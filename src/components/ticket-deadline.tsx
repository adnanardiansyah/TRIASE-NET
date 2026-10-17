"use client";

import { useEffect, useState } from "react";
import { ticketDeadline, ticketSlaState, type SlaTicket } from "@/lib/ticket-sla";

export function TicketDeadline({ ticket }: { ticket: SlaTicket }) {
  // Server and initial client render are identical; relative state starts after mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const deadline = ticketDeadline(ticket);
  if (!deadline) return null;
  const state = ticketSlaState(ticket, now ?? Date.parse(ticket.createdAt));
  if (state === "CLOSED") return null;
  const tone = state === "OVERDUE" ? "text-rose-700" : state === "DUE_SOON" ? "text-amber-700" : "text-zinc-500";
  return <span className={`mt-2 block text-[10px] leading-5 ${tone}`}><span className="block">Target: <time dateTime={deadline}>{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(deadline))} WIB</time></span>{now !== null && (state === "OVERDUE" ? "Lewat target · perlu ditinjau" : state === "DUE_SOON" ? "Tenggat dalam 24 jam" : "Dalam target")}</span>;
}
