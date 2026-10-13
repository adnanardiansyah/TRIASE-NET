"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ArrowUpRight, BarChart3, ChevronDown, CircleHelp, FilePlus2, LayoutDashboard, ListFilter, LogOut, Menu, Search, ShieldCheck, X, type LucideIcon } from "lucide-react";
import type { SessionRole } from "@/lib/auth/jwt";
import { Brand } from "./brand";

const labels = { MAHASISWA: "Mahasiswa", SATGAS: "Satuan Tugas", ADMIN: "Administrator" };
const homes = { MAHASISWA: "/mahasiswa", SATGAS: "/satgas", ADMIN: "/admin" };
const nav: Record<SessionRole, { label: string; href: string; icon: LucideIcon }[]> = {
  MAHASISWA: [{ label: "Ringkasan", href: "/mahasiswa", icon: LayoutDashboard }, { label: "Buat aduan", href: "/aduan/baru", icon: FilePlus2 }, { label: "Lacak tiket", href: "/aduan/lacak", icon: Search }],
  SATGAS: [{ label: "Ringkasan", href: "/satgas", icon: LayoutDashboard }, { label: "Antrean aduan", href: "/satgas#aduan", icon: ListFilter }, { label: "Analitik penanganan", href: "/satgas#analitik", icon: BarChart3 }],
  ADMIN: [{ label: "Ringkasan", href: "/admin", icon: LayoutDashboard }, { label: "Seluruh aduan", href: "/admin#aduan", icon: ListFilter }, { label: "Analitik operasional", href: "/admin#analitik", icon: BarChart3 }],
};

export type DashboardShellProps = { role: SessionRole; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode };
export interface SessionProfile { name: string; role: SessionRole; profile: { dutyStatus: string; categories: string[]; maxRisk: number; expiresAt: string | null } | null }

