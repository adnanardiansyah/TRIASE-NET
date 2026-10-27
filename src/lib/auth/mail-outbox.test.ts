import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),open:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/db/client",()=>({getPool:()=>({query:m.query})}));
vi.mock("./real-accounts",()=>({sealTotp:vi.fn(),openTotp:m.open}));
vi.mock("./email",()=>({sendAccountEmail:m.send}));
import {deliverAccountMail} from "./mail-outbox";
const job={id:"job",lease_id:"lease",sealed_payload:"private-ciphertext"};
beforeEach(()=>{vi.resetAllMocks();vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});m.open.mockReturnValue(JSON.stringify({email:"private@example.test",token:"private-token",purpose:"verify"}));m.send.mockResolvedValue(undefined);});
function results(...values:unknown[]){for(const result of values)m.query.mockResolvedValueOnce({rows:[{result}]});}
describe("outbox acknowledgements",()=>{
 it("counts delivery only after true complete",async()=>{results([job],true);expect(await deliverAccountMail()).toEqual({delivered:1,failed:0});});
 it("detects false complete without issuing fail after SMTP acceptance",async()=>{results([job],false);expect(await deliverAccountMail()).toEqual({delivered:0,failed:1});expect(m.query).toHaveBeenCalledTimes(2);expect(console.error).toHaveBeenCalledWith("[auth-mail]",expect.objectContaining({phase:"OUTBOX_ACK_FAILED",operation:"complete"}));});
 it("detects false fail and never logs payload or error text",async()=>{results([job],false);m.open.mockImplementation(()=>{throw new Error("private-ciphertext private-token");});expect(await deliverAccountMail()).toEqual({delivered:0,failed:1});expect(console.error).toHaveBeenCalledWith("[auth-mail]",expect.objectContaining({phase:"DECRYPT_FAILED"}));expect(console.error).toHaveBeenCalledWith("[auth-mail]",expect.objectContaining({phase:"OUTBOX_ACK_FAILED",operation:"fail"}));expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private");});
 it("rejects malformed recipients before SMTP",async()=>{results([job],true);m.open.mockReturnValue(JSON.stringify({email:"bad\r\nBcc:other@example.test",token:"token",purpose:"verify"}));await deliverAccountMail();expect(m.send).not.toHaveBeenCalled();});
 it("continues after an acknowledgement query throws",async()=>{results([job,job]);m.query.mockRejectedValueOnce(new Error("secret DB URL"));results(true);expect(await deliverAccountMail()).toEqual({delivered:1,failed:1});});
 it("logs an empty claim without reporting deliveries",async()=>{results([]);expect(await deliverAccountMail()).toEqual({delivered:0,failed:0});});
});
