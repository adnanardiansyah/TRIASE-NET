import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") {
    super(message);
  }
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ ok: false, message: error.message, code: error.code }, {
      status: error.status, headers: { "Cache-Control": "no-store" },
    });
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "40001" || code === "40P01") {
    return NextResponse.json({ ok: false, message: "Data sedang berubah. Muat ulang lalu coba lagi." }, { status: 409 });
  }
  // Never return database errors, ciphertext, or configuration secrets to clients.
  console.error("[api] Permintaan gagal", { code: code ?? "INTERNAL" });
  return NextResponse.json({ ok: false, message: "Layanan belum tersedia. Periksa konfigurasi database dan kunci server." }, { status: 503 });
}
