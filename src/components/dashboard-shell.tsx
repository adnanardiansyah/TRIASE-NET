'use client';

import Link from 'next/link';
import { usePathname } from "next/navigation";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import type { LucideIcon } from "lucide-react";
import {
  FilePlus2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { getRoleHomePath } from "@/lib/auth/guard";
import type { SessionRole } from "@/lib/auth/jwt";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Prefix tambahan yang juga dianggap sedang aktif.
   *
   * Diperlukan karena detail tiketBernada di `/aduan/TR-001`, yang bukan
   * turunan `/aduan/lacak` maupun `/aduan/baru`. Tanpa ini, halaman yang
   * paling sering dibuka justru tidak menyorot apa pun di navigasi.
   */
  match?: readonly string[];
}

/**
 * Navigasi per role.
 *
 * Setiap entri harus benar-benar boleh dibuka role tersebut. Sebelumnya
 * `ADMIN` diberi tautan ke `/mahasiswa` dan `SATGAS` diberi tautan ke
 * `/aduan/baru`, padahal keduanya milik `MAHASISWA`. Memo middleware yang
 * mengarahkan role yang salah ke berandanya sendiri membuat penggunanya
 * ditendang balik lagi begitu menautkanya diklik.
 */
const NAV_BY_ROLE: Record<SessionRole, NavItem[]> = {
  MAHASISWA: [
    { label: "Dashboard", href: "/mahasiswa", icon: LayoutDashboard },
    { label: "Buat aduan", href: "/aduan/baru", icon: FilePlus2 },
    { label: "Lacak tiket", href: "/aduan/lacak", icon: Search, match: ["/aduan"] },
  ],
  SATGAS: [{ label: "Antrean", href: "/satgas", icon: ListChecks }],
  // Admin tidak diberi tautan ke `/mahasiswa` atau `/satgas`. Guard tidak
  // mengizinkan role ADMIN membuka kedua area itu, jadi menautkannya hanya
  // menghasilkan pengalihan yang menendang pengguna kembali ke berandanya.
  ADMIN: [{ label: "Dashboard", href: "/admin", icon: LayoutDashboard }],
};

/** Ringkasan peran untuk ditampilkan di sidebar. */
const ROLE_LABEL: Record<SessionRole, string> = {
  MAHASISWA: "Mahasiswa",
  SATGAS: "Satuan Tugas",
  ADMIN: "Administrator",
};

/** Aksen warna per role, dipakai pada badge peran di sidebar. */
const ROLE_TONE: Record<SessionRole, string> = {
  MAHASISWA: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25",
  SATGAS: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  ADMIN: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
};

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function NavLinks({ role, pathname, onNavigate }: {
  role: SessionRole;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_BY_ROLE[role].map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;

        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-cyan-400/10 text-cyan-200 ring-1 ring-inset ring-cyan-400/25"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
            }`}
          >
            <Icon className={`size-4 shrink-0 ${active ? "text-cyan-300" : ""}`} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export type DashboardShellProps = {
  role: SessionRole;
  title: string;
  subtitle?: string;
  /** Aksi di kanan judul, misalnya tombol "Buat aduan". */
  actions?: ReactNode;
  children: ReactNode;
};

export function DashboardShell({ role, title, subtitle, actions, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Tetap keluar walau permintaan gagal: cookie mungkin sudah tidak ada.
      window.location.href = "/login";
    }
  }

  const logoutLabel = loggingOut ? "Keluar..." : "Logout";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/*
        Sidebar desktop. `fixed` dengan `inset-y-0` dipilih supaya area konten
        tidak ikut bergeser saat halaman bertambah panjang; lebar konten dijaga
        oleh padding kiri di bawah, bukan oleh margin elemen di dalamnya.
      */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-800/80 bg-slate-950 lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-800/80 px-5">
          <span className="grid size-9 place-items-center rounded-xl bg-cyan-500/10 text-cyan-300 ring-1 ring-inset ring-cyan-500/25">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <Link
              href="/"
              className="block truncate text-xs font-semibold tracking-[0.22em] text-cyan-400 uppercase"
            >
              TRIASE-Net
            </Link>
            <span
              className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ROLE_TONE[role]}`}
            >
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>

        <nav aria-label="Navigasi utama" className="flex-1 space-y-1 overflow-y-auto p-3">
          <NavLinks role={role} pathname={pathname} />
        </nav>

        <div className="border-t border-slate-800/80 p-3">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-60"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            {logoutLabel}
          </button>
        </div>
      </aside>

      {/* Bilah atas khusus layar kecil; sidebar disembunyikan oleh `lg:hidden`. */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl lg:hidden">
        <Disclosure as="div" className="px-4 py-3">
          {({ open }) => (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-500/10 text-cyan-300 ring-1 ring-inset ring-cyan-500/25">
                    <ShieldCheck className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold tracking-[0.22em] text-cyan-400 uppercase">
                      TRIASE-Net
                    </div>
                    <div className="truncate text-sm text-slate-400">{ROLE_LABEL[role]}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
                  >
                    <LogOut className="size-4" aria-hidden />
                    <span className="hidden sm:inline">{logoutLabel}</span>
                  </button>
                  <DisclosureButton
                    aria-label={open ? "Tutup navigasi" : "Buka navigasi"}
                    className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-cyan-500/60 hover:text-white"
                  >
                    {open ? <X className="size-5" /> : <Menu className="size-5" />}
                  </DisclosureButton>
                </div>
              </div>

              <DisclosurePanel className="pt-3">
                <nav aria-label="Navigasi seluler" className="grid gap-1 border-t border-slate-800 pt-3">
                  <NavLinks role={role} pathname={pathname} onNavigate={() => undefined} />
                </nav>
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      </header>

      <div className="lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
              {subtitle ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{subtitle}</p>
              ) : null}
            </div>

            {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
          </header>

          {children}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 sm:px-6 lg:px-8">
          <Link href={getRoleHomePath(role)} className="hover:text-slate-300">
            TRIASE-Net
          </Link>
          <span className="mx-2" aria-hidden>
            &middot;
          </span>
          Seluruh isi aduan disimpan terenkripsi dan tidak dapat dibaca tanpa
          melewati pemeriksaan akses yang tercatat di audit.
        </footer>
      </div>
    </div>
  );
}