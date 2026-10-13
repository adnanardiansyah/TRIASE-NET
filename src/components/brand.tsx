import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <Link href="/" aria-label="TRIASE-Net, beranda" className={`brand ${light ? "brand-light" : ""}`}>
    <span className="brand-symbol"><ShieldCheck size={22} strokeWidth={1.8} aria-hidden /></span>
    <span><span className="brand-name">TRIASE<span className={light ? "text-emerald-300" : "text-emerald-600"}>-Net</span></span>{!compact && <span className="brand-caption">Layanan aduan mahasiswa</span>}</span>
  </Link>;
}
