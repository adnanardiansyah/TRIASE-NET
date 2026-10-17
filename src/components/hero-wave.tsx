import { useId } from "react";
import styles from "./hero-wave.module.css";

export function HeroWave() {
  const gradientId = useId();
  return <div className={styles.waves} aria-hidden="true">
    <div className={styles.track} data-wave-track="">
      {/* Identical endpoint heights and tangents repeat at exactly half the track. */}
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <path d="M0 40 C200 16 400 16 600 40 S1000 64 1200 40 V120 H0 Z" fill="#064E3B" fillOpacity=".2" />
      </svg>)}
    </div>
    <div className={`${styles.track} ${styles.middle}`} data-wave-track="">
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
        <defs><linearGradient id={`${gradientId}-${copy}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F766E" stopOpacity=".75" />
          <stop offset="55%" stopColor="#DCEBE3" stopOpacity=".85" />
          <stop offset="100%" stopColor="#E8F1EC" />
        </linearGradient></defs>
        <path d="M0 58 C200 22 400 22 600 58 S1000 94 1200 58 V120 H0 Z" fill={`url(#${gradientId}-${copy})`} />
      </svg>)}
    </div>
    <svg className={styles.foreground} viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false">
      <path d="M0 80 C240 45 430 102 680 82 S1010 56 1200 82 V120 H0 Z" fill="var(--landing-divider-color)" />
    </svg>
  </div>;
}
