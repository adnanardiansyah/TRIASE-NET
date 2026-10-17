// Local worker invokes the same authenticated endpoint used by a production scheduler.
// Credentials remain in the local environment; neither headers nor payloads are logged.
import { existsSync } from "node:fs";
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
  throw new Error("Worker CLI ini khusus localhost. Gunakan scheduler terautentikasi untuk hosting.");
}
const secret = process.env.CRON_SECRET;
if (!secret || secret.length < 32) throw new Error("CRON_SECRET belum dikonfigurasi.");
const once = process.argv.includes("--once");
let stopped = false;
let timer;
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { stopped = true; clearTimeout(timer); controller.abort(); });
}
async function tick() {
  try {
    const response = await fetch(new URL("/api/internal/auth-mail", origin), {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]),
    });
    if (!response.ok) throw new Error("Worker HTTP failure");
    const data = await response.json();
    if (once || data.delivered || data.failed) {
      process.stdout.write(`Worker: terkirim=${Number(data.delivered ?? 0)}, gagal=${Number(data.failed ?? 0)}\n`);
    }
  } catch {
    if (!stopped) {
      console.error("Worker belum berhasil. Pastikan aplikasi berjalan dan konfigurasi terbaru sudah dimuat.");
      if (once) process.exitCode = 1;
    }
  }
  if (!once && !stopped) timer = setTimeout(tick, 10000);
}
process.stdout.write("Worker email lokal aktif. Hentikan dengan Ctrl+C.\n");
await tick();
