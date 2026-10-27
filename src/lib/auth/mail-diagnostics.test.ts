import {describe,it,expect,vi} from "vitest";
import {mailFailure,safeSmtpError,smtpPhase,smtpRejectionReason} from "./mail-diagnostics";
describe("safe SMTP diagnostics",()=>{
 it.each([
  ['550 You can only send testing emails to your own email address (private@example.test).','TEST_RECIPIENT_RESTRICTED'],
  ['550 The example.test domain is not verified.','SENDER_DOMAIN_NOT_VERIFIED'],
  ['550 API key is invalid: private-key','API_KEY_INVALID'],
  ['550 API key has restricted permissions','API_KEY_PERMISSION_DENIED'],
  ['550 Daily email quota exceeded','SENDING_LIMIT_REACHED'],
  ['550 Unrecognized provider wording private@example.test private-token','UNKNOWN'],
 ])("categorizes provider response without returning it",(response,reason)=>{
  expect(smtpRejectionReason({response})).toBe(reason);
 });
 it("logs only the category, never provider text, message or stack",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  try {
   mailFailure("SMTP_REJECTED",{code:"EMESSAGE",responseCode:550,response:"550 You can only send testing emails to your own email address (private@example.test). private-token",message:"private-key",stack:"private-stack"});
   expect(log).toHaveBeenCalledWith("[auth-mail]",{event:"failed",phase:"SMTP_REJECTED",smtpCode:"EMESSAGE",responseCode:550,reason:"TEST_RECIPIENT_RESTRICTED"});
   expect(JSON.stringify(log.mock.calls)).not.toContain("private");
   expect(smtpRejectionReason(null)).toBe("UNKNOWN");
  } finally {log.mockRestore();}
 });
 it.each([['EAUTH','SMTP_AUTH_FAILED'],['ECONNECTION','SMTP_CONNECTION_FAILED'],['ETIMEDOUT','SMTP_TIMEOUT'],['ENOTFOUND','SMTP_DNS_FAILED'],['EENVELOPE','SMTP_REJECTED']])("classifies %s",(code,phase)=>{expect(smtpPhase({code})).toBe(phase);});
 it("only includes allowlisted codes and numeric response codes",()=>{expect(safeSmtpError({code:'EAUTH',responseCode:535,message:'secret',stack:'secret',response:'secret'})).toEqual({smtpCode:'EAUTH',responseCode:535});expect(safeSmtpError({code:'secret',responseCode:'secret'})).toEqual({});});
});
