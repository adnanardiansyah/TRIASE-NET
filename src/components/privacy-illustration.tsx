import { Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";

export function PrivacyIllustration() {
  return <div className="landing-privacy-visual" aria-label="Perlindungan berlapis: identitas disamarkan, akses sesuai kewenangan, dan audit tercatat">
    <div className="landing-privacy-header"><span className="landing-small-label">Privasi dalam setiap proses</span><ShieldCheck size={18} /></div>
    <div className="landing-privacy-diagram" aria-hidden="true"><span className="landing-privacy-ring" /><span className="landing-privacy-ring landing-privacy-ring-inner" /><div className="landing-privacy-shield"><Fingerprint size={42} strokeWidth={1.2} /></div><span className="landing-privacy-tag landing-privacy-tag-one"><LockKeyhole size={13} />Enkripsi</span><span className="landing-privacy-tag landing-privacy-tag-two"><ShieldCheck size={13} />Kewenangan</span></div>
    <div className="landing-privacy-bottom"><span>Identitas pada tiket</span><strong><Fingerprint size={14} />Pseudonim</strong></div>
  </div>;
}
