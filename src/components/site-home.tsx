"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { div as MotionDiv } from "motion/react-m";
import { useScroll } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Building2, Check, ChevronDown, Fingerprint, GraduationCap, Handshake, HeartPulse, KeyRound, Laptop, LockKeyhole, Menu, MessageSquareText, MoreHorizontal, ShieldAlert, ShieldCheck, Wallet, X } from "lucide-react";
import { Brand } from "./brand";
import { HeroBackground } from "./hero-background";
import { HeroWave } from "./hero-wave";
import { HeroAtmosphere } from "./hero-atmosphere";
import { ComplaintTimeline } from "./complaint-timeline";
import { Reveal, RevealGroup } from "./reveal";
import { LandingExperience, PrivacyIllustration } from "./landing-experience";

const navItems = [{ id: "layanan", label: "Layanan" }, { id: "alur", label: "Alur pengaduan" }, { id: "privasi", label: "Privasi" }, { id: "bantuan", label: "Bantuan" }];

const categories = [
  { key: "AKADEMIK", label: "Akademik", description: "Perkuliahan dan proses pembelajaran", icon: BookOpen },
  { key: "KEUANGAN", label: "Keuangan", description: "Biaya pendidikan dan administrasi", icon: Wallet },
  { key: "FASILITAS", label: "Fasilitas", description: "Sarana dan lingkungan kampus", icon: Building2 },
  { key: "KEAMANAS_INFORMASI", label: "Keamanan informasi", description: "Privasi dan keamanan data", icon: ShieldAlert },
  { key: "KESEHATAN", label: "Kesehatan", description: "Kesehatan dan kesejahteraan mahasiswa", icon: HeartPulse },
  { key: "KEBERSAMAAN", label: "Kebersamaan", description: "Relasi dan kehidupan di kampus", icon: Handshake },
  { key: "TEKNOLOGI", label: "Teknologi", description: "Akses sistem dan layanan digital", icon: Laptop },
  { key: "LAINNYA", label: "Lainnya", description: "Hal lain yang perlu mendapat perhatian", icon: MoreHorizontal },
];
const faqs = [
  { question: "Siapa yang dapat membaca isi aduan saya?", answer: "Anda sebagai pelapor dan petugas yang memiliki kewenangan kategori, clearance risiko, serta status tugas aktif. Petugas membuka isi aduan melalui proses dekripsi yang tercatat dalam audit." },
  { question: "Apakah identitas saya ditampilkan kepada petugas?", answer: "Identitas pada tiket ditampilkan sebagai pseudonim. Nama dan email tidak ditampilkan bersama metadata aduan kepada petugas. Hindari menulis informasi pribadi yang tidak diperlukan di dalam isi aduan." },
  { question: "Bagaimana cara mengetahui perkembangan aduan?", answer: "Masuk ke dashboard Mahasiswa atau gunakan halaman Lacak Tiket. Detail tiket menampilkan riwayat status dan percakapan dengan petugas." },
  { question: "Bisakah saya menambahkan informasi setelah mengirim aduan?", answer: "Bisa. Gunakan percakapan di detail tiket selama aduan masih aktif. Percakapan ditutup ketika tiket selesai, ditutup, atau ditolak." },
  { question: "Mengapa saya diminta kode autentikator?", answer: "Kode autentikator adalah langkah verifikasi tambahan setelah password. Petugas juga dapat diminta memverifikasi ulang sebelum membuka data sensitif saat verifikasi sebelumnya sudah kedaluwarsa." },
];

