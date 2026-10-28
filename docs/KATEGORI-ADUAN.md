# Penambahan kategori aduan — 28 Oktober 2026

Kategori baru: pelecehan seksual, pelecehan nonseksual, perundungan (termasuk
perundungan digital), kekerasan fisik, kekerasan psikologis, diskriminasi,
serta ancaman/intimidasi. Kategori lama dan tiket lama tetap dipertahankan.

Dropdown Buat Aduan, filter/analitik dashboard, dan pilihan mandat admin memakai
enum domain bersama. Kartu layanan landing page dan label kategori ikut diperbarui.
Batas jumlah kategori dalam validasi mandat mengikuti panjang katalog, bukan
batas delapan kategori yang lama.

Tujuh kategori baru diberi baseline sensitivitas data 75 (HIGH) oleh server,
sehingga memakai perlindungan enkripsi dan pemeriksaan akses HIGH yang sudah ada.
Skor ini untuk perlindungan data, bukan penilaian tingkat bahaya suatu kejadian.
Kategori dan enkripsi tiket lama tidak diubah atau dipetakan ulang.

## Migrasi dan mandat petugas

Terapkan `0046_personal_safety_categories.sql` melalui runner migrasi sebelum
menjalankan versi aplikasi ini pada setiap lingkungan. Migrasi hanya memperluas
enum; nilai baru dapat dipakai setelah transaksi migrasi selesai.

Mandat petugas tidak diperluas otomatis. Mandat KEBERSAMAAN saja tidak memberikan
akses ke kategori baru. Pengelola perlu menetapkan kategori baru kepada admin
yang bertanggung jawab melalui proses administrasi database yang berwenang;
admin tersebut kemudian dapat mengatur mandat Satgas dari halaman Kelola Akun.
Admin hanya dapat mendelegasikan kategori dalam mandatnya sendiri. Pastikan
petugas terkait aktif, memiliki clearance risiko yang sesuai, dan memenuhi MFA.

Jangan mengaktifkan kategori ini di produksi sebelum penanggung jawab dan mandat
penanganannya siap. Tidak ada perubahan mandat akun nyata yang dilakukan oleh
migrasi ini.
