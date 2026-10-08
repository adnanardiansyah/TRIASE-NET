import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffDecryptPanel } from "@/components/staff-decrypt-panel";
import { verifySessionToken } from "@/lib/auth/jwt";
import { formatTicketStatus } from "@/lib/dashboard-aggregates";
import {
  getDemoTicket,
  isDemoTicketOwnedBy,
  readDemoTicketBody,
  TicketBodyUnavailableError,
} from "@/lib/demo-store";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticket: string }>;
}) {
  const { ticket } = await params;
  const record = getDemoTicket(ticket);
  const token = (await cookies()).get("triase-session")?.value;
  let session = null;

  if (token) {
    try {
      session = verifySessionToken(token);
    } catch {
      session = null;
    }
  }

  const isStaff = session?.role === "SATGAS" || session?.role === "ADMIN";
  const actorEmail = (session?.email ?? session?.sub ?? "").trim().toLowerCase();
  const isOwner = session !== null && isDemoTicketOwnedBy(record?.ticketId ?? ticket, actorEmail);

  // Pelapor yang tidak diizinkan juga mendapat 404, sama seperti tiket yang
  // memang tidak ada. Kalau tidak, permintaan yang tidak diizinkan menjadi
  // petunjuk apakah sebuah tiket ada.
  if (!record || (!isStaff && !isOwner)) {
    notFound();
  }

  // Pelapor membaca aduannya sendiri. Kalau material kunci tidak tersedia,
  // halaman tetap terbuka untuk metadata daniversinya diberi tahu, karena
  // halaman utuh tidak boleh gagal hanya karena satu decryption.
  let ownerBody: string | null = null;
  let bodyError = false;

  if (isOwner && !isStaff) {
    try {
      ownerBody = readDemoTicketBody(record.ticketId);
    } catch (error) {
      if (error instanceof TicketBodyUnavailableError) {
        bodyError = true;
      } else {
        throw error;
      }
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
              Detail tiket
            </p>
            <h1 className="mt-2 font-mono text-3xl font-bold text-white">{record.ticketId}</h1>
          </div>
          <Link
            href="/aduan/lacak"
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-500/60"
          >
            Kembali
          </Link>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">{record.subject}</h2>
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                {record.riskBand}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-sm text-slate-400">Kategori</div>
                <div className="mt-2 font-medium text-white">{record.category}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-sm text-slate-400">Status</div>
                <div className="mt-2 font-medium text-white">
                  {formatTicketStatus(record.status)}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-sm text-slate-400">Isi aduan</div>

              {isOwner && !isStaff ? (
                bodyError ? (
                  <p className="mt-2 text-sm text-rose-300">
                    Isi aduan tidak dapat dibuka karena material kunci tidak
                    tersedia di server.
                  </p>
                ) : (
                  <p className="mt-2 leading-7 whitespace-pre-wrap text-slate-200">
                    {ownerBody}
                  </p>
                )
              ) : (
                <div className="mt-2">
                  <StaffDecryptPanel ticketId={record.ticketId} />
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-xs font-semibold tracking-[0.22em] text-cyan-400 uppercase">
                Identitas pelapor
              </div>
              <div className="mt-3 font-mono text-sm text-cyan-300">{record.pseudonym}</div>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Yang tampil di sini adalah pseudonim, bukan nama atau surel
                pelapor. Identitas asli tidak disimpan bersama aduan.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-cyan-500/10 to-slate-900 p-5">
              <div className="text-xs font-semibold tracking-[0.22em] text-cyan-400 uppercase">
                Timeline
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-300">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="font-medium text-white">Dibuat</div>
                  <div className="mt-1">{new Date(record.createdAt).toLocaleString("id-ID")}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="font-medium text-white">Terakhir diperbarui</div>
                  <div className="mt-1">{new Date(record.updatedAt).toLocaleString("id-ID")}</div>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}