import { NextResponse,type NextRequest } from "next/server";
import { requireSession } from "@/lib/api/session";
import { ApiError,apiErrorResponse } from "@/lib/api/errors";
import { resolveActorId } from "@/lib/db/actors";
import { assertSessionContext } from "@/lib/ztna/access-policy";
import { getPool } from "@/lib/db/client";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{
 const s=requireSession(request);assertSessionContext(s,request.headers.get("user-agent")??"");const id=await resolveActorId(s.email??s.sub,s.role,s.authVersion);if(id!==s.userId)throw new ApiError(401,"Identitas sesi berubah.");
 const r=await getPool().query("SELECT public.fn_auth_security_history($1,$2) AS events",[id,s.authVersion]);return NextResponse.json({ok:true,events:r.rows[0].events??[]},{headers:{"Cache-Control":"no-store"}});
}catch(e){return apiErrorResponse(e);}}
