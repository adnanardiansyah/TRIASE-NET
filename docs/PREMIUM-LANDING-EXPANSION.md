# Pengembangan landing page TRIASE-Net

18 Oktober 2026

## Implementasi
- `src/components/landing-experience.tsx` baru: panel interaktif tiga tab (identitas, perlindungan, tindak lanjut) dan diagram privasi berbasis HTML/CSS serta ikon existing. Mendukung ArrowLeft/Right, Home/End, roving tabindex, tabpanel dan aria-selected.
- `src/app/landing-premium.css` baru: gaya khusus landing, panel visual, detail kartu kategori, kartu privasi, tiga kartu peran, FAQ dan footer. Layout menyesuaikan desktop/tablet/mobile; hover menggunakan transform dan menghormati reduced motion.
- `src/components/site-home.tsx`: mengintegrasikan panel dan diagram, memperkaya kategori, timeline callout, kartu peran, bantuan, CTA dan navigasi footer. Section existing tetap ada.
- `src/app/globals.css`: mengimpor stylesheet khusus landing.
- `scripts/qa-landing-premium.mjs` baru: QA browser lokal melalui CDP tanpa dependensi tambahan, viewport 1440/768/390/320px; screenshot, overflow, style yang termuat, posisi hero/navbar, tab keyboard, anchor, FAQ, Escape menu, reduced motion, dan error browser.

Foto wisuda, logo, wave aktif, entrance hero, timeline progresif, serta CTA/routing dipertahankan. Tidak menambahkan dependensi, statistik, testimoni, atau data tiket contoh. Diagram layanan bersifat penjelasan fitur; tidak mengambil atau menampilkan data mahasiswa. Auth/backend tidak diubah.

## Validasi
- Typecheck: lulus.
- Lint: lulus; lint skrip QA baru juga lulus.
- Build produksi: kompilasi dan prerender 22 halaman lulus. Cache CSS lama ditemukan melalui screenshot; rebuild tanpa cache dilakukan untuk memverifikasi stylesheet terbaru.
- Hasil browser final: lihat `artifacts/landing-qa/premium-results.json` dan screenshot dengan prefix premium.
- Pengujian ini tidak mencakup audit WCAG/Lighthouse menyeluruh, autentikasi dengan akun nyata, atau perangkat fisik.

## Hasil akhir
Build ulang tanpa cache lulus. QA browser pada empat viewport lulus tanpa kegagalan; stylesheet terbaru terkonfirmasi, tidak ada overflow horizontal atau error browser. Screenshot panel layanan, kategori, privasi, dan FAQ ditinjau secara visual pada desktop dan mobile. Tab keyboard (ArrowRight/Home/End), menu Escape, FAQ, anchor, dan reduced motion lulus.
