"use client";

import Image from "next/image";
import { div as MotionDiv } from "motion/react-m";
import { useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * Foto hero dengan parallax halus dan Ken Burns saat halaman dibuka.
 *
 * Foto bergeser ~14% dari jarak scroll, jadi tampak bergerak lebih lambat dari
 * konten. Pergeseran terjadi di dalam `.landing-hero` yang `overflow: hidden`,
 * sehingga tidak pernah mendorong layout. Celah yang muncul di tepi atas sudah
 * berada di luar layar saat terjadi (geseran < jarak scroll).
 */
export function HeroBackground() {
  const reduced = usePrefersReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, 140], { clamp: false });

  return <MotionDiv className="landing-hero-media" aria-hidden="true" style={{ y: reduced ? 0 : y }}>
    <Image
      src="/images/campus.jpg"
      alt=""
      fill
      priority
      sizes="(max-aspect-ratio: 3/2) 150vh, 100vw"
      className="landing-hero-photo"
    />
  </MotionDiv>;
}
