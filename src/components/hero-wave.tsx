import { useId } from "react";
import styles from "./hero-wave.module.css";

export function HeroWave() {
  const gradientId = useId();
  return <div className={styles.waves} aria-hidden="true">
    <div className={styles.track} data-wave-track="">
      {/* Identical endpoint heights and tangents repeat at exactly half the track. */}
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <path d="M0 38 C200 6 400 6 600 38 S1000 70 1200 38 V120 H0 Z" fill="#6EE7B7" fillOpacity=".18" />
      </svg>)}
    </div>
    <div className={`${styles.track} ${styles.middle}`} data-wave-track="">
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <defs><linearGradient id={`${gradientId}-${copy}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#99D6C0" stopOpacity=".55" />
          <stop offset="55%" stopColor="#DCEBE3" stopOpacity=".8" />
          <stop offset="100%" stopColor="#E8F1EC" />
        </linearGradient></defs>
        <path d="M0 58 C200 22 400 22 600 58 S1000 94 1200 58 V120 H0 Z" fill={`url(#${gradientId}-${copy})`} />
      </svg>)}
    </div>
    <div className={`${styles.track} ${styles.crest}`} data-wave-track="">
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <path d="M0 66 C200 42 400 42 600 66 S1000 90 1200 66 V120 H0 Z" fill="#E8F1EC" fillOpacity=".48" />
      </svg>)}
    </div>
    <div className={`${styles.track} ${styles.foreground}`} data-wave-track="">
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <path d="M0 84 C200 60 400 60 600 84 S1000 108 1200 84 V120 H0 Z" fill="var(--landing-divider-color)" />
      </svg>)}
    </div>
  </div>;
}
