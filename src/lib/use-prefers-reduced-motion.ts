"use client";

import { useEffect, useState } from "react";

/**
 * Pelacakan preferensi `prefers-reduced-motion` sistem.
 *
 * Hook ini ada karena entry mini Motion (`motion/react-m`) tidak mengekspor
 * `useReducedMotion`, dan kita memilih build mini di `components/reveal.tsx`
 * demi menghemat sekitar 14 KB gzip. Polanya sengaja diduplikasi di sini
 * supaya tidak ada dua implementasi berbeda untuk hal yang sama.
 *
 * Nilai awal selalu `false` dan baru diubah setelah mount. Itu disengaja:
 * render pertama di klien harus identik dengan render server, kalau tidak
 * React melaporkan hydration mismatch. Konsekuensinya aman — preferensi baru
 * berlaku dari frame setelah hidrasi, dan animasi masuk baru pemicu saat
 * elemen menyentuh layarnya.
 *
 * Nilai ikut berubah saat pengguna mengubah setelan sistem tanpa memuat ulang
 * halaman, jadi preferensi yang baru saja aktif langsung dihormati.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");

    setReduceMotion(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);

    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduceMotion;
}