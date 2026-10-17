import { describe,expect,it } from "vitest";
import { newRecoveryCodes,recoveryHash } from "./recovery";
describe("MFA recovery codes",()=>{
 it("generates ten independent 128-bit codes and stores only hashes",()=>{
  const a=newRecoveryCodes(),b=newRecoveryCodes();expect(a.codes).toHaveLength(10);expect(new Set([...a.codes,...b.codes]).size).toBe(20);
  for(let i=0;i<10;i++){expect(a.codes[i]).toMatch(/^(?:[a-f0-9]{8}-){3}[a-f0-9]{8}$/);expect(a.hashes[i]).toMatch(/^[a-f0-9]{64}$/);expect(a.hashes[i]).not.toContain(a.codes[i]);expect(recoveryHash(a.codes[i]!.toUpperCase())).toBe(a.hashes[i]);}
 });
});