export function SiteHome() {
  const { scrollYProgress } = useScroll();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      document.querySelector<HTMLButtonElement>('.landing-header button[aria-controls="landing-mobile-menu"]')?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > 12);
        if (window.scrollY < 120) setActiveSection("");
      });
    };
    update(); window.addEventListener("scroll", update, { passive: true });
    const sections = navItems.map((item) => document.getElementById(item.id)).filter((section): section is HTMLElement => !!section);
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id); });
      const current = sections.find((section) => visible.has(section.id));
      setActiveSection(current?.id ?? "");
    }, { rootMargin: "-15% 0px -55% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", update); observer.disconnect(); };
  }, []);
  return <div className="landing-page text-zinc-800">
    <header data-scrolled={scrolled} className="landing-header fixed inset-x-0 top-0 z-40 border-b">
      <MotionDiv aria-hidden="true" className="landing-scroll-progress" style={{ scaleX: scrollYProgress }} />
      <nav aria-label="Navigasi situs" className="mx-auto flex h-[76px] max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Brand light />
        <div className="landing-nav-links hidden items-center gap-1 text-xs font-medium text-zinc-500 md:flex">{navItems.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={activeSection === item.id ? "location" : undefined} className="hover:text-emerald-700">{item.label}</a>)}</div>
        <div className="flex items-center gap-2"><Link href="/login" className="ui-btn ui-btn-primary">Masuk<ArrowUpRight size={14} /></Link><button className="ui-icon md:hidden" onClick={() => setMenu(!menu)} aria-controls="landing-mobile-menu" aria-expanded={menu} aria-label={menu ? "Tutup navigasi" : "Buka navigasi"}>{menu ? <X size={18} /> : <Menu size={18} />}</button></div>
      </nav>
      {menu && <nav id="landing-mobile-menu" aria-label="Navigasi seluler" className="grid gap-1 border-t border-zinc-100 px-5 py-3 md:hidden">{navItems.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={activeSection === item.id ? "location" : undefined} onClick={() => setMenu(false)} className="py-2 text-sm">{item.label}</a>)}</nav>}
    </header>
    <section className="landing-hero" aria-labelledby="landing-title"><HeroBackground /><HeroAtmosphere /><div className="landing-hero-content"><div className="landing-hero-sequence"><Reveal as="p" trigger="mount" from="fade" duration={0.7} className="mb-6 inline-flex items-center gap-2 text-[11px] font-medium text-emerald-200"><span className="h-px w-7 bg-emerald-300" />DARI SUARA, MENJADI PERUBAHAN</Reveal><Reveal as="h1" id="landing-title" trigger="mount" distance={24} blur={3} duration={0.75} delay={0.12} className="landing-wordmark">TRIASE-Net / Layanan aduan mahasiswa</Reveal><Reveal as="p" trigger="mount" distance={24} duration={0.75} delay={0.27} className="landing-title">Suara Anda<br />layak <Reveal as="span" trigger="mount" from="fade" duration={0.8} delay={0.45}>didengar.</Reveal></Reveal><Reveal as="p" trigger="mount" distance={24} duration={0.7} delay={0.42} className="landing-intro">Sampaikan aduan tentang kehidupan kampus. Dengan identitas yang terlindungi dan penanganan yang dapat Anda ikuti.</Reveal><RevealGroup trigger="mount" stagger={0.12} delay={0.57} className="mt-8 flex flex-wrap gap-3"><Reveal distance={24} duration={0.65}><Link href="/aduan/baru" className="ui-btn ui-btn-light px-6 py-3">Sampaikan aduan<ArrowUpRight size={16} /></Link></Reveal><Reveal distance={24} duration={0.65}><Link href="/aduan/lacak" className="ui-btn border-white/40 bg-transparent px-6 py-3 text-white hover:border-white hover:bg-white/10">Lacak tiket<ArrowRight size={15} /></Link></Reveal></RevealGroup><Reveal as="p" trigger="mount" from="fade" duration={0.6} delay={0.79} className="mt-8 flex items-center gap-2 text-[11px] text-emerald-100/80"><LockKeyhole size={13} />Privasi pelapor menjadi bagian dari setiap proses.</Reveal></div></div><HeroWave /><div className="landing-photo-caption" aria-hidden="true"><span className="landing-caption-line" /><p>Untuk perjalanan kampus<br /><strong>yang lebih baik.</strong></p></div><a href="#layanan" className="landing-scroll absolute right-7 z-10 hidden items-center gap-2 text-[10px] text-white/70 sm:flex">Jelajahi layanan<ArrowDown size={13} className="landing-scroll-arrow" aria-hidden="true" /></a></section>
    <div className="landing-info border-b border-zinc-200"><RevealGroup stagger={0.12} amount={0.08} className="mx-auto grid max-w-[1200px] gap-5 px-5 py-7 sm:grid-cols-3 sm:px-8">{[{ icon: Fingerprint, title: "Identitas berpseudonim", note: "Pseudonim menggantikan identitas pada tiket" }, { icon: LockKeyhole, title: "Isi aduan terenkripsi", note: "Akses isi dibatasi sesuai kewenangan" }, { icon: MessageSquareText, title: "Penanganan dapat diikuti", note: "Riwayat status dan percakapan dalam satu tiket" }].map((item) => <Reveal key={item.title} distance={24} duration={0.65} className="landing-feature flex items-start gap-3"><item.icon size={19} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald-700" /><div><p className="text-xs font-semibold">{item.title}</p><p className="mt-1 text-[10px] leading-5 text-zinc-600">{item.note}</p></div></Reveal>)}</RevealGroup></div>

    <LandingExperience />

    <section id="layanan" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-16 sm:px-8 sm:py-20"><Reveal from="bottom" distance={24} duration={0.65}><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Ruang untuk setiap persoalan</p><h2 className="mt-3 text-3xl font-semibold leading-tight">Apa yang ingin Anda sampaikan?</h2></div><p className="max-w-sm text-sm leading-7 text-zinc-500">Pilih kategori yang paling sesuai. Setiap aduan diteruskan ke petugas dalam kewenangannya.</p></div></Reveal><RevealGroup className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4" stagger={0.12} amount={0.08}>{categories.map((category, index) => <Reveal key={category.key} from="bottom" distance={24} duration={0.65}><Link href={`/aduan/baru?category=${category.key}`} className="landing-category group flex h-full items-start gap-3 border-b border-zinc-200 px-1 py-6 sm:mr-7"><span className="landing-category-icon grid size-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700"><category.icon size={20} strokeWidth={1.5} /></span><div className="min-w-0 flex-1"><h3 className="flex items-start justify-between gap-2 text-xs font-semibold">{category.label}<ArrowUpRight size={13} className="shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-700" /></h3><p className="mt-2 text-[11px] leading-6 text-zinc-500">{category.description}</p><span className="landing-category-foot"><span aria-hidden="true">0{index + 1}</span><span>Sampaikan aduan<ArrowRight size={13} /></span></span></div></Link></Reveal>)}</RevealGroup></section>

    <section id="alur" className="scroll-mt-24 border-y border-zinc-200 bg-[#f5f8f6]"><div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 sm:py-20"><Reveal from="bottom" distance={24} duration={0.65}><p className="eyebrow">Alur pengaduan</p><h2 className="mt-3 text-3xl font-semibold">Dari laporan hingga tindak lanjut.</h2></Reveal><ComplaintTimeline /><Reveal distance={22} duration={0.65} className="landing-timeline-note"><span><MessageSquareText size={18} />Penanganan dapat diikuti</span><Link href="/aduan/lacak" className="landing-text-link">Lacak tiket<ArrowRight size={15} /></Link></Reveal></div></section>

    <section id="privasi" className="mx-auto grid max-w-[1200px] scroll-mt-24 gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_1fr]"><Reveal from="bottom" distance={24} duration={0.65}><p className="eyebrow">Privasi & kepercayaan</p><h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight">Berani bercerita.<br />Tetap terlindungi.</h2><p className="mt-5 max-w-md text-sm leading-7 text-zinc-500">Aduan dapat berisi hal yang sensitif. Karena itu, perlindungan identitas dan pembatasan akses menjadi bagian dari layanan ini.</p><Link href="/login" className="mt-7 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">Masuk ke layanan<ArrowRight size={15} /></Link><PrivacyIllustration /></Reveal><RevealGroup stagger={0.12} amount={0.08} className="landing-privacy-cards">{[{ icon: Fingerprint, title: "Identitas pada tiket disamarkan", body: "Petugas melihat pseudonim, bukan nama atau email pelapor pada daftar aduan." }, { icon: KeyRound, title: "Isi dibuka sesuai kewenangan", body: "Kategori, risiko, status tugas, dan verifikasi petugas menentukan akses terhadap isi aduan." }, { icon: ShieldCheck, title: "Akses dan perubahan tercatat", body: "Pembukaan isi aduan dan perubahan status terhubung dengan catatan audit." }].map((item) => <Reveal key={item.title} distance={24} duration={0.65} className="landing-privacy-card flex gap-4"><item.icon size={22} strokeWidth={1.5} className="mt-1 shrink-0 text-emerald-700" /><div><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-7 text-zinc-500">{item.body}</p></div></Reveal>)}</RevealGroup></section>

    <section className="landing-roles" aria-labelledby="roles-heading"><div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 sm:py-20"><Reveal distance={24} duration={0.7} className="landing-roles-heading"><div><p className="eyebrow">Satu layanan, tiga peran</p><h2 id="roles-heading">Terhubung untuk kampus<br />yang lebih baik.</h2></div><span className="landing-roles-emblem" aria-hidden="true"><GraduationCap size={36} strokeWidth={1} /></span></Reveal><RevealGroup stagger={0.1} className="landing-role-grid">{[{ icon: GraduationCap, label: "Mahasiswa", note: "Sampaikan aduan dan ikuti perkembangannya.", number: "01" }, { icon: ShieldCheck, label: "Satuan Tugas", note: "Tinjau dan tindak lanjuti aduan sesuai kewenangan.", number: "02" }, { icon: Building2, label: "Administrator", note: "Kelola layanan dan akses sesuai peran.", number: "03" }].map((role) => <Reveal key={role.label} distance={24} duration={0.65}><Link href="/login" className="landing-role-card"><span className="landing-role-top"><role.icon size={26} strokeWidth={1.3} /><span>{role.number}</span></span><h3>{role.label}</h3><p>{role.note}</p><span className="landing-role-link">Masuk ke layanan<ArrowUpRight size={17} /></span></Link></Reveal>)}</RevealGroup></div></section>

    <section id="bantuan" className="mx-auto grid max-w-[1200px] scroll-mt-24 gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[.7fr_1.3fr]"><Reveal distance={24} duration={0.7}><p className="eyebrow">Pusat bantuan</p><h2 className="mt-3 text-3xl font-semibold leading-tight">Hal yang sering<br />ditanyakan.</h2><p className="mt-4 max-w-xs text-xs leading-7 text-zinc-500">Informasi sebelum Anda mulai menyampaikan aduan.</p><div className="landing-help-note"><MessageSquareText size={24} strokeWidth={1.3} /><p>Penanganan dapat diikuti.</p><Link href="/aduan/lacak" className="landing-text-link">Lacak tiket<ArrowUpRight size={15} /></Link></div></Reveal><RevealGroup stagger={0.12} amount={0.08} className="landing-faq-list">{faqs.map((faq) => <Reveal key={faq.question} distance={24} duration={0.65}><details className="landing-faq group"><summary className="flex cursor-pointer list-none items-start justify-between gap-5 text-sm font-medium [&::-webkit-details-marker]:hidden">{faq.question}<ChevronDown size={17} className="mt-0.5 shrink-0 text-zinc-400 transition-transform duration-150 group-open:rotate-180" /></summary><p className="mt-4 max-w-xl text-xs leading-7 text-zinc-500">{faq.answer}</p></details></Reveal>)}</RevealGroup></section>

    <section className="landing-final-cta"><div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-5 py-10 sm:px-8"><Reveal distance={24} duration={0.7}><p className="flex items-center gap-2 text-[11px] font-medium text-emerald-700"><Check size={14} />Mulai dari satu langkah.</p><h2 className="mt-2 text-2xl font-semibold text-emerald-950">Ada hal yang perlu disampaikan?</h2></Reveal><Reveal distance={24} duration={0.7} delay={0.12}><Link href="/aduan/baru" className="ui-btn ui-btn-primary px-6">Buat aduan<ArrowUpRight size={16} /></Link></Reveal></div></section>
    <footer className="landing-footer mx-auto max-w-[1200px] px-5 sm:px-8"><div className="landing-footer-main"><Reveal from="fade" duration={0.65}><Brand /><p className="landing-footer-message">TRIASE-Net. Privasi pelapor,<br />prioritas bersama.</p></Reveal><RevealGroup stagger={0.1} className="landing-footer-links"><Reveal><p>Jelajahi</p>{navItems.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}</Reveal><Reveal><p>Layanan</p><Link href="/aduan/baru">Sampaikan aduan</Link><Link href="/aduan/lacak">Lacak tiket</Link><Link href="/login">Masuk ke layanan</Link></Reveal></RevealGroup></div><div className="landing-footer-bottom"><span>TRIASE-Net / Layanan aduan mahasiswa</span><a href="#privasi">Privasi & keamanan<ArrowUpRight size={12} /></a></div></footer>
  </div>;
}
