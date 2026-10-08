import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetDemoStore,
  createDemoTicket,
  findDemoTicketsByEmail,
  getDemoTicket,
  isDemoTicketOwnedBy,
  listDemoTickets,
  readDemoTicketBody,
  toStaffView,
  updateDemoTicketStatus,
} from "./demo-store";

function seed(email = "mahasiswa@poltek.test") {
  return createDemoTicket({
    email,
    subject: "Ruang lab sering mati mendadak",
    category: "FASILITAS",
    body: "AC proyektor mati saat jam sibuk.",
    riskBand: "MEDIUM",
  });
}
describe("demo ticket workflow", () => {
  beforeEach(() => {
    __resetDemoStore();
  });

  it("updates a ticket status when a satgas action is recorded", () => {
    const created = seed();
    const updated = updateDemoTicketStatus(created.ticketId, "SELESAI");

    expect(updated).toBeDefined();
    expect(updated?.status).toBe("SELESAI");
  });

  it("memperbarui updatedAt saat status berubah", () => {
    const created = seed();

    expect(created.createdAt).toBe(created.updatedAt);
  });

  it("tidak memperbarui updatedAt untuk tiket yang tidak ada", () => {
    expect(updateDemoTicketStatus("TR-TIDAK-ADA", "SELESAI")).toBeUndefined();
  });

  it("lookup memakai normalisasi id yang sama untuk semua fungsi", () => {
    // Versi sebelumnya hanya uppercase di `updateDemoTicketStatus`, sehingga
    // pemanggilan yang tidak melakukan itu sendiri gagal diam-diam.
    const created = seed();

    expect(getDemoTicket(created.ticketId)).toBeDefined();
    expect(getDemoTicket(created.ticketId.toLowerCase())).toBeDefined();
    expect(getDemoTicket(`  ${created.ticketId}  `)).toBeDefined();
    expect(updateDemoTicketStatus(created.ticketId.toLowerCase(), "SELESAI")).toBeDefined();
    expect(updateDemoTicketStatus("TR-TIDAK-ADA", "SELESAI")).toBeUndefined();
  });

  it("tidak pernah menimpa tiket yang sudah ada", () => {
    const first = seed();

    expect(first.ticketId).not.toBe(seed().ticketId);
  });

  it("menormalkan email pelapor saat menyimpan dan mencari", () => {
    const created = createDemoTicket({
      email: "  Mahasiswa@Poltek.Test ",
      subject: "Uji",
      category: "AKADEMIK",
      body: "Isi",
      riskBand: "LOW",
    });

    expect(created.reporterEmail).toBe("mahasiswa@poltek.test");
    expect(findDemoTicketsByEmail("MAHASISWA@POLTEK.TEST")).toHaveLength(1);
    expect(isDemoTicketOwnedBy(created.ticketId, "mahasiswa@poltek.test")).toBe(true);
    expect(isDemoTicketOwnedBy(created.ticketId, "orang@lain.test")).toBe(false);
  });

  it("menyimpan isi aduan sebagai ciphertext, bukan plaintext", () => {
    // Kalau plaintext ikut tersimpan di baris tiket, halaman detail bisa
    // merendernya tanpa melewati jalur dekripsi dan tanpa jejak audit.
    const created = seed();

    expect(created).not.toHaveProperty("body");
    expect(JSON.stringify(created)).not.toContain("AC proyektor");
    expect(created.bodyEnvelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.bodyEnvelope.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.bodyEnvelope.tag).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("menggunakan IV berbeda untuk isi yang sama", () => {
    const first = seed();
    const second = seed();

    expect(first.bodyEnvelope.iv).not.toBe(second.bodyEnvelope.iv);
    expect(first.bodyEnvelope.ciphertext).not.toBe(second.bodyEnvelope.ciphertext);
  });

  it("readDemoTicketBody mengembalikan isi asli di sisi server", () => {
    const created = seed();

    expect(readDemoTicketBody(created.ticketId)).toBe("AC proyektor mati saat jam sibuk.");
    expect(readDemoTicketBody(created.ticketId.toLowerCase())).toBe(
      "AC proyektor mati saat jam sibuk.",
    );
  });

  it("readDemoTicketBody menolak tiket yang tidak ada", () => {
    expect(() => readDemoTicketBody("TR-TIDAK-ADA")).toThrow(/tidak ada/i);
  });

  it("tampilan staf tidak memuat email, isi aduan, maupun amplop kunci", () => {
    // Ini inti dari perbaikan: kalau `toStaffView` membocorkan ketiganya, jalur
    // dekripsi di /api/satgas/decrypt tidak akan pernah dipakai.
    const created = seed();
    const view = toStaffView(created);

    expect(view).not.toHaveProperty("reporterEmail");
    expect(view).not.toHaveProperty("body");
    expect(view).not.toHaveProperty("bodyEnvelope");
    expect(view).not.toHaveProperty("email");
    expect(Object.keys(view)).not.toContain("reporterEmail");
    expect(JSON.stringify(view)).not.toContain("mahasiswa@poltek.test");
    expect(JSON.stringify(view)).not.toContain("AC proyektor");
  });

  it("tampilan staf tetap mempertahankan metadata yang dibutuhkan", () => {
    const created = seed();
    const view = toStaffView(created);

    expect(view.ticketId).toBe(created.ticketId);
    expect(view.pseudonym).toBe(created.pseudonym);
    expect(view.subject).toBe(created.subject);
    expect(view.riskBand).toBe(created.riskBand);
    expect(view.status).toBe(created.status);
  });

  it("pseudonim tidak memuat email pelapor", () => {
    const created = seed();

    expect(created.pseudonym).not.toContain("mahasiswa");
    expect(created.pseudonym).not.toContain("poltek");
    expect(created.pseudonym).toMatch(/^PS[0-9A-F]{24}$/);
  });

  it("mengurutkan daftar tiket dari yang terbaru", () => {
    const older = seed("a@poltek.test");
    const newer = seed("a@poltek.test");
    const rows = listDemoTickets();

    expect(rows).toHaveLength(2);
    // Urutan tidak boleh berubah ketika `listDemoTickets` dipanggil berulang.
    expect(listDemoTickets()[0]?.ticketId).toBe(rows[0]?.ticketId);
    expect(new Set([older.ticketId, newer.ticketId])).toEqual(
      new Set(rows.map((ticket) => ticket.ticketId)),
    );
  });
});