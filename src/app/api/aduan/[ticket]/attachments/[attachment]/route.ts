import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { readTicketCode } from "@/lib/api/validation";
import { downloadEvidence } from "@/lib/db/tickets";

export async function GET(request: NextRequest, context: { params: Promise<{ ticket: string; attachment: string }> }) {
  try {
    const session = requireSession(request);
    const params = await context.params;
    const id = z.string().uuid().safeParse(params.attachment);
    if (!id.success) throw new ApiError(404, "Lampiran tidak ditemukan.");
    const file = await downloadEvidence(session, request.headers.get("user-agent") ?? "", readTicketCode(params.ticket), id.data);
    const name = encodeURIComponent(file.name).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    return new NextResponse(new Uint8Array(file.data), { headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="bukti.${file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : file.mimeType === "image/webp" ? "webp" : "jpg"}"; filename*=UTF-8''${name}`,
      "Content-Length": String(file.data.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiErrorResponse(error); }
}
