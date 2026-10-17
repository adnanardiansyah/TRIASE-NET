import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@/lib/db/client",()=>({getPool:()=>({query})}));
import {buildRateLimitKeys,consumeRateLimit,enforceRateLimit,getClientIp} from "./rate-limit";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("JWT_SIGNING_SECRET","test-secret-at-least-32-characters-long");vi.stubEnv("AUTH_TRUST_PROXY","");vi.stubEnv("VERCEL","");});
afterEach(()=>vi.unstubAllEnvs());
describe("central rate limit adapter",()=>{
 it("uses a single atomic DB call with a keyed hash, never raw identity",async()=>{
  query.mockResolvedValue({rows:[{result:{allowed:false,remaining:0,retryAfterSeconds:30}}]});
  expect((await consumeRateLimit("email:person@example.test",5,60000)).allowed).toBe(false);
  expect(query.mock.calls[0]![0]).toContain("fn_auth_rate_limit");
  expect(query.mock.calls[0]![1]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/),5,60000]);
  expect(JSON.stringify(query.mock.calls)).not.toContain("person@example.test");
 });
 it("consumes both IP and identity budgets even when one is blocked",async()=>{
  query.mockResolvedValue({rows:[{result:{allowed:false,remaining:0,retryAfterSeconds:30}}]});
  await expect(enforceRateLimit("login","1.2.3.4","a@example.test")).rejects.toMatchObject({status:429});
  expect(query).toHaveBeenCalledTimes(2);
 });
 it("fails closed when centralized storage is unavailable",async()=>{
  query.mockRejectedValue(new Error("Unavailable"));await expect(consumeRateLimit("x",5,60000)).rejects.toThrow();
 });
 it("normalizes account identity",()=>{expect(buildRateLimitKeys("ip"," A@EXAMPLE.TEST ")[1]).toBe("auth:identity:a@example.test");});
 it("ignores spoofed proxy headers unless explicitly trusted",()=>{
  const r={headers:new Headers({"x-forwarded-for":"1.2.3.4","x-vercel-forwarded-for":"5.6.7.8"})};
  expect(getClientIp(r)).toBe("unknown");vi.stubEnv("AUTH_TRUST_PROXY","vercel");expect(getClientIp(r)).toBe("unknown");vi.stubEnv("VERCEL","1");expect(getClientIp(r)).toBe("5.6.7.8");vi.stubEnv("AUTH_TRUST_PROXY","forwarded");expect(getClientIp(r)).toBe("1.2.3.4");
 });
 it("collapses invalid and missing addresses into a restrictive shared bucket",()=>{
  vi.stubEnv("AUTH_TRUST_PROXY","forwarded");expect(getClientIp({headers:new Headers({"x-forwarded-for":"made-up"})})).toBe("unknown");
 });
});
