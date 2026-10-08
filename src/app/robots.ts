import type { MetadataRoute } from "next";

/**
 * Aturan per-bot.
 *
 * `src/app/layout.tsx` mengizinkan indeks untuk halaman publik, jadi halaman
 * yang memuat data aduan harus dicoret di sini. Tanpa berkas ini, begitu
 * layout diindeks, `/login` dan dashboard ikut terindeks.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/login",
          "/mahasiswa",
          "/satgas",
          "/admin",
          "/aduan",
          "/api",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}