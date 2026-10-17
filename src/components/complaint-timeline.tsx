"use client";

import { useRef } from "react";
import { div, li, span } from "motion/react-m";
import { useInView, useScroll, useSpring } from "motion/react";
import { MessageSquareText, ShieldCheck, ListChecks } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import styles from "./complaint-timeline.module.css";

const Track = div;
const Step = li;
const StepIcon = span;
const steps = [
  { n: "01", title: "Sampaikan dengan jelas", body: "Pilih kategori dan ceritakan hal yang terjadi. Setelah terkirim, Anda mendapatkan nomor tiket pengaduan.", icon: MessageSquareText },
  { n: "02", title: "Petugas menindaklanjuti", body: "Petugas berwenang meninjau aduan. Informasi tambahan dapat disampaikan melalui percakapan pada tiket.", icon: ShieldCheck },
  { n: "03", title: "Ikuti perkembangannya", body: "Lihat perubahan status dan riwayat penanganan melalui dashboard atau halaman pelacakan tiket.", icon: ListChecks },
];

function TimelineStep({ step }: { step: typeof steps[number] }) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const reduce = usePrefersReducedMotion();
  return <Step ref={ref} data-reveal="" data-active={seen} className={styles.step}
    initial={{ opacity: 0, y: 24 }} animate={seen ? { opacity: 1, y: 0 } : undefined}
    transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}>
    <div className={styles.markerRow}><StepIcon className={styles.marker} aria-hidden="true" initial={{ scale: 0.94 }} animate={{ scale: seen ? 1 : 0.94 }} transition={{ duration: reduce ? 0 : 0.65, ease: [0.22, 1, 0.36, 1] }}><step.icon size={18} strokeWidth={1.6} /></StepIcon><span className={`${styles.number} font-mono text-sm text-emerald-700`}>{step.n}</span></div>
    <h3 className="mt-5 text-base font-semibold">{step.title}</h3><p className="mt-3 text-xs leading-7 text-zinc-500">{step.body}</p>
  </Step>;
}

export function ComplaintTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 40%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 85, damping: 28, restDelta: 0.001 });
  return <div ref={ref} className={`${styles.timeline} mt-10`}>
    <div className={`${styles.rail} ${styles.horizontal}`} aria-hidden="true"><Track className={styles.fill} style={{ scaleX: progress }} /></div>
    <div className={`${styles.rail} ${styles.vertical}`} aria-hidden="true"><Track className={styles.fill} style={{ scaleY: progress }} /></div>
    <ol className="relative grid gap-9 md:grid-cols-3" aria-label="Tahapan alur pengaduan">{steps.map((step) => <TimelineStep key={step.n} step={step} />)}</ol>
  </div>;
}
