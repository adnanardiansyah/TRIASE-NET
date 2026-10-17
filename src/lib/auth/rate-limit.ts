import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getPool } from "@/lib/db/client";
import { ApiError } from "@/lib/api/errors";
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }
// No process-local fallback and no reset on successful login: neither instance changes
// nor a known valid account can erase the IP attack budget.
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
 const secret=process.env.JWT_SIGNING_SECRET;
 if(!secret || secret.length<32) throw new ApiError(503,"Konfigurasi keamanan belum tersedia.");
 const digest=createHmac("sha256",secret).update("rate-limit-v1:").update(key).digest("hex");
 const result=await getPool().query<{result:RateLimitResult}>("SELECT public.fn_auth_rate_limit($1,$2,$3) AS result",[digest,limit,windowMs]);
 return result.rows[0]!.result;
}
export function buildRateLimitKeys(ip:string,identity:string):string[]{ return [`auth:ip:${ip}`,`auth:identity:${identity.trim().toLowerCase()}`]; }
export async function enforceRateLimit(scope:string,ip:string,identity?:string,limit=5,windowMs=900000):Promise<void>{
 const keys=[`${scope}:ip:${ip}`,...(identity?[`${scope}:identity:${identity.trim().toLowerCase()}`]:[])];
 // Consume every applicable budget; no short-circuit that skips identity limits.
 const results=await Promise.all(keys.map(key=>consumeRateLimit(key,limit,windowMs)));
 if(results.some(r=>!r.allowed)) throw new ApiError(429,"Terlalu banyak percobaan. Coba kembali nanti.","RATE_LIMITED");
}
export function getClientIp(request:{headers:{get(name:string):string|null}}):string{
 // Only trust headers when deployment guarantees they are overwritten at ingress.
 // Vercel sets x-vercel-forwarded-for. Custom reverse proxies must strip user headers.
 const mode=process.env.AUTH_TRUST_PROXY;
 const raw=mode==="vercel" && process.env.VERCEL==="1" ? request.headers.get("x-vercel-forwarded-for") : mode==="forwarded" ? request.headers.get("x-forwarded-for") : null;
 const ip=raw?.split(",")[0]?.trim();
 return ip && isIP(ip) ? ip.toLowerCase() : "unknown";
}
