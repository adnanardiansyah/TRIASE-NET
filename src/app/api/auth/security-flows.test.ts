import { NextRequest,NextResponse } from "next/server";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),rate:vi.fn(),mail:vi.fn(),payload:vi.fn(),passwordHash:vi.fn(),passwordMatches:vi.fn(),login:vi.fn()}));
vi.mock("@/lib/auth/real-accounts",()=>({authCommand:m.auth,passwordHash:m.passwordHash,passwordMatches:m.passwordMatches,tokenHash:(x:string)=>"hash:"+x,newEmailToken:()=>({raw:"t".repeat(43),hash:"h".repeat(64)}),sealTotp:()=>"encrypted",openTotp:()=>"JBSWY3DPEHPK3PXP"}));
vi.mock("@/lib/auth/rate-limit",()=>({enforceRateLimit:m.rate,consumeRateLimit:async()=>({allowed:true}),getClientIp:()=>"ip",buildRateLimitKeys:()=>["ip","account"]}));
vi.mock("@/lib/auth/email",()=>({mailConfiguration:m.mail}));
vi.mock("@/lib/auth/mail-outbox",()=>({accountMailPayload:m.payload}));
vi.mock("@/lib/auth/session-response",()=>({loginResponse:m.login}));
import {POST as forgot} from "./forgot-password/route";
import {POST as reset} from "./reset-password/route";
import {POST as login} from "./route";
const req=(path:string,body:unknown,origin:string|null="http://localhost")=>new NextRequest("http://localhost"+path,{method:"POST",headers:{"content-type":"application/json",...(origin?{origin}:{})},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NEXT_PUBLIC_APP_URL","http://localhost");m.payload.mockReturnValue({mail_id:"job",mail_sealed:"encrypted"});m.passwordHash.mockResolvedValue("$argon2id$test");m.passwordMatches.mockResolvedValue(true);m.login.mockImplementation(()=>NextResponse.json({ok:true}));});
afterEach(()=>vi.unstubAllEnvs());
describe("authentication recovery API boundaries",()=>{
 it("returns identical forgot responses for eligible and unknown accounts and queues encrypted mail",async()=>{
  m.auth.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const a=await forgot(req("/api/auth/forgot-password",{email:"a@example.test"}));const b=await forgot(req("/api/auth/forgot-password",{email:"b@example.test"}));
  expect(a.status).toBe(200);expect(await a.json()).toEqual(await b.json());expect(a.headers.get("cache-control")).toBe("no-store");
  expect(m.auth.mock.calls[0]).toEqual(["reset_request",expect.objectContaining({token_hash:"h".repeat(64),mail_sealed:"encrypted"})]);
 });
 it("rejects absent and foreign Origin before any authentication operation",async()=>{
  for(const origin of [null,"https://attacker.test"]){expect((await forgot(req("/api/auth/forgot-password",{email:"a@example.test"},origin))).status).toBe(403);}
  expect(m.auth).not.toHaveBeenCalled();expect(m.rate).not.toHaveBeenCalled();
 });
 it("does not issue a session or activate users after password reset",async()=>{
  m.auth.mockResolvedValue(true);const r=await reset(req("/api/auth/reset-password",{token:"a".repeat(43),password:"a-long-personal-password"}));expect(r.status).toBe(200);expect(r.headers.get("set-cookie")).toBeNull();expect(m.login).not.toHaveBeenCalled();expect(m.auth.mock.calls[0]![0]).toBe("reset_finish");
 });
 it("rejects used or expired reset tokens and applies IP and token budgets",async()=>{
  m.auth.mockResolvedValue(false);const r=await reset(req("/api/auth/reset-password",{token:"a".repeat(43),password:"a-long-personal-password"}));expect(r.status).toBe(400);expect(m.rate).toHaveBeenCalledTimes(2);
 });
 it("rejects role injection and malformed password resets",async()=>{
  expect((await reset(req("/api/auth/reset-password",{token:"a".repeat(43),password:"short",role:"ADMIN"}))).status).toBe(400);expect(m.auth).not.toHaveBeenCalled();
 });
 it("recovery code returns only a bound re-enrollment challenge, never a dashboard session",async()=>{
  m.auth.mockResolvedValueOnce({id:"user",sealed:"encrypted",version:2}).mockResolvedValueOnce("22222222-2222-4222-8222-222222222222");
  const r=await login(req("/api/auth",{challengeId:"11111111-1111-4111-8111-111111111111",recoveryCode:"aaaaaaaa-bbbbbbbb-cccccccc-dddddddd"}));const body=await r.json();expect(r.status).toBe(200);expect(body.mfaRequired).toBe(true);expect(body.enrollmentSecret).toBeTruthy();expect(r.headers.get("set-cookie")).toBeNull();expect(m.login).not.toHaveBeenCalled();expect(m.auth.mock.calls[1]![0]).toBe("recovery_begin");
 });
 it("student password login does not require or create MFA recovery codes",async()=>{
  const student={id:"student",role:"MAHASISWA",version:2,email:"a@example.test",hash:"hash"};m.auth.mockResolvedValueOnce(student).mockResolvedValueOnce(student);
  expect((await login(req("/api/auth",{email:student.email,password:"password"}))).status).toBe(200);expect(m.login).toHaveBeenCalledWith(student,expect.any(String),false);
 });
});
