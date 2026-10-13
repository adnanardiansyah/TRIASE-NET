import { describe, expect, it } from "vitest";

import {
  buildAdminSummary,
  buildAverageResolution,
  buildCategoryDistribution,
  buildMahasiswaDashboard,
  buildMahasiswaSummary,
  buildRiskDistribution,
  buildSatgasSummary,
  buildSlaSummary,
  buildStatusDistribution,
  findOldestOpenTicket,
  formatDuration,
  formatRelativeTime,
  formatRiskBand,
  formatTicketCategory,
  formatTicketStatus,
  isSameCalendarDay,
  type SummaryTicket,
} from "./dashboard-aggregates";

function ticket(overrides: Partial<SummaryTicket> & { ticketId: string }): SummaryTicket {
  return {
    subject: "Aduan",
    riskBand: "MEDIUM",
    status: "DALAM_PENANGANAN",
    pseudonym: "PS0001",
    createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
    updatedAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
    ...overrides,
  };
}

const DAY = 86_400_000;

describe("dashboard aggregates", () => {
  it("builds mahasiswa summary from ticket records", () => {
    const result = buildMahasiswaSummary([
      ticket({ ticketId: "TR-001", subject: "Koneksi wifi padam", riskBand: "HIGH", pseudonym: "PS1" }),
      ticket({
        ticketId: "TR-002",
        subject: "Fasilitas lab",
        riskBand: "LOW",
        pseudonym: "PS2",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
      }),
    ]);

    expect(result.cards[0]).toMatchObject({ label: "Aduan aktif", value: "1" });
    expect(result.cards[1]).toMatchObject({ label: "Status terbaru", value: "Selesai" });
    expect(result.recent[0]?.ticket).toBe("TR-002");
  });

  it("menampilkan status tiket terbaru, termasuk ketika sudah selesai", () => {
    const result = buildMahasiswaSummary([
      ticket({ ticketId: "TR-001", status: "SELESAI", createdAt: new Date(2026, 9, 1, 9, 0, 0).toISOString() }),
      ticket({
        ticketId: "TR-002",
        status: "MENUNGGU_TINDAK_LANJUT",
        createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
      }),
    ]);

    expect(result.cards[1]?.value).toBe("Selesai");
  });

  it("tidak menghasilkan Average Risk di 0 saat tidak ada tiket", () => {
    const result = buildMahasiswaSummary([]);

    expect(result.cards[3]).toMatchObject({ label: "Rata-rata risiko", value: "0 / 100" });
  });

  it("builds admin summary with nilai yang benar", () => {
    const reference = new Date(2026, 9, 1, 12, 0, 0);

    const result = buildAdminSummary(
      [
        ticket({ ticketId: "TR-001", subject: "Koneksi wifi padam", riskBand: "HIGH", pseudonym: "PS1" }),
        ticket({
          ticketId: "TR-002",
          subject: "Tes ujian",
          riskBand: "MEDIUM",
          pseudonym: "PS2",
          status: "MENUNGGU_TINDAK_LANJUT",
          createdAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
        }),
      ],
      reference,
    );

    expect(result.stats[0]).toMatchObject({ label: "Aduan hari ini", value: "2" });
    expect(result.stats[1]).toMatchObject({ label: "Total tiket", value: "2" });
    expect(result.stats[2]).toMatchObject({ label: "Risiko tinggi", value: "1" });
    expect(result.tasks[0]?.name).toContain("Tes ujian");
  });

  it("tidak menghitung tiket lama sebagai Aduan hari ini", () => {
    const reference = new Date(2026, 9, 1, 12, 0, 0);

    const result = buildAdminSummary(
      [
        ticket({ ticketId: "TR-LAMA", createdAt: new Date(2025, 0, 5, 8, 0, 0).toISOString() }),
        ticket({ ticketId: "TR-BARU", createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString() }),
      ],
      reference,
    );

    expect(result.stats[0]).toMatchObject({ label: "Aduan hari ini", value: "1" });
    expect(result.stats[1]).toMatchObject({ label: "Total tiket", value: "2" });
  });

  it("formatTicketStatus mempertahankan status yang tidak dikenal", () => {
    expect(formatTicketStatus("UNKNOWN")).toBe("UNKNOWN");
  });

  it("isSameCalendarDay membedakan tanggal", () => {
    // Dibangun dari waktu lokal, bukan ISO dengan Z: calendar day memang
    // bersifat lokal, jadi tes dengan string UTC akan gagal di mesin yang
    // zona waktunya bukan UTC.
    const reference = new Date(2026, 9, 1, 12, 0, 0);
    const sameDay = new Date(2026, 9, 1, 1, 0, 0).toISOString();
    const previousDay = new Date(2026, 8, 30, 23, 0, 0).toISOString();

    expect(isSameCalendarDay(sameDay, reference)).toBe(true);
    expect(isSameCalendarDay(previousDay, reference)).toBe(false);
  });

  it("formatRelativeTime menangani nilai tidak valid tanpa menghasilkan NaN", () => {
    expect(formatRelativeTime("bukan tanggal")).toBe("-");
  });
});

