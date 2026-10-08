import { NextResponse, type NextRequest } from "next/server";

import { getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";

/**
 * Fakta transport untuk indikator ZTNA di layar login.
 *
 * Alamat IP tidak bisa dibaca JavaScript, jadi panel konteks harus bertanya ke
 * server. Endpoint ini sengaja hanya mengembalikan data tentang pemanggilnya
 * sendiri: tidak ada session, tidak ada parameter, dan tidak ada data pengguna
 * lain di dalamnya. Satu-satunya "bocoran" adalah alamat IP yang memang sudah
 * diketahuinya sendiri, karena setiap permintaan ini dibuat atas permintaannya.
 *
 * `Cache-Control: no-store` itu wajib. IP dan skema transport bisa berubah
 * saat pengguna berpindah jaringan, dan respons basi akan membuat panel
 * menampilkan konteks yang sudah tidak berlaku.
 */
export function GET(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = getClientIp(request);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (request.nextUrl.protocol === "https:" ? "https" : "http");

  return NextResponse.json(
    {
      ip,
      ipSource: forwardedFor ? "forwarded" : "socket",
      secureTransport: protocol === "https",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
