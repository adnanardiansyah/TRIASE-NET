import Link from "next/link";
import Image from "next/image";

export function Brand({ light = false, compact = false, institution = false }: { light?: boolean; compact?: boolean; institution?: boolean }) {
  return <Link href="/" aria-label={institution ? "Politeknik Negeri Lhokseumawe, Teknologi Informasi dan Komputer, TRIASE-Net, beranda" : "TRIASE-Net, beranda"} className={`brand ${light ? "brand-light" : ""} ${institution ? "brand-institution" : ""}`}>
    {institution && <><Image src="/images/logo-pnl.png" alt="Politeknik Negeri Lhokseumawe" width={48} height={48} className="brand-institution-logo" /><Image src="/images/logo-tik.jpg" alt="Teknologi Informasi dan Komputer" width={48} height={48} className="brand-institution-logo brand-department-logo" /><span className="brand-institution-divider" aria-hidden="true" /></>}
    <span className="brand-logo" aria-hidden="true"><Image src="/images/triase-student-services.png" alt="" width={1536} height={1024} sizes="128px" className="brand-logo-art" /></span>
    <span><span className="brand-name">TRIASE<span className={light ? "text-emerald-300" : "text-emerald-600"}>-Net</span></span>{!compact && <span className="brand-caption">Sistem Layanan Aduan Mahasiswa</span>}</span>
  </Link>;
}
