"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

/**
 * Induk Motion untuk seluruh aplikasi.
 *
 * Dipasang di `app/layout.tsx` supaya setiap halaman mewarisi dua hal sekaligus,
 * tanpa perlu mengingatkannya di tiap file:
 *
 * 1. `LazyMotion` memuat fitur Motion secara dinamis. Komponen di
 *    `components/reveal.tsx` sengaja diimpor dari `motion/react-m` (build mini)
 *    yang tidak bisa dirender sebelum fitur dimuat. Build penuh `motion.*`
 *    menambah sekitar 14 KB gzip untuk fitur yang tidak kita pakai — drag,
 *    pan, dan animasi layout — jadi jangan dikembalikan ke sana tanpa alasan.
 * 2. `MotionConfig reducedMotion="user"` membuat Motion membaca
 *    `prefers-reduced-motion` dan mematikan animasi transform untuk pengguna
 *    yang memintanya, sementara opasitas tetap boleh berubah.
 *
 * `strict` sengaja tidak dipakai. Tanpa itu, satu komponen yang keliru menulis
 * `motion.div` di halaman mana pun tetap jalan, hanya dengan menarik build
 * penuh ke bundel halaman itu. Dengan `strict`, kesalahan yang sama meledak
 * jadi error saat render.
 *
 * Aturan global di `globals.css` tetap jadi jaring pengaman: Motion menulis
 * transform lewat inline style yang tidak bisa dikalahkan cascade CSS, jadi
 * `transition-duration: 0.01ms !important` di sana tidak selalu sampai.
 *
 * `children` tetap komponen server. Client component di sini hanya
 * menyediakan konteks; tidak ada yang dipaksa jadi client karena dibungkus ini.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}