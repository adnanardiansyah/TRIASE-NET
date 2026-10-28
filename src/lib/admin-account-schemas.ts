import { z } from "zod";
import { ADUAN_CATEGORY, DUTY_STATUS } from "./domain/enums";
import { emailSchema } from "./auth/schemas";
const reason=z.string().trim().min(10).max(500);
const mandate={categories:z.array(z.enum(ADUAN_CATEGORY)).min(1).max(ADUAN_CATEGORY.length).refine(a=>new Set(a).size===a.length),max_risk:z.number().int().min(0).max(100),expires_at:z.string().datetime({offset:true})};
export const adminAccountMutation=z.discriminatedUnion("action",[
 z.object({action:z.literal("invite_resend"),id:z.string().uuid(),reason}).strict(),
 z.object({action:z.literal("status"),id:z.string().uuid(),version:z.number().int().min(0),status:z.enum(["ACTIVE","SUSPENDED"]),reason}).strict(),
 z.object({action:z.literal("mandate"),id:z.string().uuid(),version:z.number().int().min(0),duty_status:z.enum(DUTY_STATUS),...mandate,reason}).strict(),
 z.object({action:z.literal("invite"),email:emailSchema,name:z.string().trim().min(1).max(120),unit_name:z.string().trim().min(1).max(120),...mandate,reason}).strict(),
]);
