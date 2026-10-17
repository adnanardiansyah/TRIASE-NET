import { NextResponse,type NextRequest } from "next/server";
import { requireSession } from "@/lib/api/session";
import { ApiError,apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin,readJson } from "@/lib/api/validation";
import { adminAccountMutation } from "@/lib/admin-account-schemas";
import { adminAccounts } from "@/lib/admin-accounts";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
export async function GET(request:NextRequest){try{const session=requireSession(request);const p=request.nextUrl.searchParams;const action=p.get("view")==="events"?"events":"list";const result=await adminAccounts(session,request.headers.get("user-agent")??"",action,{q:(p.get("q")??"").slice(0,254),role:["MAHASISWA","SATGAS","ADMIN"].includes(p.get("role")??"")?p.get("role"):"",page:Math.max(1,Math.min(100000,Number(p.get("page"))||1))});return NextResponse.json({ok:true,data:result},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiErrorResponse(e);}}
export async function POST(request:NextRequest){try{assertSameOrigin(request);const session=requireSession(request);if(!(await consumeRateLimit(`admin-account:${session.userId}`,30,60000)).allowed)throw new ApiError(429,"Terlalu banyak perubahan. Tunggu satu menit.");const {action,...payload}=await readJson(request,adminAccountMutation,8192);const result=await adminAccounts(session,request.headers.get("user-agent")??"",action,payload);return NextResponse.json({ok:true,data:result},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiErrorResponse(e);}}
