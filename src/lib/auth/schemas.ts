import { z } from "zod";
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12, "Password minimal 12 karakter.").max(128);
export const registrationSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
export const verificationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: passwordSchema.optional() }).strict();
export const resendSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: passwordSchema }).strict();
export const rotateRecoverySchema = z.object({ password: z.string().min(1).max(128), otp: z.string().regex(/^\d{6}$/) }).strict();
