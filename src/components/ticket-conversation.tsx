"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronUp, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import { MfaStepUp } from "./mfa-step-up";
import type { ReplyView } from "@/lib/db/tickets";

type Cursor = { at: string; id: string };
export function TicketConversation({ ticketId, isStaff, closed }: { ticketId: string; isStaff: boolean; closed: boolean }) {
  const [opened, setOpened] = useState(!isStaff);
  const [messages, setMessages] = useState<ReplyView[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const retry = useRef<{ id: string; body: string } | null>(null);
  const load = useCallback(async (older?: Cursor) => {
    setPending(true);
    setError("");
    try {
      const query = older ? `?${new URLSearchParams({ beforeAt: older.at, beforeId: older.id })}` : "";
      const response = await fetch(`/api/aduan/${encodeURIComponent(ticketId)}/replies${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setStepUp(data.code === "STEP_UP_REQUIRED"); setError(data.message); return; }
      setStepUp(false);
      setMessages((current) => older ? [...data.items, ...current.filter((item) => !data.items.some((next: ReplyView) => next.id === item.id))] : data.items);
      setCursor(data.nextCursor);
    } catch { setError("Percakapan tidak dapat dimuat."); }
    finally { setPending(false); }
  }, [ticketId]);
  useEffect(() => { if (opened) void load(); }, [opened, load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    if (!retry.current || retry.current.body !== text) retry.current = { id: crypto.randomUUID(), body: text };
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(ticketId)}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text, clientId: retry.current.id }) });
      const data = await response.json();
      if (!response.ok) { setStepUp(data.code === "STEP_UP_REQUIRED"); setError(data.message); return; }
      retry.current = null;
      setBody("");
      await load();
    } catch { setError("Balasan belum terkonfirmasi. Coba kirim lagi."); }
    finally { setSending(false); }
  }

  return (
    <section className="mt-8 border-t border-zinc-200 pt-6" aria-labelledby="conversation-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="conversation-heading" className="flex items-center gap-2 text-lg font-semibold"><MessageSquare size={18} /> Percakapan</h2>
        {opened && <button type="button" onClick={() => void load()} disabled={pending} title="Muat ulang percakapan" aria-label="Muat ulang percakapan" className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"><RefreshCw size={16} className={pending ? "animate-spin" : ""} /></button>}
      </div>
      {!opened ? <button onClick={() => setOpened(true)} className="mt-3 inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"><MessageSquare size={16} /> Buka percakapan</button> : <>
        {stepUp && <MfaStepUp onVerified={() => { setStepUp(false); void load(); }} />}
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        {cursor && <button onClick={() => void load(cursor)} disabled={pending} className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-700"><ChevronUp size={16} /> Balasan sebelumnya</button>}
        <ol className="mt-4 max-h-[32rem] space-y-4 overflow-y-auto" aria-live="polite" aria-busy={pending}>
          {messages.map((message) => <li key={message.id} className="border-l-2 border-zinc-300 pl-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-zinc-500"><span className={message.authorRole === "MAHASISWA" ? "text-emerald-700" : "text-emerald-700"}>{message.authorRole === "MAHASISWA" ? "Pelapor" : "Petugas"}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("id-ID")}</time></div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{message.body}</p>
          </li>)}
        </ol>
        {!pending && !error && messages.length === 0 && <p className="mt-3 text-sm text-zinc-500">Belum ada balasan.</p>}
        {closed ? <p className="mt-4 text-sm text-zinc-500">Percakapan ditutup.</p> : <form onSubmit={submit} className="mt-5">
          <label htmlFor="reply-body" className="text-sm text-zinc-600">Balasan</label>
          <textarea id="reply-body" required maxLength={4000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} className="mt-2 block w-full resize-y rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900" />
          <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs tabular-nums text-zinc-400">{body.length}/4000</span><button disabled={sending || !body.trim() || stepUp} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Kirim</button></div>
        </form>}
      </>}
    </section>
  );
}
