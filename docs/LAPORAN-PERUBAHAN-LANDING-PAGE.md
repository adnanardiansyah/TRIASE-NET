# Laporan Perubahan Landing Page TRIASE-Net

**Tanggal laporan:** 14 Oktober 2026  
**Status:** Implementasi lokal selesai; pemeriksaan kode dan build lulus.  
**Fokus:** Penyempurnaan animasi dan interaktivitas landing page existing.

## 1. Tujuan

Meningkatkan pengalaman landing page agar terasa modern, halus, profesional,
dan konsisten dengan identitas TRIASE-Net. Perubahan mengikuti spesifikasi
pengguna tanpa membangun ulang halaman atau mengubah proses layanan aduan.

Crypgo dan PLAY IT! digunakan sebagai referensi arahan. Crypgo tidak dapat
diakses melalui alat web. Konten PLAY IT! dapat dibaca, tetapi animasi kedua
referensi tidak diverifikasi langsung melalui browser. Implementasi mengacu
pada spesifikasi yang diberikan, tanpa menyalin desain referensi.

## 2. Kondisi Awal

Proyek memakai Next.js App Router, React, TypeScript, dan Tailwind CSS.
Library `motion` sudah terpasang sehingga tidak diperlukan pemasangan library
animasi tambahan.

Landing page sebelumnya sudah memiliki foto wisuda, navbar, kategori layanan,
alur pengaduan, informasi privasi, bantuan, CTA, footer, serta komponen
`Reveal` dan `RevealGroup`. Entrance hero, reveal, dan beberapa hover interaction
juga sudah tersedia. Pekerjaan ini menyempurnakan implementasi tersebut serta
menambahkan timeline interaktif dan atmosfer hero.

## 3. Perubahan yang Dikerjakan

| Bagian | Implementasi | Dampak bagi pengguna |
| --- | --- | --- |
| Entrance hero | Label fade-in; heading branding fade-up dengan blur 3px menuju jelas; subheading dan deskripsi menyusul | Pembukaan halaman memiliki urutan visual yang lebih terarah |
| Tombol hero | Stagger 0,12 detik dengan durasi 0,65 detik | Kedua pilihan utama muncul bergantian secara halus |
| Partikel hero | SVG dengan 18 titik di desktop dan 9 titik pada layar di bawah 768px; opacity 0,16 | Menambah nuansa teknologi tanpa garis koneksi atau efek terang |
| Interaksi pointer | Dorongan partikel maksimal 10 unit SVG dalam radius 85 unit SVG; memakai spring | Respons pointer ringan dan terbatas di sekitar partikel |
| Gradasi ambient | Gradasi emerald/teal transparan bergerak perlahan selama 26 detik | Menambah kedalaman pada hero tanpa menggerakkan foto |
| Gelombang | Gelombang SVG tunggal berwarna terang mengikuti background bagian berikutnya; loop horizontal 36 detik | Transisi antarseksi lebih bersih dan tidak tertutup lapisan hijau tebal |
| Scroll reveal | Opacity 0 ke 1 dan pergeseran 24px, umumnya selama 0,65–0,7 detik | Informasi muncul bertahap ketika area terkait masuk viewport |
| Alur pengaduan | Garis penghubung terisi mengikuti scroll; ikon dan warna tahap mendapat highlight saat terlihat | Tiga tahap pengaduan lebih mudah diikuti secara visual |
| Responsivitas timeline | Horizontal mulai 768px dan vertikal pada layar lebih kecil | Alur tetap terbaca pada desktop, tablet, dan ponsel berdasarkan aturan CSS |
| Kartu dan informasi | Hover lift maksimal 4px, shadow lembut, serta highlight border existing | Elemen terasa responsif tanpa mengubah layout kartu |
| CTA hover | Lift maksimal 2px, transisi warna/shadow, dan panah bergeser 3px | Umpan balik interaksi lebih konsisten |
| Navbar | Highlight menu mengikuti section yang terlihat; perubahan shadow ringan setelah scroll | Posisi pengunjung pada halaman lebih mudah dikenali |
| Navigasi anchor | Smooth scrolling native dan kompensasi sticky navbar | Navigasi menuju Layanan, Alur, Privasi, dan Bantuan tetap tersedia |
| Footer dan informasi bawah | Reveal pada elemen penyusun, menggantikan animasi seluruh section besar | Ritme animasi lebih merata di sepanjang halaman |

Entrance hero memakai durasi 0,6–0,75 detik, jeda sekitar 0,12–0,15 detik,
dan pergeseran maksimal 24px. Easing utama yang digunakan adalah
`[0.22, 1, 0.36, 1]`.

Nama dan urutan alur pengaduan tetap:

1. Sampaikan dengan jelas.
2. Petugas menindaklanjuti.
3. Ikuti perkembangannya.

Highlight timeline hanya menjelaskan alur secara visual dan tidak mengubah
status tiket atau data aduan.

## 4. File Baru

| File | Fungsi |
| --- | --- |
| `src/components/hero-atmosphere.tsx` | Partikel SVG, interaksi pointer, deteksi viewport, dan visibilitas tab |
| `src/components/hero-atmosphere.module.css` | Tampilan partikel, gradasi ambient, pembatasan partikel mobile, dan reduced motion |
| `src/components/complaint-timeline.tsx` | Timeline tiga tahap, progress berbasis scroll, entrance, dan highlight ikon |
| `src/components/complaint-timeline.module.css` | Garis penghubung, marker, layout horizontal/vertikal, dan fallback reduced motion |

## 5. File yang Dimodifikasi

