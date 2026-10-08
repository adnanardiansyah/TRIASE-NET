/**
 * Hook start server.
 *
 * Validasi environment dijalankan satu kali per proses, bukan di setiap
 * permintaan. Di produksi proses berhenti di sini kalau konfigurasi tidak
 * lengkap, karena melanjutkan dengan kunci cadangan dari source code justru
 * memberikan rasa aman yang palsu.
 */
export async function register() {
  // Edge runtime tidak punya akses ke environment ini, dan tidak menjalankan
  // route yang menyentuh kredensial.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { assertProductionEnvIfNeeded } = await import("@/lib/config/env");

  assertProductionEnvIfNeeded();
}
