"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, Copy, FilePlus2, Fingerprint, Loader2, LockKeyhole, MapPin, MessageSquareText, Paperclip, Send, Users, X } from "lucide-react";
import { DashboardShell } from "./dashboard-shell";
import { RiskPill } from "./dashboard/pill";
import { ADUAN_CATEGORY, type AduanCategory } from "@/lib/domain/enums";
import { formatRiskBand, formatTicketCategory } from "@/lib/dashboard-aggregates";
import { complaintKind, complaintDetailRows, createComplaintSchema, detailsForCategory, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES, MAX_TOTAL_EVIDENCE_BYTES, type ComplaintDetails, type CreateComplaintInput, type EvidenceInput } from "@/lib/complaint-payload";

function FormSection({ title, note, icon, children }: { title: string; note?: string; icon: ReactNode; children: ReactNode }) {
  return <fieldset className="min-w-0 space-y-5 border-b border-zinc-200 pb-7"><legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">{icon}{title}</legend>{note && <p className="text-xs leading-6 text-zinc-500">{note}</p>}{children}</fieldset>;
}

interface CreatedTicket { ticketId: string; pseudonym: string; riskBand: string }
interface SelectedEvidence extends EvidenceInput { size: number }

export function ComplaintForm() {
  const [category, setCategory] = useState<AduanCategory>("FASILITAS");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [details, setDetails] = useState<ComplaintDetails>({ timePrecision: "UNKNOWN" });
  const [localTime, setLocalTime] = useState("");
  const [files, setFiles] = useState<SelectedEvidence[]>([]);
  const [reading, setReading] = useState(false);
  const [review, setReview] = useState<CreateComplaintInput | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedTicket | null>(null);
  const [copied, setCopied] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const kind = complaintKind(category);

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("category");
    if (ADUAN_CATEGORY.includes(selected as AduanCategory)) setCategory(selected as AduanCategory);
  }, []);
  useEffect(() => { if (review) reviewHeading.current?.focus(); if (created) receiptHeading.current?.focus(); }, [review, created]);
  const setDetail = <K extends keyof ComplaintDetails>(key: K, value: ComplaintDetails[K]) => setDetails((current) => ({ ...current, [key]: value }));
  function changeCategory(value: AduanCategory) {
    setCategory(value); setDetails((current) => detailsForCategory(value, current)); setError("");
  }
  async function addFiles(selected: FileList | null) {
    if (!selected || reading) return;
    const added = Array.from(selected);
    if (files.length + added.length > MAX_EVIDENCE_FILES) { setError("Lampiran maksimal 3 file."); return; }
    if (added.some((file) => file.size < 1 || file.size > MAX_EVIDENCE_BYTES || !EVIDENCE_MIME_TYPES.some((type) => type === file.type))) { setError("Pilih JPG, PNG, WEBP, atau PDF berukuran maksimal 1 MB per file."); return; }
    if ([...files, ...added].reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_EVIDENCE_BYTES) { setError("Total ukuran lampiran maksimal 2 MB."); return; }
    setReading(true); setError("");
    try {
      const encoded = await Promise.all(added.map((file) => new Promise<SelectedEvidence>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Lampiran tidak dapat dibaca."));
        reader.onload = () => resolve({ name: file.name, mimeType: file.type as EvidenceInput["mimeType"], size: file.size, base64: String(reader.result).split(",")[1] ?? "" });
        reader.readAsDataURL(file);
      })));
      setFiles((current) => [...current, ...encoded]);
    } catch { setError("Lampiran tidak dapat dibaca. Pilih file kembali."); }
    finally { setReading(false); }
  }
  function reviewComplaint(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!subject.trim() || !body.trim()) { setError("Lengkapi judul dan kronologi aduan."); return; }
    let occurredAt: string | undefined;
    if (details.timePrecision !== "UNKNOWN") {
      const date = new Date(`${localTime}+07:00`);
      if (!localTime || !Number.isFinite(date.getTime())) { setError("Isi waktu kejadian atau pilih tidak ingat / belum diketahui."); return; }
      if (date.getTime() > Date.now()) { setError("Waktu kejadian tidak boleh di masa depan."); return; }
      occurredAt = date.toISOString();
    }
    const payload = { category, subject: subject.trim(), body: body.trim(), details: detailsForCategory(category, { ...details, occurredAt }), attachments: files.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })) };
    const parsed = createComplaintSchema.safeParse(payload);
    if (!parsed.success) { setError("Periksa waktu kejadian dan batas panjang isian sebelum melanjutkan."); return; }
    setReview(parsed.data);
  }
  async function submit() {
    if (!review || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/aduan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(review) });
      const data = await response.json();
      if (!response.ok || !data.ok) { setError(data.message ?? "Aduan belum berhasil dikirim."); return; }
      setCreated(data); setReview(null); setSubject(""); setBody(""); setDetails({ timePrecision: "UNKNOWN" }); setLocalTime(""); setFiles([]);
      window.dispatchEvent(new Event("triase:ticket-updated"));
    } catch { setError("Pengiriman belum terkonfirmasi. Periksa daftar aduan sebelum mengirim ulang."); }
    finally { setPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(created!.ticketId); setCopied(true); }
    catch { setError("Nomor tiket belum dapat disalin."); }
  }

  return <DashboardShell role="MAHASISWA" title="Sampaikan aduan" subtitle="Ceritakan hal yang perlu mendapat perhatian. Kami mendengarkan." actions={<Link href="/mahasiswa/aduan" className="ui-btn">Aduan saya<ArrowRight size={14} /></Link>}>
    {error && <p role="alert" className="ui-alert mb-6">{error}</p>}
    {created ? <section className="max-w-3xl rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-8 sm:px-8">
      <CheckCircle2 size={32} className="text-emerald-700" aria-hidden="true" /><h2 ref={receiptHeading} tabIndex={-1} className="mt-5 text-xl font-semibold text-emerald-950">Aduan Anda sudah diterima.</h2><p className="mt-3 text-sm leading-7 text-emerald-900">Simpan nomor tiket dan ikuti perkembangan penanganannya.</p>
      <div className="my-6 flex flex-wrap items-center gap-3 border-y border-emerald-200 py-5"><span className="break-all font-mono text-lg font-semibold text-emerald-800">{created.ticketId}</span><button type="button" onClick={() => void copy()} className="ui-icon" aria-label="Salin nomor tiket">{copied ? <Check size={15} /> : <Copy size={15} />}</button>{copied && <span role="status" className="text-xs text-emerald-700">Tersalin</span>}</div>
      <dl className="grid gap-4 text-xs sm:grid-cols-2"><div><dt>Pseudonim pelapor</dt><dd className="mt-2 break-all font-mono">{created.pseudonym}</dd></div><div><dt>Perlindungan berdasarkan risiko</dt><dd className="mt-2"><RiskPill riskBand={created.riskBand} label={formatRiskBand(created.riskBand)} /></dd></div></dl>
      <div className="mt-7 flex flex-wrap gap-3"><Link href={`/aduan/${created.ticketId}`} className="ui-btn ui-btn-primary">Lihat perkembangan aduan<ArrowRight size={15} /></Link><button type="button" className="ui-btn" onClick={() => { setCreated(null); setCopied(false); setError(""); }}>Buat aduan lainnya</button></div>
    </section> : review ? <section className="max-w-4xl rounded-xl border border-zinc-200 bg-white p-5 sm:p-8" aria-busy={pending}>
      <p className="eyebrow">Periksa sebelum mengirim</p><h2 ref={reviewHeading} tabIndex={-1} className="mt-3 text-xl font-semibold text-emerald-950">Apakah laporan Anda sudah sesuai?</h2><p className="mt-3 text-xs leading-7 text-zinc-600">Aduan belum dikirim. Anda masih dapat kembali dan memperbaiki isinya.</p>
      <div className="mt-6 border-y border-zinc-200 py-5"><p className="text-xs font-semibold text-emerald-700">{formatTicketCategory(review.category)}</p><h3 className="mt-2 break-words text-lg font-semibold">{review.subject}</h3></div>
      <h3 className="mt-5 text-sm font-semibold">Kronologi kejadian</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-8 text-zinc-600">{review.body}</p>
      <dl className="mt-6 grid gap-5 border-y border-zinc-200 py-5 sm:grid-cols-2">{complaintDetailRows(review.details).map((row) => <div key={row.label} className="min-w-0"><dt className="text-xs font-semibold">{row.label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-xs leading-7 text-zinc-600">{row.value}</dd></div>)}</dl>
      <div className="mt-5"><h3 className="text-xs font-semibold">Bukti pendukung</h3>{files.length ? <ul className="mt-3 space-y-2 text-xs text-zinc-600">{files.map((file, index) => <li className="break-words" key={`${file.name}-${index}`}>{file.name} · {Math.ceil(file.size / 1024)} KB</li>)}</ul> : <p className="mt-2 text-xs text-zinc-500">Tidak ada lampiran.</p>}</div>
      <div className="mt-7 flex flex-wrap justify-between gap-3"><button type="button" disabled={pending} className="ui-btn" onClick={() => { setReview(null); setError(""); }}><ArrowLeft size={15} />Kembali mengubah</button><button type="button" disabled={pending} className="ui-btn ui-btn-primary" onClick={() => void submit()}>{pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{pending ? "Mengirim aduan..." : "Kirim aduan"}</button></div>
    </section> : <div className="grid items-start gap-9 border-t border-zinc-200 pt-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,.65fr)]">
      <form onSubmit={reviewComplaint} className="min-w-0 space-y-7" aria-busy={reading}>
        <p className="text-xs leading-6 text-zinc-600">Kategori, judul, dan kronologi wajib diisi. Informasi lainnya dapat Anda tambahkan jika diketahui.</p>
        <FormSection title="1. Informasi aduan" icon={<FilePlus2 size={17} aria-hidden="true" />}>
          <div><label htmlFor="complaint-category" className="ui-label">Kategori aduan <span aria-hidden="true">*</span></label><select id="complaint-category" className="ui-input" value={category} onChange={(event) => changeCategory(event.target.value as AduanCategory)}>{ADUAN_CATEGORY.map((value) => <option key={value} value={value}>{formatTicketCategory(value)}</option>)}</select></div>
          <div><label htmlFor="complaint-subject" className="ui-label">Judul aduan <span aria-hidden="true">*</span></label><input id="complaint-subject" className="ui-input" required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ringkasan singkat hal yang ingin Anda sampaikan" /><p className="mt-2 text-right text-[10px] text-zinc-500">{subject.length}/200</p></div>
        </FormSection>
        <FormSection title="2. Detail kejadian" icon={<MapPin size={17} aria-hidden="true" />}>
          <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="complaint-time-precision" className="ui-label">Ketepatan waktu (opsional)</label><select id="complaint-time-precision" className="ui-input" value={details.timePrecision ?? "UNKNOWN"} onChange={(event) => { setDetail("timePrecision", event.target.value as ComplaintDetails["timePrecision"]); if (event.target.value === "UNKNOWN") setLocalTime(""); }}><option value="UNKNOWN">Tidak ingat / belum diketahui</option><option value="EXACT">Waktu diketahui</option><option value="APPROXIMATE">Perkiraan waktu</option></select></div>{details.timePrecision !== "UNKNOWN" && <div><label htmlFor="complaint-occurred-at" className="ui-label">{details.timePrecision === "APPROXIMATE" ? "Perkiraan waktu kejadian" : "Waktu kejadian"} (WIB)</label><input id="complaint-occurred-at" type="datetime-local" className="ui-input" required value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></div>}</div>
          <div><label htmlFor="complaint-location" className="ui-label">{kind === "FACILITIES" ? "Gedung / ruangan / lokasi fasilitas" : "Lokasi atau media kejadian"} (opsional)</label><input id="complaint-location" className="ui-input" maxLength={500} value={details.location ?? ""} onChange={(event) => setDetail("location", event.target.value)} placeholder={kind === "FACILITIES" ? "Contoh: Gedung A, ruang 201" : "Contoh: area kampus atau media komunikasi yang digunakan"} /></div>
          {kind === "FACILITIES" && <div><label htmlFor="complaint-facility" className="ui-label">Kondisi fasilitas (opsional)</label><textarea id="complaint-facility" className="ui-input resize-y" rows={3} maxLength={1000} value={details.facilityCondition ?? ""} onChange={(event) => setDetail("facilityCondition", event.target.value)} placeholder="Apa yang rusak atau tidak berfungsi? Bagaimana dampaknya?" /></div>}
          {kind === "TECHNOLOGY" && <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="complaint-system" className="ui-label">Aplikasi / sistem (opsional)</label><input id="complaint-system" className="ui-input" maxLength={200} value={details.systemName ?? ""} onChange={(event) => setDetail("systemName", event.target.value)} placeholder="Nama aplikasi atau layanan" /></div><div><label htmlFor="complaint-error" className="ui-label">Pesan error / kendala (opsional)</label><textarea id="complaint-error" className="ui-input resize-y" rows={2} maxLength={1000} value={details.errorMessage ?? ""} onChange={(event) => setDetail("errorMessage", event.target.value)} placeholder="Tuliskan pesan error tanpa password atau kode akses" /></div></div>}
          <div><label htmlFor="complaint-body" className="ui-label">Kronologi kejadian <span aria-hidden="true">*</span></label><textarea id="complaint-body" className="ui-input min-h-44 resize-y leading-7" required maxLength={8000} rows={7} value={body} onChange={(event) => setBody(event.target.value)} aria-describedby="complaint-body-help" placeholder="Ceritakan apa yang terjadi, urutan kejadian, dan dampak yang Anda alami." /><div className="mt-2 flex justify-between gap-4 text-[10px] leading-5 text-zinc-500"><span id="complaint-body-help">Gunakan informasi yang Anda ketahui; tidak perlu menebak.</span><span className="shrink-0">{body.length}/8000</span></div></div>
        </FormSection>
        {kind === "PERSONAL" && <FormSection title="Pihak terkait" note="Seluruh isian pada bagian ini opsional. Anda dapat menyebutkan ciri atau peran jika tidak mengetahui nama." icon={<Users size={17} aria-hidden="true" />}>
          <div><label htmlFor="complaint-involvement" className="ui-label">Posisi Anda sebagai pelapor</label><select id="complaint-involvement" className="ui-input" value={details.involvement ?? "UNSPECIFIED"} onChange={(event) => setDetails((current) => ({ ...current, involvement: event.target.value as ComplaintDetails["involvement"], affectedPerson: undefined, relationship: undefined }))}><option value="UNSPECIFIED">Tidak ingin menyebutkan</option><option value="SELF">Saya mengalami sendiri</option><option value="OTHER">Melaporkan kejadian terhadap orang lain</option></select></div>
          {details.involvement === "OTHER" && <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="complaint-affected" className="ui-label">Pihak yang mengalami (opsional)</label><input id="complaint-affected" className="ui-input" maxLength={200} value={details.affectedPerson ?? ""} onChange={(event) => setDetail("affectedPerson", event.target.value)} placeholder="Nama panggilan atau keterangan yang relevan" /></div><div><label htmlFor="complaint-relationship" className="ui-label">Hubungan Anda (opsional)</label><input id="complaint-relationship" className="ui-input" maxLength={200} value={details.relationship ?? ""} onChange={(event) => setDetail("relationship", event.target.value)} placeholder="Contoh: teman sekelas" /></div></div>}
          <div><label htmlFor="complaint-reported" className="ui-label">Pihak terlapor / ciri yang diketahui (opsional)</label><textarea id="complaint-reported" className="ui-input resize-y" rows={2} maxLength={500} value={details.reportedParty ?? ""} onChange={(event) => setDetail("reportedParty", event.target.value)} placeholder="Sebutkan jika diketahui; boleh dikosongkan" /></div>
          <div><label htmlFor="complaint-witnesses" className="ui-label">Saksi / informasi pendukung (opsional)</label><textarea id="complaint-witnesses" className="ui-input resize-y" rows={2} maxLength={500} value={details.witnesses ?? ""} onChange={(event) => setDetail("witnesses", event.target.value)} placeholder="Informasi saksi yang relevan, jika ada" /></div>
        </FormSection>}
        <FormSection title="Bukti pendukung" icon={<Paperclip size={17} aria-hidden="true" />} note="Opsional. JPG, PNG, WEBP, atau PDF. Maksimal 3 file, 1 MB per file, dan total 2 MB.">
          <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-5"><label htmlFor="complaint-evidence" className="ui-label">Tambahkan gambar atau dokumen</label><input id="complaint-evidence" type="file" multiple accept={EVIDENCE_MIME_TYPES.join(",")} disabled={reading || files.length >= MAX_EVIDENCE_FILES} className="block w-full min-w-0 text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-100 file:px-3 file:py-2 file:text-emerald-900" onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />{reading && <p role="status" className="mt-3 text-xs text-emerald-700">Membaca lampiran...</p>}</div>
          {files.length > 0 && <ul className="space-y-2">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3"><div className="min-w-0"><p className="break-words text-xs font-medium text-zinc-700">{file.name}</p><p className="mt-1 text-[10px] text-zinc-500">{Math.ceil(file.size / 1024)} KB</p></div><button type="button" className="ui-icon shrink-0" disabled={reading} aria-label={`Hapus lampiran ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={15} /></button></li>)}</ul>}
        </FormSection>
        <FormSection title="Harapan pelapor" icon={<MessageSquareText size={17} aria-hidden="true" />}>
          <div><label htmlFor="complaint-outcome" className="ui-label">Tindak lanjut yang diharapkan (opsional)</label><textarea id="complaint-outcome" className="ui-input resize-y leading-7" rows={3} maxLength={1500} value={details.expectedOutcome ?? ""} onChange={(event) => setDetail("expectedOutcome", event.target.value)} placeholder="Apa yang Anda harapkan dapat dibantu atau ditindaklanjuti?" /></div>
        </FormSection>
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5"><span className="inline-flex items-center gap-2 text-[10px] text-zinc-500"><LockKeyhole size={13} />Isi dan bukti aduan dilindungi enkripsi</span><button disabled={reading || !subject.trim() || !body.trim()} className="ui-btn ui-btn-primary"><ClipboardCheck size={16} />Periksa laporan<ArrowRight size={14} /></button></div>
      </form>
      <aside className="space-y-6 border-t border-zinc-200 pt-7 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"><div><p className="eyebrow">Bercerita dengan aman</p><h2 className="mt-3 text-lg font-semibold text-emerald-950">Lengkap seperlunya.<br />Tetap terlindungi.</h2><p className="mt-4 text-xs leading-7 text-zinc-600">Tidak semua kolom perlu diisi. Sertakan hal yang relevan dan hindari data pribadi yang tidak diperlukan.</p></div>{[{ icon: Fingerprint, title: "Identitas pada tiket disamarkan", body: "Nama akun dan email Anda tidak ditampilkan bersama tiket kepada petugas. Hindari menuliskannya pada kronologi jika tidak diperlukan." }, { icon: ClipboardCheck, title: "Periksa sebelum mengirim", body: "Anda akan melihat ringkasan laporan dan dapat kembali mengubah isinya sebelum dikirim." }, { icon: MessageSquareText, title: "Ikuti tindak lanjut", body: "Setelah terkirim, gunakan nomor tiket untuk melihat status dan percakapan dengan petugas." }].map((item) => <div key={item.title} className="flex items-start gap-3"><item.icon size={18} aria-hidden="true" className="mt-1 shrink-0 text-emerald-700" /><div><h3 className="text-xs font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-7 text-zinc-600">{item.body}</p></div></div>)}</aside>
    </div>}
  </DashboardShell>;
}