| File | Perubahan |
| --- | --- |
| `src/components/site-home.tsx` | Integrasi atmosfer dan timeline, urutan hero, active navbar, serta reveal per elemen |
| `src/components/reveal.tsx` | Opsi blur yang default-nya nonaktif dan pemicu mount pada `RevealGroup` |
| `src/components/hero-wave.tsx` | Penyederhanaan menjadi satu gelombang SVG dengan tile seamless |
| `src/components/hero-wave.module.css` | Penghapusan lapisan hijau dan perubahan durasi loop menjadi 36 detik |
| `src/app/globals.css` | Active navbar, hover, anchor offset, pause gelombang, fokus keyboard, reduced motion, dan tampilan cetak |
| `src/app/layout.tsx` | Fallback tanpa JavaScript juga menghapus blur agar teks tetap jelas |

**Dependency tambahan: tidak ada.** Implementasi menggunakan Motion yang sudah
tersedia, CSS, SVG, dan API browser. GSAP, tsParticles, dan library smooth-scroll
tambahan tidak dipasang.

## 6. Performa dan Aksesibilitas

- Foto wisuda tidak diberi zoom atau parallax.
- Gerakan utama memakai transform dan opacity. Blur dibatasi pada entrance
  heading branding dan tidak diterapkan pada foto.
- Koordinat partikel ditentukan secara tetap, tanpa `Math.random()` saat render,
  untuk menjaga konsistensi hasil server dan render awal klien.
- Pointer memakai Motion values dan pembaruan yang dibatasi dengan
  `requestAnimationFrame`, bukan React state pada setiap pergerakan.
- Interaksi pointer hanya aktif untuk mouse pada perangkat dengan fine pointer;
  sentuhan tidak memicu interaksi partikel.
- Animasi atmosfer dan gelombang dijeda ketika hero tidak terlihat atau tab
  disembunyikan.
- Elemen dekoratif diberi `aria-hidden` dan tidak menangkap klik.
- Fokus keyboard tetap terlihat; elemen reveal yang menerima fokus langsung
  dibuat terbaca.
- `prefers-reduced-motion` menonaktifkan atmosfer dan gerakan dekoratif,
  menampilkan konten tanpa transform/blur, serta menonaktifkan smooth scrolling.
- Fallback tanpa JavaScript dan saat mencetak menjaga konten reveal tetap jelas.
- Tidak ada Client Component baru pada root layout; komponen interaktif memakai
  provider Motion yang sudah tersedia.

Langkah-langkah tersebut merupakan pengendalian performa pada implementasi.
Belum ada pengukuran FPS, Lighthouse, Core Web Vitals, atau profiling browser.

## 7. Bagian yang Dipertahankan

Foto wisuda, identitas dan logo TRIASE-Net, desain dasar navbar, layout utama,
isi layanan, nama/urutan tahapan, serta tujuan tombol tetap dipertahankan.
Perubahan animasi ini tidak mengubah routing, autentikasi, pembuatan aduan,
pelacakan tiket, atau aturan akses data.

Pekerjaan logo/favicon, desain premium, notifikasi dashboard, dan tenggat tiket
telah dilakukan pada pekerjaan sebelumnya. Fitur-fitur tersebut tetap ada,
tetapi bukan perubahan baru dalam lingkup laporan animasi ini.

## 8. Pengujian dan Hasil Verifikasi

| Pemeriksaan | Hasil | Batas verifikasi |
| --- | --- | --- |
| `npm run typecheck` | Lulus | Memeriksa tipe TypeScript |
| `npm run lint` | Lulus | Memeriksa aturan kode proyek |
| `npm run build` | Lulus | Build produksi dan prerender selesai tanpa error |
| HTML hasil prerender | Lulus | Satu H1, empat target anchor, tujuan CTA, teks timeline, dan referensi foto wisuda ditemukan |
| Konsistensi render awal | Ditinjau pada kode | State awal dan koordinat partikel dibuat deterministik; hidrasi browser belum diuji |
| Responsivitas | Ditinjau pada CSS | Breakpoint timeline dan jumlah partikel sudah tersedia; visual perangkat belum diuji |
| Reduced motion | Ditinjau pada kode/CSS | Fallback tersedia; perilaku aktual browser belum diuji |
| Performa aktual | Belum diukur | Memerlukan browser dan alat profiling |

Alat browser tidak tersedia pada sesi implementasi. Karena itu, laporan ini
tidak menyatakan bahwa visual desktop/tablet/mobile, hidrasi, interaksi pointer,
keyboard navigation, atau performa aktual telah lolos pengujian browser.
Pemeriksaan HTML memastikan tujuan navigasi tetap ada, bukan pengujian klik
secara langsung.

## 9. Pemeriksaan Lanjutan yang Disarankan

Saat browser tersedia, periksa landing page pada desktop, tablet, dan ponsel;
uji navigasi anchor, CTA, FAQ, dan keyboard; aktifkan reduced motion; lalu
ukur performa serta pastikan tidak ada layout shift atau scrollbar horizontal.
Sesuaikan intensitas efek hanya jika hasil pengujian perangkat menunjukkan
kebutuhan tersebut.

## 10. Hasil Akhir

Implementasi lokal kini memiliki entrance hero bertahap, atmosfer ringan,
timeline berbasis scroll, gelombang terang seamless, dan microinteraction yang
konsisten. Pemeriksaan tipe, lint, build produksi, serta struktur HTML hasil
render telah lulus. Verifikasi visual dan pengukuran performa browser masih
menjadi pekerjaan lanjutan.
