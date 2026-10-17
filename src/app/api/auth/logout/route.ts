import { NextResponse,type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/api/validation";
import { apiErrorResponse } from "@/lib/api/errors";
import { getRequestSession } from "@/lib/auth/request";
import { authCommand } from "@/lib/auth/real-accounts";
import { assertSessionContext } from "@/lib/ztna/access-policy";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 try{assertSameOrigin(request);}catch(e){return apiErrorResponse(e);}
 let response:NextResponse;
 try{
  const session=getRequestSession(request);
  if(session?.authVersion){assertSessionContext(session,request.headers.get("user-agent")??"");await authCommand("session_revoke",{id:session.userId,role:session.role,version:session.authVersion});}
  response=NextResponse.json({ok:true,message:"Sesi akun telah dicabut di seluruh perangkat."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){response=apiErrorResponse(e);}
 response.cookies.set("triase-session","",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0,expires:new Date(0)});
 return response;
}
