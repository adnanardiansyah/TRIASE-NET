"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, Fingerprint, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react";
import { Reveal } from "./reveal";

const features = [
  { icon: Fingerprint, label: "Identitas", title: "Identitas berpseudonim", description: "Pseudonim menggantikan identitas pada tiket", detail: "Petugas melihat pseudonim, bukan nama atau email pelapor pada daftar aduan.", chips: ["Identitas pada tiket disamarkan", "Privasi pelapor"] },
  { icon: LockKeyhole, label: "Perlindungan", title: "Isi aduan terenkripsi", description: "Akses isi dibatasi sesuai kewenangan", detail: "Kategori, risiko, status tugas, dan verifikasi petugas menentukan akses terhadap isi aduan.", chips: ["Akses sesuai kewenangan", "Akses dan perubahan tercatat"] },
  { icon: MessageSquareText, label: "Tindak lanjut", title: "Penanganan dapat diikuti", description: "Riwayat status dan percakapan dalam satu tiket", detail: "Lihat perubahan status dan riwayat penanganan melalui dashboard atau halaman pelacakan tiket.", chips: ["Riwayat penanganan", "Percakapan pada tiket"] },
];

export function LandingExperience() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const feature = features[selected]!;
  const Icon = feature.icon;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % features.length;
    else if (event.key === "ArrowLeft") next = (index + features.length - 1) % features.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = features.length - 1;
    else return;
    event.preventDefault(); setSelected(next); tabs.current[next]?.focus();
  }
  return <section className="landing-experience mx-auto max-w-[1200px] px-5 py-16 sm:px-8 sm:py-24" aria-labelledby="experience-heading">
    <Reveal distance={22} duration={0.65} className="landing-section-heading">
      <div><p className="eyebrow">Layanan aduan mahasiswa</p><h2 id="experience-heading">Satu ruang.<br /><span>Setiap suara berarti.</span></h2></div>
      <p>Sampaikan aduan tentang kehidupan kampus. Dengan identitas yang terlindungi dan penanganan yang dapat Anda ikuti.</p>
    </Reveal>
    <Reveal distance={22} duration={0.65} className="landing-experience-shell">
      <div className="landing-experience-tabs" role="tablist" aria-label="Kenali layanan TRIASE-Net">
        {features.map((item, index) => <button key={item.label} ref={(node) => { tabs.current[index] = node; }} id={`experience-tab-${index}`} role="tab" type="button" aria-selected={selected === index} aria-controls={`experience-panel-${index}`} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={(event) => navigate(event, index)}><item.icon size={17} /><span>{item.label}</span><span className="landing-tab-number" aria-hidden="true">0{index + 1}</span></button>)}
      </div>
      {features.map((item, index) => <div key={item.label} id={`experience-panel-${index}`} role="tabpanel" aria-labelledby={`experience-tab-${index}`} hidden={selected !== index} tabIndex={0}>
        {selected === index && <div className="landing-experience-panel">
          <div className="landing-experience-copy"><span className="landing-small-label">TRIASE-Net / 0{index + 1}</span><h3>{feature.title}</h3><p className="landing-panel-lead">{feature.description}</p><p>{feature.detail}</p><div className="landing-panel-chips">{feature.chips.map((chip) => <span key={chip}><Check size={13} />{chip}</span>)}</div><Link className="landing-text-link" href={index === 2 ? "/aduan/lacak" : "/aduan/baru"}>{index === 2 ? "Lacak tiket" : "Sampaikan aduan"}<ArrowUpRight size={16} /></Link></div>
          <div className="landing-service-visual" aria-hidden="true"><div className="landing-visual-grid" /><div className="landing-visual-orbit landing-orbit-outer" /><div className="landing-visual-orbit landing-orbit-inner" /><span className="landing-visual-node landing-node-top"><ShieldCheck size={18} /></span><span className="landing-visual-node landing-node-bottom"><MessageSquareText size={18} /></span><div className="landing-visual-core"><Icon size={48} strokeWidth={1.15} /></div><div className="landing-visual-note"><span className="landing-status-dot" />{feature.title}<span>TRIASE-Net</span></div></div>
        </div>}
      </div>)}
    </Reveal>
  </section>;
}

export function PrivacyIllustration() {
  return <div className="landing-privacy-visual" aria-label="Perlindungan berlapis: identitas disamarkan, akses sesuai kewenangan, dan audit tercatat">
    <div className="landing-privacy-header"><span className="landing-small-label">Privasi dalam setiap proses</span><ShieldCheck size={18} /></div>
    <div className="landing-privacy-diagram" aria-hidden="true"><span className="landing-privacy-ring" /><span className="landing-privacy-ring landing-privacy-ring-inner" /><div className="landing-privacy-shield"><Fingerprint size={42} strokeWidth={1.2} /></div><span className="landing-privacy-tag landing-privacy-tag-one"><LockKeyhole size={13} />Enkripsi</span><span className="landing-privacy-tag landing-privacy-tag-two"><ShieldCheck size={13} />Kewenangan</span></div>
    <div className="landing-privacy-bottom"><span>Identitas pada tiket</span><strong><Fingerprint size={14} />Pseudonim</strong></div>
  </div>;
}
