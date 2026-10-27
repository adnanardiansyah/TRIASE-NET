import {beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const deliver=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/auth/mail-outbox",()=>({deliverAccountMail:deliver}));
import {GET} from "./route";
beforeEach(()=>{vi.stubEnv("CRON_SECRET","s".repeat(32));});
function request(){return new NextRequest("https://app.example.test/api/internal/auth-mail",{headers:{authorization:`Bearer ${"s".repeat(32)}`}});}
it("returns 503 for a failed batch without internal diagnostics",async()=>{deliver.mockResolvedValue({delivered:0,failed:1});const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,delivered:0,failed:1});});
it("returns 200 for an empty batch",async()=>{deliver.mockResolvedValue({delivered:0,failed:0});expect((await GET(request())).status).toBe(200);});
it("rejects unauthenticated calls",async()=>{expect((await GET(new NextRequest("https://app.example.test/api/internal/auth-mail"))).status).toBe(401);});
