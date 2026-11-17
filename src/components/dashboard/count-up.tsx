"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Angka metrik yang naik dari nilai sebelumnya ke nilai baru.
 *
 * Menerima string seperti "12" atau "87%". Nilai yang tidak diawali angka
 * (misalnya "-") ditampilkan apa adanya. Pembaca layar selalu mendapat nilai
 * akhir lewat teks `sr-only`; angka yang sedang berjalan disembunyikan.
 */
export function CountUp({ value }: { value: string }) {
  const match = /^(\d+)(.*)$/.exec(value);
  const target = match ? Number(match[1]) : null;
  const suffix = match?.[2] ?? "";
  const reduced = usePrefersReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (target === null) return;
    const start = from.current;
    from.current = target;
    if (reduced || start === target) { setShown(target); return; }
    const duration = Math.min(1100, 450 + Math.abs(target - start) * 12);
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - began) / duration);
      setShown(Math.round(start + (target - start) * easeOutCubic(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => { cancelAnimationFrame(frame); setShown(target); };
  }, [target, reduced]);

  if (target === null) return <>{value}</>;
  return <><span aria-hidden="true" className="count-up">{shown}{suffix}</span><span className="sr-only">{value}</span></>;
}
