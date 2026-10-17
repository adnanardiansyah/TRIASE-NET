/**
 * Bentuk minimum yang dipakai ringkasan dasbor.
 *
 * Sengaja bukan `DemoTicketRecord`: dasbor satgas dan admin menerima tampilan
 * yang sudah dipseudonimkan, tanpa email dan tanpa isi aduan, jadi tipe ini
 * juga mencegah halaman tersebut diam-diam kembali meminta field yang banned.
 */
import { ADUAN_CLOSED_STATUS, type AduanStatus } from "./domain/enums";
import { SLA_TARGET_DAYS } from "./ticket-sla";
export { SLA_TARGET_DAYS } from "./ticket-sla";

function isClosedStatus(status: string): boolean {
  return ADUAN_CLOSED_STATUS.includes(status as AduanStatus);
}

export interface SummaryTicket {
  ticketId: string;
  subject: string;
  riskBand: string;
  status: string;
  pseudonym: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Kategori aduan. Opsional karena ringkasan lama dan sebagian fixture tes
   * tidak menyertakannya; `DEMO_TICKET_STATUSES` dan data API sebenarnya
   * selalu mengisinya. Fungsi yang memakainya harus menangani `undefined`.
   */
  category?: string;
  rowVersion?: number;
  closedAt?: string | null;
}

export type MahasiswaSummary = {
  cards: { label: string; value: string }[];
  recent: { ticket: string; title: string; status: string; updated: string }[];
};

export type AdminSummary = {
  stats: { label: string; value: string }[];
  tasks: { name: string; owner: string; eta: string }[];
};

/**
 * Bobot representatif per band risiko untuk ditampilkan.
 *
 * Angka ini hanya untuk ringkasan dasbor, bukan untuk keputusan akses. Dekripsi
 * dan penentuan band tetap milik `calculateRiskScore` + `getRiskBand`.
 */
const RISK_BAND_WEIGHT: Readonly<Record<string, number>> = {
  LOW: 20,
  MEDIUM: 55,
  HIGH: 85,
};

const UNKNOWN_BAND_WEIGHT = 50;

export function formatTicketStatus(status: string): string {
  switch (status) {
    case "DITERIMA":
      return "Diterima";
    case "DITUTUP":
      return "Ditutup";
    case "DITOLAK":
      return "Ditolak";
    case "DALAM_PENANGANAN":
      return "Dalam penanganan";
    case "MENUNGGU_TINDAK_LANJUT":
      return "Menunggu tindak lanjut";
    case "SELESAI":
      return "Selesai";
    default:
      return status;
  }
}

