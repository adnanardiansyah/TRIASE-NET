import type { AduanStatus } from "./domain/enums";

export const STATUS_TRANSITIONS: Readonly<Record<AduanStatus, readonly AduanStatus[]>> = {
  DITERIMA: ["DALAM_PENANGANAN", "DITOLAK"],
  DALAM_PENANGANAN: ["MENUNGGU_TINDAK_LANJUT", "SELESAI", "DITOLAK"],
  MENUNGGU_TINDAK_LANJUT: ["DALAM_PENANGANAN", "SELESAI"],
  SELESAI: ["DITUTUP", "DALAM_PENANGANAN"],
  DITUTUP: [],
  DITOLAK: [],
};

export function canTransitionStatus(from: AduanStatus, to: AduanStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}
