"use client";

import { useRef, useState } from "react";
import { div, li, span } from "motion/react-m";
import { useInView, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { MessageSquareText, ShieldCheck, ListChecks } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import styles from "./complaint-timeline.module.css";

const Track = div;
const Step = li;
const StepIcon = span;
const steps = [
  { n: "01", title: "Sampaikan dengan jelas", body: "Pilih kategori dan ceritakan hal yang terjadi. Setelah terkirim, Anda mendapatkan nomor tiket pengaduan.", detail: "Nomor tiket pengaduan", icon: MessageSquareText },
  { n: "02", title: "Petugas menindaklanjuti", body: "Petugas berwenang meninjau aduan. Informasi tambahan dapat disampaikan melalui percakapan pada tiket.", detail: "Percakapan pada tiket", icon: ShieldCheck },
  { n: "03", title: "Ikuti perkembangannya", body: "Lihat perubahan status dan riwayat penanganan melalui dashboard atau halaman pelacakan tiket.", detail: "Riwayat penanganan", icon: ListChecks },
];

// Posisi penanda tiap tahap di sepanjang garis (0 = awal, 1 = akhir).
const STEP_AT = steps.map((_, index) => index / (steps.length - 1));

function TimelineStep({ step, active }: { step: typeof steps[number]; active: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const reduce = usePrefersReducedMotion();
  return <Step ref={ref} data-reveal="" data-active={active} className={styles.step}
    initial={{ opacity: 0, y: 24 }} animate={seen ? { opacity: 1, y: 0 } : undefined}
    transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}>
    <div className={styles.markerRow} aria-hidden="true"><StepIcon className={styles.marker} initial={{ scale: 0.94 }} animate={{ scale: active ? 1 : 0.94 }} transition={{ duration: reduce ? 0 : 0.65, ease: [0.22, 1, 0.36, 1] }}>{step.n}</StepIcon></div>
    <div className={styles.card}>
      <div className={styles.cardTop}><span className={styles.number}>Tahap {step.n}</span><span className={styles.icon} aria-hidden="true"><step.icon size={25} strokeWidth={1.4} /></span></div>
      <h3>{step.title}</h3><p className={styles.body}>{step.body}</p>
      <div className={styles.detail}><span aria-hidden="true" />{step.detail}</div>
    </div>
  </Step>;
}

export function ComplaintTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 40%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 85, damping: 28, restDelta: 0.001 });
  const reduce = usePrefersReducedMotion();
  // Tahap menyala saat ujung garis mencapai penandanya, dan padam lagi bila
  // pengguna menggulir kembali ke atas.
  const [reached, setReached] = useState(0);
  useMotionValueEvent(progress, "change", (value) => {
    const count = STEP_AT.filter((at) => value >= Math.max(0.02, at - 0.02)).length;
    setReached((current) => current === count ? current : count);
  });
  const headX = useTransform(progress, (value) => `${value * 100}%`);
  return <div ref={ref} className={styles.timeline} data-complaint-timeline="">
    <div className={`${styles.rail} ${styles.horizontal}`} aria-hidden="true"><Track className={styles.fill} style={{ scaleX: progress }} /></div>
    <div className={`${styles.headTrack} ${styles.horizontal}`} aria-hidden="true"><Track className={styles.head} style={{ left: headX }} data-visible={reached > 0 && reached < steps.length} /></div>
    <div className={`${styles.rail} ${styles.vertical}`} aria-hidden="true"><Track className={styles.fill} style={{ scaleY: progress }} /></div>
    <div className={`${styles.headTrack} ${styles.vertical}`} aria-hidden="true"><Track className={styles.head} style={{ top: headX }} data-visible={reached > 0 && reached < steps.length} /></div>
    <ol className={styles.steps} aria-label="Tahapan alur pengaduan">{steps.map((step, index) => <TimelineStep key={step.n} step={step} active={reduce || index < reached} />)}</ol>
  </div>;
}
