"use client";

import { createContext, useContext, useMemo } from "react";
import {
  article,
  aside,
  dd,
  div,
  dl,
  dt,
  footer,
  h1,
  h2,
  h3,
  h4,
  header,
  li,
  main,
  nav,
  ol,
  p,
  section,
  span,
  ul,
} from "motion/react-m";
import type { HTMLMotionProps, TargetAndTransition, Variants } from "motion/react";

import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * Animasi masuk berbasis scroll untuk section mana pun.
 *
 * Tailwind v4 di proyek ini sudah menangani micro-interaction: hover, gradasi
 * yang bergerak, blur pulse, progress bar. Yang belum bisa ditulis dengan CSS
 * murni adalah "muncul saat elemen masuk viewport" beserta stagernya, karena
 * butuh IntersectionObserver plus orkestrasi urutan. Motion yang menanganinya;
 * sisanya tetap Tailwind.
 *
* Komponen ini memakai entry mini `motion/react-m`, bukan `motion.div`.
 * Alasannya ukuran, bukan fitur: build penuh menambah sekitar 14 KB gzip
 * (44 KB vs 30 KB terukur) untuk fitur yang tidak pernah dipakai. Imbalannya
 * komponen ini hanya bisa dirender di bawah `MotionProvider` di root layout,
 * yang juga sudah memuat `reducedMotion="user"`. Komponen animasi baru
 * sebaiknya ikut aturan yang sama.
 *
 * Contoh:
 *
 * ```tsx
 * <Reveal from="bottom" delay={0.1}>
 *   <h2>...</h2>
 * </Reveal>
 *
 * <RevealGroup className="grid gap-6 md:grid-cols-3" stagger={0.08}>
 *   {pillars.map((pillar) => (
 *     <Reveal key={pillar.title} as="article">
 *       ...
 *     </Reveal>
 *   ))}
 * </RevealGroup>
 * ```
 *
 * Transisi halaman lewat `template.tsx` memakai pemicu `mount`, bukan
 * viewport, karena route baru harus langsung terasa selesai:
 *
 * ```tsx
 * <Reveal trigger="mount" from="fade" duration={0.28}>{children}</Reveal>
 * ```
 *
 * `from="fade"` dipilih untuk wrapper penuh halaman karena animasi
 * `transform` akan membuat wrapper itu jadi containing block, lalu ikut
 * menjatuhkan elemen `position: fixed` di dalamnya.
 *
 * Catatan `prefers-reduced-motion`: state `hidden` sengaja TIDAK ikut diubah
 * saat pengguna meminta reduced motion. State itu dirender server sebagai inline
 * `style`, jadi berbeda di render hidrasi pertama akan memicu hydration
 * mismatch. Yang diturunkan ke nol hanya durasinya, cukup untuk membuat
 * elemen langsung tampil tanpa gerak, sementara `MotionConfig` mematikan
 * transform.
 */

/** Kurva easing decelero yang sama dengan feel motion di beranda. */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Sinyal ke `Reveal` bahwa ia hidup di dalam `RevealGroup`. */
const StaggerContext = createContext(false);

/** Arah asal elemen. `distance` menentukan berapa px jarak tempuhnya. */
export type RevealFrom = "bottom" | "top" | "left" | "right" | "scale" | "fade";

/**
 * Kapan animasi dijalankan.
 *
 * - `viewport`: menunggu elemen masuk viewport. Ini default dan yang benar
 *   untuk section panjang, karena energi animasi jatuh tepat di tempat mata
 *   sedang berada.
 * - `mount`: jalan begitu komponen terpasang, tanpa menunggu viewport. Dipakai
 *   untuk transisi halaman, yang memang harus langsung terasa selesai begitu
 *   route baru tampil.
 */
export type RevealTrigger = "viewport" | "mount";

/** Elemen yang boleh dipakai sebagai `as`. */
export type RevealTag =
  | "div"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "main"
  | "nav"
  | "ul"
  | "ol"
  | "li"
  | "dl"
  | "dt"
  | "dd"
  | "span"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4";

/**
 * Properti yang dikendalikan `Reveal` sendiri, jadi tidak bisa ditimpa lewat
 * props yang diteruskan.
 */
type ControlledProps =
  | "children"
  | "initial"
  | "animate"
  | "whileInView"
  | "whileHover"
  | "variants"
  | "viewport"
  | "transition";

/**
 * Atribut DOM yang diteruskan ke elemen.
 *
 * `HTMLMotionProps<"div">` dipakai sebagai bentuk tunggal, bukan
 * `HTMLMotionProps<RevealTag>` per tag, supaya `className` dan atribut lain
 * punya satu definisi. Konsekuensinya `onCopy` atau `onWheel`, yang hanya ada
 * di sebagian tag, tidak bisa dipakai di sini. Itu trade-off yang sepadan,
 * karena `Reveal` hampir selalu dipakai pada `div`, `section`, atau `li`.
 */
type RevealElementProps = Omit<HTMLMotionProps<"div">, ControlledProps>;

/**
 * Peta tag ke komponen mini.
 *
 * Tiap komponen di peta punya tipe Motion yang berbeda: `ref` pada `div`
 * menunjuk `HTMLDivElement`, pada `li` menunjuk `HTMLLIElement`, dan
 * seterusnya. Tanpa penyamaan, `COMPONENTS[as]` menghasilkan union dari
 * komponen dengan `ref` berbeda sehingga tipe `<Component />` tidak bisa
 * dirapikan. Penyamaan dilakukan sekali di sini lewat `as unknown as`, bukan
 * ditabur di tiap call site.
 *
 * `Record<RevealTag, ...>` sekaligus menjaga agar setiap tag di union punya
 * padanan: menambah tag ke `RevealTag` tanpa menambah baris di sini akan gagal
 * typecheck, bukan menghasilkan `undefined` saat runtime.
 */
