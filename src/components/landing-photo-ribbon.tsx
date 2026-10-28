"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { Pause, Play } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { Reveal } from "./reveal";
import { ScrollScene } from "./scroll-scene";
import styles from "./landing-photo-ribbon.module.css";

// Three compositions of the existing photograph, rather than unrelated stock photos.
const frames = [
  { position: "18% 68%", label: "Wisudawan di sisi kiri panorama" },
  { position: "50% 68%", label: "Kebersamaan wisudawan di tengah panorama" },
  { position: "85% 68%", label: "Wisudawan mengangkat tangan di sisi kanan panorama" },
];

export function LandingPhotoRibbon() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0 });
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return <section ref={ref} className={styles.ribbon} aria-labelledby="campus-moments-heading">
    <div className={styles.heading}>
      <Reveal from="right" distance={24} duration={0.9}>
        <p className="eyebrow">TRIASE-Net / Layanan aduan mahasiswa</p>
        <h2 id="campus-moments-heading">Untuk perjalanan kampus<br />yang lebih baik.</h2>
      </Reveal>
      <button type="button" className={`ui-btn ${styles.control}`} disabled={reduced} aria-pressed={paused || reduced} onClick={() => setPaused((value) => !value)}>
        {paused || reduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        {reduced ? "Gerakan dikurangi" : paused ? "Lanjutkan foto" : "Jeda foto"}
      </button>
    </div>
    <div className={styles.viewport} tabIndex={0} role="region" aria-label="Panorama foto wisuda bergerak; gerakan berhenti saat disorot atau difokuskan">
      <ScrollScene axis="x" distance={100} className={styles.scroll} disabled={paused}>
      <div className={styles.track} data-photo-track="" data-running={inView && visible && !paused && !reduced}>
        {[0, 1].map((copy) => <div key={copy} className={styles.group} aria-hidden={copy === 1 ? true : undefined}>
          {frames.map((frame, index) => <div key={frame.position} className={styles.frame}>
            <Image src="/images/campus.jpg" alt={copy === 0 ? frame.label : ""} fill sizes="(max-width: 640px) 420px, 640px" style={{ objectPosition: frame.position, transformOrigin: frame.position }} />
            <span className={styles.number} aria-hidden="true">0{index + 1} / TRIASE-Net</span>
          </div>)}
        </div>)}
      </div>
      </ScrollScene>
    </div>
  </section>;
}
