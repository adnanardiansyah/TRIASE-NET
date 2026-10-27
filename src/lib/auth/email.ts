import "server-only";
import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { ApiError } from "@/lib/api/errors";
import { mailFailure, mailProgress, smtpPhase } from "./mail-diagnostics";
export type AccountMailPurpose="verify"|"invite"|"reset";
export function mailConfiguration() {
 const host=process.env.SMTP_HOST?.trim(),from=process.env.MAIL_FROM?.trim(),origin=process.env.NEXT_PUBLIC_APP_URL;
 if(!host||!from||!origin) throw new ApiError(503,"Pengiriman email belum dikonfigurasi. Hubungi pengelola aplikasi.","MAIL_NOT_CONFIGURED");
 let url:URL;try{url=new URL(origin);}catch{throw new ApiError(503,"Konfigurasi alamat aplikasi tidak valid.");}
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=="/"||(/[\r\n]/.test(host+from))) throw new ApiError(503,"Konfigurasi email tidak valid.");
 if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname)) throw new ApiError(503,"Alamat aplikasi harus menggunakan HTTPS.");
 const port=Number(process.env.SMTP_PORT??587),secure=port===465;
 if(host.toLowerCase()==="smtp.resend.com" && (port!==465 || process.env.SMTP_USER!=="resend" || !process.env.SMTP_PASSWORD)) throw new ApiError(503,"Konfigurasi SMTP tidak valid.");
 if(!Number.isInteger(port)||port<1||port>65535)throw new ApiError(503,"Konfigurasi SMTP tidak valid.");
 if(!!process.env.SMTP_USER!==!!process.env.SMTP_PASSWORD)throw new ApiError(503,"Konfigurasi autentikasi SMTP tidak lengkap.");
 return {host,from,origin:url.origin,port,secure};
}
export async function sendAccountEmail(email:string,rawToken:string,purpose:AccountMailPurpose){
 let config:ReturnType<typeof mailConfiguration>;
 try {config=mailConfiguration();} catch {mailFailure("SMTP_CONFIG_FAILED");throw new ApiError(503,"Pengiriman email belum dikonfigurasi.","MAIL_NOT_CONFIGURED");}
 let dnsDeadline:ReturnType<typeof setTimeout>|undefined;
 let address:string;
 try{address=(await Promise.race([lookup(config.host),new Promise<never>((_resolve,reject)=>{dnsDeadline=setTimeout(()=>reject(Object.assign(new Error("DNS deadline"),{code:"ETIMEDOUT"})),5000);})])).address;}
 catch(error){mailFailure("SMTP_DNS_FAILED",error);throw new ApiError(503,"Alamat server email belum dapat dihubungi. Coba kembali nanti.","MAIL_DELIVERY_FAILED");}
 finally{if(dnsDeadline)clearTimeout(dnsDeadline);}
 // Resolve through the OS resolver, while validating the certificate against the original hostname.
 let transport:ReturnType<typeof nodemailer.createTransport>;
 try {transport=nodemailer.createTransport({host:address,port:config.port,secure:config.secure,requireTLS:!config.secure,tls:{rejectUnauthorized:true,servername:config.host},auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:5000,greetingTimeout:5000,dnsTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});} catch {mailFailure("SMTP_CONFIG_FAILED");throw new ApiError(503,"Konfigurasi SMTP tidak valid.","MAIL_NOT_CONFIGURED");}
 const path=purpose==="reset"?"reset-password":"verifikasi";
 const link=`${config.origin}/${path}#token=${rawToken}&kind=${purpose}`;
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try {
  const result=await Promise.race([transport.sendMail({from:config.from,to:email,subject:purpose==="invite"?"Aktifkan akun petugas TRIASE-Net":purpose==="reset"?"Pemulihan password TRIASE-Net":"Verifikasi email TRIASE-Net",text:`Buka tautan berikut untuk ${purpose==="invite"?"membuat password dan mengaktifkan akun petugas":purpose==="reset"?"mengganti password Anda":"memverifikasi email"}:\n\n${link}\n\nTautan berlaku 30 menit dan hanya dapat dipakai sekali. Jika Anda tidak meminta ini, abaikan email ini.`}),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>{transport.close();reject(Object.assign(new Error("SMTP deadline"),{code:"ETIMEDOUT"}));},12000);})]);
  if(!result.accepted.length)throw Object.assign(new Error("Mail rejected"),{code:"EENVELOPE"});
  mailProgress("smtp_accepted");
 }catch(error){mailFailure(smtpPhase(error),error);throw new ApiError(503,"Email belum berhasil dikirim. Coba kembali setelah layanan email tersedia.","MAIL_DELIVERY_FAILED");}
 finally{if(deadline)clearTimeout(deadline);transport.close();}
}
