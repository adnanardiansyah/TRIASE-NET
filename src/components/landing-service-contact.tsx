import Link from "next/link";
import { ArrowUpRight, Mail, Phone } from "lucide-react";
import { Reveal } from "./reveal";
import styles from "./landing-service-contact.module.css";

// Kontak diambil dari environment agar data pribadi tidak tertanam di kode
// dan halaman publik. Kartu yang tidak disetel tidak ditampilkan.
const serviceEmail = process.env.NEXT_PUBLIC_SERVICE_EMAIL?.trim() ?? "";
const servicePhone = process.env.NEXT_PUBLIC_SERVICE_PHONE?.trim() ?? "";

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return "tel:" + (digits.startsWith("0") ? "+62" + digits.slice(1) : digits);
}

export function LandingServiceContact() {
  return <section id="pengelola" aria-labelledby="service-contact-heading" className={styles.contactSection}>
    <Reveal duration={0.7} distance={24} className={styles.contact}>
      <div>
        <p className="eyebrow">Pengelola layanan</p>
        <h2 id="service-contact-heading">Proyek Inovasi Produk</h2>
        <p>Hubungi pengelola untuk pertanyaan umum tentang TRIASE-Net. Sampaikan isi aduan melalui formulir agar perkembangan penanganannya dapat Anda ikuti.</p>
        <Link href="/aduan/baru" className={styles.reportLink}>Sampaikan aduan<ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
      {(serviceEmail || servicePhone) && <address className={styles.contacts}>
        {serviceEmail && <a href={`mailto:${serviceEmail}`}><Mail size={19} aria-hidden="true" /><span><span>Email pengelola</span><strong>{serviceEmail}</strong></span><ArrowUpRight size={15} aria-hidden="true" /></a>}
        {servicePhone && <a href={telHref(servicePhone)}><Phone size={19} aria-hidden="true" /><span><span>Telepon pengelola</span><strong>{servicePhone}</strong></span><ArrowUpRight size={15} aria-hidden="true" /></a>}
      </address>}
    </Reveal>
  </section>;
}
