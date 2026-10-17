# Halaman dashboard terpisah

18 Oktober 2026

## Navigasi
| Peran | Ringkasan | Daftar aduan | Analitik |
| --- | --- | --- | --- |
| Mahasiswa | /mahasiswa | /mahasiswa/aduan | /mahasiswa/analitik |
| Satgas | /satgas | /satgas/aduan | /satgas/analitik |
| Admin | /admin | /admin/aduan | /admin/analitik |

Mahasiswa tetap memakai /aduan/baru dan /aduan/lacak untuk membuat dan melacak tiket. Detail /aduan/[ticket] tetap dipakai semua peran sesuai kewenangan. Tautan kembali dari form, tracker, dan detail kini menuju daftar aduan. Sidebar aktif mengikuti pathname; menu daftar tidak lagi berupa anchor. Bookmark #aduan/#analitik dan URL filter pada ringkasan diarahkan ke route baru.

## Fungsi halaman
- Ringkasan: statistik yang dapat diklik, akses cepat sesuai peran, aduan aktif berdasarkan tenggat untuk staf, serta pembaruan tiket berdasarkan updatedAt. Tidak menampilkan seluruh tabel atau analitik.
- Aduan: pencarian, filter kombinasi, kelompok status, urutan risiko/tenggat, tabel/kartu, pagination, hapus chip, bagikan URL tanpa teks pencarian, detail tiket, ekspor CSV staf, dan perubahan status staf dengan expectedVersion existing.
- Analitik: jumlah terfilter, grafik pengajuan 7/30/90 hari, kategori, risiko, status, target/SLA, reset filter, dan tautan menuju daftar dengan filter terkait. Filter kalender mengikuti tanggal WIB agar selaras dengan bucket grafik. Pada pilihan Seluruh waktu, distribusi dan ringkasan mencakup seluruh data; grafik aktivitas tetap menampilkan tujuh hari terakhir.
- Loading, kosong, gagal, dan akses ditolak ditampilkan terpisah. Retry memuat ulang API. Akun dengan mandat/status tugas yang tidak sesuai tetap ditolak, bukan diberi hasil nol atau akses tambahan.

## Implementasi
- Enam page baru di area mahasiswa, satgas (route group dashboard), dan admin.
- src/components/dashboard/role-dashboard.tsx mengatur tiga jenis halaman dengan API existing.
- dashboard-overview.tsx dan dashboard-analytics.tsx baru memisahkan tampilan ringkasan dan analitik.
- src/lib/dashboard-routes.ts memusatkan tujuan route, drilldown filter dan migrasi bookmark lama.
- workspace-shell.tsx, student-forms.tsx, ticket-detail-screen.tsx memperbarui navigasi.
- workspace-premium.css menambahkan panel ringkasan/analitik responsive.
- dashboard-view.ts memperluas bucket hari grafik dan batas kalender WIB.
- Tes route dan periode ditambahkan; skrip QA browser khusus di scripts/qa-dashboard-pages.mjs.

Autentikasi, backend/API, workflow status, data tiket, dan policy akses tidak diubah. Tidak ada dependensi baru.

## Validasi
Typecheck dan lint lulus. 51 tes filter, tanggal, route/otorisasi, CSV, dan agregasi lulus. Build produksi menghasilkan 28 halaman statis termasuk enam route baru.

Pengujian browser menggunakan metadata sintetis dengan semua API diintersep, tanpa menulis database. Hasilnya disimpan di artifacts/dashboard-pages-qa/pages-results.json. Ini menguji UI dan navigasi, bukan bukti mutasi database nyata.

Pemeriksaan langsung ke localhost:3000: MFA Mahasiswa/Satgas berhasil; daftar, detail, dan notifikasi merespons 200. Login Admin berhasil, tetapi API daftar dan notifikasi menolak 403 karena status tugas/mandat existing. Hak tersebut tidak diperluas. Tidak ada tiket nyata yang dibuat atau diubah untuk QA ini. Uji integrasi pengiriman/reply/perubahan status pada data nyata dan audit WCAG/Lighthouse menyeluruh tetap terpisah.

Hasil browser akhir: 9 skenario lengkap (3 peran x 1440/390/320px) dan 6 pemeriksaan route tanpa sesi lulus, tanpa kegagalan. Meliputi navigasi sidebar/menu aktif, isi halaman terpisah, pencarian, pagination, tabel/kartu, filter/share, CSV staf, transisi status pada fixture, rentang grafik, kategori/drilldown, reset, bookmark lama, reduced motion, serta overflow. Penolakan akses dan pemulihan melalui retry diuji terpisah. Tidak ada error browser pada sembilan skenario utama.
