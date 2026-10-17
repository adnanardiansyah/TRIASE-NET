// Local production QA using an already running Chromium DevTools endpoint.
// No browser/test dependencies or authenticated application data are required.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.QA_ORIGIN ?? "http://localhost:3102";
const debug = process.env.QA_BROWSER ?? "http://127.0.0.1:9226";
const label = process.argv[2] ?? "premium";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid artifact label");
const output = resolve("artifacts/landing-qa");
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
      if (await this.evaluate("document.readyState === 'complete' && !!document.querySelector('.landing-page')")) return;
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

const results = [];
for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }, { name: "small-mobile", width: 320, height: 740 }]) {
  const page = await Page.open();
  try {
    await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await page.navigate(origin); await wait(1300);
    const layout = await page.evaluate(`({ styled: getComputedStyle(document.querySelector('.landing-experience-tabs')).display === 'grid' && getComputedStyle(document.querySelector('.landing-experience-shell')).borderRadius === '26px', overflow: document.documentElement.scrollWidth > innerWidth, heroTop: document.querySelector('.landing-hero').getBoundingClientRect().top, headerBottom: document.querySelector('.landing-header').getBoundingClientRect().bottom, titleTop: document.querySelector('.landing-wordmark').getBoundingClientRect().top, categoryCount: document.querySelectorAll('.landing-category').length, roles: document.querySelectorAll('.landing-role-card').length, photoLoaded: document.querySelector('.landing-hero-photo').naturalWidth > 0 })`);
    await page.screenshot(`${viewport.name}-hero`);
    await page.evaluate("document.querySelector('.landing-experience').scrollIntoView({behavior:'instant',block:'start'})"); await wait(900);
    await page.evaluate("document.querySelector('[role=tab]').focus()");
    await page.key('ArrowRight', 'ArrowRight', 39); await wait(100);
    const tabs = await page.evaluate(`({ active: document.activeElement.id, selected: document.querySelector('[role=tab][aria-selected=true]').id, visiblePanels: [...document.querySelectorAll('[role=tabpanel]')].filter(n => !n.hidden).length, panel: document.querySelector('[role=tabpanel]:not([hidden]) h3').textContent })`);
    await page.key('End', 'End', 35);
    const endKey = await page.evaluate("document.activeElement.id === 'experience-tab-2'");
    await page.key('Home', 'Home', 36);
    const homeKey = await page.evaluate("document.activeElement.id === 'experience-tab-0'");
    await page.screenshot(`${viewport.name}-experience`);
    const anchors = [];
    for (const id of ['layanan','alur','privasi','bantuan']) {
      await page.evaluate(`document.querySelector('a[href="#${id}"]').click()`); await page.settleScroll(); await wait(700);
      anchors.push(await page.evaluate(`({ id: '${id}', clearHeader: document.getElementById('${id}').getBoundingClientRect().top >= document.querySelector('.landing-header').getBoundingClientRect().bottom - 1, overflow: document.documentElement.scrollWidth > innerWidth })`));
      if (id !== 'alur') await page.screenshot(`${viewport.name}-${id}`);
    }
    const faq = await page.evaluate("(() => { document.querySelector('.landing-faq summary').click(); return document.querySelector('.landing-faq').open; })()");
    let mobileMenu = true;
    if (viewport.width < 768) {
      await page.evaluate("document.querySelector('.landing-header button').click()"); await wait(100);
      await page.key('Escape','Escape',27);
      mobileMenu = await page.evaluate("document.querySelector('.landing-header button').getAttribute('aria-expanded') === 'false' && document.activeElement === document.querySelector('.landing-header button')");
    }
    await page.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await wait(100);
    const reduced = await page.evaluate("[...document.querySelectorAll('[data-wave-track]')].every(n => getComputedStyle(n).animationName === 'none')");
    results.push({viewport,layout,tabs,endKey,homeKey,anchors,faq,mobileMenu,reduced,errors:page.errors});
  } finally { await page.close(); }
}
const failures = results.filter(r => !r.layout.styled || r.layout.overflow || r.layout.heroTop !== 0 || r.layout.titleTop < r.layout.headerBottom || !r.layout.photoLoaded || r.layout.categoryCount !== 8 || r.layout.roles !== 3 || r.tabs.selected !== 'experience-tab-1' || r.tabs.active !== r.tabs.selected || r.tabs.visiblePanels !== 1 || !r.endKey || !r.homeKey || !r.faq || !r.mobileMenu || !r.reduced || r.anchors.some(a => !a.clearHeader || a.overflow) || r.errors.length);
await writeFile(resolve(output, `${label}-results.json`),JSON.stringify({results,failures},null,2));
process.stdout.write(JSON.stringify({viewports:results.length,failures:failures.map(f=>f.viewport.name)},null,2)+'\n');
if(failures.length) process.exitCode=1;
