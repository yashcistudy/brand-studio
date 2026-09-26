// Brand Studio — storage: IndexedDB drafts, project files, GitHub publishing

const DB = "brand-studio", VER = 1;
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  catch (e) { return undefined; }
}
export async function idbSet(key, val) {
  try { const db = await open(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
  catch (e) { return false; }
}
export async function idbDel(key) {
  try { const db = await open(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { }
}

export async function fetchJSON(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }

export function readFile(file, as = "dataURL") {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; as === "text" ? r.readAsText(file) : r.readAsDataURL(file); });
}
export function download(name, data, type = "application/json") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- inline assets for self-contained project files ---------- */
async function toDataURL(url) {
  const r = await fetch(url); const b = await r.blob();
  return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
}
export async function inlineAssets(brand) {
  const b = JSON.parse(JSON.stringify(brand));
  const fix = async (obj, key) => { const v = obj[key]; if (v && typeof v === "string" && !/^(data:|https?:|blob:)/.test(v) && /\.(png|jpe?g|webp|svg|gif|woff2?|ttf|otf)$/i.test(v)) { try { obj[key] = await toDataURL(`brands/${brand.id}/${v}`); } catch (e) { } } };
  for (const l of b.logos || []) await fix(l, "src");
  for (const f of b.fonts || []) await fix(f, "src");
  for (const t of b.templates || []) for (const k of Object.keys(t.fields || {})) await fix(t.fields, k);
  return b;
}

/* ---------- GitHub ---------- */
function b64utf8(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
async function sha1(str) { const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str)); return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 16); }
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif", "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf", "application/font-woff2": "woff2", "application/x-font-ttf": "ttf", "application/octet-stream": "bin" };

const clean = t => String(t || "").replace(/[^\x21-\x7E]/g, "");
async function gfetch(url, opts) {
  try { return await fetch(url, opts); }
  catch (e) { throw new Error("مرورگر به api.github.com نرسید (مشکل شبکه، نه توکن). VPN را روشن یا عوض کنید، افزونه‌های مسدودکننده را برای این سایت خاموش کنید، و https://api.github.com را در یک تب جدا باز کنید؛ اگر آن هم باز نشد، از «بارگذاری دستی» استفاده کنید."); }
}
export class GitHub {
  constructor(cfg) { this.c = Object.assign({}, cfg, { token: clean(cfg && cfg.token), owner: String(cfg && cfg.owner || "").trim(), repo: String(cfg && cfg.repo || "").trim() }); }
  get ok() { return !!(this.c && this.c.owner && this.c.repo && this.c.token); }
  api(path) { return `https://api.github.com/repos/${this.c.owner}/${this.c.repo}/${path}`; }
  headers() { return { Authorization: `Bearer ${this.c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; }
  async test() {
    const r = await gfetch(this.api(""), { headers: this.headers() });
    if (!r.ok) throw new Error(r.status === 404 ? "مخزن پیدا نشد یا توکن به آن دسترسی ندارد" : r.status === 401 ? "توکن نامعتبر است" : "خطای " + r.status);
    const j = await r.json(); if (!j.permissions || !j.permissions.push) throw new Error("توکن اجازهٔ نوشتن (Contents: Read and write) ندارد");
    return j;
  }
  async getSha(path) {
    const r = await gfetch(this.api(`contents/${path}?ref=${encodeURIComponent(this.c.branch || "main")}`), { headers: this.headers() });
    if (r.status === 404) return null; if (!r.ok) throw new Error("خواندن " + path + ": " + r.status);
    const j = await r.json(); return j.sha;
  }
  async put(path, base64, message) {
    const sha = await this.getSha(path);
    const body = { message, content: base64, branch: this.c.branch || "main" }; if (sha) body.sha = sha;
    const r = await gfetch(this.api(`contents/${path}`), { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, this.headers()), body: JSON.stringify(body) });
    if (!r.ok) { let m = r.status; try { m += " " + (await r.json()).message; } catch (e) { } throw new Error("ذخیرهٔ " + path + ": " + m); }
    return r.json();
  }
  async putText(path, text, message) { return this.put(path, b64utf8(text), message); }
  // Upload data: URLs as files, rewrite brand to relative paths, then commit brand.json
  async publishBrand(brand, onStep) {
    const b = JSON.parse(JSON.stringify(brand));
    const uploads = [];
    const collect = (obj, key, folder) => { const v = obj[key]; if (typeof v === "string" && v.startsWith("data:")) uploads.push({ obj, key, folder, v }); };
    for (const l of b.logos || []) collect(l, "src", "logos");
    for (const f of b.fonts || []) collect(f, "src", "fonts");
    for (const t of b.templates || []) for (const k of Object.keys(t.fields || {})) collect(t.fields, k, "assets");
    let i = 0;
    const done = {};
    for (const u of uploads) {
      i++; const m = u.v.match(/^data:([^;,]+)?(;base64)?,(.*)$/s); if (!m) continue;
      const mime = m[1] || "application/octet-stream"; const data = m[2] ? m[3] : b64utf8(decodeURIComponent(m[3]));
      const hash = await sha1(data.slice(0, 20000) + data.length);
      const ext = EXT[mime] || (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "");
      const rel = `${u.folder}/${hash}.${ext}`;
      if (!done[rel]) { onStep && onStep(`بارگذاری فایل ${i} از ${uploads.length}`); await this.put(`brands/${b.id}/${rel}`, data, `Add ${rel} for ${b.id}`); done[rel] = 1; }
      u.obj[u.key] = rel;
    }
    onStep && onStep("ذخیرهٔ brand.json");
    await this.putText(`brands/${b.id}/brand.json`, JSON.stringify(b, null, 2), `Update brand ${b.id} from Brand Studio`);
    return b;
  }
}
