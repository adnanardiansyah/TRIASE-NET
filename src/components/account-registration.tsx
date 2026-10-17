"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";
import { Brand } from "./brand";
import { Reveal } from "./reveal";
export function AccountRegistration({ verify = false }: { verify?: boolean }) {
 const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");
 const [token,setToken]=useState("");const [invite,setInvite]=useState(false);const [resend,setResend]=useState(false);
 const [pending,setPending]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
 const fragmentRead = useRef(false);
 useEffect(()=>{if(verify){if(fragmentRead.current)return;fragmentRead.current=true;const p=new URLSearchParams(window.location.hash.slice(1));setToken(p.get("token")??"");setInvite(p.get("kind")==="invite");window.history.replaceState(window.history.state,"",window.location.pathname);}else setResend(new URLSearchParams(window.location.search).get("mode")==="resend");},[verify]);
 async function submit(event:FormEvent){event.preventDefault();if(pending)return;setError("");
  if((!verify&&!resend||invite)&&password!==confirm){setError("Konfirmasi password belum sama.");return;}
  setPending(true);
  try{const path=verify?"verify":resend?"resend":"register";const body=verify?{token,...(invite?{password}:{})}:resend?{email}:{email,password};
   const r=await fetch(`/api/auth/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.message??"Permintaan belum berhasil.");setMessage(data.message);setPassword("");setConfirm("");
  }catch(e){setError(e instanceof Error?e.message:"Tidak dapat menghubungi layanan.");}finally{setPending(false);}
 }
 return <main className="premium-login min-h-svh px-5 py-8"><div className="mx-auto max-w-[1100px]"><Brand /><Reveal trigger="mount" distance={18} duration={0.6} className="login-form-card mx-auto mt-10 w-full max-w-[480px] p-8"><span className="mb-6 inline-grid size-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Mail size={23}/></span><h1>{verify?invite?"Aktifkan akun petugas":"Verifikasi email Anda":resend?"Kirim ulang verifikasi":"Daftar akun mahasiswa"}</h1><p className="mt-3 mb-6 text-sm leading-7 text-zinc-500">{verify?"Konfirmasikan aktivasi akun Anda. Setelah berhasil, masuk melalui halaman login.":"Gunakan email milik Anda. Verifikasi dilakukan sekali; login mahasiswa berikutnya cukup email dan password."}</p>
 {message?<div role="status" className="space-y-5 text-sm leading-7 text-emerald-900"><CheckCircle2 size={30}/><p>{message}</p><Link href="/login" className="ui-btn ui-btn-primary">Ke halaman login<ArrowRight size={15}/></Link></div>:<form onSubmit={submit} className="space-y-5">{error&&<p role="alert" className="ui-alert">{error}</p>}
 {!verify&&<div><label htmlFor="register-email" className="ui-label">Email</label><input id="register-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={pending} className="ui-input"/></div>}
 {(!verify&&!resend||invite)&&<><div><label htmlFor="register-password" className="ui-label">Password (minimal 12 karakter)</label><input id="register-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} disabled={pending} className="ui-input"/></div><div><label htmlFor="register-confirm" className="ui-label">Ulangi password</label><input id="register-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={pending} className="ui-input"/></div></>}
 {verify&&!token?<p role="alert" className="ui-alert">Tautan verifikasi tidak lengkap. Buka tautan dari email atau minta tautan baru.</p>:<button disabled={pending} className="ui-btn ui-btn-primary w-full">{pending&&<Loader2 size={16} className="animate-spin"/>}{pending?"Memproses...":verify?"Verifikasi & aktifkan akun":resend?"Kirim ulang tautan":"Daftar & kirim verifikasi"}<ArrowRight size={15}/></button>}
 {!verify&&<button type="button" onClick={()=>{setResend(!resend);setError("");}} className="text-xs text-emerald-700">{resend?"Kembali ke pendaftaran":"Sudah daftar? Kirim ulang email verifikasi"}</button>}
 </form>}<Link href="/login" className="mt-7 inline-flex min-h-11 items-center gap-2 text-xs text-zinc-500"><ArrowLeft size={14}/>Kembali ke login</Link></Reveal></div></main>;
}
