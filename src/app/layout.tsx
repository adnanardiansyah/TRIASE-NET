import type { Metadata } from "next";

import { MotionProvider } from "@/components/motion-provider";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "TRIASE-Net — Layanan Aduan Mahasiswa yang Aman",
    template: "%s | TRIASE-Net",
  },
  description:
    "Sistem komunikasi aman untuk layanan aduan mahasiswa. Enkripsi adaptif, Zero Trust Network Access, dan audit yang tidak dapat disunting.",
  keywords: [
    "layanan aduan mahasiswa",
    "zero trust network access",
    "enkripsi adaptif",
    "keamanan informasi kampus",
  ],
  // Halaman publik seperti beranda memang perlu diindeks. Dashboard dan API
  // dikecualikan lewat robots.ts yang menandai /login, /mahasiswa, /satgas,
  // /admin, /aduan, dan /api sebagai disallowed.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "TRIASE-Net",
    title: "TRIASE-Net — Layanan Aduan Mahasiswa yang Aman",
    description:
      "Enkripsi adaptif, Zero Trust Network Access, dan audit yang tidak dapat disunting untuk setiap aduan mahasiswa.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className="scroll-smooth">
      <head>
        {/* Motion merender state `hidden` sebagai inline `opacity: 0` dari
            server. Tanpa JavaScript, section yang dibungkus `Reveal` tidak
            akan pernah masuk viewport dan tetap tak terlihat selamanya.
            `!important` di sini hanya berlaku ketika scripting dimatikan. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}