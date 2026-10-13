import { sql } from "kysely";
import { getDb } from "./client";
import type { SessionRole } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/api/errors";

export async function resolveActorId(email: string, role: SessionRole): Promise<string> {
  const result = await sql<{ id: string | null }>`SELECT public.fn_app_resolve_actor(${email}, ${role}::public.app_role) AS id`.execute(getDb());
  const id = result.rows[0]?.id;
  if (!id) throw new ApiError(403, "Akun belum terdaftar, tidak aktif, atau sedang dikunci.", "ACCOUNT_UNAVAILABLE");
  return id;
}