export function formatRelativeTime(isoValue: string): string {
  const timestamp = new Date(isoValue).getTime();

  // Tanpa penjaga ini, nilai yang tidak dapat diparse membuat `difference`
  // menjadi NaN dan seluruh perbandingan di bawah false, sehingga hasilnya
  // keluar sebagai "NaN hari lalu".
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const difference = Date.now() - timestamp;

  if (difference < 60_000) {
    return "baru saja";
  }

  const minutes = Math.max(1, Math.round(difference / 60_000));
  if (minutes < 60) {
    return `${minutes} menit lalu`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} jam lalu`;
  }

  const days = Math.round(hours / 24);
  return `${days} hari lalu`;
}

export function sortNewestFirst<T extends SummaryTicket>(items: T[]): T[] {
  return [...items].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

/** True bila tiket dibuat pada hari kalender yang sama dengan `reference`. */
export function isSameCalendarDay(isoValue: string, reference: Date): boolean {
  const date = new Date(isoValue);

  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

export function buildMahasiswaSummary(tickets: SummaryTicket[]): MahasiswaSummary {
  const ordered = sortNewestFirst(tickets);
  const activeCount = ordered.filter((ticket) => !isClosedStatus(ticket.status)).length;
  const latest = ordered[0];
  const averageRisk = ordered.length
    ? Math.round(
        ordered.reduce(
          (total, ticket) => total + (RISK_BAND_WEIGHT[ticket.riskBand] ?? UNKNOWN_BAND_WEIGHT),
          0,
        ) / ordered.length,
      )
    : 0;

  return {
    cards: [
      { label: "Aduan aktif", value: String(activeCount) },
      { label: "Status terbaru", value: latest ? formatTicketStatus(latest.status) : "Belum ada" },
      { label: "Ticket terbaru", value: latest ? latest.ticketId : "-" },
      { label: "Rata-rata risiko", value: `${averageRisk} / 100` },
    ],
    recent: ordered.slice(0, 3).map((ticket) => ({
      ticket: ticket.ticketId,
      title: ticket.subject,
      status: formatTicketStatus(ticket.status),
      updated: formatRelativeTime(ticket.updatedAt),
    })),
  };
}

export function buildAdminSummary(
  tickets: SummaryTicket[],
  now: Date = new Date(),
): AdminSummary {
  const ordered = sortNewestFirst(tickets);
  const highRiskCount = ordered.filter((ticket) => ticket.riskBand === "HIGH").length;
  const todayCount = ordered.filter((ticket) => isSameCalendarDay(ticket.createdAt, now)).length;
  const closedCount = ordered.filter((ticket) => ticket.status === "SELESAI").length;
  const completionRate = ordered.length ? Math.round((closedCount / ordered.length) * 100) : 0;

  return {
    stats: [
      // Versi sebelumnya memakai `ordered.length` untuk label "Aduan hari ini",
      // padahal itu total semua tiket, bukan yang dibuat hari ini.
      { label: "Aduan hari ini", value: String(todayCount) },
      { label: "Total tiket", value: String(ordered.length) },
      { label: "Risiko tinggi", value: String(highRiskCount) },
      { label: "Tingkat penyelesaian", value: `${completionRate}%` },
    ],
    tasks: ordered.slice(0, 3).map((ticket) => ({
      name: ticket.subject,
      owner: ticket.pseudonym,
      eta: formatTicketStatus(ticket.status),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Metrik operasional dasbor                                                    */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * Ambang waktu penyelesaian per band risiko, dalam hari.
 *
 * Ini kebijakan operasional, bukan hasil kalkulasi: makin tinggi risiko,
 * makin cepat tiket harus selesai. Nilainya hanya untuk ringkasan dasbor dan
 * tidak ikut memengaruhi keputusan akses, enkripsi, atau akses dekripsi.
 */


/** Ambang yang dipakai saat band risiko tidak dikenal. */
const UNKNOWN_SLA_TARGET_DAYS = 7;

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  AKADEMIK: "Akademik",
  KEUANGAN: "Keuangan",
  FASILITAS: "Fasilitas",
  KEAMANAS_INFORMASI: "Keamanan informasi",
  KESEHATAN: "Kesehatan",
  KEBERSAMAAN: "Kebersamaan",
  TEKNOLOGI: "Teknologi",
  LAINNYA: "Lainnya",
};

const RISK_LABEL: Readonly<Record<string, string>> = {
  LOW: "Rendah",
  MEDIUM: "Sedang",
  HIGH: "Tinggi",
};

const UNRESOLVED_CATEGORY = "LAINNYA";

export type DistributionSlice = {
  key: string;
  label: string;
  count: number;
  /** Persentase 0-100, sudah dibulatkan. */
  percent: number;
};

export type SlaSummary = {
  /** Tiket berstatus `SELESAI` yang jadi dasar perhitungan. */
  resolved: number;
  /** Sebagian dari `resolved` yang selesai sebelum ambangnya. */
  withinTarget: number;
  /** Sebagian dari `resolved` yang lewat ambangnya. */
  breached: number;
  /**
   * Tiket yang masih terbuka tetapi usianya sudah melewati ambangnya.
   *
   * Angka ini tidak masuk hitungan `rate` karena tiket yang belum selesai
   * belum bisa dinyatakan gagal, tapi tetap penting: justru tiket inilah yang
   * paling perlu ditangani hari ini juga.
   */
  overdueOpen: number;
  /** Persentase `withinTarget` terhadap `resolved`, 0-100. */
  rate: number;
  /** Ambang yang dipakai, untuk ditampilkan di UI. */
  targetDays: number;
};

export function formatRiskBand(riskBand: string): string {
  return RISK_LABEL[riskBand] ?? riskBand;
}

export function formatTicketCategory(category: string | undefined): string {
  if (!category) {
    return CATEGORY_LABEL[UNRESOLVED_CATEGORY] ?? UNRESOLVED_CATEGORY;
  }

  return CATEGORY_LABEL[category] ?? category;
}

/**
 * Durasi dalam bentuk yang enak dibaca, untuk nilai rata-rata dan usia tiket.
 *
 * Unit dipilih supaya kolom tabel tidak melebar: nilai di bawah satu menit
 * diringkas jadi "&lt; 1 menit", lalu naik ke menit, jam, dan hari.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "-";
  }

  // Ambang diperiksa pada nilai mentahnya, bukan pada hasil pembulatan.
  // `Math.round` di bawah akan menaikkan 30 detik menjadi 1 menit, sehingga
  // nilai di bawah satu menit ikut terbaca "1 menit" dan batas "&lt; 1 menit"
  // tidak pernah tercapai.
  if (milliseconds < 60_000) {
    return "< 1 menit";
  }

  const minutes = Math.round(milliseconds / 60_000);

  if (minutes < 60) {
    return `${minutes} menit`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} jam`;
  }

  return `${Math.round(hours / 24)} hari`;
}