export function DashboardShell({ role, title, subtitle, actions, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }).then(async (r) => { if (r.ok) setProfile(await r.json()); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => { setMobile(false); }, [pathname]);
  useEffect(() => {
    if (!mobile && !profileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobile(false); setProfileOpen(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobile, profileOpen]);
  async function logout() {
    setLoggingOut(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign("/login");
    } catch { setLogoutError("Belum dapat keluar. Coba lagi."); setLoggingOut(false); }
  }
  const name = profile?.name ?? labels[role];
  const initials = name.split(" ").slice(0, 2).map((word) => word[0]).join("");
  const sidebar = <>
    <div className="flex h-[85px] items-center px-6"><Brand light compact /></div>
    <div className="mx-4 flex items-center gap-3 rounded-md border border-white/10 px-3 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10 text-emerald-300"><ShieldCheck size={17} /></span><div><p className="text-[11px] font-semibold text-white">Ruang kerja</p><p className="mt-1 text-[10px] text-emerald-200/60">{labels[role]}</p></div></div>
    <p className="workspace-nav-caption">Menu utama</p>
    <nav aria-label="Navigasi utama" className="space-y-1 px-3">{nav[role].map((item) => <Link key={item.href} href={item.href} onClick={() => setMobile(false)} aria-current={pathname === item.href ? "page" : undefined} className={`workspace-nav-link ${pathname === item.href ? "is-active" : ""}`}><item.icon size={17} strokeWidth={1.6} />{item.label}</Link>)}</nav>
    <div className="mt-auto px-3 pb-4"><p className="workspace-nav-caption">Informasi</p><Link href="/#bantuan" className="workspace-nav-link"><CircleHelp size={17} strokeWidth={1.6} />Pusat bantuan<ArrowUpRight size={12} className="ml-auto" /></Link><div className="mx-1 mt-5 border-t border-white/10 pt-4"><div className="flex items-center gap-2 text-[10px] text-emerald-200/70"><ShieldCheck size={13} /> Sesi dengan verifikasi MFA</div></div></div>
  </>;
  return <div className="min-h-screen bg-[#f7f9f8] text-zinc-800">
    <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:bg-white focus:p-3">Lewati navigasi</a>
    <aside className="animate-in fade-in slide-in-from-left-2 duration-200 ease-out motion-reduce:animate-none workspace-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col lg:flex">{sidebar}</aside>
    <Dialog open={mobile} onClose={setMobile} className="relative z-50 lg:hidden"><div className="fixed inset-0 bg-black/40" aria-hidden /><DialogPanel className="animate-in fade-in slide-in-from-left-2 duration-200 ease-out motion-reduce:animate-none workspace-sidebar fixed inset-y-0 left-0 flex flex-col"><DialogTitle className="sr-only">Navigasi ruang kerja</DialogTitle><button className="absolute right-2 top-2 p-2 text-white" aria-label="Tutup navigasi" onClick={() => setMobile(false)}><X size={17} /></button>{sidebar}</DialogPanel></Dialog>
    <div className="lg:pl-[236px]">
      <header className="no-print sticky top-0 z-30 flex h-[70px] items-center justify-between gap-3 border-b border-zinc-200/80 bg-white px-4 sm:px-7 lg:px-9">
        <div className="flex min-w-0 items-center gap-3"><button onClick={() => setMobile(true)} className="ui-icon lg:hidden" aria-label="Buka navigasi"><Menu size={18} /></button><span className="hidden text-xs text-zinc-400 sm:inline">Ruang kerja</span><span className="hidden text-zinc-300 sm:inline">/</span><Link href={homes[role]} className="truncate text-xs font-medium text-zinc-700">{labels[role]}</Link></div>
        <div className="relative"><button aria-expanded={profileOpen} aria-controls="account-menu" onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-3 rounded-md py-1 text-left"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">{initials}</span><span className="hidden sm:block"><span className="block max-w-40 truncate text-xs font-semibold text-zinc-700">{name}</span><span className="mt-1 block text-[10px] text-zinc-400">{labels[role]}</span></span><ChevronDown size={13} className="text-zinc-400" /></button>
          {profileOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label="Tutup menu akun" onClick={() => setProfileOpen(false)} /><div id="account-menu" className="animate-in fade-in slide-in-from-top-1 duration-150 ease-out motion-reduce:animate-none absolute right-0 top-full z-40 mt-3 w-64 rounded-md border border-zinc-200 bg-white p-4 shadow-lg"><p className="text-xs font-semibold">{name}</p><p className="mt-1 text-xs text-zinc-500">{labels[role]}</p>{profile?.profile && <p className="mt-3 text-xs text-zinc-500">Tugas: <span className={profile.profile.dutyStatus === "ON_DUTY" ? "text-emerald-700" : "text-amber-700"}>{profile.profile.dutyStatus === "ON_DUTY" ? "Aktif bertugas" : "Tidak bertugas"}</span></p>}<button disabled={loggingOut} onClick={() => void logout()} className="mt-4 flex w-full items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-rose-600"><LogOut size={15} />{loggingOut ? "Keluar..." : "Keluar dari akun"}</button>{logoutError && <p role="alert" className="mt-2 text-xs text-rose-600">{logoutError}</p>}</div></>}
        </div>
      </header>
      <main id="workspace-content" className="mx-auto max-w-[1520px] px-4 py-7 sm:px-7 lg:px-9 lg:py-8">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className="eyebrow mb-2">{labels[role]}</p><h1 className="text-[25px] font-semibold leading-tight text-zinc-900">{title}</h1>{subtitle && <p className="mt-2 max-w-2xl text-[13px] leading-6 text-zinc-500">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</header>
        {children}
      </main>
      <footer className="mx-4 flex flex-wrap justify-between gap-2 border-t border-zinc-200 py-5 text-[10px] text-zinc-400 sm:mx-7 lg:mx-9"><span>TRIASE-Net · Layanan aduan mahasiswa</span><span>Privasi pelapor, prioritas bersama.</span></footer>
    </div>
  </div>;
}
