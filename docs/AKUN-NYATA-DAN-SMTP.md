# Akun nyata TRIASE-Net

> Pembaruan keamanan: pengiriman kini memakai outbox dan worker terautentikasi; pemulihan password/MFA sudah tersedia. Ikuti [audit dan panduan deployment terbaru](AUTH-SECURITY-AUDIT.md) sebelum memakai instruksi ini.

Mahasiswa mendaftar di `/register` memakai email dan password minimal 12 karakter. Tautan email berlaku 30 menit, sekali pakai. Setelah dikonfirmasi, mahasiswa login dengan email dan password tanpa kode autentikator. Verifikasi email membuktikan kepemilikan email, bukan status mahasiswa PNL. Isi `STUDENT_EMAIL_DOMAINS` hanya jika domain resmi yang dipakai mahasiswa sudah diketahui; beberapa domain dipisahkan koma.

Admin dan Satgas login dengan password dan kode aplikasi autentikator pribadi. Pada login pertama, masukkan kunci yang tampil ke aplikasi autentikator sebagai akun berbasis waktu, lalu masukkan kode enam digit. Rahasia autentikator disimpan terenkripsi, bukan sebagai kunci bersama. Akun lama/demo tidak mempunyai kredensial baru dan tidak bisa dipakai login. `npm run demo:totp` sudah dihapus.

## Langkah konfigurasi

1. Pilih layanan email yang menyediakan SMTP. Salin konfigurasi penyedia ke `.env` lokal, jangan ke chat atau repository:

   ```dotenv
   SMTP_HOST=host-smtp-dari-penyedia
   SMTP_PORT=587
   SMTP_USER=username-dari-penyedia
   SMTP_PASSWORD=password-smtp-dari-penyedia
   MAIL_FROM="TRIASE-Net <alamat-pengirim-yang-disetujui-penyedia>"
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   STUDENT_EMAIL_DOMAINS=
   ```

   Gunakan port 587 dengan STARTTLS atau 465 dengan TLS sesuai penyedia. Alamat pengirim harus diizinkan oleh penyedia. Pada hosting publik, `NEXT_PUBLIC_APP_URL` harus alamat HTTPS aplikasi yang sebenarnya. Tanpa konfigurasi SMTP, aplikasi mengembalikan pesan layanan email belum dikonfigurasi; aplikasi tidak mengaku email terkirim. Jika koneksi gagal setelah akun dibuat, akun tetap belum aktif dan dapat meminta kirim ulang.

2. Untuk pemasangan baru, isi konfigurasi database dan kunci lain sesuai `.env.example`, lalu jalankan `npm run db:migrate -- --admin`. Buat kunci autentikator dengan `node scripts/configure-auth-key.mjs`. Pada workspace ini migrasi dan pembuatan kunci sudah dilakukan. Simpan cadangan `AUTH_ENCRYPTION_KEY_BASE64`; menggantinya membuat autentikator lama tidak dapat didekripsi. Jangan menimpa kunci yang sudah dipakai.

3. Di terminal pada folder proyek, jalankan `npm run admin:create`. Masukkan email Anda, nama, dan password pribadi. Password disembunyikan. Ini hanya membuat Admin nyata pertama; akun Admin demo tidak diubah. Aktivasi awal dilakukan melalui akses lokal database tepercaya, sehingga tidak menunggu email. Login Admin tetap memerlukan pengaitan autentikator pribadi.

4. Restart `npm run dev` setelah mengubah `.env`. Buka `/login`, masuk sebagai Admin baru, lalu hubungkan autentikator.

5. Buka **Pengguna & mandat** di sidebar Admin. Undang Satgas dengan email miliknya. Satgas membuka email undangan dan membuat password sendiri. Setelah aktivasi, Admin mengatur mandat dan status bertugas. Petugas tetap tidak dapat membaca aduan tanpa mandat aktif yang sesuai kategori, risiko, dan masa berlaku. Undangan gagal dikirim atau kedaluwarsa dapat dikirim ulang dari halaman ini.

6. Uji mahasiswa dengan email yang dapat Anda buka: daftar, buka tautan email, konfirmasi aktivasi, lalu login. Login mahasiswa berikutnya tidak meminta kode. Jangan gunakan alamat `.test` untuk pengiriman email nyata.

## Pengelolaan dan pemeriksaan

Admin dapat menonaktifkan/mengaktifkan akun non-Admin, mengatur mandat Satgas, dan melihat audit perubahan beserta alasan. Penonaktifan mengubah versi kredensial sehingga sesi lama ditolak. Aktivasi tidak melewati verifikasi email. Perubahan sensitif membutuhkan MFA yang masih baru. Akun Admin tidak dapat diubah melalui daftar ini.

Jalankan `npm test` dan `npm run build` untuk pemeriksaan aplikasi. `npm run test:auth:db` memeriksa fungsi database menggunakan skema yang disalin ke database sementara berisi data sintetis; database sementara dihapus setelah pemeriksaan, tanpa menyalin atau mengubah akun nyata. Tes integrasi aduan yang memerlukan database terisolasi terpisah tetap bersifat opt-in.

Autentikasi SMTP Resend sudah diverifikasi melalui TLS setelah key diisi. Pengiriman dan penerimaan email harus diuji melalui pendaftaran atau kirim ulang. Pembatasan HTTP dan tantangan MFA menggunakan PostgreSQL terpusat. Pemulihan password dan recovery code autentikator dijelaskan pada panduan keamanan terbaru. SSO kampus tidak diperlukan untuk alur akun lokal ini.

## Worker lokal setelah migrasi

Migrasi 0042?0045 sudah diterapkan ke database lokal dengan persetujuan pemilik. Jalankan aplikasi dengan `npm run dev`, lalu pada terminal lain jalankan `npm run mail:worker`. Worker memeriksa antrean setiap 10 detik dan berhenti dengan Ctrl+C. Untuk satu putaran pemeriksaan gunakan `npm run mail:worker -- --once`. CLI hanya menerima endpoint localhost dan tidak mencetak token atau kredensial. Jika worker sudah aktif, jangan menjalankan salinan tambahan tanpa kebutuhan.

Untuk Resend memakai `onboarding@resend.dev`, daftar atau minta kirim ulang menggunakan alamat email yang terkait akun Resend Anda. Jangan membuat akun dengan email `.test` untuk pengiriman nyata. Alamat penerima lain memerlukan domain pengirim terverifikasi. Pengujian awal worker berhasil dengan antrean kosong: terkirim 0, gagal 0.
