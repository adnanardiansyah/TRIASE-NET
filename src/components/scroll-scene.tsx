"use client";

import { useRef, type ReactNode } from "react";
import { div as MotionDiv } from "motion/react-m";
import { useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/** Scroll-linked movement reverses naturally when the user scrolls back up. */
export function ScrollScene({ children, distance = 48, axis = "y", className, disabled = false }: {
  children: ReactNode;
  distance?: number;
  axis?: "x" | "y";
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const travel = useTransform(scrollYProgress, [0, 0.5, 1], [distance, 0, -distance]);
  return <div ref={ref} className={className} data-scroll-scene={axis}>
    <MotionDiv data-scroll-content="" style={{ [axis]: reduced || disabled ? 0 : travel }}>{children}</MotionDiv>
  </div>;
}
