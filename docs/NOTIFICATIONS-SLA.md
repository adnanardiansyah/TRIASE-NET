# Notifikasi dan tenggat aduan

Notifikasi dalam aplikasi menampilkan maksimal 50 pembaruan dalam akses
pengguna: perubahan status oleh pengguna lain dan balasan pihak lawan. Staf juga
menerima pemberitahuan aduan baru dan tiket aktif yang melewati target. Sepuluh
tenggat terlewat paling lama diprioritaskan; sisa tempat menampilkan pembaruan
terbaru, agar percakapan ramai tidak menenggelamkan tiket mendesak. Tidak ada
nama/email pelapor, judul, atau isi percakapan di payload notifikasi.

Sumber notifikasi adalah riwayat status, metadata tiket, dan metadata balasan yang
sudah dilindungi RLS. Status dibaca disimpan per akun di `notification_reads`;
membaca notifikasi tidak mengubah riwayat audit atau membuka isi terenkripsi.
Endpoint menolak penandaan event yang tidak tersedia dalam feed pengguna.

Jalankan `npm run db:migrate` untuk menerapkan `0038_notification_reads.sql`
sebelum memakai API notifikasi. Endpoint GET/PATCH `/api/notifications` memerlukan
sesi valid; PATCH memvalidasi origin, JSON, serta maksimal 50 kunci event.

Lonceng diperbarui saat dibuka, halaman kembali aktif, perubahan tiket pada tab
yang sama, dan setiap 60 detik selama tab terlihat. Penandaan dibaca disimpan di
server sehingga tetap berlaku setelah login ulang atau berpindah perangkat.

Tenggat memakai kebijakan yang sudah digunakan ringkasan dashboard:
HIGH 3 hari, MEDIUM 7 hari, LOW 14 hari kalender dari waktu pengajuan.
Peringatan mendekati tenggat muncul dalam 24 jam terakhir; status selesai,
ditutup, dan ditolak dikecualikan. Membuka ulang tiket mempertahankan tenggat
pengajuan awal. Semua tanggal tenggat ditampilkan dalam WIB.

Tab **Lewat target** dan **Mendekati tenggat**, serta urutan **Tenggat terdekat**,
membantu staf memprioritaskan tiket dalam kewenangannya. Ini belum mencakup
pengalihan petugas otomatis, email, atau push notification di luar aplikasi.