function toPercent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

/**
 * Urutan band risiko tetap, bukan urutan jumlah.
 *
 * Dashboard sengaja memakai urutan tetap, bukan urutan jumlah: pembaca membandingkan
 * panjang bar, dan urutan "Tinggi, Sedang, Rendah" sudah jadi ingatan bersama.
 * Mengurutkan menurut jumlah membuat bar melompat-lompat setiap data baru masuk.
 */
const RISK_ORDER: readonly string[] = ["HIGH", "MEDIUM", "LOW"];

const STATUS_ORDER: readonly string[] = [
  "DITERIMA",
  "DALAM_PENANGANAN",
  "MENUNGGU_TINDAK_LANJUT",
  "SELESAI",
  "DITUTUP",
  "DITOLAK",
];

export function buildRiskDistribution(tickets: SummaryTicket[]): DistributionSlice[] {
  const counts = new Map<string, number>();

  for (const ticket of tickets) {
    const key = ticket.riskBand || "MEDIUM";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return RISK_ORDER.filter((key) => counts.has(key)).map((key) => ({
    key,
    label: formatRiskBand(key),
    count: counts.get(key) ?? 0,
    percent: toPercent(counts.get(key) ?? 0, tickets.length),
  }));
}

export function buildStatusDistribution(tickets: SummaryTicket[]): DistributionSlice[] {
  const counts = new Map<string, number>();

  for (const ticket of tickets) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
  }

  const known = STATUS_ORDER.filter((key) => counts.has(key)).map((key) => ({
    key,
    label: formatTicketStatus(key),
    count: counts.get(key) ?? 0,
    percent: toPercent(counts.get(key) ?? 0, tickets.length),
  }));

  // Status di luar daftar known tetap perlu terlihat, kalau tidak administrator
  // mengira tiketnya hilang karena tidak muncul di mana pun.
  const knownKeys = new Set(STATUS_ORDER);
  const extra = [...counts.entries()]
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, count]) => ({
      key,
      label: formatTicketStatus(key),
      count,
      percent: toPercent(count, tickets.length),
    }));

  return [...known, ...extra];
}

/**
 * Sebaran kategori, diurutkan dari yang paling banyak.
 *
 * Kategori tanpa label yang dikenal dikelompokkan ke `LAINNYA` supaya
 * denormalisasinya tidak memecah bar chart jadi terlalu banyak irisan.
 */
export function buildCategoryDistribution(tickets: SummaryTicket[]): DistributionSlice[] {
  const counts = new Map<string, number>();

  for (const ticket of tickets) {
    const raw = ticket.category ?? UNRESOLVED_CATEGORY;
    const key = raw in CATEGORY_LABEL ? raw : UNRESOLVED_CATEGORY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({
      key,
      label: formatTicketCategory(key),
      count,
      percent: toPercent(count, tickets.length),
    }));
}

/**
 * Kepatuhan SLA dihitung hanya dari tiket yang sudah `SELESAI`.
 *
 * Tiket yang masih berjalan tidak bisa dinilai "melewati ambang" sebelum
 * waktunya habis, jadi menghitungnya sebagai pelanggaran akan membuat angka
 * selalu merah pada sistem yang justru sehat. Tiket selesai dihitung dari
 * `updatedAt - createdAt` karena itu satu-satunya pasangan timestamp yang
 * tersedia tanpa menambah endpoint baru.
 */
