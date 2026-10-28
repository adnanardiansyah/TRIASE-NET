"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { div as MotionDiv } from "motion/react-m";
import { useScroll, useSpring, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/** Scroll-linked movement reverses naturally when the user scrolls back up. */
export function ScrollScene({ children, distance = 72, axis = "y", depth = 0, className, disabled = false }: {
  children: ReactNode;
  distance?: number;
  axis?: "x" | "y";
  depth?: number;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 30, restDelta: 0.0001 });
  const amplitude = distance * (mobile ? 0.7 : 1);
  const travel = useTransform(progress, [0, 0.5, 1], [amplitude, 0, -amplitude]);
  const scale = useTransform(progress, [0, 0.5, 1], [1 - depth, 1, 1 - depth * 0.5]);
  return <div ref={ref} className={className} data-scroll-scene={axis}>
    <MotionDiv data-scroll-content="" style={{ [axis]: reduced || disabled ? 0 : travel, scale: reduced || disabled ? 1 : scale }}>{children}</MotionDiv>
  </div>;
}
