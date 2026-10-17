// Local production QA using an already running Chromium DevTools endpoint.
// No browser/test dependencies or authenticated application data are required.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { issueSessionToken } from "../src/lib/auth/jwt.ts";

const origin = process.env.QA_ORIGIN ?? "http://localhost:3103";
const debug = process.env.QA_BROWSER ?? "http://127.0.0.1:9228";
const label = process.argv[2] ?? "workspace";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid artifact label");
const output = resolve("artifacts/workspace-qa");
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
  const fixture = structuredClone(fixtureRows);
  page.ws.addEventListener('message', async ({data}) => {
    const message = JSON.parse(data);
    if(message.method !== 'Fetch.requestPaused') return;
    const {requestId,request} = message.params;
    const path = new URL(request.url).pathname;
    let body = {ok:true};
    if(path === '/api/auth/me') body = {name:'Pengguna Uji UI',role,profile:null};
    else if(path === '/api/aduan') body = {ok:true,items:fixture};
    else if(path.startsWith('/api/aduan/') && request.method === 'PATCH') {
      const ticket = fixture.find(t=>t.ticketId === path.split('/').pop());
      if(ticket) { Object.assign(ticket,{status:JSON.parse(request.postData).status,updatedAt:new Date().toISOString(),rowVersion:2}); body = {ok:true,...ticket}; }
    }
    else if(path === '/api/notifications') body = {items:[]};
    else if(path === '/api/auth') body = {ok:true,mfaRequired:true,challengeId:'ui-fixture-challenge'};
    else if(path === '/api/ztna/context') body = {};
    else throw new Error(`Unexpected API ${path}`);
    await page.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}).catch(error => { if (!error.message.includes('Invalid InterceptionId')) throw error; });
  });
  await page.send('Fetch.enable',{patterns:[{urlPattern:`${origin}/api/*`,requestStage:'Request'}]});
  if(role) {
    const token = issueSessionToken({sub:'ui-test-only',role,userId:'00000000-0000-4000-8000-000000000001'},10);
    await page.send('Network.setCookie',{name:'triase-session',value:token,url:origin,httpOnly:true,sameSite:'Lax'});
  }
}
for(const width of (process.env.QA_SMOKE ? [1440] : [1440,390,320])) {
  const page = await Page.open();
  try {
    await setup(page,null); await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await page.navigate(`${origin}/login`); await wait(1000);
    const initial = await page.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,styled:getComputedStyle(document.querySelector('.login-form-card')).borderRadius==='28px',passwordType:document.querySelector('#login-password').type})`);
    await page.screenshot(`login-${width}`);
    await page.evaluate(`document.querySelector('.login-password-toggle').click()`);
    const visible = await page.evaluate(`document.querySelector('#login-password').type==='text'`);
    await page.evaluate(`document.querySelector('#login-password').dispatchEvent(new KeyboardEvent('keydown',{key:'A',modifierCapsLock:true,bubbles:true}))`);
    const capsLock = await page.evaluate(`!!document.getElementById('login-caps-warning')`);
    await page.evaluate(`document.querySelector('form').requestSubmit()`); await wait(250);
    const otp = await page.evaluate(`document.activeElement.id==='login-otp' && !!document.querySelector('#login-otp')`);
    await page.screenshot(`login-mfa-${width}`);
    results.push({kind:'login',width,initial,visible,capsLock,otp,errors:page.errors});
  } finally { await page.close(); }
}
for(const role of (process.env.QA_SMOKE ? ['SATGAS'] : ['MAHASISWA','SATGAS','ADMIN'])) for(const width of (process.env.QA_SMOKE ? [1440] : [1440,390,320])) {
  const page = await Page.open();
  try {
    await setup(page,role); await page.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    const path = role==='MAHASISWA'?'/mahasiswa':role==='SATGAS'?'/satgas':'/admin';
    await page.navigate(origin+path); await wait(1200);
    const initial = await page.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,styled:getComputedStyle(document.querySelector('.dashboard-welcome')).borderRadius!=='0px',rows:document.querySelectorAll('.ticket-table tbody tr').length,shortcuts:document.querySelectorAll('.dashboard-shortcut').length,staffActions:document.querySelectorAll('.ticket-table select').length})`);
    await page.screenshot(`${role.toLowerCase()}-${width}`);
    await page.evaluate(`document.querySelector('.dashboard-view-toggle button:last-child').click()`); await wait(150);
    const cards = await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===8 && new URLSearchParams(location.search).get('view')==='cards'`);
    await page.evaluate(`document.querySelector('button[aria-controls="ticket-filters"]').click()`);
    await page.evaluate(`(() => { const n=document.querySelector('#ticket-filters select'); n.value='DITERIMA'; n.dispatchEvent(new Event('change',{bubbles:true})); })()`); await wait(150);
    const filtered = await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===4 && new URLSearchParams(location.search).get('status')==='DITERIMA'`);
    await page.evaluate(`document.getElementById('aduan').scrollIntoView({behavior:'instant'})`); await wait(600); await page.screenshot(`${role.toLowerCase()}-cards-${width}`);
    await page.evaluate(`document.querySelector('.dashboard-active-filters button').click()`); await wait(100);
    const reset = await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===8 && !new URLSearchParams(location.search).has('status')`);
    await page.evaluate(`document.activeElement?.blur()`); await page.key('/','Slash',191);
    const shortcut = await page.evaluate(`document.activeElement===document.querySelector('input[placeholder^="Cari nomor"]')`);
    await page.evaluate(`document.activeElement.blur(); document.querySelector('.dashboard-list-tools > button').click()`); await wait(100);
    const share = await page.evaluate(`!!document.querySelector('[role="status"]')`);
    await page.navigate(origin+path+'?view=cards&status=DITERIMA'); await wait(500);
    const restore = await page.evaluate(`document.querySelectorAll('.dashboard-ticket-card').length===4 && document.querySelector('.dashboard-view-toggle button:last-child').getAttribute('aria-pressed')==='true'`);
    let statusChange=true;
    if(role!=='MAHASISWA') {
      await page.evaluate(`(() => {const n=document.querySelector('.dashboard-ticket-card select'); n.value=n.options[1].value; n.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(200);
      statusChange = await page.evaluate(`!!document.querySelector('[role="status"]') && document.querySelectorAll('.dashboard-ticket-card').length===3`);
    }
    let navActive=true;
    if(role!=='MAHASISWA' && width>=1024) {
      await page.evaluate(`document.querySelector('aside a[href$="#aduan"]').click()`); await wait(150);
      navActive=await page.evaluate(`document.querySelector('aside a[href$="#aduan"]').getAttribute('aria-current')==='page'`);
    }
    let mobile=true;
    if(width<1024) { await page.evaluate(`document.querySelector('button[aria-label="Buka navigasi"]').click()`); await wait(150); await page.key('Escape','Escape',27); await wait(100); mobile=await page.evaluate(`!document.querySelector('[role="dialog"]')`); }
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await wait(100);
    const reduced = await page.evaluate(`getComputedStyle(document.querySelector('.metric')).animationName==='none'`);
    const overflow = await page.evaluate(`document.documentElement.scrollWidth>innerWidth`);
    results.push({kind:'dashboard',role,width,initial,cards,filtered,reset,shortcut,share,restore,statusChange,navActive,mobile,reduced,overflow,errors:page.errors});
  } finally { await page.close(); }
}
const failures=results.filter(r=>r.initial.overflow || !r.initial.styled || r.errors.length || (r.kind==='login' ? !r.visible || !r.capsLock || !r.otp : r.initial.rows!==8 || r.initial.shortcuts!==3 || !r.cards || !r.filtered || !r.reset || !r.shortcut || !r.share || !r.restore || !r.statusChange || !r.navActive || !r.mobile || !r.reduced || r.overflow));
await writeFile(resolve(output,`${label}-results.json`),JSON.stringify({mode:'UI fixtures; all API calls intercepted; not live authentication/database validation',results,failures},null,2));
process.stdout.write(JSON.stringify({cases:results.length,failures:failures.map(r=>({kind:r.kind,role:r.role,width:r.width}))},null,2)+'\n');
if(failures.length) process.exitCode=1;
