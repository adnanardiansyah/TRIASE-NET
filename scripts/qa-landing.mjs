// Local production QA using an already running Chromium DevTools endpoint.
// No browser/test dependencies or authenticated application data are required.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.QA_ORIGIN ?? "http://localhost:3100";
const debug = process.env.QA_BROWSER ?? "http://127.0.0.1:9225";
const label = process.argv[2] ?? "qa";
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

const instrumentation = `(() => {
  window.__qa = { cls: 0, lcp: null, lcpElement: null, shifts: [], entrance: {} };
  let first = 0, last = 0, total = 0;
  new PerformanceObserver(list => list.getEntries().forEach(e => {
    if (e.hadRecentInput) return;
    if (!first || e.startTime - last > 1000 || e.startTime - first > 5000) { first = e.startTime; total = 0; }
    last = e.startTime; total += e.value; window.__qa.cls = Math.max(window.__qa.cls, total);
    window.__qa.shifts.push({ value: e.value, at: e.startTime });
  })).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(list => list.getEntries().forEach(e => { window.__qa.lcp = e.startTime; window.__qa.lcpElement = e.element?.tagName + ':' + e.element?.className; })).observe({ type: 'largest-contentful-paint', buffered: true });
  const start = performance.now();
  function sample() {
    const selectors = ['.landing-hero-sequence > p:first-child','#landing-title','.landing-title','.landing-intro','.landing-hero-sequence a[href="/aduan/baru"]','.landing-hero-sequence a[href="/aduan/lacak"]','.landing-hero-sequence > p:last-child'];
    selectors.forEach((selector, i) => {
      let node = document.querySelector(selector); if (!node) return;
      if (node.tagName === 'A') node = node.parentElement;
      const opacity = Number(getComputedStyle(node).opacity);
      if (opacity > .02 && !window.__qa.entrance[i]) window.__qa.entrance[i] = Math.round(performance.now());
    });
    if (performance.now() - start < 6000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})()`;

