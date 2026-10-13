import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth/request";
import { ApiError } from "./errors";

export function requireSession(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session) throw new ApiError(401, "Sesi diperlukan. Silakan masuk.");
  return session;
}