describe("metrik operasional", () => {
  it("formatDuration memakai satuan yang sesuai dengan besarannya", () => {
    expect(formatDuration(30_000)).toBe("< 1 menit");
    expect(formatDuration(45 * 60_000)).toBe("45 menit");
    expect(formatDuration(5 * 3_600_000)).toBe("5 jam");
    expect(formatDuration(3 * DAY)).toBe("3 hari");
  });

  it("formatDuration menolak nilai negatif atau tidak valid", () => {
    expect(formatDuration(-1)).toBe("-");
    expect(formatDuration(Number.NaN)).toBe("-");
  });

  it("formatRiskBand dan formatTicketCategory memakai label Indonesia", () => {
    expect(formatRiskBand("HIGH")).toBe("Tinggi");
    expect(formatRiskBand("LUAR").length).toBeGreaterThan(0);
    expect(formatTicketCategory("KEAMANAS_INFORMASI")).toBe("Keamanan informasi");
    expect(formatTicketCategory("AKADEMIK")).toBe("Akademik");
  });

  it("formatTicketCategory memperlakukan kategori hilang sebagai Lainnya", () => {
    expect(formatTicketCategory(undefined)).toBe("Lainnya");
  });

  it("buildRiskDistribution memakai urutan risiko tetap, bukan urutan jumlah", () => {
    const result = buildRiskDistribution([
      ticket({ ticketId: "TR-1", riskBand: "LOW" }),
      ticket({ ticketId: "TR-2", riskBand: "HIGH" }),
      ticket({ ticketId: "TR-3", riskBand: "LOW" }),
      ticket({ ticketId: "TR-4", riskBand: "MEDIUM" }),
    ]);

    expect(result.map((slice) => slice.key)).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect(result.map((slice) => slice.count)).toEqual([1, 1, 2]);
    expect(result[2]?.percent).toBe(50);
  });

  it("buildRiskDistribution tidak menghasilkan persen NaN saat kosong", () => {
    expect(buildRiskDistribution([])).toEqual([]);
  });

  it("buildStatusDistribution mempertahankan status di luar daftar known", () => {
    const result = buildStatusDistribution([
      ticket({ ticketId: "TR-1", status: "SELESAI" }),
      ticket({ ticketId: "TR-2", status: "UNKNOWN" }),
    ]);

    expect(result.map((slice) => slice.key)).toEqual(["SELESAI", "UNKNOWN"]);
    expect(result[1]?.label).toBe("UNKNOWN");
  });

  it("buildCategoryDistribution mengurutkan dari yang paling banyak", () => {
    const result = buildCategoryDistribution([
      ticket({ ticketId: "TR-1", category: "AKADEMIK" }),
      ticket({ ticketId: "TR-2", category: "TEKNOLOGI" }),
      ticket({ ticketId: "TR-3", category: "TEKNOLOGI" }),
    ]);

    expect(result[0]).toMatchObject({ key: "TEKNOLOGI", count: 2, percent: 67 });
    expect(result[1]?.key).toBe("AKADEMIK");
  });

  it("buildCategoryDistribution mengelompokkan kategori tak dikenal ke Lainnya", () => {
    const result = buildCategoryDistribution([
      ticket({ ticketId: "TR-1", category: "KATEGORI_BARU" }),
      ticket({ ticketId: "TR-2" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: "LAINNYA", count: 2 });
  });

  it("buildSlaSummary menghitung tiket selesai yang tepat dan yang lewat ambang", () => {
    const result = buildSlaSummary([
      ticket({
        ticketId: "TR-CEPAT",
        riskBand: "HIGH",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
        updatedAt: new Date(2026, 9, 2, 8, 0, 0).toISOString(),
      }),
      ticket({
        ticketId: "TR-LAMBAT",
        riskBand: "HIGH",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
        updatedAt: new Date(2026, 9, 10, 8, 0, 0).toISOString(),
      }),
    ]);

    // Ambang HIGH adalah 3 hari: satu tiket 1 hari, satu tiket 9 hari.
    expect(result.resolved).toBe(2);
    expect(result.withinTarget).toBe(1);
    expect(result.breached).toBe(1);
    expect(result.rate).toBe(50);
    expect(result.targetDays).toBe(3);
  });

  it("buildSlaSummary tidak menghakimi tiket yang masih berjalan", () => {
    const result = buildSlaSummary([
      ticket({ ticketId: "TR-JALAN", status: "DALAM_PENANGANAN" }),
    ]);

    expect(result.resolved).toBe(0);
    expect(result.breached).toBe(0);
    expect(result.rate).toBe(0);
  });

  it("buildSlaSummary mengabaikan timestamp yang tidak dapat diparse", () => {
    const result = buildSlaSummary([
      ticket({ ticketId: "TR-RUSAK", status: "SELESAI", createdAt: "bukan tanggal" }),
    ]);

    expect(result.resolved).toBe(1);
    expect(result.withinTarget).toBe(0);
    expect(result.breached).toBe(0);
  });

  it("buildSlaSummary menghitung tiket terbuka yang sudah lewat ambang", () => {
    const now = new Date(2026, 9, 10, 12, 0, 0);

    const result = buildSlaSummary(
      [
        // HIGH ambang 3 hari, sudah 6 hari dan masih berjalan.
        ticket({
          ticketId: "TR-TERLAMBAT",
          riskBand: "HIGH",
          createdAt: new Date(2026, 8, 25, 8, 0, 0).toISOString(),
        }),
        ticket({
          ticketId: "TR-MASIH_AWAL",
          riskBand: "HIGH",
          createdAt: new Date(2026, 9, 9, 8, 0, 0).toISOString(),
        }),
        // Sudah selesai, jadi tidak dihitung sebagai terbuka.
        ticket({
          ticketId: "TR-SELESAI",
          status: "SELESAI",
          createdAt: new Date(2026, 8, 1, 8, 0, 0).toISOString(),
          updatedAt: new Date(2026, 8, 2, 8, 0, 0).toISOString(),
        }),
      ],
      now,
    );

    expect(result.overdueOpen).toBe(1);
    // Tiket terlambat tidak boleh ikuthitungan sebagai pelanggaran SLA.
    expect(result.breached).toBe(0);
    expect(result.rate).toBe(100);
  });

  it("buildMahasiswaDashboard menerjemahkan label dan menandai tiket terbuka", () => {
    const result = buildMahasiswaDashboard([
      ticket({
        ticketId: "TR-1",
        subject: "Koneksi wifi padam",
        riskBand: "HIGH",
        category: "TEKNOLOGI",
        status: "DALAM_PENANGANAN",
      }),
      ticket({
        ticketId: "TR-2",
        subject: "Ujian bocor",
        riskBand: "LOW",
        category: "AKADEMIK",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
      }),
    ]);

    expect(result.tickets[0]).toMatchObject({
      ticketId: "TR-2",
      statusLabel: "Selesai",
      riskLabel: "Rendah",
      categoryLabel: "Akademik",
      isOpen: false,
    });
    expect(result.tickets[1]).toMatchObject({ ticketId: "TR-1", isOpen: true });
    expect(result.stats[0]).toMatchObject({ label: "Aduan aktif", value: "1" });
    expect(result.stats[2]).toMatchObject({ label: "Selesai", value: "1" });
    expect(result.stats[2]?.hint).toBe("50% dari total aduan");
  });

  it("buildMahasiswaDashboard aman saat belum ada aduan", () => {
    const result = buildMahasiswaDashboard([]);

    expect(result.tickets).toEqual([]);
    expect(result.stats[0]).toMatchObject({ value: "0", hint: "Belum ada aduan" });
    expect(result.stats[3]?.hint).toBe("Belum ada data");
  });

  it("buildAverageResolution hanya memakai tiket selesai", () => {
    const result = buildAverageResolution([
      ticket({
        ticketId: "TR-1",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
        updatedAt: new Date(2026, 9, 3, 8, 0, 0).toISOString(),
      }),
      ticket({
        ticketId: "TR-2",
        status: "SELESAI",
        createdAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
        updatedAt: new Date(2026, 9, 5, 8, 0, 0).toISOString(),
      }),
      ticket({ ticketId: "TR-3", status: "DALAM_PENANGANAN" }),
    ]);

    // 2 hari dan 4 hari, rata-rata 3 hari.
    expect(result).toBe(3 * DAY);
  });

  it("buildAverageResolution mengembalikan null saat belum ada tiket selesai", () => {
    expect(buildAverageResolution([])).toBeNull();
    expect(buildAverageResolution([ticket({ ticketId: "TR-1" })])).toBeNull();
  });

  it("findOldestOpenTicket mengabaikan tiket selesai", () => {
    const result = findOldestOpenTicket([
      ticket({ ticketId: "TR-SELESAI", status: "SELESAI", createdAt: new Date(2026, 0, 1).toISOString() }),
      ticket({ ticketId: "TR-BARU", createdAt: new Date(2026, 9, 1).toISOString() }),
      ticket({ ticketId: "TR-LAMA", createdAt: new Date(2026, 5, 1).toISOString() }),
    ]);

    expect(result?.ticketId).toBe("TR-LAMA");
  });

  it("findOldestOpenTicket mengembalikan null saat semua tiket selesai", () => {
    expect(findOldestOpenTicket([ticket({ ticketId: "TR-1", status: "SELESAI" })])).toBeNull();
  });

  it("buildSatgasSummary menyusun KPI, sebaran, dan SLA sekaligus", () => {
    const now = new Date(2026, 9, 1, 12, 0, 0);

    const summary = buildSatgasSummary(
      [
        ticket({
          ticketId: "TR-1",
          riskBand: "HIGH",
          status: "DALAM_PENANGANAN",
          category: "KEAMANAS_INFORMASI",
          createdAt: new Date(2026, 8, 25, 8, 0, 0).toISOString(),
        }),
        ticket({ ticketId: "TR-2", riskBand: "LOW", status: "MENUNGGU_TINDAK_LANJUT", category: "AKADEMIK" }),
        ticket({
          ticketId: "TR-3",
          riskBand: "MEDIUM",
          status: "SELESAI",
          category: "AKADEMIK",
          createdAt: new Date(2026, 8, 29, 8, 0, 0).toISOString(),
          updatedAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
        }),
      ],
      now,
    );

    expect(summary.stats[0]).toMatchObject({ label: "Antrean aktif", value: "2" });
    expect(summary.stats[0]?.hint).toContain("1 berisiko tinggi");
    expect(summary.stats[1]).toMatchObject({ label: "Menunggu tindak lanjut", value: "1" });
    // 2 hari dari TR-3, ambang MEDIUM 7 hari.
    expect(summary.stats[2]?.value).toBe("2 hari");
    expect(summary.stats[3]?.value).toBe("100%");
    expect(summary.risk.map((slice) => slice.key)).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect(summary.category[0]).toMatchObject({ key: "AKADEMIK", count: 2 });
    // Tiket tertua terbuka dibuat 6 hari lalu.
    expect(summary.oldestOpenLabel).toBe("6 hari");
  });

  it("buildSatgasSummary aman saat antrean kosong", () => {
    const summary = buildSatgasSummary([]);

    expect(summary.stats[0]).toMatchObject({ label: "Antrean aktif", value: "0" });
    expect(summary.stats[1]?.hint).toBe("Semua berjalan");
    expect(summary.stats[2]?.value).toBe("-");
    expect(summary.averageResolution).toBe("-");
    expect(summary.oldestOpenLabel).toBe("Antrean kosong");
    expect(summary.risk).toEqual([]);
    expect(summary.category).toEqual([]);
    expect(summary.sla.rate).toBe(0);
  });
});