const COMPONENTS = {
  div,
  section,
  article,
  aside,
  header,
  footer,
  main,
  nav,
  ul,
  ol,
  li,
  dl,
  dt,
  dd,
  span,
  p,
  h1,
  h2,
  h3,
  h4,
} as unknown as Record<RevealTag, React.ComponentType<HTMLMotionProps<"div">>>;

export type RevealProps = RevealElementProps & {
  /** Elemen yang dirender. Default `div`. */
  as?: RevealTag;
  /** Arah asal elemen. Default `bottom`. */
  from?: RevealFrom;
  /** Jeda sebelum animasi, dalam detik. Diabaikan di dalam `RevealGroup`. */
  delay?: number;
  /** Durasi animasi, dalam detik. Default `0.6`. */
  duration?: number;
  /** Jarak tempuh translate dalam px. Default `20`. */
  distance?: number;
  /** Hanya sekali saat masuk viewport. Default `true`. */
  once?: boolean;
  /** Porsi elemen yang harus terlihat sebelum memicu. Default `0.2`. */
  amount?: number;
  /** Kapan animasi dipicu. Default `viewport`. */
  trigger?: RevealTrigger;
  children?: React.ReactNode;
};

export type RevealGroupProps = RevealElementProps & {
  as?: RevealTag;
  /** Jeda antar anak, dalam detik. Default `0.08`. */
  stagger?: number;
  /** Jeda sebelum anak pertama bergerak, dalam detik. Default `0`. */
  delay?: number;
  once?: boolean;
  amount?: number;
  children?: React.ReactNode;
};

function buildHiddenState(from: RevealFrom, distance: number): TargetAndTransition {
  switch (from) {
    case "top":
      return { opacity: 0, y: -distance };
    case "left":
      return { opacity: 0, x: distance };
    case "right":
      return { opacity: 0, x: -distance };
    case "scale":
      return { opacity: 0, scale: 0.94 };
    case "fade":
      return { opacity: 0 };
    default:
      return { opacity: 0, y: distance };
  }
}

function buildVisibleState(
  from: RevealFrom,
  transition: TargetAndTransition["transition"],
): TargetAndTransition {
  switch (from) {
    case "top":
    case "bottom":
      return { opacity: 1, y: 0, transition };
    case "left":
    case "right":
      return { opacity: 1, x: 0, transition };
    case "scale":
      return { opacity: 1, scale: 1, transition };
    default:
      return { opacity: 1, transition };
  }
}

/**
 * Section yang muncul saat masuk viewport.
 *
 * `data-reveal` sengaja dipasang agar gaya `<noscript>` di `layout.tsx` bisa
 * memaksa elemen ini tetap terlihat kalau JavaScript tidak pernah jalan:
 * tanpa itu, section di bawah lipatan akan tertahan di `opacity: 0` selamanya.
 */
export function Reveal({
  as = "div",
  from = "bottom",
  delay = 0,
  duration = 0.6,
  distance = 20,
  once = true,
  amount = 0.2,
  trigger = "viewport",
  children,
  ...rest
}: RevealProps) {
  const reduceMotion = usePrefersReducedMotion();
  const insideGroup = useContext(StaggerContext);

  const variants = useMemo<Variants>(() => {
    const transition = reduceMotion
      ? { duration: 0, ease: EASE_OUT }
      : { duration, delay, ease: EASE_OUT };

    return {
      hidden: buildHiddenState(from, distance),
      visible: buildVisibleState(from, transition),
    };
  }, [from, distance, duration, delay, reduceMotion]);

  const Component = COMPONENTS[as];

  // Di dalam grup, `initial`/`animate` harus diwarisi dari induknya.
  // Memakainya sendiri akan memutus propagasi variant dan stagger.
  const activation = insideGroup
    ? {}
    : trigger === "mount"
      ? { initial: "hidden", animate: "visible" }
      : {
          initial: "hidden",
          whileInView: "visible",
          viewport: { once, amount },
        };

  return (
    <Component data-reveal="" variants={variants} {...activation} {...rest}>
      {children}
    </Component>
  );
}

/**
 * Induk pengatur stagger untuk deretan `Reveal`.
 *
 * Delay individual pada anak diabaikan di sini; urutannya dikendalikan
 * sepenuhnya oleh `stagger` supaya tidak saling bertabrakan.
 */
export function RevealGroup({
  as = "div",
  stagger = 0.08,
  delay = 0,
  once = true,
  amount = 0.15,
  children,
  ...rest
}: RevealGroupProps) {
  const reduceMotion = usePrefersReducedMotion();

  const variants = useMemo<Variants>(
    () => ({
      hidden: {},
      visible: {
        transition: {
          staggerChildren: reduceMotion ? 0 : stagger,
          delayChildren: reduceMotion ? 0 : delay,
        },
      },
    }),
    [stagger, delay, reduceMotion],
  );

  const Component = COMPONENTS[as];

  return (
    <StaggerContext.Provider value>
      <Component
        data-reveal=""
        variants={variants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once, amount }}
        {...rest}
      >
        {children}
      </Component>
    </StaggerContext.Provider>
  );
}
