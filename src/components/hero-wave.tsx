import styles from "./hero-wave.module.css";

export function HeroWave() {
  return <div className={styles.waves} aria-hidden="true">
    <div className={styles.track}>
      {/* Identical tiles with matching endpoint tangents keep the loop seamless. */}
      {[0, 1].map((copy) => <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 50 C200 -5 400 -5 600 50 S1000 105 1200 50 V120 H0 Z" fill="currentColor" />
      </svg>)}
    </div>
  </div>;
}
