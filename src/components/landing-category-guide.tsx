import Link from "next/link";
import { ArrowUpRight, ChevronDown, Mail, Phone } from "lucide-react";
import { Reveal } from "./reveal";
import styles from "./landing-category-guide.module.css";

const groups = [
  { title: "Perkuliahan & layanan kampus", items: [
    { key: "AKADEMIK", label: "Akademik", example: "Kendala jadwal kuliah, penilaian, atau proses pembelajaran." },
    { key: "KEUANGAN", label: "Keuangan", example: "Ketidaksesuaian tagihan atau kendala administrasi pembayaran." },
    { key: "FASILITAS", label: "Fasilitas", example: "Ruang belajar, toilet, atau sarana kampus yang rusak." },
    { key: "KESEHATAN", label: "Kesehatan", example: "Kendala akses layanan kesehatan atau dukungan kesejahteraan mahasiswa." },
    { key: "KEBERSAMAAN", label: "Kebersamaan", example: "Persoalan komunikasi atau kerja sama dalam kegiatan kampus." },
  ] },
  { title: "Pelecehan, perundungan & diskriminasi", items: [
    { key: "PELECEHAN_SEKSUAL", label: "Pelecehan seksual", example: "Komentar, pesan, atau sentuhan bernuansa seksual yang tidak dikehendaki." },
    { key: "PELECEHAN_NON_SEKSUAL", label: "Pelecehan nonseksual", example: "Ucapan atau tindakan merendahkan tanpa muatan seksual." },
    { key: "PERUNDUNGAN", label: "Perundungan (bullying)", example: "Ejekan, pengucilan, atau penghinaan berulang, termasuk di ruang digital." },
    { key: "DISKRIMINASI", label: "Diskriminasi", example: "Perlakuan tidak setara atau pengecualian karena identitas atau latar belakang." },
  ] },
  { title: "Kekerasan, ancaman & intimidasi", items: [
    { key: "KEKERASAN_FISIK", label: "Kekerasan fisik", example: "Tindakan seperti memukul, menendang, atau melukai fisik." },
    { key: "KEKERASAN_PSIKOLOGIS", label: "Kekerasan psikologis", example: "Tekanan, penghinaan, atau tindakan yang menimbulkan ketakutan dan tekanan psikologis." },
    { key: "ANCAMAN_INTIMIDASI", label: "Ancaman / intimidasi", example: "Ancaman menyakiti, membalas laporan, atau pemaksaan melalui intimidasi." },
  ] },
  { title: "Sistem digital & persoalan lainnya", items: [
    { key: "TEKNOLOGI", label: "Teknologi", example: "Aplikasi kampus error atau layanan digital tidak dapat diakses." },
    { key: "KEAMANAS_INFORMASI", label: "Keamanan informasi", example: "Dugaan penyalahgunaan akun atau tersebarnya data pribadi." },
    { key: "LAINNYA", label: "Lainnya", example: "Persoalan yang belum sesuai dengan kategori lain." },
  ] },
];

export function LandingCategoryGuide() {
  return <Reveal duration={0.7} distance={24} className={styles.guide}>
    <div className={styles.heading}>
      <p className="eyebrow">Panduan kategori</p>
      <h3>Belum yakin memilih kategori?</h3>
      <p>Buka contoh berikut untuk menemukan kategori yang paling mendekati pengalaman Anda. Satu kejadian dapat berkaitan dengan beberapa kategori; ceritakan konteksnya di dalam aduan.</p>
    </div>
    <div className={styles.grid}>
      {groups.map((group) => <details key={group.title} className={styles.group}>
        <summary>{group.title}<ChevronDown size={17} aria-hidden="true" /></summary>
        <ul>{group.items.map((item) => <li key={item.key}>
          <Link href={`/aduan/baru?category=${item.key}`}>{item.label}<ArrowUpRight size={14} aria-hidden="true" /></Link>
          <p>{item.example}</p>
        </li>)}</ul>
      </details>)}
    </div>
    <p className={styles.note}>Contoh ini membantu memilih kategori awal, bukan menentukan hasil penanganan. Jika belum menemukan yang sesuai, pilih <Link href="/aduan/baru?category=LAINNYA">Lainnya</Link> dan jelaskan persoalannya.</p>
  </Reveal>;
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
      <address className={styles.contacts}>
        <a href="mailto:adnanadriansyah5@gmail.com"><Mail size={19} aria-hidden="true" /><span><span>Email pengelola</span><strong>adnanadriansyah5@gmail.com</strong></span><ArrowUpRight size={15} aria-hidden="true" /></a>
        <a href="tel:+6289531034437"><Phone size={19} aria-hidden="true" /><span><span>Telepon pengelola</span><strong>089531034437</strong></span><ArrowUpRight size={15} aria-hidden="true" /></a>
      </address>
    </Reveal>
  </section>;
}
