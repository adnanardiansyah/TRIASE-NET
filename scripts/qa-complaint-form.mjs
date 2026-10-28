// Local production QA using an already running Chromium DevTools endpoint.
// No browser/test dependencies or authenticated application data are required.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { issueSessionToken } from "../src/lib/auth/jwt.ts";

const origin = process.env.QA_ORIGIN ?? "http://localhost:3110";
const debug = process.env.QA_BROWSER ?? "http://127.0.0.1:9231";
const label = process.argv[2] ?? "form";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid artifact label");
const output = resolve("artifacts/complaint-form-qa");
await mkdir(output, { recursive: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

class Page {
  static async open() {
    const target = await (await fetch(`${debug}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", fail, { once: true }); });
    return new Page(ws, target.id);
  }
  constructor(ws, id) {
    this.ws = ws; this.id = id; this.next = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const call = this.pending.get(message.id); if (!call) return;
        clearTimeout(call.timer); this.pending.delete(message.id);
        if (message.error) call.reject(new Error(JSON.stringify(message.error))); else call.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") this.errors.push(message.params.entry.text);
      else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") this.errors.push(message.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    });
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20_000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async navigate(url) {
    await this.send("Page.navigate", { url });
    for (let attempt = 0; attempt < 50; attempt++) {
      await wait(100);
      if (await this.evaluate("document.readyState === 'complete' && !!document.querySelector('.premium-login, .premium-workspace')")) return;
    }
    throw new Error("Landing did not load");
  }
  async settleScroll() {
    let previous = -1; let stable = 0;
    for (let attempt = 0; attempt < 35 && stable < 4; attempt++) {
      await wait(100); const y = await this.evaluate("window.scrollY");
      stable = Math.abs(y - previous) < 1 ? stable + 1 : 0; previous = y;
    }
  }
  async screenshot(name, clip) {
    const shot = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(clip), ...(clip ? { clip } : {}) });
    await writeFile(resolve(output, `${label}-${name}.png`), Buffer.from(shot.data, "base64"));
  }
  async key(key, code, windowsVirtualKeyCode) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : key === " " ? { text: " " } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  }
  async close() { this.ws.close(); await fetch(`${debug}/json/close/${this.id}`); }
}


// UI fixtures only: every browser API request is intercepted. Database access
// and protected downloads are tested separately in the integration suite.
for (const endpoint of [origin, debug]) {
 if (!["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)) throw new Error("QA only accepts local endpoints");
}
await writeFile(resolve(output, 'evidence.pdf'), '%PDF-1.7\nSynthetic UI evidence');
const oversized = Buffer.alloc(1024 * 1024 + 1); oversized.write('%PDF-');
await writeFile(resolve(output, 'too-large.pdf'), oversized);
const results=[]; const failures=[];
const check=(value,label)=>{if(!value)failures.push(label)};
const pdf=resolve('artifacts/complaint-form-qa/evidence.pdf');
async function setValue(page,selector,value){
 await page.evaluate('(()=>{const n=document.querySelector('+JSON.stringify(selector)+');if(!n)throw new Error("Field not found on "+location.pathname);const proto=n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(n,'+JSON.stringify(value)+');n.dispatchEvent(new Event(n instanceof HTMLSelectElement?"change":"input",{bubbles:true}));})()');await wait(80);
}
async function button(page,text){await page.evaluate('(()=>{const button=[...document.querySelectorAll("button")].find(n=>n.textContent.trim()==='+JSON.stringify(text)+');if(!button)throw new Error("Missing button");button.click()})()');await wait(150);}
async function file(page,path){const doc=await page.send('DOM.getDocument');const found=await page.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#complaint-evidence'});await page.send('DOM.setFileInputFiles',{nodeId:found.nodeId,files:[path]});await wait(300);}
for(const width of [1440,768,390]){
 const page=await Page.open(); const posts=[];let forceFailure=true;
 try{
  await page.send('Page.enable');await page.send('Runtime.enable');await page.send('Log.enable');await page.send('Network.enable');
  page.ws.addEventListener('message',async({data})=>{const message=JSON.parse(data);if(message.method!=='Fetch.requestPaused')return;const {requestId,request}=message.params;const path=new URL(request.url).pathname;let body={ok:true},status=200;
   if(path==='/api/auth/me')body={name:'Mahasiswa Uji UI',role:'MAHASISWA',profile:null};
   else if(path==='/api/notifications')body={ok:true,items:[]};
   else if(path==='/api/aduan'&&request.method==='POST'){posts.push(JSON.parse(request.postData));if(forceFailure){forceFailure=false;status=503;body={ok:false,message:'Uji layanan sibuk. Coba kembali.'}}else body={ok:true,ticketId:'TRX-2026-0000BEEF',pseudonym:'PS-UI-ONLY',riskBand:'HIGH'};}
   else if(path==='/api/aduan')body={ok:true,items:[]};
   else body={};
   await page.send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  });
  await page.send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/*',requestStage:'Request'}]});
  const token=issueSessionToken({sub:'ui-test-only',role:'MAHASISWA',authVersion:1,authMethod:'PASSWORD',userId:'00000000-0000-4000-8000-000000000001'},10);
  await page.send('Network.setCookie',{name:'triase-session',value:token,url:origin,httpOnly:true,sameSite:'Lax'});
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.__copied=text;}}});'});
  await page.navigate(origin+'/aduan/baru?category=PERUNDUNGAN');await wait(800);
  check(await page.evaluate('document.getElementById("complaint-category")?.value==="PERUNDUNGAN"'),'category query '+width);
  await setValue(page,'#complaint-subject','Laporan uji terstruktur');await setValue(page,'#complaint-body','Kronologi sintetis untuk pengujian tampilan.');
  await button(page,'Periksa laporan');
  check(posts.length===0,'review must not submit '+width);
  check(await page.evaluate('document.activeElement.textContent.includes("Apakah laporan")'),'review focus '+width);
  await button(page,'Kembali mengubah');
  check(await page.evaluate('document.getElementById("complaint-body").value.includes("Kronologi sintetis")'),'back preserves chronology '+width);
  await setValue(page,'#complaint-involvement','OTHER');await setValue(page,'#complaint-affected','Pihak uji');await setValue(page,'#complaint-relationship','Teman sekelas');await setValue(page,'#complaint-reported','Ciri pihak terlapor uji');await setValue(page,'#complaint-witnesses','Saksi uji');
  await setValue(page,'#complaint-time-precision','APPROXIMATE');await setValue(page,'#complaint-occurred-at','2026-01-01T10:00');await setValue(page,'#complaint-location','Ruang kelas uji');await setValue(page,'#complaint-outcome','Tindak lanjut yang sesuai.');
  await file(page,pdf);
  check(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'form overflow '+width);
  await page.screenshot('form-'+width);
  await page.evaluate('document.getElementById("complaint-involvement").scrollIntoView({behavior:"instant",block:"center"})');await page.screenshot('parties-'+width);
  await file(page,resolve('artifacts/complaint-form-qa/too-large.pdf'));
  check(await page.evaluate('document.querySelector("[role=alert]")?.textContent.includes("1 MB")'),'file size rejection '+width);
  await button(page,'Periksa laporan');
  check(await page.evaluate('document.body.textContent.includes("Pihak uji")&&document.body.textContent.includes("evidence.pdf")&&document.body.textContent.includes("10.00")'),'structured review '+width);
  check(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'review overflow '+width);
  await page.screenshot('review-'+width);
  await button(page,'Kembali mengubah');await setValue(page,'#complaint-category','TEKNOLOGI');
  check(await page.evaluate('!document.getElementById("complaint-involvement")&&!!document.getElementById("complaint-system")'),'conditional fields '+width);
  await setValue(page,'#complaint-system','Portal uji');await setValue(page,'#complaint-error','Pesan error uji');await setValue(page,'#complaint-time-precision','UNKNOWN');
  await button(page,'Periksa laporan');
  check(await page.evaluate('!document.body.textContent.includes("Ciri pihak terlapor uji")&&document.body.textContent.includes("Portal uji")'),'hidden data omitted from review '+width);
  await button(page,'Kirim aduan');
  check(await page.evaluate('!!document.querySelector("[role=alert]")&&document.body.textContent.includes("Apakah laporan")'),'submission failure preserves review '+width);
  await button(page,'Kirim aduan');await wait(300);
  check(posts.length===2&&posts.every(p=>p.attachments.length===1&&p.details.systemName==='Portal uji'&&!p.details.reportedParty&&!p.details.affectedPerson),'submitted payload '+width);
  check(await page.evaluate('document.body.textContent.includes("Aduan Anda sudah diterima")&&document.activeElement.textContent.includes("Aduan Anda sudah diterima")'),'receipt and focus '+width);
  await page.evaluate('Array.from(document.querySelectorAll("button")).find(n=>n.getAttribute("aria-label")==="Salin nomor tiket").click()');await wait(100);
  check(await page.evaluate('window.__copied==="TRX-2026-0000BEEF"'),'copy ticket '+width);
  const overflow=await page.evaluate('document.documentElement.scrollWidth>innerWidth');check(!overflow,'receipt overflow '+width);
  results.push({width,posts:posts.map(p=>({category:p.category,details:p.details,attachmentCount:p.attachments.length})),errors:page.errors,overflow});
  check(!page.errors.filter(e=>!e.includes('503')).length,'browser errors '+width);
  process.stdout.write('Completed '+width+'px; posts='+posts.length+'; errors='+page.errors.length+'\n');
 }finally{await page.close()}
}
await writeFile(resolve(output,'form-results.json'),JSON.stringify({mode:'UI fixtures; APIs intercepted; not live authentication/database testing',results,failures},null,2));process.stdout.write(JSON.stringify({cases:results.length,failures})+'\n');if(failures.length)process.exitCode=1;
