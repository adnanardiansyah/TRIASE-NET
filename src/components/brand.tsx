import Link from "next/link";
import Image from "next/image";

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <Link href="/" aria-label="TRIASE-Net, beranda" className={`brand ${light ? "brand-light" : ""}`}>
    <Image src="/images/brand-mark.png" alt="" width={44} height={44} className="brand-logo" />
    <span><span className="brand-name">TRIASE<span className={light ? "text-emerald-300" : "text-emerald-600"}>-Net</span></span>{!compact && <span className="brand-caption">Layanan aduan mahasiswa</span>}</span>
  </Link>;
}
