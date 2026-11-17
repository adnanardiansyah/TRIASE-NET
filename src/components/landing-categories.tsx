"use client";

import Link from "next/link";
import type { PointerEvent } from "react";
import {
  ArrowUpRight,
  Bandage,
  BookOpen,
  Brain,
  Building2,
  DatabaseZap,
  Handshake,
  HeartPulse,
  Laptop,
  MessageSquareText,
  MessageSquareWarning,
  MoreHorizontal,
  Scale,
  ShieldCheck,
  TriangleAlert,
  UserRoundX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Reveal, RevealGroup } from "./reveal";
import styles from "./landing-categories.module.css";

type Category = { key: string; label: string; example: string; icon: LucideIcon };
type Group = { title: string; sensitive?: boolean; items: Category[] };

// Kelompok 2 dan 3 sama persis dengan PERSONAL_SAFETY_CATEGORIES. Aduan di
// kategori itu mendapat skor risiko dasar 75, sehingga petugas wajib
// verifikasi ulang (step-up, ambang 70) sebelum membuka isinya.
const groups: Group[] = [
  { title: "Perkuliahan & layanan kampus", items: [
    { key: "AKADEMIK", label: "Akademik", icon: BookOpen, example: "Jadwal kuliah, penilaian, atau proses pembelajaran." },
    { key: "KEUANGAN", label: "Keuangan", icon: Wallet, example: "Tagihan yang tidak sesuai atau kendala administrasi pembayaran." },
    { key: "FASILITAS", label: "Fasilitas", icon: Building2, example: "Ruang belajar, toilet, atau sarana kampus yang rusak." },
    { key: "KESEHATAN", label: "Kesehatan", icon: HeartPulse, example: "Akses layanan kesehatan atau dukungan kesejahteraan." },
    { key: "KEBERSAMAAN", label: "Kebersamaan", icon: Handshake, example: "Komunikasi atau kerja sama dalam kegiatan kampus." },
  ] },
  { title: "Pelecehan, perundungan & diskriminasi", sensitive: true, items: [
    { key: "PELECEHAN_SEKSUAL", label: "Pelecehan seksual", icon: UserRoundX, example: "Komentar, pesan, atau sentuhan bernuansa seksual yang tidak dikehendaki." },
    { key: "PELECEHAN_NON_SEKSUAL", label: "Pelecehan nonseksual", icon: MessageSquareText, example: "Ucapan atau tindakan merendahkan tanpa muatan seksual." },
    { key: "PERUNDUNGAN", label: "Perundungan (bullying)", icon: MessageSquareWarning, example: "Ejekan, pengucilan, atau penghinaan berulang, termasuk di ruang digital." },
    { key: "DISKRIMINASI", label: "Diskriminasi", icon: Scale, example: "Perlakuan tidak setara karena identitas atau latar belakang." },
  ] },
  { title: "Kekerasan, ancaman & intimidasi", sensitive: true, items: [
    { key: "KEKERASAN_FISIK", label: "Kekerasan fisik", icon: Bandage, example: "Memukul, menendang, atau tindakan yang melukai fisik." },
    { key: "KEKERASAN_PSIKOLOGIS", label: "Kekerasan psikologis", icon: Brain, example: "Tekanan atau penghinaan yang menimbulkan ketakutan." },
    { key: "ANCAMAN_INTIMIDASI", label: "Ancaman / intimidasi", icon: TriangleAlert, example: "Ancaman menyakiti, membalas laporan, atau pemaksaan." },
  ] },
  { title: "Sistem digital & lainnya", items: [
    { key: "TEKNOLOGI", label: "Teknologi", icon: Laptop, example: "Aplikasi kampus error atau layanan digital tidak dapat diakses." },
    { key: "KEAMANAS_INFORMASI", label: "Keamanan informasi", icon: DatabaseZap, example: "Penyalahgunaan akun atau tersebarnya data pribadi." },
    { key: "LAINNYA", label: "Lainnya", icon: MoreHorizontal, example: "Persoalan yang belum sesuai dengan kategori lain." },
  ] },
];

// Sorotan mengikuti kursor: satu listener untuk semua kartu, posisi disimpan
// sebagai CSS variable sehingga React tidak perlu render ulang.
function trackSpotlight(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== "mouse") return;
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-spotlight]");
  if (!card) return;
  const bounds = card.getBoundingClientRect();
  card.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
  card.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
}

export function LandingCategories() {
  return <>
    <div className={styles.groups} onPointerMove={trackSpotlight}>
      {groups.map((group, index) => <section key={group.title} className={styles.group} aria-labelledby={`category-group-${index}`} data-sensitive={group.sensitive || undefined}>
        <Reveal distance={12} duration={0.5} className={styles.head}>
          <span className={styles.count} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <h3 id={`category-group-${index}`}>{group.title}</h3>
          {group.sensitive && <p className={styles.safety}><ShieldCheck size={14} aria-hidden="true" />Isi aduan hanya dibuka petugas berwenang setelah verifikasi ulang.</p>}
        </Reveal>
        <RevealGroup stagger={0.05} amount={0.1} className={styles.grid}>
          {group.items.map((item) => <Reveal key={item.key} distance={12} duration={0.5}>
            <Link href={`/aduan/baru?category=${item.key}`} className={styles.card} data-spotlight="">
              <span className={styles.icon}><item.icon size={19} strokeWidth={1.5} aria-hidden="true" /></span>
              <span className={styles.text}><strong>{item.label}</strong><span>{item.example}</span></span>
              <ArrowUpRight size={15} className={styles.arrow} aria-hidden="true" />
            </Link>
          </Reveal>)}
        </RevealGroup>
      </section>)}
    </div>
    <p className={styles.note}>Satu kejadian dapat berkaitan dengan beberapa kategori. Pilih yang paling mendekati, lalu ceritakan konteksnya di dalam aduan. Belum menemukan yang sesuai? Pilih <Link href="/aduan/baru?category=LAINNYA">Lainnya</Link>.</p>
  </>;
}
