# Diagnosis email verifikasi staging

Temuan kode: endpoint sebelumnya mengembalikan 200 walau semua send gagal; complete/fail mengembalikan boolean yang diabaikan. delivered sebelumnya berarti sendMail selesai, bukan bukti acknowledgement atau email tiba di inbox. Claim hanya mengambil maksimal dua job yang belum kedaluwarsa, attempts < 5, dan lease tersedia. attempts naik saat claim, sebelum dekripsi/SMTP. Job EXPIRED tidak akan dicoba lagi.

Penyebab kegagalan staging historis belum diketahui: tidak ada log fase lama atau akses runtime staging yang digunakan dalam audit ini. Tidak ada pengiriman, perubahan akun, query database, migrasi, reset attempts, atau penggantian secret dilakukan selama audit.

Enkripsi: accountMailPayload -> sealTotp dan worker -> openTotp sama-sama memakai authKey() dari AUTH_ENCRYPTION_KEY_BASE64, AES-256-GCM, serta AAD triase-auth-v1:<mail_id>. env.ts memvalidasi format kunci produksi; ini tidak membuktikan kesamaan nilai lintas deployment. DECRYPT_FAILED bisa berarti beda kunci, AAD/payload rusak, atau format payload tidak valid. Jangan mencetak kunci atau fingerprint-nya. Keberhasilan event decrypted membuktikan payload job tersebut dapat dibaca oleh worker saat ini.

Konfigurasi Resend: SMTP_HOST=smtp.resend.com, SMTP_PORT=465, SMTP_USER=resend, SMTP_PASSWORD adalah API key yang sudah ada, MAIL_FROM pengirim terverifikasi. Port 465 menggunakan secure=true, certificate verification=true dan SNI hostname asli meskipun koneksi memakai IP hasil DNS. Jangan mengganti secret untuk diagnosis. Lihat https://resend.com/changelog/smtp-service.

Uji setelah deployment:
1. Pastikan cron mengarah ke deployment staging terbaru yang sama dengan aplikasi pembuat job; periksa scope konfigurasi Preview/Production tanpa menyalin nilainya ke log.
2. Melalui UI staging, gunakan Kirim ulang verifikasi satu kali untuk akun uji PENDING yang Anda kendalikan. Ini membuat job/token baru melalui alur resmi; jangan menghidupkan job EXPIRED. Audit ini tidak menjalankan langkah tersebut.
3. Tunggu satu siklus cron (2 menit). Jika ada backlog eligible, claim maksimal dua job per siklus. Periksa response dan log batch; 200 dengan claimed=0 bukan bukti pengiriman.
4. Harapkan claimed -> decrypted -> recipient_validated -> smtp_accepted -> acknowledged, lalu batch delivered=1, failed=0 (atau hitungan batch jika ada job lain). Periksa email baru di Resend dan inbox/spam akun uji. SMTP acceptance bukan bukti inbox delivery.
5. Verifikasi tautan melalui UI jika ingin menyelesaikan aktivasi akun uji.

Filter Vercel Runtime Logs: pilih project dan deployment staging terbaru, rentang waktu saat uji, route /api/internal/auth-mail. Cari [auth-mail], lalu event failed atau nama phase; aktifkan level Info dan Error. Periksa batch claimed/delivered/failed dan HTTP 503. Field phase membedakan DECRYPT_FAILED, RECIPIENT_UNAVAILABLE, SMTP_CONFIG_FAILED, SMTP_DNS_FAILED, SMTP_CONNECTION_FAILED, SMTP_AUTH_FAILED, SMTP_REJECTED, SMTP_TIMEOUT, OUTBOX_ACK_FAILED. OUTBOX_CLAIM_FAILED menunjukkan query/hasil claim gagal. smtpCode dan responseCode hanya muncul jika lolos allowlist; operation complete/fail menunjukkan acknowledgement mana yang gagal. Tidak ada raw error, alamat email, token, ciphertext, kredensial, URL database, atau kunci di record ini.

Worker tidak lagi memanggil cleanup yang menghapus outbox lama. Retensi perlu ditangani terpisah sesuai kebijakan operasional; audit ini tidak menjalankan penghapusan. Jika SMTP berhasil tetapi complete gagal, email mungkin sudah terkirim; worker tidak memanggil fail pada kasus ini. Lease tetap mengikuti perilaku database dan retry berikutnya dapat menyebabkan duplikasi, sehingga periksa Resend sebelum mengulang uji.

Diagnostik lanjutan: SMTP_REJECTED kini menyertakan reason tetap: TEST_RECIPIENT_RESTRICTED, SENDER_DOMAIN_NOT_VERIFIED, API_KEY_INVALID, API_KEY_PERMISSION_DENIED, SENDING_LIMIT_REACHED, atau UNKNOWN. Kategori berasal dari pencocokan konservatif respons provider di memori; respons asli tidak dicatat. UNKNOWN tidak boleh ditafsirkan sebagai penyebab tertentu. Setelah deploy kode ini, gunakan satu undangan baru melalui UI dan periksa reason pada pemanggilan worker berikutnya. Perubahan ini tidak mengubah secret maupun data.
