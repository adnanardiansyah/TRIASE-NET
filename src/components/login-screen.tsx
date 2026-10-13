"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, Fingerprint, GraduationCap, KeyRound, Loader2, Monitor, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { Brand } from "./brand";
import { getRoleHomePath, isAllowedForRole } from "@/lib/auth/guard";
import type { SessionRole } from "@/lib/auth/jwt";
import { UNKNOWN_TRANSPORT, assessLoginContext, collectDeviceSignals, parseTransportContext, type ContextAssessment } from "@/lib/ztna/device-context";

const accounts = [
  { role: "MAHASISWA" as const, label: "Mahasiswa", email: "mahasiswa@poltek.test", password: "mahasiswa123", icon: GraduationCap },
  { role: "SATGAS" as const, label: "Satgas", email: "satgas@poltek.test", password: "admin123", icon: ShieldCheck },
  { role: "ADMIN" as const, label: "Admin", email: "admin@poltek.test", password: "admin123", icon: KeyRound },
] as const;
type LoginResult = { ok?: boolean; message?: string; mfaRequired?: boolean; challengeId?: string; user?: { role?: SessionRole } };

function redirectAfterLogin(role: SessionRole) {
  const home = getRoleHomePath(role);
  const requested = new URLSearchParams(window.location.search).get("redirect");
  if (requested?.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")) {
    const url = new URL(requested, window.location.origin);
    if (url.origin === window.location.origin && url.pathname !== "/login" && isAllowedForRole(url.pathname, role)) return window.location.assign(url.pathname + url.search + url.hash);
  }
  window.location.assign(home);
}

