import {describe,it,expect} from "vitest";
import {safeSmtpError,smtpPhase} from "./mail-diagnostics";
describe("safe SMTP diagnostics",()=>{
 it.each([['EAUTH','SMTP_AUTH_FAILED'],['ECONNECTION','SMTP_CONNECTION_FAILED'],['ETIMEDOUT','SMTP_TIMEOUT'],['ENOTFOUND','SMTP_DNS_FAILED'],['EENVELOPE','SMTP_REJECTED']])("classifies %s",(code,phase)=>{expect(smtpPhase({code})).toBe(phase);});
 it("only includes allowlisted codes and numeric response codes",()=>{expect(safeSmtpError({code:'EAUTH',responseCode:535,message:'secret',stack:'secret',response:'secret'})).toEqual({smtpCode:'EAUTH',responseCode:535});expect(safeSmtpError({code:'secret',responseCode:'secret'})).toEqual({});});
});
