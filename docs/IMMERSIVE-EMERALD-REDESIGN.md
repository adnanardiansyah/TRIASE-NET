# TRIASE-Net ? Immersive Emerald Experience

Perubahan lokal 18 Oktober 2026.

## File yang diubah dalam pekerjaan ini
- `src/components/site-home.tsx`: navbar fixed, Brand light, indikator scroll Motion, entrance aksen headline.
- `src/app/globals.css`: navbar emerald glass dengan transisi 300ms, hero 100svh, safe area, anchor offset, sage sections dan card, breakpoint yang disatukan.
- `src/components/hero-wave.tsx`: tiga lapisan SVG emerald?sage, gradient ID stabil melalui useId.
- `src/components/hero-wave.module.css`: drift horizontal 32 detik pada dekorasi belakang; dua lapisan depan statis.

Tidak ada komponen baru atau dependensi baru. HeroBackground, HeroAtmosphere, Reveal/RevealGroup, dan ComplaintTimeline digunakan kembali. Satu Image Next.js berprioritas dengan foto wisuda existing tetap menjadi latar hero dan navbar. Auth, routing, data status, backend, copywriting, dan logo tidak diubah dalam pekerjaan ini.

## Motion dan aksesibilitas
- Indikator scroll hanya satu, berupa transform scaleX pada garis 2px.
- Partikel existing tetap berjalan sesuai visibility, reduced motion, dan kemampuan pointer.
- Wave dan panah berhenti saat atmosfer menandai hero tidak aktif; CSS reduced motion menonaktifkan loop.
- Ujung kurva wave belakang memiliki tinggi dan tangen identik; pergeseran satu salinan pada track 200% secara matematis seamless. Perlu konfirmasi visual di browser.
- Menu seluler mempertahankan aria-expanded, Escape, pemulihan fokus, dan penutupan saat memilih anchor.
- Nav memiliki tinggi tetap; progress absolute tidak mengambil ruang layout. Anchor memperhitungkan header dan safe area.
- Render awal scrolled/menu tetap deterministik; useId memberi ID gradient stabil untuk SSR dan hidrasi. Tidak ada pembacaan window saat render.

## Pemeriksaan manual yang diperlukan
Browser interaktif tidak tersedia pada sesi ini. Screenshot lama di artifacts bukan bukti untuk perubahan ini.
Periksa desktop, tablet, dan mobile 320px: framing foto, kontras, menu keyboard, notch, overflow, posisi headline, scroll anchor, loop 32 detik, reduced motion, serta navigasi CTA/login. Audit WCAG AA dan LCP perlu pengukuran browser.

Dua referensi ThemeWagon tidak dapat dibuka melalui alat web; referensi PLAY IT dapat diakses. Implementasi mengikuti brief pengguna tanpa menyalin konten referensi.

## Hasil pemeriksaan otomatis
- `npm.cmd run typecheck`: lulus.
- `npm.cmd run lint`: lulus.
- `git diff --check` untuk empat file implementasi: lulus.
- `npm.cmd run build`: lulus; 22 halaman statis berhasil dihasilkan.
