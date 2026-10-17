import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({send:vi.fn(),close:vi.fn(),create:vi.fn(),lookup:vi.fn()}));
vi.mock("node:dns/promises",()=>({lookup:m.lookup}));
vi.mock("nodemailer",()=>({default:{createTransport:m.create}}));
import { sendAccountEmail,mailConfiguration } from "./email";
beforeEach(()=>{vi.clearAllMocks();m.lookup.mockResolvedValue({address:"127.0.0.1",family:4});m.create.mockReturnValue({sendMail:m.send,close:m.close});m.send.mockResolvedValue({accepted:["a@example.test"]});vi.stubEnv("SMTP_HOST","smtp.example.test");vi.stubEnv("SMTP_PORT","587");vi.stubEnv("SMTP_USER","user");vi.stubEnv("SMTP_PASSWORD","private-password");vi.stubEnv("MAIL_FROM","app@example.test");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://app.example.test");});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe("SMTP security",()=>{
 it("requires verified TLS, bounded waits and disabled transport logging",async()=>{
  await sendAccountEmail("a@example.test","opaque-token","reset");expect(m.create).toHaveBeenCalledWith(expect.objectContaining({requireTLS:true,secure:false,tls:{rejectUnauthorized:true,servername:"smtp.example.test"},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,debug:false,logger:false}));
  expect(m.send.mock.calls[0]![0].text).toContain("https://app.example.test/reset-password#token=opaque-token&kind=reset");expect(m.close).toHaveBeenCalled();
 });
 it("enforces an absolute delivery deadline even if the SMTP server never finishes",async()=>{
  vi.useFakeTimers();m.send.mockImplementation(()=>new Promise(()=>{}));const sending=sendAccountEmail("a@example.test","token","verify");const rejected=expect(sending).rejects.toMatchObject({code:"MAIL_DELIVERY_FAILED"});await vi.advanceTimersByTimeAsync(12001);await rejected;expect(m.close).toHaveBeenCalled();
 });
 it("bounds system DNS resolution and never starts SMTP after DNS timeout",async()=>{
  vi.useFakeTimers();m.lookup.mockImplementation(()=>new Promise(()=>{}));const sending=sendAccountEmail("a@example.test","token","verify");const rejected=expect(sending).rejects.toMatchObject({code:"MAIL_DELIVERY_FAILED"});await vi.advanceTimersByTimeAsync(5001);await rejected;expect(m.create).not.toHaveBeenCalled();
 });
 it("uses implicit TLS on port 465",async()=>{vi.stubEnv("SMTP_PORT","465");await sendAccountEmail("a@example.test","token","verify");expect(m.create.mock.calls[0]![0].secure).toBe(true);});
 it("hides provider errors and always closes transport",async()=>{
  m.send.mockRejectedValue(new Error("private-password provider internals"));await expect(sendAccountEmail("a@example.test","secret-token","verify")).rejects.toMatchObject({code:"MAIL_DELIVERY_FAILED"});expect(m.close).toHaveBeenCalled();
 });
 it("rejects partial credentials and credentials embedded in origin",()=>{vi.stubEnv("SMTP_PASSWORD","");expect(()=>mailConfiguration()).toThrow();vi.stubEnv("SMTP_PASSWORD","private-password");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://name:private-password@app.example.test");expect(()=>mailConfiguration()).toThrow();});
});
