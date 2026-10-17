import type { SessionRole } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/api/errors";
import { authCommand } from "@/lib/auth/real-accounts";
export async function resolveActorId(email: string, role: SessionRole, version?: number): Promise<string> {
  if (!version) throw new ApiError(401,"Silakan masuk ulang dengan akun terdaftar.");
  const id = await authCommand<string | null>("validate", {email,role,version});
  if (!id) throw new ApiError(401,"Akun atau sesi tidak aktif. Silakan masuk ulang.");
  return id;
}