export function buildSlaSummary(
  tickets: SummaryTicket[],
  now: Date = new Date(),
): SlaSummary {
  const resolved = tickets.filter((ticket) => ticket.status === "SELESAI" || ticket.status === "DITUTUP");

  let withinTarget = 0;
  let breached = 0;
  let overdueOpen = 0;

  for (const ticket of resolved) {
    const created = new Date(ticket.createdAt).getTime();
    const updated = new Date(ticket.closedAt ?? ticket.updatedAt).getTime();

    if (!Number.isFinite(created) || !Number.isFinite(updated)) {
      continue;
    }

    const target = SLA_TARGET_DAYS[ticket.riskBand] ?? UNKNOWN_SLA_TARGET_DAYS;

    if (updated - created <= target * DAY_MS) {
      withinTarget += 1;
    } else {
      breached += 1;
    }
  }

  for (const ticket of tickets) {
    if (isClosedStatus(ticket.status)) {
      continue;
    }

    const created = new Date(ticket.createdAt).getTime();

    if (!Number.isFinite(created)) {
      continue;
    }

    const target = SLA_TARGET_DAYS[ticket.riskBand] ?? UNKNOWN_SLA_TARGET_DAYS;

    if (now.getTime() - created > target * DAY_MS) {
      overdueOpen += 1;
    }
  }

  const highestRisk = tickets.some((ticket) => ticket.riskBand === "HIGH") ? "HIGH" : "MEDIUM";

  return {
    resolved: resolved.length,
    withinTarget,
    breached,
    overdueOpen,
    rate: toPercent(withinTarget, resolved.length),
    targetDays: SLA_TARGET_DAYS[highestRisk] ?? UNKNOWN_SLA_TARGET_DAYS,
  };
}

