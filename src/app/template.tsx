import { Reveal } from "@/components/reveal";

/**
 * `template.tsx` bukan `layout.tsx`: ia dirender ulang pada setiap navigasi,
 * bukan hanya saat muat. Itulah yang membuatnya tempat yang tepat untuk
 * transisi masuk antar halaman.
 *
 * Cuma ada animasi masuk. AnimatePresence untuk animasi keluar tidak dipakai
 * karena App Router tidak menyediakan lifecycle Client Component di sekitar
 * navigasi; satu-satunya cara mendapatkannya adalah menyetel
 * `experimental.viewTransition`, yang batasnya belum stabil. Melewatkan
 * transisi keluar memberi hasil yang sama dengan cara yang bisa dipertahankan.
 *
 * `from="fade"` dipilih supaya `AmbientBackdrop` di beranda tetap menempel ke
 * viewport: animasi `transform` pada elemen leluhur akan membuatnya jadi
 * containing block, sehingga anak `position: fixed` ikut bergerak dengannya.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <Reveal trigger="mount" from="fade" duration={0.28}>
      {children}
    </Reveal>
  );
}