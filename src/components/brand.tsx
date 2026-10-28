import Link from "next/link";
import Image from "next/image";

export function Brand({ light = false, compact = false, institution = false }: { light?: boolean; compact?: boolean; institution?: boolean }) {
  return <Link href="/" aria-label={institution ? "Politeknik Negeri Lhokseumawe — TRIASE-Net, beranda" : "TRIASE-Net, beranda"} className={`brand ${light ? "brand-light" : ""} ${institution ? "brand-institution" : ""}`}>
    {institution && <><Image src="/images/logo-pnl.png" alt="Politeknik Negeri Lhokseumawe" width={48} height={48} className="brand-institution-logo" /><span className="brand-institution-divider" aria-hidden="true" /></>}
    <Image src="/images/brand-mark.png" alt="" width={44} height={44} className="brand-logo" />
    <span><span className="brand-name">TRIASE<span className={light ? "text-emerald-300" : "text-emerald-600"}>-Net</span></span>{!compact && <span className="brand-caption">Layanan aduan mahasiswa</span>}</span>
  </Link>;
}
