import { describe, expect, it } from "vitest";
import { canTransitionStatus } from "./ticket-workflow";

describe("ticket workflow", () => {
  it("accepts work, follow-up, resolution and reopening", () => {
    expect(canTransitionStatus("DITERIMA", "DALAM_PENANGANAN")).toBe(true);
    expect(canTransitionStatus("DALAM_PENANGANAN", "MENUNGGU_TINDAK_LANJUT")).toBe(true);
    expect(canTransitionStatus("MENUNGGU_TINDAK_LANJUT", "SELESAI")).toBe(true);
    expect(canTransitionStatus("SELESAI", "DALAM_PENANGANAN")).toBe(true);
  });
  it("rejects skipped, repeated and terminal transitions", () => {
    expect(canTransitionStatus("DITERIMA", "SELESAI")).toBe(false);
    expect(canTransitionStatus("SELESAI", "SELESAI")).toBe(false);
    expect(canTransitionStatus("DITUTUP", "DALAM_PENANGANAN")).toBe(false);
    expect(canTransitionStatus("DITOLAK", "DITERIMA")).toBe(false);
  });
});
