import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  buildRateLimitKeys,
  consumeRateLimit,
  getClientIp,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { getRoleHomePath } from "@/lib/auth/guard";
import { issueSessionToken, type SessionRole } from "@/lib/auth/jwt";
import { verifyTotp } from "@/lib/auth/totp";

const SESSION_COOKIE = "triase-session";

const SESSION_TTL_MINUTES = 240;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_MAX_ATTEMPTS = 8;
const CHALLENGE_WINDOW_MS = 5 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 5;

interface DemoUser {
  email: string;
  password: string;
  name: string;
  role: SessionRole;
  /** Base32 TOTP. Boleh ditimpa lewat environment untuk pengujian. */
  totpSecretEnvKey: string;
}

/**
 * Akun demo.
 *
 * Kredensial ini memang bagian dari demo, bukan rahasia produksi. Yang tidak
 * boleh ada adalah membocorkan data akun sebelum MFA selesai, atau membiarkan
 * kode TOTP ditebak tanpa batas.
 */
const USERS: readonly DemoUser[] = [
  {
    email: "satgas@poltek.test",
    password: "admin123",
    name: "Satgas Perwakilan",
    role: "SATGAS",
    totpSecretEnvKey: "DEMO_TOTP_SECRET_SATGAS",
  },
  {
    email: "mahasiswa@poltek.test",
    password: "mahasiswa123",
    name: "Mahasiswa Demo",
    role: "MAHASISWA",
    totpSecretEnvKey: "DEMO_TOTP_SECRET_MAHASISWA",
  },
  {
    email: "admin@poltek.test",
    password: "admin123",
    name: "Admin Demo",
    role: "ADMIN",
    totpSecretEnvKey: "DEMO_TOTP_SECRET_ADMIN",
  },
];

const DEVELOPMENT_TOTP_FALLBACK = "JBSWY3DPEHPK3PXP";

interface Challenge {
  email: string;
  ip: string;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
}

const challenges = new Map<string, Challenge>();

function sweepChallenges(now: number): void {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) {
      challenges.delete(id);
    }
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isDemoAuthEnabled(): boolean {
  if (!isProduction()) {
    return true;
  }

  return process.env.DEMO_AUTH_ENABLED === "true";
}

function getTotpSecret(user: DemoUser): string {
  const configured = process.env[user.totpSecretEnvKey];

  if (configured && configured.length > 0) {
    return configured;
  }

  if (isProduction()) {
    // Tanpa pemeriksaan ini, satu seed yang tertulis di source code berlaku
    // untuk semua akun di semua deployment produksi.
    throw new Error(
      `${user.totpSecretEnvKey} wajib disetel di produksi; tidak ada nilai cadangan yang aman.`,
    );
  }

  return DEVELOPMENT_TOTP_FALLBACK;
}

function findUser(email: string): DemoUser | undefined {
  return USERS.find((item) => item.email === email);
}

function unauthorized(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 401 });
}

/**
 * Login dua tahap.
 *
 * Tahap pertama hanya memastikan kata sandi benar, lalu mengembalikan
 * `challengeId` yang acak. Versi sebelumnya langsung mengembalikan
 * `user: { email, role, name }` pada respons "MFA diperlukan", sehingga siapa
 * pun yang tahu alamat email yang valid bisa memverifikasinya tanpa pernah
 * punya kata sandi. Sekarang respons itu tidak lagi memuat apa pun tentang
 * identitas.
 *
 * Tahap kedua menukar `challengeId` dengan kode TOTP. Ini juga menutup
 * kebocoran kode TOTP: tanpa challenge, endpoint menerima kode dari siapa pun
 * dan penebakan enam digit jadi bebas.
 */
export async function POST(request: NextRequest) {
  // Akun di atas adalah akun demo dengan kata sandi dan seed TOTP yang
  // tertulis di source code. Menjalankannya di produksi berarti siapa pun
  // yang bisa membaca repo bisa masuk sebagai admin.
  if (!isDemoAuthEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Autentikasi demo dinonaktifkan. Setel DEMO_AUTH_ENABLED=true hanya untuk environment demo.",
      },
      { status: 503 },
    );
  }

  const now = Date.now();
  sweepChallenges(now);

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    otp?: string;
    challengeId?: string;
  };

  const ip = getClientIp(request);
  const email = body.email?.trim().toLowerCase() ?? "";
  const challengeId = body.challengeId?.trim();

  // Tahap MFA hanya membawa challengeId, bukan email. Membatasi dengan
  // identitas kosong akan menggabungkan semua orang menjadi satu penghitung,
  // jadi tahap ini dibatasi berdasarkan IP saja.
  const limitKeys = challengeId ? [`auth:ip:${ip}`] : buildRateLimitKeys(ip, email);
  const allowed = limitKeys.map((key) =>
    consumeRateLimit(key, PASSWORD_MAX_ATTEMPTS, PASSWORD_WINDOW_MS),
  );

  if (allowed.some((result) => !result.allowed)) {
    const retryAfter = Math.max(...allowed.map((result) => result.retryAfterSeconds));
    return NextResponse.json(
      {
        ok: false,
        message: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (challengeId) {
    return finishMfa(challengeId, body.otp ?? "");
  }

  const user = findUser(email);
  const passwordOk = user
    ? constantTimeEquals(user.password, body.password ?? "")
    : constantTimeEquals("__no_such_user__", body.password ?? "");

  if (!user || !passwordOk) {
    return unauthorized("Kredensial tidak valid.");
  }

  const newChallengeId = randomUUID();
  challenges.set(newChallengeId, {
    email: user.email,
    ip,
    issuedAt: now,
    expiresAt: now + CHALLENGE_WINDOW_MS,
    attempts: 0,
  });

  return NextResponse.json({
    ok: true,
    mfaRequired: true,
    challengeId: newChallengeId,
    message: "Kode MFA diperlukan untuk melanjutkan login.",
  });
}

function finishMfa(challengeId: string, otp: string): NextResponse {
  const challenge = challenges.get(challengeId);

  if (!challenge) {
    return unauthorized("Sesi MFA tidak valid atau sudah berakhir.");
  }

  challenge.attempts += 1;

  if (challenge.attempts > CHALLENGE_MAX_ATTEMPTS) {
    challenges.delete(challengeId);
    return unauthorized("Terlalu banyak percobaan MFA. Silakan masuk ulang.");
  }

  const user = findUser(challenge.email);

  if (!user) {
    challenges.delete(challengeId);
    return unauthorized("Kredensial tidak valid.");
  }

  if (!verifyTotp(getTotpSecret(user), otp, 1)) {
    return unauthorized("Kode MFA tidak valid.");
  }

  challenges.delete(challengeId);

  const token = issueSessionToken(
    { sub: user.email, role: user.role, email: user.email },
    SESSION_TTL_MINUTES,
  );

  resetRateLimit(`auth:ip:${challenge.ip}`);
  resetRateLimit(`auth:identity:${challenge.email}`);

  const response = NextResponse.json({
    ok: true,
    message: "Login berhasil.",
    redirectTo: getRoleHomePath(user.role),
    user: { email: user.email, role: user.role, name: user.name },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * SESSION_TTL_MINUTES,
  });

  return response;
}