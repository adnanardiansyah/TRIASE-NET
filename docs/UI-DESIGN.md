# Sistem Visual TRIASE-Net

Pembaruan ini berlaku pada landing page, login, ketiga dashboard, formulir
aduan, pelacakan, detail tiket, percakapan, serta verifikasi tambahan MFA.

## Identitas

- Permukaan putih dan abu netral untuk keterbacaan data.
- Emerald untuk identitas dan aksi utama.
- Biru untuk proses, amber untuk perhatian, merah untuk risiko tinggi.
- Sidebar charcoal sebagai pembeda navigasi dan area kerja.
- Radius komponen maksimal 8px, kecuali avatar, indikator, dan diagram donat.
- Animasi singkat pada masuknya elemen dan perubahan state. Tidak ada
  backdrop blur besar, orb, atau dekorasi yang terus bergerak.

Komponen utama: `workspace-shell.tsx`, `dashboard/role-dashboard.tsx`,
`site-home.tsx`, `login-screen.tsx`, dan `student-forms.tsx`.
Token dan kontrol bersama didefinisikan di `src/app/globals.css` dalam
layer components agar utility Tailwind tetap dapat mengatur responsivitas.

## Dashboard

Mahasiswa mendapatkan daftar aduan sendiri, ringkasan proses, pelacakan,
formulir pengajuan, timeline, dan percakapan. Satgas mendapatkan antrean
dalam kewenangannya, filter, pengurutan, perubahan status dengan versi baris,
serta indikator target penanganan. Admin mendapatkan ringkasan operasional
dan daftar aduan dalam cakupan kewenangannya.

Ketiga dashboard menggunakan data API sebenarnya, bukan data contoh untuk
mengisi grafik. Pencarian, filter status/kategori/risiko/periode, pagination
8 baris, dan diagram 7 hari bekerja di atas metadata yang diizinkan API.
Ekspor CSV tersedia untuk staf dan mengikuti filter aktif. Ekspor tidak
menyertakan isi aduan, email, atau pseudonim dan menetralkan formula spreadsheet.

Navigasi akun menggunakan `/api/auth/me`, yang hanya mengembalikan profil
pengguna yang sedang masuk dan metadata kewenangannya. Tidak ada rahasia MFA
atau material kunci yang dikembalikan.

## Media

`public/images/campus.jpg` adalah foto ilustratif mahasiswa wisuda, bukan
foto kampus institusi pengguna. Sumber gambar:
https://images.unsplash.com/photo-1541339907198-e08756dedf3f

Foto disimpan lokal sehingga halaman tidak bergantung pada host gambar
eksternal saat dipakai. CSP tetap menggunakan sumber gambar lokal.

## Verifikasi

TypeScript, lint, tes unit, serta kompilasi Tailwind/PostCSS dapat dijalankan
tanpa menyalakan server. Pengujian visual interaktif memerlukan aplikasi
yang dijalankan pengguna. Pembaruan ini tidak memerlukan migrasi tambahan
di luar migrasi runtime yang telah dibuat sebelumnya.