export function LoginScreen() {
  const [role, setRole] = useState<SessionRole>("MAHASISWA");
  const [email, setEmail] = useState<string>(accounts[0].email);
  const [password, setPassword] = useState<string>(accounts[0].password);
  const [visible, setVisible] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState<ContextAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [expiresAt, setExpiresAt] = useState(0);
  const [expired, setExpired] = useState(false);
  const otpInput = useRef<HTMLInputElement>(null);
  const assess = useCallback(async (signal?: AbortSignal) => {
    setAssessing(true); setContextError(false);
    let transport = UNKNOWN_TRANSPORT;
    try { const response = await fetch("/api/ztna/context", { cache: "no-store", signal }); if (!response.ok) throw new Error(); transport = parseTransportContext(await response.json()); }
    catch { if (signal?.aborted) return; setContextError(true); }
    setContext(assessLoginContext(collectDeviceSignals(), transport, false)); setAssessing(false);
  }, []);
  useEffect(() => { const controller = new AbortController(); void assess(controller.signal); return () => controller.abort(); }, [assess]);
  useEffect(() => {
    if (!challenge) return;
    otpInput.current?.focus();
    const tick = () => { setSeconds(30 - Math.floor(Date.now() / 1000) % 30); setExpired(Date.now() >= expiresAt); };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [challenge, expiresAt]);
  const reset = () => { setChallenge(""); setOtp(""); setError(""); setExpired(false); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || expired) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(challenge ? { challengeId: challenge, otp } : { email: email.trim(), password }) });
      let data: LoginResult;
      try { data = await response.json(); } catch { throw new Error("Layanan login belum dapat memberikan respons. Coba lagi."); }
      if (!response.ok || !data.ok) { setError(data.message ?? "Login belum berhasil."); return; }
      if (data.mfaRequired && data.challengeId) { setChallenge(data.challengeId); setExpiresAt(Date.now() + 5 * 60_000); setOtp(""); return; }
      const actualRole = data.user?.role;
      if (actualRole && ["MAHASISWA", "SATGAS", "ADMIN"].includes(actualRole)) { redirectAfterLogin(actualRole); return; }
      setError("Respons login tidak lengkap. Silakan masuk ulang.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Tidak dapat menghubungi server."); }
    finally { setPending(false); }
  }

  return <main className="grid min-h-svh bg-white lg:grid-cols-[.95fr_1.05fr]">
    <aside className="landing-photo relative hidden min-h-svh flex-col justify-between p-10 text-white lg:flex xl:p-14"><div className="relative z-10"><Brand light /><Link href="/" className="mt-9 inline-flex items-center gap-2 text-xs text-emerald-100/80 hover:text-white"><ArrowLeft size={14} />Kembali ke beranda</Link></div><div className="relative z-10 max-w-md py-16"><p className="mb-5 text-[11px] font-semibold text-emerald-200">RUANG UNTUK SUARA ANDA</p><h2 className="text-4xl font-medium leading-tight">Perubahan yang baik<br />dimulai dari keberanian<br />untuk bercerita.</h2><p className="mt-6 max-w-sm text-sm leading-7 text-emerald-100/80">Sampaikan aduan, ikuti penanganannya, dan tetap terhubung dengan petugas melalui satu tiket.</p></div><div className="relative z-10 flex flex-wrap gap-5 border-t border-white/20 pt-6 text-[10px] text-emerald-100/80"><span className="inline-flex items-center gap-2"><Fingerprint size={14} />Identitas berpseudonim</span><span className="inline-flex items-center gap-2"><ShieldCheck size={14} />Akses terverifikasi</span></div></aside>
    <div className="flex min-w-0 flex-col px-5 py-6 sm:px-10 lg:px-14">
      <div className="flex items-center justify-between lg:justify-end"><div className="lg:hidden"><Brand compact /></div><Link href="/#bantuan" className="text-xs text-zinc-500 hover:text-emerald-700">Pusat bantuan<ArrowRight size={12} className="ml-2 inline" /></Link></div>
      <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col justify-center py-10 lg:py-12">
        <div className="mb-7"><span className="mb-5 inline-grid size-11 place-items-center rounded-lg bg-emerald-50 text-emerald-700">{challenge ? <Smartphone size={22} strokeWidth={1.5} /> : <KeyRound size={22} strokeWidth={1.5} />}</span><div className="mb-3 flex items-center gap-2 text-[10px] font-medium"><span className="flex items-center gap-1.5 text-emerald-700"><span className="grid size-4 place-items-center rounded-full bg-emerald-100">{challenge ? <Check size={10} /> : "1"}</span>Akun</span><span className="h-px w-7 bg-zinc-200" /><span className={`flex items-center gap-1.5 ${challenge ? "text-emerald-700" : "text-zinc-400"}`}><span className={`grid size-4 place-items-center rounded-full ${challenge ? "bg-emerald-100" : "bg-zinc-100"}`}>2</span>Verifikasi</span></div><h1 className="text-[28px] font-semibold text-zinc-900">{challenge ? "Verifikasi akun Anda" : "Selamat datang kembali."}</h1><p className="mt-3 text-[13px] leading-6 text-zinc-500">{challenge ? "Masukkan kode 6 digit dari autentikator untuk melanjutkan." : "Masuk untuk melanjutkan ke ruang kerja Anda."}</p></div>
        {error && <p role="alert" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert mb-5">{error}</p>}
        {expired && <p role="alert" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert mb-5">Sesi verifikasi berakhir. Kembali ke langkah akun untuk masuk ulang.</p>}
        {!challenge ? <form key="account" onSubmit={submit} className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none space-y-5">
          <fieldset disabled={pending}><legend className="ui-label">Akun demo</legend><div className="grid grid-cols-3 gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1">{accounts.map((account) => <button key={account.role} type="button" aria-pressed={role === account.role} onClick={() => { setRole(account.role); setEmail(account.email); setPassword(account.password); setError(""); }} className={`flex min-w-0 items-center justify-center gap-1.5 rounded py-2 text-[11px] transition-colors ${role === account.role ? "bg-white font-semibold text-emerald-700 shadow-sm" : "text-zinc-400 hover:text-zinc-700"}`}><account.icon size={13} />{account.label}</button>)}</div></fieldset>
          <div><label htmlFor="login-email" className="ui-label">Email</label><input id="login-email" type="email" autoComplete="username" required maxLength={254} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} className="ui-input" placeholder="nama@kampus.ac.id" /></div>
          <div><label htmlFor="login-password" className="ui-label">Password</label><div className="relative"><input id="login-password" type={visible ? "text" : "password"} autoComplete="current-password" required maxLength={256} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} className="ui-input pr-11" /><button type="button" onClick={() => setVisible(!visible)} title={visible ? "Sembunyikan password" : "Tampilkan password"} aria-label={visible ? "Sembunyikan password" : "Tampilkan password"} aria-pressed={visible} className="absolute right-3 top-3 text-zinc-400 hover:text-emerald-700">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
          <button disabled={pending} className="ui-btn ui-btn-primary w-full py-3">{pending ? <Loader2 size={16} className="animate-spin" /> : null}{pending ? "Memverifikasi..." : "Lanjutkan"}{!pending && <ArrowRight size={15} className="ml-auto" />}</button>
        </form> : <form key="otp" onSubmit={submit} className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none space-y-5"><div className="flex items-center gap-3 border-y border-zinc-100 py-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check size={15} /></span><div className="min-w-0"><p className="text-[10px] text-zinc-400">Password terverifikasi</p><p className="mt-1 truncate text-xs font-medium text-zinc-700">{email}</p></div></div><div><label htmlFor="login-otp" className="ui-label">Kode autentikator</label><input ref={otpInput} id="login-otp" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={otp} disabled={pending || expired} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} className="ui-input py-3 text-center font-mono text-2xl" /><div className="mt-3 flex items-center justify-between text-[10px] text-zinc-400"><span>Perkiraan pergantian kode</span><span className="tabular-nums">{seconds} detik</span></div><div className="mt-2 h-1 overflow-hidden rounded bg-zinc-100"><div className="h-full origin-left bg-emerald-500 transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${seconds / 30})` }} /></div></div><button disabled={pending || otp.length !== 6 || expired} className="ui-btn ui-btn-primary w-full py-3">{pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{pending ? "Memverifikasi..." : "Verifikasi & masuk"}</button><button type="button" disabled={pending} onClick={reset} className="mx-auto flex items-center gap-2 text-xs text-zinc-500 hover:text-emerald-700"><ArrowLeft size={14} />Kembali ke akun</button></form>}
        <details className="group mt-8 border-t border-zinc-200 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] text-zinc-500 [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><Monitor size={13} />{assessing ? "Memeriksa konteks peramban..." : context?.device ?? "Konteks peramban"}</span><ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" /></summary><div className="mt-4 space-y-3 text-[10px]">{contextError && <p className="text-amber-700">Konteks jaringan belum dapat dibaca.</p>}{context && <><div className="flex items-center justify-between"><span className="text-zinc-400">Penilaian konteks</span><span className={context.riskBand === "HIGH" ? "text-rose-600" : context.riskBand === "MEDIUM" ? "text-amber-600" : "text-emerald-700"}>{context.riskScore}/100</span></div>{context.checks.map((check) => <div key={check.id} className="flex items-start justify-between gap-4"><span title={check.detail} className="text-zinc-500">{check.label}</span><span className={check.status === "PASS" ? "text-emerald-700" : check.status === "WARN" ? "text-amber-600" : "text-rose-600"}>{check.status === "PASS" ? "Sesuai" : check.status === "WARN" ? "Perhatian" : "Belum sesuai"}</span></div>)}</>}<button type="button" disabled={assessing} onClick={() => void assess()} className="inline-flex items-center gap-1.5 text-emerald-700"><RefreshCw size={12} className={assessing ? "animate-spin" : ""} />Periksa ulang</button></div></details>
      </div>
      <footer className="mx-auto w-full max-w-[390px] border-t border-zinc-100 pt-5 text-center text-[10px] text-zinc-400">TRIASE-Net · Privasi pelapor, prioritas bersama.</footer>
    </div>
  </main>;
}
