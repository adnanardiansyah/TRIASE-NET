# Runtime Aduan, ZTNA, dan Percakapan

API aduan sekarang menggunakan PostgreSQL. `demo-store.ts` dan `audit-log.ts`
tetap tersedia untuk fixture tes lama; keduanya tidak dipakai alur aduan runtime.

## Persiapan

Jalankan langkah berikut sendiri sebelum menjalankan aplikasi. Database proyek
tidak dimigrasikan otomatis oleh aplikasi atau oleh pengujian.

1. Isi `.env.local` berdasarkan `.env.example`. Next.js dan skrip CLI
   mendahulukan `.env.local` dibanding `.env`.
2. Gunakan `DATABASE_URL` milik `triase_app_login`, bukan `postgres`, pemilik
   tabel, atau peran BYPASSRLS. Pool runtime menolak akun dengan hak berlebih.
3. Isi `DATABASE_ADMIN_URL` dengan akun pemilik skema untuk migrasi berikut.
   Migrasi 0037 mengubah policy tabel lama, sehingga memerlukan hak pemilik.
4. Tetapkan `KEK_MASTER_BASE64` dan `PSEUDONYM_HMAC_KEY_BASE64` masing-masing
   dengan kunci acak 32 byte. Jangan mengganti kunci ini setiap restart.
   `KEK_ACTIVE_VERSION` harus cocok dengan versi ACTIVE di `kek_versions`.

```powershell
npm run db:migrate -- --admin
npm run db:seed:runtime
```

`db:seed:runtime` khusus pengembangan. Skrip ini membuat akun demo yang sesuai
dengan halaman login dan profil ON_DUTY untuk akun staf baru. Akun/profil lama
tidak ditimpa. Jika admin lama OFF_DUTY, status tersebut tetap dipertahankan;
aktifkan profil lewat administrasi database sebelum menguji akses admin.
Skrip memerlukan `DATABASE_ADMIN_URL` dan versi KEK yang terdaftar.

Database baru tetap mengikuti bootstrap peran pada `TAHAP-1.md` terlebih dahulu.
Tidak ada fallback penyimpanan di memori ketika database gagal.

## Perilaku

- POST aduan menerima judul, kategori, dan isi. Input ditolak jika tipe,
  kategori, atau panjangnya salah; teks panjang tidak dipotong diam-diam.
- Judul asli ikut dienkripsi bersama isi. Antrean menampilkan judul tersamar
  berdasarkan kategori, bukan judul bebas yang mungkin memuat identitas.
- Skor pengajuan berasal dari sensitivitas kategori dan usia sesi di server:
  FASILITAS/AKADEMIK/TEKNOLOGI/LAINNYA mulai 20, KEUANGAN/KEBERSAMAAN 45,
  KEAMANAS_INFORMASI/KESEHATAN 75, dengan tambahan usia sesi maksimal 15.
- LOW memakai AES-256-GCM; MEDIUM memakai ChaCha20-Poly1305; HIGH memakai
  ChaCha20-Poly1305 di dalam AES-256-GCM. Setiap lapisan memiliki DEK acak
  yang dibungkus KEK. Ciphertext lapisan dalam tidak disimpan terbuka.
- AAD mengikat tiket, pseudonim, kategori, skor, dan indeks lapisan. AAD balasan
  juga mengikat ID pesan dan peran pengirim. Balasan dienkripsi dengan band
  yang sama seperti aduan induknya.
- Mahasiswa hanya melihat tiket miliknya. Staf memerlukan akun ACTIVE,
  profil ON_DUTY yang belum kedaluwarsa, kategori yang sesuai, dan clearance
  risiko/kunci yang memadai. Kebijakan berlaku juga untuk ADMIN.
- Cookie sesi mengikat UUID pengguna, hash user-agent, dan waktu MFA.
  Perubahan akun/peran/status diperiksa kembali melalui database.
- Dekripsi dan percakapan staf meminta verifikasi ulang TOTP jika kebijakan
  profil mewajibkannya atau risiko HIGH dan MFA berusia lebih dari 15 menit.
  Verifikasi ulang tidak memperpanjang masa berlaku sesi asal.
- Status memakai versi baris. Perubahan dari dashboard usang mendapat 409.
  Update status, audit, dan riwayat berada dalam satu transaksi.
- Percakapan ditutup pada SELESAI, DITUTUP, dan DITOLAK. SELESAI dapat dibuka
  kembali menjadi DALAM_PENANGANAN. Dua status terminal lainnya tidak dapat
  dibuka kembali melalui API ini.
- Balasan menggunakan UUID dari klien untuk mencegah duplikasi saat retry.
  Riwayat balasan dimuat 50 pesan per halaman dengan kursor timestamp/UUID.
- Pembacaan/dekripsi balasan tercatat di audit. Riwayat status dan balasan
  append-only, dan penulisannya harus menunjuk audit dengan aktor yang cocok.

## Batas Saat Ini

Login masih menggunakan akun/kata sandi demo dan rahasia TOTP demo. Resolusi
akun, status aktif, dan kewenangan menggunakan database; autentikasi OIDC
mahasiswa dan login staf berbasis kredensial database belum diimplementasikan.
Jangan mengaktifkan DEMO_AUTH_ENABLED pada deployment layanan nyata.

Hash user-agent adalah ikatan konteks sederhana, bukan attestation perangkat.
Sistem belum mengukur posture perangkat atau reputasi jaringan yang terverifikasi.
Pembatas percobaan login/step-up masih per proses, belum dibagikan ke Redis.

Untuk membaca data versi KEK lama, pertahankan kuncinya di variabel
`KEK_MASTER_V<version>_BASE64`, misalnya `KEK_MASTER_V1_BASE64`. Kunci aktif
selalu berasal dari `KEK_MASTER_BASE64`. Registry versi disiapkan melalui
administrasi database; aplikasi tidak membuat atau mengaktifkan KEK sendiri.

Tiket demo lama di memori tidak dapat dipulihkan setelah proses berhenti.
Daftar dashboard belum memakai pagination; pagination tersedia pada balasan.

## Verifikasi

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
```

`test:db` membuat salinan database sumber pada database bernama
`triase_test_<acak>`, menerapkan migrasi baru hanya di salinan itu, lalu menguji
API layanan menggunakan akun LOGIN sementara yang hanya mewarisi `triase_app`.
Database dan akun uji dihapus setelah selesai, termasuk ketika tes gagal.
Database sumber harus sudah memiliki skema 0035 dan tidak memiliki koneksi
aktif saat salinan dibuat. Skrip tidak menghentikan koneksi pengguna.
Gunakan database pengembangan sebagai sumber, bukan data produksi.

Tes unit tidak membutuhkan PostgreSQL. Tes integrasi dilewati pada `npm test`
biasa dan dijalankan oleh `test:db` dengan konfigurasi terisolasi.
