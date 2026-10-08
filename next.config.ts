import type { NextConfig } from "next";

/**
 * Header keamanan.
 *
 * Aplikasi ini menangani aduan mahasiswa, jadi cookie sesi dan ciphertextnya
 * sensitif. Header di bawah menutup kelas serangan yang tidak perlu
 * ditambahkan satu per satu.
 *
 * Catatan CSP:
 *
 * - `unsafe-inline` pada `style-src` diperlukan karena Tailwind dan Next.js
 *   menyuntikkan blok `<style>` saat runtime.
 * - `unsafe-inline` pada `script-src` diperlukan untuk payload RSC
 *   (`self.__next_f`) yang di-inline di dalam HTML hasil render.
 * - `unsafe-eval` HANYA untuk mode pengembangan. Fast Refresh milik Next.js
 *   menyuntikkan modul memakai `eval()` di `@next/react-refresh-utils`, dan
 *   webpack dev server memakai `eval` untuk source map. Tanpa `unsafe-eval`,
 *   browser menolak `main-app.js` dengan EvalError sehingga Fast Refresh mati
 *   total. Pada produksi CSP tetap ketat tanpa `unsafe-eval`.
 * - `ws:`/`wss:` pada `connect-src` hanya untuk hot reload dev server.
 *   WebSocket punya scheme sendiri, jadi tidak tercakup oleh `'self'`.
 *
 * `NODE_ENV` dibaca saat build: `next build` menyetelnya ke `production` dan
 * hasil `headers()` disimpan di routes-manifest, sehingga `next start` selalu
 * memakai CSP produksi.
 */
const isDevelopment = process.env.NODE_ENV !== "production";

const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])].join(" ");

const connectSrc = ["'self'", ...(isDevelopment ? ["ws:", "wss:"] : [])].join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Token otentikasi ZTNA hanya boleh melalui kanal aman dan dikodekan
  // server-side.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
