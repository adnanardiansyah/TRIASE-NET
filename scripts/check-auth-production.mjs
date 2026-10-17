// Configuration-only preflight. Does not connect, send email, or print values.
const errors=[];const requireValue=(name,test)=>{if(!test(process.env[name]??""))errors.push(name);};
for(const name of ["JWT_SIGNING_SECRET","CRON_SECRET"])requireValue(name,v=>v.length>=32&&!/CHANGE_ME|example|test-secret/i.test(v));
for(const name of ["AUTH_ENCRYPTION_KEY_BASE64","KEK_MASTER_BASE64","PSEUDONYM_HMAC_KEY_BASE64"])requireValue(name,v=>Buffer.from(v,"base64").length===32&&Buffer.from(v,"base64").toString("base64")===v);
for(const name of ["JWT_ISSUER","JWT_AUDIENCE","SMTP_HOST","MAIL_FROM"])requireValue(name,v=>!!v&&!/[\r\n]/.test(v));
requireValue("NEXT_PUBLIC_APP_URL",v=>{try{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password&&u.pathname==="/"&&!u.search&&!u.hash;}catch{return false;}});
requireValue("DATABASE_URL",v=>{try{const u=new URL(v);return ["postgres:","postgresql:"].includes(u.protocol)&&(process.env.DATABASE_SSL==="true"||["require","verify-full"].includes(u.searchParams.get("sslmode")));}catch{return false;}});
requireValue("AUTH_TRUST_PROXY",v=>["vercel","forwarded"].includes(v));
if(process.env.AUTH_TRUST_PROXY==="vercel"&&process.env.VERCEL!=="1")errors.push("VERCEL");
if(!!process.env.SMTP_USER!==!!process.env.SMTP_PASSWORD)errors.push("SMTP_USER/SMTP_PASSWORD");
const port=Number(process.env.SMTP_PORT??587);if(![465,587].includes(port))errors.push("SMTP_PORT (review required)");
if(process.env.CRON_SECRET===process.env.JWT_SIGNING_SECRET)errors.push("CRON_SECRET (must be independent)");
if(process.env.VERCEL==="1"&&(process.env.DATABASE_ADMIN_URL||process.env.DATABASE_MIGRATION_URL))errors.push("PRIVILEGED_DATABASE_URL_IN_RUNTIME");
if(errors.length){console.error("Production preflight requires configuration:",errors.join(", "));process.exitCode=1;}else{process.stdout.write("PASS: configuration shape. Still verify TLS, provider secrets, scheduler, delivery, DB roles and load in staging.\n");}
