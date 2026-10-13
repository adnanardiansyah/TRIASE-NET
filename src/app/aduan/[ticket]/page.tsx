import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { verifySessionToken } from "@/lib/auth/jwt";
import { ticketDetail } from "@/lib/db/tickets";
import { ApiError } from "@/lib/api/errors";
import { readTicketCode } from "@/lib/api/validation";
import { TicketDetailView } from "@/components/ticket-detail";

export default async function TicketDetailPage({ params }: { params: Promise<{ ticket: string }> }) {
  const token = (await cookies()).get("triase-session")?.value;
  if (!token) redirect("/login");
  let session;
  try { session = verifySessionToken(token); } catch { redirect("/login"); }
  let detail;
  try {
    const code = readTicketCode((await params).ticket);
    detail = await ticketDetail(session, (await headers()).get("user-agent") ?? "", code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    return <main className="min-h-screen bg-white px-6 py-12 text-zinc-700">
      <div className="mx-auto max-w-xl"><h1 className="text-xl font-semibold">Tiket belum dapat dibuka</h1>
        <p role="alert" className="mt-3 text-sm text-zinc-500">{error instanceof ApiError ? error.message : "Layanan database belum tersedia."}</p>
        <Link href={session.role === "MAHASISWA" ? "/mahasiswa" : session.role === "ADMIN" ? "/admin" : "/satgas"} className="mt-5 inline-block text-sm text-emerald-700">Kembali ke dashboard</Link>
      </div>
    </main>;
  }
  return <TicketDetailView initial={detail} role={session.role} />;
}
