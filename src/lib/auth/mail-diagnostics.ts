import "server-only";
export type MailPhase = "DECRYPT_FAILED" | "RECIPIENT_UNAVAILABLE" | "SMTP_CONFIG_FAILED" | "SMTP_DNS_FAILED" | "SMTP_CONNECTION_FAILED" | "SMTP_AUTH_FAILED" | "SMTP_REJECTED" | "SMTP_TIMEOUT" | "OUTBOX_ACK_FAILED" | "OUTBOX_CLAIM_FAILED";
const codes = new Set(["EAUTH", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ESOCKET", "EDNS", "ENOTFOUND", "EAI_AGAIN", "EENVELOPE", "EMESSAGE", "EPROTOCOL", "ETLS"]);
export function safeSmtpError(error: unknown) {
 const e = error && typeof error === "object" ? error as {code?:unknown;responseCode?:unknown} : {};
 return { ...(typeof e.code === "string" && codes.has(e.code) ? {smtpCode:e.code} : {}), ...(typeof e.responseCode === "number" && Number.isInteger(e.responseCode) && e.responseCode >= 100 && e.responseCode <= 599 ? {responseCode:e.responseCode} : {}) };
}
export function smtpPhase(error: unknown): MailPhase {
 const {smtpCode, responseCode}=safeSmtpError(error);
 if(smtpCode === "ETIMEDOUT") return "SMTP_TIMEOUT";
 if(smtpCode === "EAUTH" || responseCode === 530 || responseCode === 534 || responseCode === 535) return "SMTP_AUTH_FAILED";
 if(smtpCode === "EDNS" || smtpCode === "ENOTFOUND" || smtpCode === "EAI_AGAIN") return "SMTP_DNS_FAILED";
 if(responseCode && responseCode >= 400 || smtpCode === "EENVELOPE" || smtpCode === "EMESSAGE") return "SMTP_REJECTED";
 return "SMTP_CONNECTION_FAILED";
}
// Construct records from an allowlist only. Never pass an Error or payload to the logger.
export function mailFailure(phase: MailPhase, error?: unknown, operation?: "complete" | "fail") {
 console.error("[auth-mail]", {event:"failed", phase, ...safeSmtpError(error), ...(operation ? {operation} : {})});
}
export function mailProgress(event: "claimed" | "decrypted" | "recipient_validated" | "smtp_accepted" | "acknowledged" | "batch", counts: {claimed?:number;delivered?:number;failed?:number} = {}) {
 // Routine worker milestones belong at Info level in Vercel Runtime Logs.
 // eslint-disable-next-line no-console
 console.info("[auth-mail]", {event, ...counts});
}
