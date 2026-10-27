import { timingSafeEqual } from "node:crypto";
import { NextResponse,type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { deliverAccountMail } from "@/lib/auth/mail-outbox";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET;
 const actual=Buffer.from(request.headers.get("authorization")??"");const expected=Buffer.from(`Bearer ${secret??""}`);
 if(!secret||secret.length<32||actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({ok:false},{status:401,headers:{"Cache-Control":"no-store"}});
 try{const result=await deliverAccountMail();return NextResponse.json({ok:result.failed===0,...result},{status:result.failed?503:200,headers:{"Cache-Control":"no-store"}});}catch {return apiErrorResponse(new Error("Mail worker unavailable"));}
}
