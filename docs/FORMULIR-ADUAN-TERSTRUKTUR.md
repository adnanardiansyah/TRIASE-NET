# Formulir aduan terstruktur

Halaman Buat Aduan memakai desain emerald dan shell dashboard yang sudah ada.
Isian wajib tetap kategori, judul, dan kronologi. Sebelum mengirim, pengguna
melihat ringkasan dan dapat kembali mengubah isian tanpa kehilangan input.
Tombol kirim dinonaktifkan selama permintaan berjalan. Gangguan jaringan tetap
menampilkan instruksi untuk memeriksa daftar aduan sebelum mencoba lagi.

## Informasi sesuai kategori

- Semua kategori: waktu diketahui/perkiraan/tidak ingat, lokasi atau media,
  kronologi, serta harapan tindak lanjut.
- Fasilitas: kondisi fasilitas dan panduan gedung/ruangan.
- Teknologi/keamanan informasi: aplikasi/sistem dan pesan error.
- Keselamatan pribadi/kebersamaan: posisi pelapor, pihak terlapor, saksi,
  serta pihak yang mengalami dan hubungan pelapor jika melaporkan orang lain.

Nama lengkap, NIM, telepon, alamat rumah, dan data orang tua tidak diwajibkan.
Informasi pihak terkait opsional. Waktu dimasukkan dalam WIB dan disimpan
sebagai timestamp dengan zona waktu. Isian kategori yang tersembunyi dibuang
dari payload saat kategori berubah; server juga menolak kombinasi tidak sesuai.
Data formulir tidak disimpan otomatis ke localStorage atau sessionStorage.

## Bukti pendukung

JPG, PNG, WEBP, atau PDF; maksimal 3 file, 1 MiB per file, total 2 MiB.
Ukuran/jenis divalidasi di browser dan server; server memeriksa base64 kanonis,
signature awal file, total byte, serta menormalkan nama file dan ekstensi.
Pemeriksaan signature bukan pemindaian antivirus atau validasi penuh dokumen.
File tidak dirender sebagai HTML/iframe atau diubah/dikompres oleh aplikasi.

File kecil disimpan bersama detail laporan di JSON **di dalam ciphertext**
aduan, bukan file publik atau filesystem serverless. `attachment_count` pada
tiket diisi dari jumlah file tervalidasi. Tidak diperlukan bucket eksternal,
environment variable tambahan, atau migrasi tabel untuk implementasi ini.
Tabel `aduan_attachments` yang sudah ada belum dipakai sebagai object storage;
implementasi inline ini harus diselaraskan jika object storage diaktifkan kelak.

Payload JSON POST dibatasi 3.000.000 byte. Batas file sengaja menjaga payload
base64 di bawah batas request Vercel Functions. Untuk file besar/video, gunakan
arsitektur upload object storage terpisah, bukan menaikkan batas JSON ini.
Referensi: [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

## Akses dan kompatibilitas

Tiket lama dengan payload `subject`/`body` tetap terbaca. Detail baru tidak
ditambahkan ke metadata daftar tiket atau notifikasi. Pemilik mendapat detail
dan deskriptor lampiran dari detail tiketnya; staf mendapatkannya setelah
dekripsi berwenang yang sudah diaudit. Isi base64 tidak dikembalikan oleh API
detail atau preview dekripsi.

`GET /api/aduan/[ticket]/attachments/[attachment]` memeriksa sesi, RLS pemilik/
mandat staf, clearance, dan MFA yang masih berlaku sebelum membuka bukti.
Unduhan dicatat sebagai `ADUAN_ATTACHMENT_READ` dengan ID bukti pada reason code.
Respons memakai `Content-Disposition: attachment`, `nosniff`, serta `no-store`.
Komponen unduhan menangani error dan verifikasi ulang MFA tanpa meninggalkan
halaman. Semua byte dan nama bukti tetap berada dalam payload terenkripsi
sampai pengguna yang berwenang membuka atau mengunduhnya.

## Pengujian

Tes mencakup input minimal lama, waktu perkiraan/tidak diketahui, penolakan waktu
masa depan, isian tidak sesuai kategori, pembersihan isian tersembunyi, batas
ukuran/jumlah file, MIME spoofing, sanitasi nama, serta respons unduhan.
Integrasi PostgreSQL menguji detail/bukti pada LOW/MEDIUM/HIGH, unduhan pemilik
dan staf, penolakan pengguna lain/MFA kedaluwarsa, counter lampiran, audit,
serta tidak munculnya detail sensitif atau byte bukti pada metadata.

## Hasil pemeriksaan lokal

- Typecheck, lint, dan build produksi lulus.
- 247 tes unit/API lulus; 11 tes integrasi PostgreSQL lulus pada database uji
  terisolasi yang dihapus setelah pemeriksaan.
- Browser Edge headless: 1440px, 768px, dan 390px; tidak ditemukan overflow
  horizontal pada formulir, ringkasan, maupun tanda terima.
- Uji UI mencakup isian kondisional, pergantian kategori, pemeliharaan input saat
  kembali, ringkasan sebelum pengiriman, penolakan file terlalu besar, kegagalan
  kirim dan percobaan ulang, fokus judul, serta penyalinan nomor tiket.
- API pada uji browser menggunakan fixture yang diintersep; tidak ada aduan nyata
  dibuat melalui browser. Skenario kegagalan sengaja mengembalikan HTTP 503.
  Validasi enkripsi, penyimpanan, dan otorisasi bukti diuji terpisah pada PostgreSQL.
- Hasil dan screenshot lokal berada di `artifacts/complaint-form-qa/`, yang
  diabaikan Git. Helper uji: `scripts/qa-complaint-form.mjs` (Node 24, server lokal
  port 3110 dan browser DevTools port 9231; muat environment lokal yang sama).

Implementasi belum di-push/deploy sebagai bagian pekerjaan ini. Pengujian
pengiriman/unduhan terhadap deployment Vercel/Neon online belum dilakukan.