/** Rata-rata lama penyelesaian, hanya dari tiket `SELESAI`. */
export function buildAverageResolution(tickets: SummaryTicket[]): number | null {
  const durations = tickets
    .filter((ticket) => ticket.status === "SELESAI")
    .map((ticket) => new Date(ticket.updatedAt).getTime() - new Date(ticket.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (durations.length === 0) {
    return null;
  }

  return durations.reduce((total, value) => total + value, 0) / durations.length;
}

/** Tiket terbuka tertua, untuk dipakai sebagai penanda antrean menumpuk. */
export function findOldestOpenTicket(tickets: SummaryTicket[]): SummaryTicket | null {
  const open = tickets.filter((ticket) => !isClosedStatus(ticket.status));

  if (open.length === 0) {
    return null;
  }

  return open.reduce((oldest, ticket) =>
    new Date(ticket.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? ticket : oldest,
  );
}

export type SatuanTugasSummary = {
  stats: { label: string; value: string; hint: string }[];
  risk: DistributionSlice[];
  status: DistributionSlice[];
  category: DistributionSlice[];
  sla: SlaSummary;
  averageResolution: string;
  oldestOpenLabel: string;
};

export function buildSatgasSummary(
  tickets: SummaryTicket[],
  now: Date = new Date(),
): SatuanTugasSummary {
  const open = tickets.filter((ticket) => !isClosedStatus(ticket.status));
  const highRiskOpen = open.filter((ticket) => ticket.riskBand === "HIGH");
  const waiting = tickets.filter((ticket) => ticket.status === "MENUNGGU_TINDAK_LANJUT");
  const averageResolution = buildAverageResolution(tickets);
  const oldestOpen = findOldestOpenTicket(tickets);
  const sla = buildSlaSummary(tickets, now);

  const oldestOpenAge = oldestOpen
    ? now.getTime() - new Date(oldestOpen.createdAt).getTime()
    : null;

  return {
    stats: [
      {
        label: "Antrean aktif",
        value: String(open.length),
        hint: highRiskOpen.length > 0 ? `${highRiskOpen.length} berisiko tinggi` : "Tidak ada risiko tinggi",
      },
      {
        label: "Menunggu tindak lanjut",
        value: String(waiting.length),
        hint: waiting.length > 0 ? "Perluditindaklanjuti" : "Semua berjalan",
      },
      {
        label: "Rata-rata penyelesaian",
        value: averageResolution === null ? "-" : formatDuration(averageResolution),
        hint: averageResolution === null ? "Belum ada tiket selesai" : "Dari tiket selesai",
      },
      {
        label: "Kepatuhan SLA",
        value: `${sla.rate}%`,
        hint:
          sla.overdueOpen > 0
            ? `${sla.overdueOpen} tiket terbuka lewat ambang`
            : `${sla.withinTarget} dari ${sla.resolved} tiket selesai tepat waktu`,
      },
    ],
    risk: buildRiskDistribution(tickets),
    status: buildStatusDistribution(tickets),
    category: buildCategoryDistribution(tickets),
    sla,
    averageResolution: averageResolution === null ? "-" : formatDuration(averageResolution),
    oldestOpenLabel: oldestOpenAge === null ? "Antrean kosong" : formatDuration(oldestOpenAge),
  };
}

/**
 * Bentuk satu tiket untuk daftar di dasbor mahasiswa.
 *
 * Label sudah diterjemahkan di sini, bukan di komponen, supaya komponen tidak
 * perlu tahu nama enum domain. `isOpen` dipakai untuk memilih warna status
 * tanpa memanggil perbandingan ulang di markup.
 */
export type MahasiswaTicket = {
  ticketId: string;
  subject: string;
  status: string;
  statusLabel: string;
  riskBand: string;
  riskLabel: string;
  category: string;
  categoryLabel: string;
  updatedLabel: string;
  isOpen: boolean;
};

export type MahasiswaDashboard = {
  stats: { label: string; value: string; hint: string }[];
  tickets: MahasiswaTicket[];
};

/**
 * Memetakan skor rata-rata risiko ke band, supaya baris kedua kartu KPI bisa
 * memakai bahasa yang sama dengan pil risiko.
 */
function riskLabelForScore(score: number): string {
  if (score >= 70) {
    return RISK_LABEL.HIGH ?? "Tinggi";
  }

  if (score >= 40) {
    return RISK_LABEL.MEDIUM ?? "Sedang";
  }

  return RISK_LABEL.LOW ?? "Rendah";
}

/**
 * Dasbor mahasiswa.
 *
 * Mengambil angka rata-rata risiko dari `buildMahasiswaSummary` supaya hanya
 * ada satu definisi "rata-rata risiko" di proyek ini. Fungsi itu diuji
 * terpisah; fungsi ini tidak mengulang perhitungan yang sama.
 */
export function buildMahasiswaDashboard(tickets: SummaryTicket[]): MahasiswaDashboard {
  const { cards } = buildMahasiswaSummary(tickets);
  const ordered = sortNewestFirst(tickets);
  const open = ordered.filter((ticket) => !isClosedStatus(ticket.status));
  const waiting = ordered.filter((ticket) => ticket.status === "MENUNGGU_TINDAK_LANJUT");
  const closed = ordered.filter((ticket) => ticket.status === "SELESAI");
  const averageRisk = cards[3]?.value ?? "0 / 100";
  const riskScore = Number.parseInt(averageRisk, 10);

  return {
    stats: [
      {
        label: "Aduan aktif",
        value: String(open.length),
        hint: ordered.length === 0 ? "Belum ada aduan" : `Dari ${ordered.length} aduan`,
      },
      {
        label: "Menunggu tindak lanjut",
        value: String(waiting.length),
        hint: waiting.length > 0 ? "Perlu ditunggu satuan tugas" : "Tidak ada yang tertunda",
      },
      {
        label: "Selesai",
        value: String(closed.length),
        hint: `${toPercent(closed.length, ordered.length)}% dari total aduan`,
      },
      {
        label: "Rata-rata risiko",
        value: averageRisk,
        hint:
          ordered.length === 0
            ? "Belum ada data"
            : `Rata-rata ${riskLabelForScore(Number.isFinite(riskScore) ? riskScore : 0).toLowerCase()}`,
      },
    ],
    tickets: ordered.map((ticket) => ({
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      status: ticket.status,
      statusLabel: formatTicketStatus(ticket.status),
      riskBand: ticket.riskBand,
      riskLabel: formatRiskBand(ticket.riskBand),
      category: ticket.category ?? UNRESOLVED_CATEGORY,
      categoryLabel: formatTicketCategory(ticket.category),
      updatedLabel: formatRelativeTime(ticket.updatedAt),
      isOpen: !isClosedStatus(ticket.status),
    })),
  };
}
