"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Bell, CheckCheck, Clock3, MessageSquareText, RefreshCw, X } from "lucide-react";
import type { AppNotification } from "@/lib/notifications";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const marking = useRef(false);
  const load = useCallback(async () => {
    if (marking.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Notifikasi belum dapat dimuat.");
      if (!controller.signal.aborted) { setItems(data.items); setError(""); }
    } catch (failure) {
      if (!controller.signal.aborted) { setItems([]); setError(failure instanceof Error ? failure.message : "Notifikasi belum dapat dimuat."); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("triase:ticket-updated", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer); request.current?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("triase:ticket-updated", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  const unread = items.filter((item) => !item.read);
  async function markRead(ids: string[]) {
    if (!ids.length || marking.current) return;
    marking.current = true;
    setPending(true); setError("");
    // A previous poll must not overwrite newly confirmed read receipts.
    request.current?.abort(); setLoading(false);
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), keepalive: true });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Belum dapat menandai dibaca.");
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, read: true } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Belum dapat menandai dibaca."); }
    finally { marking.current = false; setPending(false); }
  }
  return <>
    <button className="ui-icon relative" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "notifications-panel" : undefined} aria-label={`Notifikasi, ${unread.length} belum dibaca di daftar pembaruan${error ? ", gagal dimuat" : ""}`} onClick={() => { setOpen(true); void load(); }}>
      <Bell size={18} />{unread.length > 0 && <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-emerald-700 px-1 text-center text-[10px] leading-5 text-white">{unread.length}</span>}
      {error && !unread.length && <span className="absolute right-0 top-0 size-2 rounded-full bg-amber-500" />}
    </button>
    <Dialog open={open} onClose={setOpen} className="relative z-[70]">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <DialogPanel id="notifications-panel" className="premium-notifications fixed inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-5"><div><DialogTitle className="text-lg font-semibold">Notifikasi</DialogTitle><p className="mt-1 text-xs text-zinc-500">Hingga 50 pembaruan; aduan terlambat diprioritaskan.</p></div><button className="ui-icon" onClick={() => setOpen(false)} aria-label="Tutup notifikasi"><X size={16} /></button></div>
        <div className="flex items-center justify-between gap-3 px-5 py-3"><button disabled={pending || !unread.length || loading} onClick={() => void markRead(unread.map((item) => item.id))} className="flex items-center gap-2 text-xs font-semibold text-emerald-700 disabled:opacity-40"><CheckCheck size={15} />Tandai semua dibaca</button><button className="ui-icon" disabled={loading || pending} onClick={() => void load()} aria-label="Muat ulang notifikasi"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button></div>
        {error && <p role="alert" className="mx-5 mb-3 rounded-md bg-amber-50 p-3 text-xs leading-6 text-amber-800">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
          {loading && !items.length ? <p role="status" className="p-8 text-center text-sm text-zinc-500">Memuat pembaruan...</p> : !items.length && !error ? <p className="p-8 text-center text-sm text-zinc-500">Belum ada pembaruan.</p> : <ul className="divide-y divide-zinc-100">{items.map((item) => <li key={item.id} className={`p-5 ${item.read ? "bg-white" : "bg-emerald-50/50"}`}>
            <Link href={`/aduan/${item.ticketId}`} onClick={() => { if (!item.read) void markRead([item.id]); setOpen(false); }} className="flex items-start gap-3 rounded-md">
              <span className={`mt-1 shrink-0 ${item.kind === "OVERDUE" ? "text-amber-600" : "text-emerald-700"}`}>{item.kind === "OVERDUE" ? <Clock3 size={18} /> : item.kind === "REPLY" ? <MessageSquareText size={18} /> : <Bell size={18} />}</span>
              <span><span className="font-mono text-[11px] font-semibold text-emerald-700">{item.ticketId}</span><span className="mt-1 block text-xs leading-6 text-zinc-700">{item.message}</span><time dateTime={item.createdAt} className="mt-2 block text-[10px] text-zinc-500">{new Date(item.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</time></span>
              {!item.read && <span className="mt-2 ml-auto size-2 shrink-0 rounded-full bg-emerald-600"><span className="sr-only">Belum dibaca</span></span>}
            </Link>
            {!item.read && <button disabled={pending} onClick={() => void markRead([item.id])} className="mt-3 ml-7 text-[11px] font-medium text-emerald-700 disabled:opacity-40">Tandai dibaca</button>}
          </li>)}</ul>}
        </div>
      </DialogPanel>
    </Dialog>
  </>;
}
