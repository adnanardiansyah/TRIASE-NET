import "server-only";
export type MailPhase = "DECRYPT_FAILED" | "RECIPIENT_UNAVAILABLE" | "SMTP_CONFIG_FAILED" | "SMTP_DNS_FAILED" | "SMTP_CONNECTION_FAILED" | "SMTP_AUTH_FAILED" | "SMTP_REJECTED" | "SMTP_TIMEOUT" | "OUTBOX_ACK_FAILED" | "OUTBOX_CLAIM_FAILED";
const codes = new Set(["EAUTH", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ESOCKET", "EDNS", "ENOTFOUND", "EAI_AGAIN", "EENVELOPE", "EMESSAGE", "EPROTOCOL", "ETLS"]);
// Inspect provider text in memory only. Output is always a fixed category;
// unknown wording stays unknown rather than exposing the original response.
export function smtpRejectionReason(error: unknown) {
 const e = error && typeof error === "object" ? error as {response?:unknown} : {};
 const response = typeof e.response === "string" ? e.response.slice(0,8192).toLowerCase() : "";
 if (/only send testing emails to your own email address/.test(response)) return "TEST_RECIPIENT_RESTRICTED";
 if (/domain.{0,200}(?:is not verified|not verified|isn't verified)/.test(response)) return "SENDER_DOMAIN_NOT_VERIFIED";
 if (/(?:api key|apikey).{0,100}(?:invalid|expired|revoked)|(?:invalid|expired|revoked).{0,100}(?:api key|apikey)/.test(response)) return "API_KEY_INVALID";
 if (/(?:api key|apikey).{0,150}(?:permission|restricted)|(?:insufficient|missing).{0,40}permissions?/.test(response)) return "API_KEY_PERMISSION_DENIED";
 if (/(?:daily|monthly|sending) (?:email )?(?:quota|limit).{0,60}(?:exceeded|reached)/.test(response)) return "SENDING_LIMIT_REACHED";
 return "UNKNOWN";
}
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
 console.error("[auth-mail]", {event:"failed", phase, ...safeSmtpError(error), ...(phase === "SMTP_REJECTED" ? {reason:smtpRejectionReason(error)} : {}), ...(operation ? {operation} : {})});
}
export function mailProgress(event: "claimed" | "decrypted" | "recipient_validated" | "smtp_accepted" | "acknowledged" | "batch", counts: {claimed?:number;delivered?:number;failed?:number} = {}) {
 // Routine worker milestones belong at Info level in Vercel Runtime Logs.
 // eslint-disable-next-line no-console
 console.info("[auth-mail]", {event, ...counts});
}
