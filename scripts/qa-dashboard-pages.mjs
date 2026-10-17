// Local production QA using an already running Chromium DevTools endpoint.
// No browser/test dependencies or authenticated application data are required.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { issueSessionToken } from "../src/lib/auth/jwt.ts";

const origin = process.env.QA_ORIGIN ?? "http://localhost:3104";
const debug = process.env.QA_BROWSER ?? "http://127.0.0.1:9229";
const label = process.argv[2] ?? "pages";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid artifact label");
const output = resolve("artifacts/dashboard-pages-qa");
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

// UI-only fixtures: API responses intercepted inside the browser. No database calls.
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("QA must use a local server");
const results = [];
const fixtureRows = Array.from({length: 12}, (_, index) => ({ ticketId: `TRX-2026-TEST00${String(index).padStart(2,"0")}`, subject: `Aduan uji tampilan ${index + 1}`, pseudonym: `PS-UI-${index + 1}`, category: index % 2 ? "AKADEMIK" : "FASILITAS", status: index % 3 ? "DALAM_PENANGANAN" : "DITERIMA", riskBand: index % 2 ? "LOW" : "HIGH", createdAt: new Date(Date.now() - index * 3600000).toISOString(), updatedAt: new Date().toISOString(), rowVersion: 1 }));
async function setup(page, role) {
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Network.enable');
  await page.send('Network.deleteCookies', {name:'triase-session',url:origin});
  const fixture = structuredClone(fixtureRows).map((ticket,index)=>({...ticket,status:['DITERIMA','DALAM_PENANGANAN','MENUNGGU_TINDAK_LANJUT','SELESAI'][index%4],createdAt:new Date(Date.now()-index*3*86400000).toISOString()}));
  page.ws.addEventListener('message', async ({data}) => {
    const message = JSON.parse(data);
    if(message.method !== 'Fetch.requestPaused') return;
    const {requestId,request} = message.params;
    const path = new URL(request.url).pathname;
    let body = {ok:true};
    if(path === '/api/auth/me') body = {name:'Pengguna Uji UI',role,profile:null};
    else if(path === '/api/aduan') body = page.forceError ? {message:'Petugas tidak sedang bertugas atau mandat sudah berakhir.'} : {ok:true,items:fixture};
    else if(path.startsWith('/api/aduan/') && request.method === 'PATCH') {
      const ticket = fixture.find(t=>t.ticketId === path.split('/').pop());
      if(ticket) { Object.assign(ticket,{status:JSON.parse(request.postData).status,updatedAt:new Date().toISOString(),rowVersion:2}); body = {ok:true,...ticket}; }
    }
    else if(path === '/api/notifications') body = {items:[]};
    else if(path === '/api/auth') body = {ok:true,mfaRequired:true,challengeId:'ui-fixture-challenge'};
    else if(path === '/api/ztna/context') body = {};
    else throw new Error(`Unexpected API ${path}`);
    await page.send('Fetch.fulfillRequest',{requestId,responseCode:path==='/api/aduan' && page.forceError ? 403 : 200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}).catch(error => { if (!error.message.includes('Invalid InterceptionId')) throw error; });
  });
  await page.send('Fetch.enable',{patterns:[{urlPattern:`${origin}/api/*`,requestStage:'Request'}]});
  if(role) {
    const token = issueSessionToken({sub:'ui-test-only',role,userId:'00000000-0000-4000-8000-000000000001'},10);
    await page.send('Network.setCookie',{name:'triase-session',value:token,url:origin,httpOnly:true,sameSite:'Lax'});
  }
}
const failures = [];
function check(value, label) { if(!value) failures.push(label); }
async function ready(page, section) {
  for(let i=0;i<150;i++) {
    if(await page.evaluate(`document.querySelector('[data-dashboard-section="${section}"]') && !document.querySelector('[aria-busy="true"]')`)) {await wait(150); return;}
    await wait(100);
  }
  await page.screenshot('not-ready'); process.stdout.write(JSON.stringify({browserErrors:page.errors})+'\n'); process.stdout.write(JSON.stringify(await page.evaluate(`({path:location.pathname,hash:location.hash,section:document.querySelector('[data-dashboard-section]')?.dataset.dashboardSection,busy:[...document.querySelectorAll('[aria-busy=true]')].map(n=>n.className),errors:document.querySelector('[role=alert]')?.textContent})`))+'\n'); throw new Error(`Not ready: ${section}`);
}
for(const role of (process.env.QA_ROLE ? [process.env.QA_ROLE] : ['MAHASISWA','SATGAS','ADMIN'])) for(const width of (process.env.QA_WIDTH ? [Number(process.env.QA_WIDTH)] : [1440,390,320])) {
  const page=await Page.open();
  const base=role==='MAHASISWA'?'/mahasiswa':role==='SATGAS'?'/satgas':'/admin';
  const prefix=`${role}-${width}`;
  const checks={};
  try {
    await setup(page,role);
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__shared=text;}}});const originalCreateObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blob.text().then(text=>window.__csv=text);return originalCreateObjectURL(blob);};`});
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await page.navigate(origin+base); await ready(page,'overview');
    checks.overview=await page.evaluate(`!!document.querySelector('.dashboard-overview-grid') && !document.querySelector('.ticket-table') && !document.querySelector('.dashboard-analytics-page') && document.querySelectorAll('.dashboard-metric-link').length===4`);
    await page.screenshot(`${role.toLowerCase()}-overview-${width}`);
    // Follow the actual sidebar link, including closing the mobile drawer.
    if(width<1024) {await page.evaluate(`document.querySelector('button[aria-label="Buka navigasi"]').click()`); await wait(100);}
    await page.evaluate(`(() => {const a=[...document.querySelectorAll('.workspace-nav-link')].find(a=>a.getAttribute('href')==='${base}/aduan' && a.getClientRects().length);a.click();})()`);
    await ready(page,'tickets');
    checks.navigation=await page.evaluate(`location.pathname==='${base}/aduan' && [...document.querySelectorAll('aside .workspace-nav-link[aria-current="page"]')].length===1 && !document.querySelector('.dashboard-welcome') && !document.querySelector('.dashboard-analytics-page') && !document.querySelector('[role="dialog"]')`);
    checks.initialRows=await page.evaluate(`document.querySelectorAll('.ticket-table tbody tr').length===8`);
    await page.evaluate(`document.querySelector('button[aria-label="Halaman berikutnya"]').click()`); await wait(100);
    checks.pagination=await page.evaluate(`document.querySelectorAll('.ticket-table tbody tr').length===4`);
    await page.evaluate(`document.querySelector('button[aria-label="Halaman sebelumnya"]').click()`);
    await page.evaluate(`(()=>{const n=document.querySelector('input[placeholder^="Cari nomor"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'TEST0000');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(100);
    checks.search=await page.evaluate(`document.querySelectorAll('.ticket-table tbody tr').length===1 && !location.search.includes('TEST0000')`);
    await page.evaluate(`document.querySelector('button[aria-label="Hapus filter"]').click()`); await wait(100);
    await page.evaluate(`document.querySelector('.dashboard-view-toggle button:last-child').click()`);await wait(100);
    checks.cards=await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===8`);
    await page.evaluate(`document.querySelector('button[aria-controls="ticket-filters"]').click()`);await wait(100);
    await page.evaluate(`(()=>{const n=document.querySelector('#ticket-filters select');n.value='DITERIMA';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);
    checks.filter=await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===3`);
    await page.evaluate(`document.querySelector('.dashboard-list-tools > button').click()`);await wait(100);
    checks.share=await page.evaluate(`new URL(window.__shared).pathname==='${base}/aduan' && !new URL(window.__shared).hash && new URL(window.__shared).searchParams.get('status')==='DITERIMA'`);
    if(role!=='MAHASISWA') {
      await page.send('Browser.setDownloadBehavior',{behavior:'deny'});
      await page.evaluate(`([...document.querySelectorAll('button')].find(n=>n.textContent.includes('Ekspor CSV'))).click()`);await wait(100);
      checks.csv=await page.evaluate(`window.__csv.split('\\r\\n').length===4 && !window.__csv.includes('PS-UI-')`);
    }
    await page.screenshot(`${role.toLowerCase()}-tickets-${width}`);
    if(role!=='MAHASISWA') {
      await page.evaluate(`(()=>{const n=document.querySelector('.dashboard-ticket-card select');n.value=n.options[1].value;n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(200);
      checks.status=await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===2 && !!document.querySelector('[role="status"]')`);
    } else checks.status=await page.evaluate(`!document.querySelector('.dashboard-ticket-card select')`);
    await page.navigate(origin+base+'/analitik');await ready(page,'analytics');
    checks.analytics=await page.evaluate(`!!document.querySelector('.dashboard-analytics-page') && !document.querySelector('.ticket-table') && !document.querySelector('.dashboard-welcome') && document.querySelectorAll('.dashboard-chart-column').length===7`);
    await page.evaluate(`(()=>{const n=document.getElementById('analysis-period');n.value='30';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(150);
    checks.range=await page.evaluate(`document.querySelectorAll('.dashboard-chart-column').length===30 && document.querySelector('.dashboard-analysis-note').textContent.startsWith('10 aduan')`);
    await page.evaluate(`(()=>{const n=document.getElementById('analysis-category');n.value='FASILITAS';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(150);
    checks.category=await page.evaluate(`document.querySelector('.dashboard-analysis-note').textContent.startsWith('5 aduan')`);
    await page.screenshot(`${role.toLowerCase()}-analytics-${width}`);
    const drill=await page.evaluate(`document.querySelector('.dashboard-analysis-controls > a').getAttribute('href')`);
    await page.evaluate(`document.querySelector('.dashboard-analysis-controls > a').click()`);await ready(page,'tickets');
    checks.drill=await page.evaluate(`location.pathname==='${base}/aduan' && new URLSearchParams(location.search).get('category')==='FASILITAS' && document.querySelectorAll('.ticket-table tbody tr').length===5`);
    checks.drillUrl=drill.includes('period=30') && drill.includes('category=FASILITAS');
    await page.navigate(origin+base+'/analitik?period=90');await ready(page,'analytics');
    checks.ninety=await page.evaluate(`document.querySelectorAll('.dashboard-chart-column').length===90 && document.documentElement.scrollWidth<=innerWidth`);
    await page.evaluate(`document.querySelector('.dashboard-analysis-controls button').click()`);await wait(150);
    checks.reset=await page.evaluate(`!location.search && document.querySelectorAll('.dashboard-chart-column').length===7`);
    await page.navigate(origin+base+'#analitik');await wait(600);await ready(page,'analytics');
    checks.legacy=await page.evaluate(`location.pathname==='${base}/analitik'`);
    checks.overflow=await page.evaluate(`document.documentElement.scrollWidth<=innerWidth`);
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(100);
    checks.reduced=await page.evaluate(`getComputedStyle(document.querySelector('.metric')).animationName==='none'`);
    for(const [name,value] of Object.entries(checks))check(value,`${prefix}: ${name}`);
    check(!page.errors.length,`${prefix}: browser errors`);
    results.push({role,width,checks,errors:page.errors}); await writeFile(resolve(output,`${label}-results.json`),JSON.stringify({results,failures},null,2));
  } finally { await page.close(); }
}
// A forbidden data response must not appear as successful zero metrics.
{
 const page=await Page.open();
 try {
  await setup(page,'ADMIN');page.forceError=true;
  await page.navigate(origin+'/admin');await wait(600);
  const rejected=await page.evaluate(`!!document.querySelector('[role="alert"]') && !document.querySelector('.dashboard-metrics')`);
  check(rejected,'access denied is not empty data');
  page.forceError=false;
  await page.evaluate(`document.querySelector('[role="alert"] button').click()`);await ready(page,'overview');
  check(await page.evaluate(`!!document.querySelector('.dashboard-metrics') && !document.querySelector('[role="alert"]')`),'retry recovers data');
 }finally{await page.close();}
}
const protections=[];
for(const base of ['/mahasiswa','/satgas','/admin'])for(const suffix of ['/aduan','/analitik']){
 const response=await fetch(origin+base+suffix,{redirect:'manual'});
 const protectedRoute=response.status===307 && new URL(response.headers.get('location'),origin).pathname==='/login';
 check(protectedRoute,`${base+suffix}: unauthenticated route`);protections.push({path:base+suffix,status:response.status,protected:protectedRoute});
}
await writeFile(resolve(output,`${label}-results.json`),JSON.stringify({mode:'UI fixtures; API intercepted; no database writes',results,protections,failures},null,2));
process.stdout.write(JSON.stringify({cases:results.length,protectedRoutes:protections.length,failures},null,2)+'\n');
if(failures.length)process.exitCode=1;
