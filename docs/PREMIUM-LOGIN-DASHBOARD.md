# Login dan dashboard premium TRIASE-Net

18 Oktober 2026

## Perubahan UI
- `src/components/login-screen.tsx`: panel foto wisuda dengan gradient emerald, kartu login sage, entrance Motion, indikator Caps Lock, kontrol password dengan touch target lebih besar. Alur password, MFA, expiry, konteks perangkat, dan redirect existing dipertahankan.
- `src/components/workspace-shell.tsx`: sidebar emerald, header glass, badge peran, heading baru, dropdown akun, indikator navigasi berdasarkan path/hash.
- `src/components/dashboard/role-dashboard.tsx`: welcome panel, tiga akses cepat sesuai peran, metric entrance bertahap, panel analitik dan daftar aduan baru; tetap memakai data API sesuai kewenangan.
- `src/components/notification-center.tsx`: gaya dan entrance panel notifikasi diselaraskan, perilaku read receipt existing dipertahankan.
- `src/app/workspace-premium.css` baru dan import pada `globals.css`: gaya dibatasi pada login/workspace/notifikasi; responsive dan reduced motion.

## Fitur tambahan
1. Tampilan tabel/kartu dengan filter dan pagination yang sama. Kartu menampilkan metadata, status, risiko, tenggat, detail, dan aksi perubahan status hanya bagi staf.
2. URL menyimpan filter status/kategori/risiko/periode/urutan/tab serta pilihan tampilan. Filter dipulihkan saat membuka ulang URL dan navigasi history.
3. Tombol Bagikan filter menyalin URL dengan fallback bilah alamat jika clipboard tidak tersedia. Kata pencarian tidak dimasukkan ke URL. Penerima tetap membutuhkan akun dan kewenangan yang sesuai.
4. Chip filter aktif dapat dihapus satu per satu; reset existing tetap tersedia.
5. Shortcut `/` memfokuskan pencarian, tidak mengambil alih input lain atau dialog aktif.
6. Indikator Caps Lock pada password login.

Tidak ada perubahan autentikasi, policy akses, API/backend, workflow status, schema database, atau dependensi. Tidak ada data contoh pada produk.

## Validasi
- Typecheck dan lint lulus.
- Delapan tes di dashboard-location.test.ts dan dashboard-view.test.ts lulus: roundtrip filter, input URL tidak valid, pembatasan tab staf, pengecualian kata pencarian, pemeliharaan parameter unrelated, filter data, CSV, tanggal Jakarta, dan SLA.
- Build produksi lulus dengan 22 halaman statis.
- Browser UI: 12 kasus, login dan tiga peran pada 1440/390/320px. Password toggle, Caps Lock, transisi/fokus OTP, tabel/kartu, filter/reset, share notice, restore URL, shortcut, perubahan status staf, Escape menu, reduced motion, serta overflow lulus. Tidak ada error browser. Screenshot desktop dan mobile ditinjau.
- Artefak: `artifacts/workspace-qa/workspace-results.json` dan screenshot dengan prefix workspace.

## Batas pengujian browser
Konfigurasi produksi lokal tidak mengaktifkan demo auth/TOTP. Pengujian menggunakan sesi uji singkat dan respons API sintetis yang diintersep seluruhnya dalam browser. Tidak ada query atau perubahan database melalui QA ini, dan tidak ada perubahan konfigurasi auth. Ini menguji UI, bukan bukti keberhasilan MFA/login, notifikasi, ekspor, atau perubahan tiket terhadap database nyata. Uji integrasi dengan akun dan database yang dikonfigurasi tetap diperlukan; audit Lighthouse/WCAG menyeluruh dan perangkat fisik tidak dilakukan.

Build akhir dan lint akhir lulus. Dua smoke test tambahan pada build akhir (login desktop dan Satgas termasuk indikator navigasi aktif) lulus; lihat artifacts/workspace-qa/workspace-final-results.json.