const results = { label, origin, browser: (await (await fetch(`${debug}/json/version`)).json()).Browser, lighthouse: { available: false, performance: null, accessibility: null, bestPractices: null }, measurements: "Local production build, headless browser, no CPU/network throttling; not Lighthouse scores", viewports: [] };
for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }]) {
  const page = await Page.open();
  try {
    await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === "mobile" });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: viewport.name === "mobile" });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: instrumentation });
    await page.navigate(origin); await wait(2200);
    const initial = await page.evaluate(`(() => {
      const photo = document.querySelector('.landing-hero-photo');
      const hero = document.querySelector('.landing-hero');
      const css = getComputedStyle(hero, '::before');
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, photoLoaded: photo.complete && photo.naturalWidth > 0, photoTransform: getComputedStyle(photo).transform, heroBounds: { top: hero.getBoundingClientRect().top, height: hero.getBoundingClientRect().height }, overlay: css.backgroundImage, metrics: window.__qa, revealOpacity: [...document.querySelectorAll('.landing-hero-sequence [data-reveal]')].map(n=>getComputedStyle(n).opacity), particles: [...document.querySelectorAll('svg[viewBox="0 0 1000 700"] > g')].filter(n=>getComputedStyle(n).display!=='none').length };
    })()`);
    const contrast = await page.evaluate(`(() => {
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=1; const ctx=canvas.getContext('2d');
      function rgb(color) { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data].slice(0,3); }
      function luminance(channels) { const c=channels.map(v=>{v/=255; return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}); return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
      return ['footer p','.landing-info > div > div p:last-child'].map(selector=>{
        const node=document.querySelector(selector),foreground=rgb(getComputedStyle(node).color); let parent=node,background;
        while(parent) { const color=getComputedStyle(parent).backgroundColor; if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent') {background=rgb(color);break;} parent=parent.parentElement; }
        background??=[255,255,255]; const a=luminance(foreground),b=luminance(background);
        return {selector,foreground,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    })()`);
    await page.screenshot(`${viewport.name}-hero`);
    let mobileEscape = null;
    if (viewport.name === "mobile") {
      await page.evaluate("document.querySelector('.landing-header button[aria-controls=\"landing-mobile-menu\"]').click()");
      await wait(100); await page.key("Escape", "Escape", 27); await wait(100);
      mobileEscape = await page.evaluate("document.querySelector('.landing-header button[aria-controls=\"landing-mobile-menu\"]').getAttribute('aria-expanded')==='false'");
      if (!mobileEscape) await page.evaluate("document.querySelector('.landing-header button[aria-controls=\"landing-mobile-menu\"]').click()");
      await wait(100);
    }
    const wave = await page.evaluate(`(() => {
      document.getAnimations().forEach(a=>a.pause());
      const track = document.querySelector('[data-wave-track]');
      const tiles = [...track.querySelectorAll('svg')].map(n=>{const r=n.getBoundingClientRect(); return {width:r.width,left:r.left,right:r.right}});
      const hero = document.querySelector('.landing-hero').getBoundingClientRect();
      return {tiles,durationMs:parseFloat(getComputedStyle(track).animationDuration)*1000,clip:{x:0,y:hero.bottom-100,width:document.documentElement.clientWidth,height:100,scale:1}};
    })()`);
    for (const time of [0, wave.durationMs - 1, wave.durationMs]) {
      await page.evaluate(`document.querySelector('[data-wave-track]').getAnimations()[0].currentTime=${time}`);
      await page.screenshot(`${viewport.name}-wave-${time}`, wave.clip);
    }
    await page.evaluate("document.getAnimations().forEach(a=>a.play())");
    await page.evaluate("window.scrollTo({top:document.body.scrollHeight,behavior:'instant'})"); await wait(80);
    await page.evaluate("window.scrollTo({top:0,behavior:'instant'})"); await wait(150);
    const anchors = [];
    for (const id of ["layanan", "alur", "privasi", "bantuan"]) {
      await page.evaluate(`(() => { const menu = document.querySelector('.landing-header button[aria-controls="landing-mobile-menu"]'); if (menu && getComputedStyle(menu).display !== 'none' && menu.getAttribute('aria-expanded') !== 'true') menu.click(); })()`);
      await wait(60);
      await page.evaluate(`(() => { const links = [...document.querySelectorAll('.landing-header a[href="#${id}"]')]; links.find(n=>n.getClientRects().length > 0).click(); })()`);
      await page.settleScroll(); await wait(1000);
      anchors.push(await page.evaluate(`(() => { const target = document.getElementById('${id}'); return { id: '${id}', top: target.getBoundingClientRect().top, headerBottom: document.querySelector('.landing-header').getBoundingClientRect().bottom, active: [...document.querySelectorAll('.landing-header a[aria-current="location"]')].map(n=>n.getAttribute('href')), overflow: document.documentElement.scrollWidth > innerWidth, visibleReveal: [...target.querySelectorAll('[data-reveal]')].filter(n=>{const r=n.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).map(n=>getComputedStyle(n).opacity) }; })()`));
      if (id === "alur") await page.screenshot(`${viewport.name}-timeline`);
    }
    await page.evaluate("document.querySelector('.landing-faq summary').focus()");
    const faqFocus = await page.evaluate("document.activeElement.tagName");
    await page.key("Enter", "Enter", 13); await wait(100);
    const faqOpened = await page.evaluate("document.querySelector('.landing-faq').open");
    await page.key("Enter", "Enter", 13);
    const faqClosed = await page.evaluate("!document.querySelector('.landing-faq').open");
    await page.evaluate("document.querySelector('.landing-faq summary').click()");
    const faqClicked = await page.evaluate("document.querySelector('.landing-faq').open");
    await page.evaluate("document.querySelector('.landing-faq summary').click()");
    const faqChecks = [];
    for (let index = 0; index < 5; index++) {
      await page.evaluate(`document.querySelectorAll('.landing-faq summary')[${index}].focus()`); await wait(60);
      await page.key("Enter", "Enter", 13); await wait(30);
      const enter = await page.evaluate(`document.querySelectorAll('.landing-faq')[${index}].open`);
      await page.key("Enter", "Enter", 13);
      await page.key(" ", "Space", 32); await wait(30);
      const space = await page.evaluate(`document.querySelectorAll('.landing-faq')[${index}].open`);
      await page.key(" ", "Space", 32);
      await page.evaluate(`document.querySelectorAll('.landing-faq summary')[${index}].click()`);
      const click = await page.evaluate(`document.querySelectorAll('.landing-faq')[${index}].open`);
      await page.evaluate(`document.querySelectorAll('.landing-faq summary')[${index}].click()`);
      faqChecks.push({ index, enter, space, click, closed: await page.evaluate(`!document.querySelectorAll('.landing-faq')[${index}].open`) });
    }
    await page.evaluate("window.scrollTo({top:350,behavior:'instant'})"); await wait(300);
    const midHero = await page.evaluate("({active:[...document.querySelectorAll('.landing-header a[aria-current]')].map(n=>n.getAttribute('href')),y:scrollY})");
    await page.evaluate("window.scrollTo({top:document.body.scrollHeight,behavior:'instant'}); window.scrollTo({top:0,behavior:'instant'})"); await wait(500);
    const returnedTop = await page.evaluate("({active:[...document.querySelectorAll('.landing-header a[aria-current]')].map(n=>n.getAttribute('href')),opacity:getComputedStyle(document.querySelector('.landing-title')).opacity,overflow:document.documentElement.scrollWidth>innerWidth})");
    await page.evaluate("document.activeElement?.blur(); document.querySelector('.landing-header .brand').focus()");
    await page.key("Tab", "Tab", 9);
    const keyboard = await page.evaluate("({tag:document.activeElement.tagName,href:document.activeElement.getAttribute('href'),outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth})");
    const timeline = await page.evaluate("({direction:getComputedStyle(document.querySelector('ol[aria-label=\"Tahapan alur pengaduan\"]')).gridTemplateColumns,steps:document.querySelectorAll('ol[aria-label=\"Tahapan alur pengaduan\"]>li').length})");
    const beforeInteractionMetrics = initial.metrics;
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.navigate(origin); await wait(500);
    const reduced = await page.evaluate(`({scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior,atmosphere:getComputedStyle(document.querySelector('[data-running]')).display,waveAnimation:getComputedStyle(document.querySelector('[data-wave-track]')).animationName,hero:[...document.querySelectorAll('.landing-hero-sequence [data-reveal]')].map(n=>({opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform,filter:getComputedStyle(n).filter}))})`);
    const ctas = [];
    const buttons = await page.evaluate("[...document.querySelectorAll('.landing-page a[href^=\"/\"]:not([href=\"/\"])')].map((n,index)=>({href:n.getAttribute('href'),label:n.textContent,index}))");
    for (const { href, label: buttonLabel, index } of buttons) {
      await page.evaluate(`document.querySelectorAll('.landing-page a[href^="/"]:not([href="/"])')[${index}].click()`);
      await wait(1000);
      ctas.push({ href, label: buttonLabel, destination: await page.evaluate("location.pathname+location.search") });
      await page.navigate(origin); await wait(200);
    }
    results.viewports.push({ ...viewport, initial, contrast, mobileEscape, wave, anchors, faqFocus, faqOpened, faqClosed, faqClicked, faqChecks, midHero, returnedTop, keyboard, timeline, reduced, ctas, metrics: beforeInteractionMetrics, errors: page.errors });
    process.stdout.write(`${viewport.name}: overflow=${initial.scrollWidth > initial.width}; LCP=${beforeInteractionMetrics.lcp}; CLS=${beforeInteractionMetrics.cls}; errors=${page.errors.length}\n`);
  } finally { await page.close(); }
}
results.failures = results.viewports.flatMap((v) => {
  const failures = [];
  const check = (passed, message) => { if (!passed) failures.push(`${v.name}: ${message}`); };
  check(v.initial.photoLoaded && v.initial.photoTransform === "none", "graduation image loading/transform");
  check(v.initial.scrollWidth <= v.initial.width && !v.returnedTop.overflow && v.anchors.every(a=>!a.overflow), "horizontal overflow");
  check(!v.errors.length, "browser errors");
  check(v.anchors.every(a=>a.top >= a.headerBottom && a.active.includes(`#${a.id}`) && a.visibleReveal.every(opacity=>Number(opacity) > .99)), "anchors, active navigation or reveal");
  check(!v.midHero.active.length && !v.returnedTop.active.length && v.returnedTop.opacity === "1", "return-to-hero navigation/reveal");
  check(v.faqChecks.every(f=>f.enter && f.space && f.click && f.closed), "FAQ keyboard/click");
  check(v.name !== "mobile" || v.mobileEscape, "mobile Escape");
  check(v.reduced.scrollBehavior === "auto" && v.reduced.atmosphere === "none" && v.reduced.waveAnimation === "none" && v.reduced.hero.every(n=>n.opacity === "1" && n.transform === "none" && n.filter === "none"), "reduced motion");
  check(v.ctas.every(c=>c.href === "/login" ? c.destination === "/login" : decodeURIComponent(c.destination) === `/login?redirect=${c.href}`), "CTA routing");
  check(parseFloat(v.keyboard.outlineWidth) > 0, "keyboard focus outline");
  check(v.contrast.every(c=>c.ratio>=4.5), "refined secondary text contrast");
  check(v.timeline.steps === 3 && v.timeline.direction.split(" ").length === (v.name === "mobile" ? 1 : 3), "timeline orientation");
  const onset=v.metrics.entrance;
  // rAF can coalesce samples while a cold page is busy; equal timestamps for
  // adjacent text are inconclusive, not evidence of reversed animation order.
  check([0,1,2,3,4,5,6].every(i=>Number.isFinite(onset[i])) && [1,2,3,4,5,6].every(i=>onset[i]>=onset[i-1]) && onset[4]>onset[3] && onset[5]>onset[4], "hero entrance/stagger order");
  return failures;
});
await writeFile(resolve(output, `${label}-results.json`), JSON.stringify(results, null, 2));
process.stdout.write(`Results saved: artifacts/landing-qa/${label}-results.json; failures=${results.failures.length}\n`);
if (results.failures.length) { console.error(results.failures); process.exitCode = 1; }
