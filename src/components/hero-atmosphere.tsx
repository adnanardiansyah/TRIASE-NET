"use client";

import { useEffect, useRef, useState } from "react";
import { g } from "motion/react-m";
import { useInView, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import styles from "./hero-atmosphere.module.css";

const ParticleGroup = g;
// Fixed coordinates keep SSR and hydration identical; no per-render randomness.
const PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  x: 65 + (index * 173) % 870,
  y: 65 + (index * 137) % 530,
  radius: 1.3 + (index % 3) * 0.4,
  duration: `${18 + index % 7}s`,
  delay: `${-index * 1.7}s`,
}));

function Particle({ point, pointerX, pointerY }: { point: typeof PARTICLES[number]; pointerX: MotionValue<number>; pointerY: MotionValue<number> }) {
  function offset(axis: "x" | "y", values: number[]) {
    const dx = point.x - values[0]!;
    const dy = point.y - values[1]!;
    const distance = Math.hypot(dx, dy);
    if (distance >= 85 || distance < 1) return 0;
    return (axis === "x" ? dx : dy) / distance * (1 - distance / 85) * 10;
  }
  const x = useSpring(useTransform([pointerX, pointerY], (values: number[]) => offset("x", values)), { stiffness: 65, damping: 22 });
  const y = useSpring(useTransform([pointerX, pointerY], (values: number[]) => offset("y", values)), { stiffness: 65, damping: 22 });
  return <ParticleGroup style={{ x, y }} className={styles.particle}>
    <circle cx={point.x} cy={point.y} r={point.radius} className={styles.dot} style={{ animationDuration: point.duration, animationDelay: point.delay }} />
  </ParticleGroup>;
}

export function HeroAtmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0 });
  const reduceMotion = usePrefersReducedMotion();
  const [tabVisible, setTabVisible] = useState(true);
  const pointerX = useMotionValue(-1000);
  const pointerY = useMotionValue(-1000);

  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState === "visible");
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    // Check the actual query before attaching listeners, including first hydration.
    if (reduceMotion || !visible || !tabVisible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hero = ref.current?.closest<HTMLElement>(".landing-hero");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!hero || !finePointer.matches) return;
    let frame = 0;
    let clientX = 0;
    let clientY = 0;
    const reset = () => { cancelAnimationFrame(frame); frame = 0; pointerX.set(-1000); pointerY.set(-1000); };
    const move = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== "mouse") return;
      clientX = event.clientX; clientY = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const bounds = hero.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        pointerX.set((clientX - bounds.left) / bounds.width * 1000);
        pointerY.set((clientY - bounds.top) / bounds.height * 700);
      });
    };
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", reset);
    finePointer.addEventListener("change", reset);
    return () => { reset(); hero.removeEventListener("pointermove", move); hero.removeEventListener("pointerleave", reset); finePointer.removeEventListener("change", reset); };
  }, [pointerX, pointerY, reduceMotion, visible, tabVisible]);

  return <div ref={ref} className={styles.atmosphere} aria-hidden="true" data-running={visible && tabVisible && !reduceMotion}>
    <div className={styles.ambient} />
    <svg className={styles.particles} viewBox="0 0 1000 700" preserveAspectRatio="none" focusable="false">
      {PARTICLES.map((point, index) => <Particle key={index} point={point} pointerX={pointerX} pointerY={pointerY} />)}
    </svg>
  </div>;
}
