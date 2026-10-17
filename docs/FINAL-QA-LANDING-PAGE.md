# Final QA landing page TRIASE-Net

Tanggal: 14 Oktober 2026. Pengujian lokal pada build produksi Next.js dengan Edge headless 155.0.4283.45. Tidak ada redesign atau penambahan animasi.

## Temuan dan perubahan

- **Diperbaiki:** foto wisuda berhasil dimuat tetapi tersembunyi di screenshot hero. Urutan lapisan di `globals.css` diperbaiki: foto z-index 0, overlay 1. Foto yang sama kembali terlihat pada desktop, tablet, dan mobile; transform foto tetap `none`.
- Gelombang ditempatkan pada z-index 2 agar overlay tidak menimpa warna transisi ke section berikutnya. Geometri, durasi, dan arah animasi tetap.
- Foto kini menjadi visual utama; intensitas gradient dan partikel tidak perlu diubah berdasarkan screenshot ketiga viewport. Teks tetap terbaca.
- Skrip QA diperluas dari tombol utama ke seluruh 16 tautan internal layanan/login, termasuk delapan kategori.
- **Temuan di luar lingkup, belum diperbaiki:** klik delapan kategori pada sesi tanpa login berakhir di `/login?category=...`, tanpa parameter `redirect`. CTA utama menghasilkan `/login?redirect=...` dengan benar. Pemulihan kategori setelah login belum diuji. Routing, autentikasi, dan backend tidak diubah.

## Hasil pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| Screenshot hero dan timeline | Ditinjau langsung pada 1440×900, 768×1024, 390×844 |
| Entrance hero | Urutan onset label, branding, judul, deskripsi, kedua CTA, dan catatan privasi lulus; stagger CTA terukur berurutan |
| Gelombang SVG | Tile berdampingan; screenshot pada 0, 35.999, dan 36.000 detik tersedia; tidak terlihat sambungan pada sampel yang ditinjau; endpoint/tangen SVG cocok |
| Scroll reveal | Scroll cepat ke bawah/kembali ke atas dan navigasi empat section lulus; elemen yang terlihat mencapai opacity 1 |
| Timeline | Tiga tahap; horizontal pada 1440/768px, vertikal pada 390px; screenshot ditinjau |
| Navbar/anchor | Empat target tidak tertutup sticky header, active state sesuai target; kembali ke hero menghapus active state |
| CTA utama | Sampaikan aduan, Lacak tiket, Buat aduan, dan tautan login mencapai tujuan/gerbang login sesuai pemeriksaan |
| Delapan kategori | Mencapai login tetapi kehilangan parameter redirect; assertion CTA gagal pada ketiga viewport |
| FAQ | Kelima FAQ dapat dibuka/ditutup dengan klik, Enter, dan Space pada ketiga viewport |
| Keyboard | Sampel Tab menampilkan outline fokus; Escape menutup menu mobile; FAQ Enter/Space lulus |
| Reduced motion | Atmosfer disembunyikan, wave tanpa animasi, smooth scroll nonaktif, hero tanpa transform/blur dan opacity 1 |
| Overflow/CLS/hidrasi | Tidak ada overflow horizontal pada posisi yang diuji; CLS 0; tidak ada console error/exception atau hydration error yang tertangkap |
| Build/typecheck/lint | `npm.cmd run build`, `npm.cmd run typecheck`, dan `npm.cmd run lint` lulus. Lint awal sempat membaca JavaScript ekstensi Edge dari profil sementara; profil tersebut sudah dihapus dan lint standar dijalankan ulang dengan sukses |

Hasil browser lengkap: `artifacts/landing-qa/verified-results.json`. Skrip keluar dengan kode 1 karena tiga assertion CTA (masing-masing satu per viewport), bukan seluruh pemeriksaan lulus. Screenshot berawalan `verified-` menunjukkan kondisi sesudah perbaikan; `recheck-` adalah kondisi sebelum perbaikan.

## Metrik

| Viewport | LCP | CLS |
| --- | --- | --- |
| Desktop 1440×900 | 620 ms | 0 |
| Tablet 768×1024 | 1324 ms | 0 |
| Mobile 390×844 | 540 ms | 0 |

Diukur dengan PerformanceObserver pada pemuatan awal browser lokal, tanpa throttling CPU/jaringan; hasil satu kali jalan, kondisi cache dapat berbeda. Ini bukan skor Lighthouse atau data lapangan. CLS diamati pada pemuatan awal sebelum interaksi, bukan jaminan seluruh sesi.

Lighthouse tidak terpasang/tidak tersedia: **Performance, Accessibility, Best Practices: belum diukur**.

## Batas verifikasi dan checklist manual

- [ ] Amati loop wave penuh dan scroll cepat di perangkat nyata untuk flicker, dropped frames, dan gerakan patah. Screenshot batas loop serta pemeriksaan geometri belum membuktikan FPS/kualitas temporal.
- [ ] Uji Safari/iOS dan Firefox; sesi ini hanya Edge headless, viewport mobile adalah emulasi.
- [ ] Jalankan Lighthouse pada build produksi dengan konfigurasi throttling yang dicatat.
- [ ] Uji alur kategori hingga setelah login pada sesi terotorisasi dan perbaiki pemulihan tujuan dalam pekerjaan routing/autentikasi terpisah.
- [ ] Lakukan penelusuran Tab seluruh halaman, aktivasi CTA dengan keyboard, serta pemeriksaan screen reader. Sesi ini menguji sampel fokus, FAQ, dan Escape, bukan audit aksesibilitas lengkap.
- [ ] Ukur CLS sepanjang sesi dan performa jaringan lambat/perangkat kelas rendah.
