import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetAuditLog,
  appendAuditEntry,
  findAuditEntriesForTicket,
  listAuditEntries,
  verifyAuditChain,
} from "./audit-log";

const ACTOR = { actorEmail: "satgas@poltek.test", actorRole: "SATGAS" };

describe("audit log", () => {
  beforeEach(() => {
    __resetAuditLog();
  });

  it("rantai kosong dianggap utuh", () => {
    expect(listAuditEntries()).toHaveLength(0);
    expect(verifyAuditChain()).toBe(true);
  });

  it("merangkai setiap entri ke entri sebelumnya", () => {
    const first = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });
    const second = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-2" });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.previousHash).toBe("0".repeat(64));
    expect(second.previousHash).toBe(first.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rantai tetap utuh setelah beberapa entri", () => {
    for (let index = 0; index < 5; index += 1) {
      appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: `TR-${index}` });
    }

    expect(verifyAuditChain()).toBe(true);
  });

  it("mendeteksi riwayat yang dimanipulasi saat diverifikasi", () => {
    const first = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });
    const second = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-2" });
    const third = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-3" });

    expect(verifyAuditChain([first, second, third])).toBe(true);

    // Entri yang dihapus dari tengah: entriketiga masih menunjuk hash kedua,
    // jadi rantainya putus.
    expect(verifyAuditChain([first, third])).toBe(false);

    // Entri yang ditulis ulang: hash tidak lagi cocok dengan isinya.
    const rewritten = { ...first, ticketId: "TR-999" };
    expect(verifyAuditChain([rewritten, second, third])).toBe(false);
  });

  it("entri yang dikembalikan tidak bisa dimutasi pemanggil", () => {
    const first = appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-2" });

    // Modul ESM berjalan dalam mode strict, jadi penulisan ke properti yang
    // dibekukan melempar galat alih-alih diam-diam diabaikan.
    expect(() => {
      (first as { ticketId: string }).ticketId = "TR-999";
    }).toThrow();

    expect(first.ticketId).toBe("TR-1");
    expect(verifyAuditChain()).toBe(true);
  });

  it("menghapus entri dari salinan tidak mengubah log", () => {
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-2" });

    listAuditEntries().splice(1, 1);

    expect(listAuditEntries()).toHaveLength(2);
    expect(verifyAuditChain()).toBe(true);
  });

  it("membatasi panjang detail agar log tidak menyimpan isi aduan", () => {
    const entry = appendAuditEntry({
      ...ACTOR,
      action: "DECRYPT_REQUESTED",
      ticketId: "TR-1",
      detail: "x".repeat(500),
    });

    expect(entry.detail.length).toBeLessThan(200);
  });

  it("menemukan entri berdasarkan tiket", () => {
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_DENIED", ticketId: "TR-2" });

    expect(findAuditEntriesForTicket("TR-1")).toHaveLength(1);
    expect(findAuditEntriesForTicket("TR-2")[0]?.action).toBe("DECRYPT_DENIED");
    expect(findAuditEntriesForTicket("TR-3")).toHaveLength(0);
  });

  it("listAuditEntries mengembalikan daftar terpisah, bukan isi modul", () => {
    appendAuditEntry({ ...ACTOR, action: "DECRYPT_REQUESTED", ticketId: "TR-1" });

    expect(listAuditEntries()).toHaveLength(1);
  });
});
