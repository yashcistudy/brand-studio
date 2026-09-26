// Brand Studio — editor application
import { esc, fa, uid, isPh, PH_RE, renderFrame, checkTemplate, fontCSS, resolveColor, contrast, formatOf, themeOf, findBlock, ensureIds, walk, assetUrl, dieHTML } from "./engine.js";
import { idbGet, idbSet, idbDel, fetchJSON, readFile, download, inlineAssets, GitHub } from "./store.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));

/* ================= STATE ================= */
const S = {
  formats: [], brands: {}, order: [], published: {}, pubFormats: "",
  dirty: {}, localOnly: {},
  ui: { brand: "", view: "editor", tpl: {}, sel: null, itab: "content", guides: true, mode: "frame", q: "", fam: "", themeOnly: false },
  gh: { owner: "yashcistudy", repo: "brand-studio", branch: "main", token: "", remember: true },
  hist: [], fut: [], log: []
};
try { Object.assign(S.ui, JSON.parse(localStorage.getItem("bs-ui") || "{}")); } catch (e) { }
try { Object.assign(S.gh, JSON.parse(localStorage.getItem("bs-gh") || "{}")); } catch (e) { }
S.ui.sel = null;
const saveUI = () => { try { localStorage.setItem("bs-ui", JSON.stringify(S.ui)); } catch (e) { } };
const saveGH = () => { try { localStorage.setItem("bs-gh", JSON.stringify(S.gh.remember ? S.gh : Object.assign({}, S.gh, { token: "" }))); } catch (e) { } };

const brand = () => S.brands[S.ui.brand];
function tpl() { const b = brand(); if (!b) return null; return b.templates.find(t => t.id === S.ui.tpl[b.id]) || b.templates[0] || null; }
const theme = () => themeOf(brand(), tpl() || {});
function toast(msg, ms = 2400) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ================= PERSISTENCE ================= */
let saveT = {};
function markDirty(bid = S.ui.brand) {
  S.dirty[bid] = true; updateSaveState("در حال ذخیره…");
  clearTimeout(saveT[bid]);
  saveT[bid] = setTimeout(async () => {
    const ok = await idbSet("draft:" + bid, { brand: S.brands[bid], at: Date.now() });
    await idbSet("local-order", S.order);
    updateSaveState(ok ? null : "ذخیره در مرورگر ناموفق بود");
  }, 500);
}
async function saveFormats() { await idbSet("draft:formats", S.formats); S.dirty.__formats = JSON.stringify(S.formats) !== S.pubFormats; updateSaveState(); }
function updateSaveState(msg) {
  const el = $("#save-state"); if (!el) return;
  if (msg) { el.textContent = msg; el.className = "pill"; return; }
  const n = Object.keys(S.dirty).filter(k => S.dirty[k]).length;
  el.textContent = n ? `ذخیره در مرورگر؛ ${fa(n)} مورد منتشرنشده` : "همه‌چیز منتشر شده";
  el.className = "pill " + (n ? "warn" : "ok");
}
function injectFonts() { let st = $("#bs-fonts"); if (!st) { st = document.createElement("style"); st.id = "bs-fonts"; document.head.appendChild(st); } st.textContent = fontCSS(S.brands); }

async function boot() {
  try { S.formats = await fetchJSON("data/formats.json"); } catch (e) { S.formats = []; }
  S.pubFormats = JSON.stringify(S.formats);
  const df = await idbGet("draft:formats"); if (df) { S.formats = df; S.dirty.__formats = JSON.stringify(df) !== S.pubFormats; }
  let ids = [];
  try { ids = (await fetchJSON("brands/index.json")).brands || []; } catch (e) { }
  for (const id of ids) {
    try { const b = await fetchJSON(`brands/${id}/brand.json`); S.published[id] = JSON.stringify(b); S.brands[id] = b; } catch (e) { console.warn("brand load failed", id, e); }
  }
  const localOrder = (await idbGet("local-order")) || [];
  for (const id of new Set([...ids, ...localOrder])) {
    const d = await idbGet("draft:" + id);
    if (d && d.brand) { S.brands[id] = d.brand; S.dirty[id] = S.published[id] ? JSON.stringify(d.brand) !== S.published[id] : true; if (!S.published[id]) S.localOnly[id] = true; }
  }
  S.order = [...new Set([...ids, ...localOrder])].filter(id => S.brands[id]);
  for (const id of S.order) S.brands[id].templates.forEach(ensureIds);
  if (!S.brands[S.ui.brand]) S.ui.brand = S.order[0] || "";
  injectFonts();
  render();
  if (document.fonts) document.fonts.ready.then(() => { if (S.ui.view === "editor") drawPreview(); });
}

/* ================= HISTORY ================= */
function pushHist() { const t = tpl(); if (!t) return; S.hist.push(JSON.stringify(t)); if (S.hist.length > 80) S.hist.shift(); S.fut = []; }
function restore(json) { const b = brand(); const t = JSON.parse(json); const i = b.templates.findIndex(x => x.id === t.id); if (i >= 0) b.templates[i] = t; markDirty(); renderEditor(); }
function undo() { const t = tpl(); if (!S.hist.length || !t) return; S.fut.push(JSON.stringify(t)); restore(S.hist.pop()); }
function redo() { const t = tpl(); if (!S.fut.length || !t) return; S.hist.push(JSON.stringify(t)); restore(S.fut.pop()); }
function mut(fn, opts = {}) { if (!opts.noHist) pushHist(); fn(tpl(), brand()); markDirty(); if (opts.full) renderEditor(); else { drawPreview(); if (opts.insp) drawInspector(); if (opts.list) drawList(); } }
function bmut(fn, full = true) { fn(brand()); markDirty(); if (full) render(); }

/* ================= TOP-LEVEL RENDER ================= */
const VIEWS = [["editor", "ویرایشگر"], ["sets", "توالی‌ها"], ["grid", "شبکه و هایلایت"], ["brand", "هویت برند"], ["formats", "اندازه‌ها"], ["rules", "قواعد و تحویل"], ["publish", "ذخیره و انتشار"]];
function render() {
  document.body.classList.toggle("guides", S.ui.guides);
  $("#toggle-guides").setAttribute("aria-pressed", S.ui.guides);
  const sel = $("#brand-select");
  sel.innerHTML = S.order.map(id => `<option value="${id}" ${id === S.ui.brand ? "selected" : ""}>${esc(S.brands[id].name)}${S.dirty[id] ? " •" : ""}</option>`).join("");
  const b = brand();
  $("#brand-dot").style.background = b ? (resolveColor({ brand: b, theme: (b.themes || [])[0] || {} }, "@accent") || "#999") : "#999";
  $("#tabs").innerHTML = VIEWS.map(([k, l]) => `<button role="tab" data-view="${k}" aria-selected="${S.ui.view === k}">${l}</button>`).join("");
  updateSaveState(); saveUI();
  const M = $("#main");
  if (!b) { M.innerHTML = `<section class="view"><h2>هنوز برندی نیست</h2><p class="lead">با «+ برند تازه» شروع کنید.</p></section>`; return; }
  ({ editor: renderEditor, sets: renderSets, grid: renderGrid, brand: renderBrand, formats: renderFormats, rules: renderRules, publish: renderPublish })[S.ui.view]();
}

/* ================= FRAME HELPERS ================= */
function frameScaled(t, width, opts = {}) {
  const b = opts.brand || brand();
  const r = renderFrame(S, b, t, Object.assign({ guides: false, zones: true }, opts));
  const s = width / r.fmt.w;
  return { html: `<div class="fw" style="width:${Math.round(r.fmt.w * s)}px;height:${Math.round(r.fmt.h * s)}px">${r.html.replace('style="position:relative;', `style="transform:scale(${s});position:absolute;`)}</div>`, r, s };
}
function cropTile(t, b) {
  const r = renderFrame(S, b || brand(), t, { zones: false });
  const tw = 130, th = tw * 4 / 3, s = Math.max(tw / r.fmt.w, th / r.fmt.h), ox = (tw - r.fmt.w * s) / 2, oy = (th - r.fmt.h * s) / 2;
  return r.html.replace('style="position:relative;', `style="transform:translate(${ox}px,${oy}px) scale(${s});position:absolute;`);
}

/* ================= EDITOR ================= */
function renderEditor() {
  const M = $("#main"); const t = tpl();
  M.innerHTML = `<section class="view"><div class="ed">
    <aside class="panel tlist" id="tlist"></aside>
    <div class="stage" id="stage">
      <div class="stbar">
        <div class="grp" id="themebar"></div>
        <div class="grp">
          <div class="seg"><button data-mode="frame" aria-pressed="${S.ui.mode === "frame"}">قاب</button><button data-mode="place" aria-pressed="${S.ui.mode === "place"}">در جای واقعی</button></div>
          <button class="btn sm" id="undo" title="Ctrl+Z">↶ برگشت</button><button class="btn sm" id="redo" title="Ctrl+Shift+Z">↷</button>
          <button class="btn sm primary" id="export">خروجی PNG</button>
        </div>
      </div>
      <div class="canvas" id="canvas"></div>
      <div class="checks" id="checks"></div>
    </div>
    <aside class="panel insp" id="insp"></aside>
  </div></section>`;
  drawList(); drawThemebar(); drawPreview(); drawInspector();
}
function drawThemebar() {
  const t = tpl(), b = brand(); if (!t) { $("#themebar").innerHTML = ""; return; }
  const allowed = (t.themes && t.themes.length ? t.themes : b.themes.map(x => x.id)).filter(id => b.themes.find(x => x.id === id));
  $("#themebar").innerHTML = `<span class="pill">${esc(formatOf(S, t.format).name)} · ${fa(formatOf(S, t.format).w)}×${fa(formatOf(S, t.format).h)}</span>` +
    (allowed.length > 1 ? `<div class="seg" role="group" aria-label="پوسته">${allowed.map(id => `<button data-theme="${id}" aria-pressed="${t.theme === id}">${esc(b.themes.find(x => x.id === id).name)}</button>`).join("")}</div>` : "");
}
function families(b) { return [...new Set(b.templates.map(t => t.family || "بدون خانواده"))]; }
function drawList() {
  const b = brand(), cur = tpl();
  const q = (S.ui.q || "").trim(); const fam = S.ui.fam || "";
  const list = b.templates.filter(t => (!q || (t.name + " " + t.id).includes(q)) && (!fam || (t.family || "بدون خانواده") === fam));
  const fams = [...new Set(list.map(t => t.family || "بدون خانواده"))];
  $("#tlist").innerHTML = `<input type="search" id="tq" placeholder="جست‌وجوی قالب" value="${esc(q)}">
    <select id="tfam"><option value="">همهٔ خانواده‌ها</option>${families(b).map(f => `<option ${f === fam ? "selected" : ""}>${esc(f)}</option>`).join("")}</select>
    <div class="tools"><button class="btn sm" id="t-new">+ قالب</button><button class="btn sm" id="t-dup">تکثیر</button><button class="btn sm" id="t-up" title="بالا">↑</button><button class="btn sm" id="t-down" title="پایین">↓</button><button class="btn sm danger" id="t-del">حذف</button></div>
    ${fams.map(f => `<h3>${esc(f)}</h3>` + list.filter(t => (t.family || "بدون خانواده") === f).map(t => `<button class="item" data-tpl="${esc(t.id)}" aria-current="${cur && t.id === cur.id}"><span>${esc(t.name)}</span><small>${esc(t.stage || "")}</small></button>`).join("")).join("") || `<p class="lead" style="padding:8px">قالبی پیدا نشد.</p>`}`;
}

let lastRender = null;
function stageScale(fmt) {
  const c = $("#canvas"); const avail = c ? c.clientWidth - 16 : 600;
  const maxH = Math.max(420, window.innerHeight - 260);
  return Math.min(avail / fmt.w, maxH / fmt.h, fmt.w > fmt.h ? 1 : 0.5);
}
function drawPreview() {
  const t = tpl(), c = $("#canvas"); if (!c) return;
  if (!t) { c.innerHTML = `<p class="lead">این برند قالبی ندارد. «+ قالب» را بزنید.</p>`; $("#checks").innerHTML = ""; return; }
  const b = brand();
  const r = renderFrame(S, b, t, { editor: true, guides: true, markPh: true });
  lastRender = r;
  const fmt = r.fmt;
  if (S.ui.mode === "place") {
    const w = fmt.w > fmt.h ? Math.min(640, c.clientWidth - 20) : fmt.id === "story" || fmt.h / fmt.w > 1.6 ? 370 : 388;
    const s = w / fmt.w;
    const fr = `<div class="fw" style="width:${Math.round(fmt.w * s)}px;height:${Math.round(fmt.h * s)}px">${r.html.replace('style="position:relative;', `style="transform:scale(${s});position:absolute;`)}</div>`;
    const page = esc(b.pageName || `[صفحهٔ ${b.name}]`);
    if (fmt.h / fmt.w > 1.6) c.innerHTML = `<div class="phone">${fr}<div class="ui"><div class="bars"><i class="on"></i><i></i><i></i></div><div class="who"><span class="av"></span>${page} · ۲ ساعت</div><div class="reply">ارسال پیام…</div></div></div>`;
    else if (fmt.w > fmt.h) c.innerHTML = `<div class="player">${fr}<div class="tl"></div></div>`;
    else c.innerHTML = `<div class="feed"><div class="fh"><span class="av"></span>${page}<span style="margin-inline-start:auto">•••</span></div>${fr}<div class="fa"><i></i><i></i><i></i></div><div class="fc"><b>${page}</b> کپشن این‌جا ادامه پیدا می‌کند… <div class="l" style="width:80%"></div><div class="l" style="width:55%"></div></div></div>`;
  } else {
    const s = stageScale(fmt);
    c.innerHTML = `<div class="fw" id="fw" style="width:${Math.round(fmt.w * s)}px;height:${Math.round(fmt.h * s)}px" data-scale="${s}">${r.html.replace('style="position:relative;', `style="transform:scale(${s});position:absolute;`)}<div class="hoverbox" id="hoverbox" hidden></div></div>`;
  }
  drawSelection(); drawChecks();
}
function drawChecks() {
  const t = tpl(), b = brand(); if (!t || !lastRender) return;
  const is = checkTemplate(S, b, t, lastRender.report);
  const fl = $("#canvas .bs-flow"); let over = false;
  if (fl && fl.scrollHeight > fl.clientHeight + 4) over = true;
  $$("#canvas .bs-card").forEach(el => { if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflow === "hidden") over = true; });
  if (over) is.unshift(["w", "محتوا از قاب بیرون زده است؛ متن را کوتاه کنید، اندازه را کم کنید یا عنصری را پنهان کنید."]);
  const w = is.filter(x => x[0] === "w").length;
  $("#checks").innerHTML = `<h4>آمادگی انتشار <span class="pill ${w ? "warn" : "ok"}">${w ? fa(w) + " مورد باز" : "بدون مورد باز"}</span></h4>` + (is.length ? is.map(([k, m, bid]) => `<button class="issue ${k}" ${bid ? `data-issue="${esc(bid)}"` : ""}><b>${k === "w" ? "باز" : "توجه"}</b><span>${esc(m)}</span></button>`).join("") : `<div class="issue ok"><b>✓</b><span>همهٔ فیلدهای لازم پر شده‌اند.</span></div>`);
}
function drawSelection() {
  const fw = $("#fw"); if (!fw) return;
  $$(".selbox", fw).forEach(x => x.remove());
  const id = S.ui.sel; if (!id) return;
  const el = fw.querySelector(`[data-bid="${CSS.escape(id)}"]`); if (!el) return;
  const fr = fw.getBoundingClientRect(), r = el.getBoundingClientRect();
  const hit = findBlock(tpl(), id); const isFloat = hit && hit.block.float;
  const box = document.createElement("div"); box.className = "selbox" + (isFloat ? " float" : "");
  Object.assign(box.style, { left: (r.left - fr.left) + "px", top: (r.top - fr.top) + "px", width: r.width + "px", height: r.height + "px" });
  box.innerHTML = `<span class="tag">${esc(blockLabel(hit ? hit.block : { type: "?" }))}</span>` + (isFloat ? `<i class="rs w" data-rs="w"></i><i class="rs e" data-rs="e"></i><i class="rs s" data-rs="s"></i>` : "");
  fw.appendChild(box);
}
const TYPE_FA = { text: "متن", image: "تصویر", logo: "لوگو", list: "فهرست", chips: "مشخصات", table: "جدول", footer: "پاورقی", row: "ردیف", card: "کارت", spacer: "فاصله/شکل", zone: "جای استیکر", die: "تاس" };
function blockLabel(b) { return (b.label || TYPE_FA[b.type] || b.type) + (b.field ? ` · ${b.field}` : ""); }

/* ---------- inspector ---------- */
const ITABS = [["content", "محتوا"], ["layers", "لایه‌ها"], ["element", "عنصر"], ["frame", "قاب"]];
function drawInspector() {
  const I = $("#insp"); if (!I) return; const t = tpl();
  if (!t) { I.innerHTML = ""; return; }
  I.innerHTML = `<div class="itabs" role="tablist">${ITABS.map(([k, l]) => `<button data-itab="${k}" aria-selected="${S.ui.itab === k}">${l}</button>`).join("")}</div><div class="ibody" id="ibody"></div>`;
  ({ content: inspContent, layers: inspLayers, element: inspElement, frame: inspFrame })[S.ui.itab]();
}
function fieldKeys(t) { return [...new Set([...Object.keys(t.fieldMeta || {}), ...Object.keys(t.fields || {})])]; }
function inspContent() {
  const t = tpl(), B = $("#ibody");
  const keys = fieldKeys(t);
  B.innerHTML = keys.map(k => {
    const m = (t.fieldMeta || {})[k] || { label: k }; const v = (t.fields || {})[k] ?? "";
    const lim = m.max; const len = String(v).length;
    const cnt = m.type === "image" ? "" : `<span class="cnt${lim && len > lim ? " over" : ""}" id="cnt-${esc(k)}">${fa(len)}${lim ? " / " + fa(lim) : ""}</span>`;
    let input;
    if (m.type === "image") input = `<div class="addrow">${v ? `<img src="${esc(assetUrl(brand().id, v))}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">` : `<span class="pill warn">خالی</span>`}<span class="btn sm file">${v ? "جایگزینی" : "بارگذاری تصویر"}<input type="file" accept="image/*" data-imgfield="${esc(k)}"></span>${v ? `<button class="btn sm ghost" data-clearfield="${esc(k)}">حذف</button>` : ""}</div>`;
    else if (m.options) input = `<select data-field="${esc(k)}">${m.options.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (m.multi) input = `<textarea data-field="${esc(k)}" rows="${Math.min(6, Math.max(2, String(v).split("\n").length + 1))}" dir="${m.ltr ? "ltr" : "rtl"}">${esc(v)}</textarea>`;
    else input = `<input type="text" data-field="${esc(k)}" value="${esc(v)}" dir="${m.ltr ? "ltr" : "rtl"}" ${m.ltr ? 'placeholder="https://..."' : ""}>`;
    return `<div class="field"><label>${esc(m.label || k)} ${m.required ? "*" : ""}${cnt}</label>${input}
      <details class="fset"><summary>تنظیم فیلد «${esc(k)}»</summary><div class="frow two" style="margin-top:6px">
        <input class="inp" data-fm="${esc(k)}:label" value="${esc(m.label || "")}" placeholder="برچسب">
        <input class="inp" type="number" data-fm="${esc(k)}:max" value="${m.max ?? ""}" placeholder="سقف نویسه">
        <select class="inp" data-fm="${esc(k)}:type"><option value="">متن</option><option value="image" ${m.type === "image" ? "selected" : ""}>تصویر</option></select>
        <input class="inp ltr" data-fm="${esc(k)}:pattern" value="${esc(m.pattern || "")}" placeholder="الگوی اعتبارسنجی (regex)">
        <label class="check"><input type="checkbox" data-fm="${esc(k)}:required" ${m.required ? "checked" : ""}> الزامی</label>
        <label class="check"><input type="checkbox" data-fm="${esc(k)}:multi" ${m.multi ? "checked" : ""}> چندخطی</label>
        <label class="check"><input type="checkbox" data-fm="${esc(k)}:ltr" ${m.ltr ? "checked" : ""}> چپ‌به‌راست</label>
        <button class="btn sm danger" data-delfield="${esc(k)}">حذف فیلد</button></div></details></div>`;
  }).join("") + `<div class="group"><b>فیلد تازه</b><div class="addrow"><input class="inp ltr" id="nf-key" placeholder="key (لاتین)"><input class="inp" id="nf-label" placeholder="برچسب"><button class="btn sm" id="nf-add">افزودن</button></div><div class="hint" style="font-size:11.5px;color:var(--mute)">فیلد را در تب «عنصر» به یک متن، تصویر یا فهرست وصل کنید، یا در متن ثابت با {key} بیاورید.</div></div>`;
}
function layerRows(list, depth, where) {
  return (list || []).map((b, i) => `<div class="layer${S.ui.sel === b.id ? " on" : ""}${b.hidden ? " hid" : ""}" data-layer="${esc(b.id)}" style="padding-right:${6 + depth * 14}px">
    <button class="ib" data-lhide="${esc(b.id)}" title="نمایش/پنهان">${b.hidden ? "◌" : "●"}</button>
    <span class="nm">${esc(blockLabel(b))} <small>${TYPE_FA[b.type] || b.type}${b.float ? " · شناور" : ""}${b.byTheme ? " · تغییر پوسته‌ای" : ""}</small></span>
    <button class="ib" data-lmove="${esc(b.id)}:-1" title="بالا">↑</button><button class="ib" data-lmove="${esc(b.id)}:1" title="پایین">↓</button>
    <button class="ib" data-ldup="${esc(b.id)}" title="تکثیر">⧉</button><button class="ib" data-ldel="${esc(b.id)}" title="حذف">✕</button></div>` + (b.children ? layerRows(b.children, depth + 1) : "")).join("");
}
const NEW_BLOCK = {
  text: () => ({ type: "text", role: "body", text: "متن تازه", label: "متن" }),
  image: () => ({ type: "image", field: "img", h: 400, label: "تصویر", note: "تصویر را در تب محتوا بارگذاری کنید" }),
  logo: () => { const b = brand(); return { type: "logo", set: Object.keys(b.logoSets || {})[0] || "primary", h: 110 }; },
  list: () => ({ type: "list", field: "list", num: "bullet", size: 38 }),
  chips: () => ({ type: "chips", items: [{ label: "برچسب", field: "chip1" }] }),
  table: () => ({ type: "table", field: "rows", headers: ["ستون ۱", "ستون ۲"], size: 30 }),
  card: () => ({ type: "card", bg: "@card", color: "@cardText", radius: 24, pad: [32, 36], gap: 20, children: [{ type: "text", role: "body", text: "متن داخل کارت" }] }),
  row: () => ({ type: "row", gap: 24, children: [{ type: "text", role: "label", text: "ردیف" }] }),
  spacer: () => ({ type: "spacer", h: 24 }),
  footer: () => ({ type: "footer", pager: "none", push: true }),
  zone: () => ({ type: "zone", h: 260, label: "جای استیکر", note: true }),
  die: () => ({ type: "die", n: 5, size: 120 })
};
function inspLayers() {
  const t = tpl();
  $("#ibody").innerHTML = `<div class="group" style="border:0;padding:0"><b>جریان (چیدمان خودکار از بالا به پایین)</b><div class="layers">${layerRows(t.blocks, 0) || `<span class="lead">خالی</span>`}</div></div>
    <div class="group"><b>شناور (جای آزاد روی قاب؛ روی پیش‌نمایش بکشید)</b><div class="layers">${layerRows(t.floats, 0) || `<span class="lead" style="font-size:12px">عنصر شناوری نیست</span>`}</div></div>
    <div class="group"><b>افزودن عنصر</b><div class="addrow"><select class="inp" id="add-type">${Object.keys(NEW_BLOCK).map(k => `<option value="${k}">${TYPE_FA[k]}</option>`).join("")}</select>
    <select class="inp" id="add-where"><option value="after">بعد از انتخاب‌شده</option><option value="inside">داخل کارت/ردیف انتخاب‌شده</option><option value="end">انتهای جریان</option><option value="float">شناور</option></select><button class="btn sm primary" id="add-go">افزودن</button></div></div>`;
}

/* ---- element property editor ---- */
const ROLES = () => Object.keys(brand().type || {});
function colorOpts(v) {
  const b = brand(), th = theme();
  const roles = Object.keys(th).filter(k => !["id", "name"].includes(k));
  const cur = v || "";
  const isCustom = cur && !cur.startsWith("@") && !(b.colors || []).find(c => c.id === cur) && !cur.startsWith("grad:") && cur !== "transparent";
  return `<option value="">— پیش‌فرض —</option><option value="transparent" ${cur === "transparent" ? "selected" : ""}>بی‌رنگ</option>
    <optgroup label="نقش‌های پوسته">${roles.map(r => `<option value="@${r}" ${cur === "@" + r ? "selected" : ""}>@${r}</option>`).join("")}</optgroup>
    <optgroup label="پالت">${(b.colors || []).map(c => `<option value="${c.id}" ${cur === c.id ? "selected" : ""}>${esc(c.name)} ${c.hex}</option>`).join("")}</optgroup>
    ${(b.gradients || []).length ? `<optgroup label="گرادیان">${b.gradients.map(g => `<option value="grad:${g.id}" ${cur === "grad:" + g.id ? "selected" : ""}>${esc(g.name || g.id)}</option>`).join("")}</optgroup>` : ""}
    <option value="__custom" ${isCustom ? "selected" : ""}>رنگ دلخواه…</option>`;
}
const P = (key, label, kind, extra) => ({ key, label, kind, extra });
const PROPS = {
  common: [P("label", "نام لایه", "text"), P("color", "رنگ متن", "color"), P("bg", "پس‌زمینه", "color"), P("pad", "فاصلهٔ داخلی (بالا راست پایین چپ یا ۲ عدد)", "nums"), P("radius", "گردی گوشه", "num"), P("border.w", "ضخامت قاب", "num"), P("border.color", "رنگ قاب", "color"), P("border.style", "نوع قاب", "select", ["", "solid", "dashed", "dotted"]),
    P("align", "جای‌گیری در ستون", "select", ["", "start", "center", "end", "stretch"]), P("w", "عرض (عدد یا full)", "text"), P("mt", "فاصلهٔ اضافهٔ بالا", "num"), P("push", "چسبیدن به پایین", "bool"), P("grow", "پر کردن فضای خالی", "bool"), P("bleed", "تمام‌عرض تا لبهٔ قاب", "bool"), P("bleedTop", "تا لبهٔ بالای قاب", "bool"), P("bleedBottom", "تا لبهٔ پایین قاب", "bool"), P("opacity", "شفافیت (۰ تا ۱)", "num"), P("rotate", "چرخش (درجه)", "num"), P("hidden", "پنهان", "bool")],
  text: [P("field", "فیلد محتوا", "fieldsel"), P("text", "متن ثابت (می‌توانید {فیلد} بنویسید)", "textarea"), P("role", "سبک متن", "rolesel"), P("size", "اندازه (px)", "num"), P("weight", "وزن", "select", ["", "300", "400", "500", "600", "700", "800", "900"]), P("lh", "فاصلهٔ خطوط", "num"), P("font", "فونت", "fontsel"), P("textAlign", "چینش متن", "select", ["", "right", "center", "left", "justify"]), P("fit.ref", "کوچک‌شدن خودکار پس از چند نویسه", "num"), P("fit.min", "کمینهٔ کوچک‌شدن (۰ تا ۱)", "num"), P("marker", "نشانهٔ کنار متن", "select", ["", "square", "dot", "bar"]), P("markerColor", "رنگ نشانه", "color"), P("markerSize", "اندازهٔ نشانه", "num"), P("prefix", "پیشوند", "text"), P("emptyText", "متن وقتی فیلد خالی است", "text"), P("emptyColor", "رنگ متن خالی", "color"), P("ltr", "چپ‌به‌راست", "bool"), P("tracking", "فاصلهٔ حروف (em)", "num")],
  image: [P("field", "فیلد تصویر", "fieldsel"), P("h", "ارتفاع", "num"), P("wpx", "عرض", "num"), P("fit", "برش", "select", ["cover", "contain"]), P("phTitle", "عنوان جای خالی", "text"), P("note", "راهنمای جای خالی", "textarea")],
  logo: [P("brand", "لوگوی کدام برند", "brandsel"), P("set", "نوع لوگو", "logoset"), P("h", "ارتفاع", "num"), P("ground", "زمینه (خودکار از رنگ پشت)", "select", ["", "light", "dark"])],
  list: [P("field", "فیلد (هر خط یک مورد؛ «عنوان | توضیح»)", "fieldsel"), P("num", "سبک", "select", ["bullet", "box", "line", "pill", "kv", "none"]), P("size", "اندازه", "num"), P("active", "مورد فعال (شماره)", "num"), P("showDesc", "نمایش توضیح", "bool"), P("markerColor", "رنگ نشانه", "color"), P("itemGap", "فاصلهٔ موارد", "num"), P("round", "نشانهٔ گرد", "bool"), P("font", "فونت", "fontsel")],
  chips: [P("itemsText", "موارد (هر خط: برچسب | فیلد)", "textarea"), P("chipBg", "زمینهٔ برچسب", "color"), P("chipText", "رنگ متن برچسب", "color"), P("missText", "متن مورد تأییدنشده", "text")],
  table: [P("field", "فیلد جدول (ستون‌ها با |)", "fieldsel"), P("headersText", "سرستون‌ها (با ، جدا کنید)", "text"), P("size", "اندازه", "num"), P("cellBg", "زمینهٔ خانه", "color"), P("cellText", "رنگ متن خانه", "color"), P("phBg", "زمینهٔ خانهٔ جانگهدار", "color")],
  footer: [P("text", "نشانی / متن", "text"), P("pager", "شمارهٔ صفحه", "select", ["none", "dots", "dice", "number"]), P("i", "صفحهٔ فعلی", "num"), P("n", "تعداد صفحه", "num"), P("aside", "متن کناری (بدون شماره)", "text"), P("line", "خط بالای پاورقی", "boolT"), P("size", "اندازه", "num"), P("lineColor", "رنگ خط", "color")],
  row: [P("justify", "چیدمان افقی", "select", ["space-between", "flex-start", "center", "flex-end", "space-around"]), P("alignItems", "چیدمان عمودی", "select", ["center", "flex-start", "flex-end", "stretch", "baseline"]), P("gap", "فاصله", "num"), P("wrap", "شکستن به خط بعد", "bool")],
  card: [P("gap", "فاصلهٔ داخلی عناصر", "num"), P("justify", "چیدمان عمودی", "select", ["flex-start", "center", "flex-end", "space-between"]), P("overflowHidden", "بریدن محتوای اضافه", "bool")],
  spacer: [P("h", "ارتفاع", "num"), P("wpx", "عرض", "num"), P("flex", "کش آمدن", "bool")],
  zone: [P("h", "ارتفاع", "num"), P("label", "برچسب", "text"), P("field", "فیلد یادداشت", "fieldsel"), P("round", "گوشهٔ گرد", "bool")],
  die: [P("n", "خال‌ها (۱ تا ۶)", "num"), P("size", "اندازه", "num"), P("pip", "رنگ خال", "color")],
  float: [P("float.x", "فاصله از لبهٔ افقی", "num"), P("float.y", "فاصله از لبهٔ عمودی", "num"), P("float.ax", "لبهٔ افقی", "select", ["left", "right"]), P("float.ay", "لبهٔ عمودی", "select", ["top", "bottom"]), P("float.w", "عرض", "num"), P("float.h", "ارتفاع", "num"), P("float.under", "زیر محتوا (پس‌زمینه)", "bool"), P("float.z", "ترتیب رویی", "num")]
};
function getPath(o, path) { return path.split(".").reduce((a, k) => a == null ? undefined : a[k], o); }
function setPath(o, path, v) { const ks = path.split("."); let cur = o; for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null || typeof cur[ks[i]] !== "object") cur[ks[i]] = {}; cur = cur[ks[i]]; } const last = ks[ks.length - 1]; if (v === undefined || v === "" || v === null) delete cur[last]; else cur[last] = v; }
function effBlock(b) { const th = tpl().theme; return S.ui.themeOnly && b.byTheme && b.byTheme[th] ? Object.assign({}, b, b.byTheme[th]) : b; }
function propInput(p, b) {
  let v = p.key === "itemsText" ? (b.items || []).map(i => `${i.label} | ${i.field}`).join("\n") : p.key === "headersText" ? (b.headers || []).join("، ") : getPath(b, p.key);
  const id = `pp-${p.key.replace(/\./g, "_")}`; const dk = `data-prop="${p.key}"`;
  switch (p.kind) {
    case "bool": return `<label class="check"><input type="checkbox" ${dk} ${v ? "checked" : ""}> ${esc(p.label)}</label>`;
    case "boolT": return `<label class="check"><input type="checkbox" ${dk} data-deftrue="1" ${v !== false ? "checked" : ""}> ${esc(p.label)}</label>`;
    case "num": return `<div class="field"><label for="${id}">${esc(p.label)}</label><input type="number" step="any" id="${id}" ${dk} value="${v ?? ""}"></div>`;
    case "nums": return `<div class="field"><label for="${id}">${esc(p.label)}</label><input type="text" dir="ltr" id="${id}" ${dk} data-nums="1" value="${Array.isArray(v) ? v.join(" ") : v ?? ""}"></div>`;
    case "textarea": return `<div class="field"><label for="${id}">${esc(p.label)}</label><textarea id="${id}" ${dk} rows="3">${esc(v ?? "")}</textarea></div>`;
    case "select": return `<div class="field"><label for="${id}">${esc(p.label)}</label><select id="${id}" ${dk}>${p.extra.map(o => `<option value="${o}" ${String(v ?? "") === o ? "selected" : ""}>${o || "— پیش‌فرض —"}</option>`).join("")}</select></div>`;
    case "color": { const hex = v && String(v).startsWith("#") ? v : "#000000"; return `<div class="field"><label>${esc(p.label)}</label><div class="colorpick"><select ${dk} data-color="1">${colorOpts(v)}</select><input type="color" data-colorhex="${p.key}" value="${hex.length === 7 ? hex : "#000000"}" ${v && String(v).startsWith("#") ? "" : "hidden"}></div></div>`; }
    case "fieldsel": { const keys = fieldKeys(tpl()); return `<div class="field"><label>${esc(p.label)}</label><select ${dk}><option value="">— بدون فیلد —</option>${keys.map(k => `<option value="${esc(k)}" ${v === k ? "selected" : ""}>${esc(((tpl().fieldMeta || {})[k] || {}).label || k)} (${esc(k)})</option>`).join("")}</select></div>`; }
    case "rolesel": return `<div class="field"><label>${esc(p.label)}</label><select ${dk}>${ROLES().map(r => `<option ${v === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>`;
    case "fontsel": { const opts = ["", "display", "body", "latin", ...S.order.filter(id => id !== S.ui.brand).flatMap(id => ["display", "body"].map(r => `${id}:${r}`))]; return `<div class="field"><label>${esc(p.label)}</label><select ${dk}>${opts.map(o => `<option value="${o}" ${String(v ?? "") === o ? "selected" : ""}>${o || "— از سبک متن —"}</option>`).join("")}</select></div>`; }
    case "brandsel": return `<div class="field"><label>${esc(p.label)}</label><select ${dk}><option value="">همین برند</option>${S.order.filter(i => i !== S.ui.brand).map(i => `<option value="${i}" ${v === i ? "selected" : ""}>${esc(S.brands[i].name)}</option>`).join("")}</select></div>`;
    case "logoset": { const lb = (b.brand && S.brands[b.brand]) || brand(); return `<div class="field"><label>${esc(p.label)}</label><select ${dk}>${Object.keys(lb.logoSets || {}).map(k => `<option ${v === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>`; }
    default: return `<div class="field"><label for="${id}">${esc(p.label)}</label><input type="text" id="${id}" ${dk} value="${esc(v ?? "")}"></div>`;
  }
}
function inspElement() {
  const B = $("#ibody"); const t = tpl();
  const hit = S.ui.sel && findBlock(t, S.ui.sel);
  if (!hit) { B.innerHTML = `<p class="lead" style="margin:0">روی عنصری در پیش‌نمایش بزنید یا از تب «لایه‌ها» انتخاب کنید.</p>`; return; }
  const raw = hit.block, b = effBlock(raw);
  const specific = PROPS[b.type] || [];
  const th = brand().themes.find(x => x.id === t.theme);
  B.innerHTML = `<div class="banner" style="padding:6px 10px"><b>${esc(blockLabel(raw))}</b> · ${TYPE_FA[raw.type] || raw.type}${raw.float ? " · شناور" : ""}</div>
    <label class="check"><input type="checkbox" id="theme-only" ${S.ui.themeOnly ? "checked" : ""}> تغییرها فقط برای پوستهٔ «${esc(th ? th.name : t.theme)}»</label>
    ${S.ui.themeOnly && raw.byTheme && raw.byTheme[t.theme] ? `<button class="btn sm ghost" id="clear-theme-ov">پاک کردن تغییرهای این پوسته</button>` : ""}
    <div class="group" style="border:0;padding:0">${specific.map(p => propInput(p, b)).join("")}</div>
    ${raw.float ? `<div class="group"><b>جای شناور</b>${PROPS.float.map(p => propInput(p, raw)).join("")}</div>` : ""}
    <div class="group"><b>ظاهر و جای‌گیری</b>${PROPS.common.map(p => propInput(p, b)).join("")}</div>
    <div class="group"><b>کارها</b><div class="addrow" style="flex-wrap:wrap">
      <button class="btn sm" data-el="float">${raw.float ? "برگرداندن به جریان" : "شناور کن"}</button>
      <button class="btn sm" data-el="dup">تکثیر</button>
      <button class="btn sm" data-el="up">بالا</button><button class="btn sm" data-el="down">پایین</button>
      <button class="btn sm danger" data-el="del">حذف</button></div>
      <div class="field"><label>شرط نمایش</label><div class="frow two"><select class="inp" data-showif="field"><option value="">همیشه نمایش</option>${fieldKeys(t).map(k => `<option ${raw.showIf && raw.showIf.field === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
      <input class="inp" data-showif="not" placeholder="مگر وقتی برابر است با…" value="${esc(raw.showIf && raw.showIf.not || "")}"></div></div></div>`;
}
function inspFrame() {
  const t = tpl(), b = brand(); const fmt = formatOf(S, t.format);
  const pad = t.pad || null;
  B_ = $("#ibody");
  B_.innerHTML = `
    <div class="field"><label>نام قالب</label><input type="text" data-tp="name" value="${esc(t.name)}"></div>
    <div class="frow two"><div class="field"><label>خانواده</label><input type="text" data-tp="family" value="${esc(t.family || "")}" list="famlist"><datalist id="famlist">${families(b).map(f => `<option>${esc(f)}</option>`).join("")}</datalist></div>
    <div class="field"><label>مرحلهٔ مسیر مخاطب</label><input type="text" data-tp="stage" value="${esc(t.stage || "")}" list="stagelist"><datalist id="stagelist"><option>آگاهی</option><option>فهم</option><option>اعتماد</option><option>درخواست</option></datalist></div></div>
    <div class="field"><label>شناسه</label><input type="text" dir="ltr" data-tp="id" value="${esc(t.id)}"></div>
    <div class="field"><label>اندازه</label><select data-tp="format">${S.formats.map(f => `<option value="${f.id}" ${f.id === t.format ? "selected" : ""}>${esc(f.name)} · ${f.w}×${f.h}</option>`).join("")}</select></div>
    <div class="field"><label>پوستهٔ فعال</label><select data-tp="theme">${b.themes.map(x => `<option value="${x.id}" ${x.id === t.theme ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
    <div class="field"><label>پوسته‌های مجاز برای این قالب</label>${b.themes.map(x => `<label class="check"><input type="checkbox" data-allowtheme="${x.id}" ${(t.themes || []).includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("")}</div>
    <div class="field"><label>پس‌زمینهٔ قاب</label><div class="colorpick"><select data-tp="bg" data-color="1">${colorOpts(t.bg)}</select><input type="color" data-tphex="bg" value="${t.bg && t.bg.startsWith("#") ? t.bg : "#ffffff"}" ${t.bg && t.bg.startsWith("#") ? "" : "hidden"}></div></div>
    <div class="field"><label>فاصلهٔ داخلی قاب (بالا راست پایین چپ)</label><input type="text" dir="ltr" data-tp="pad" value="${pad ? pad.join(" ") : ""}" placeholder="${[fmt.safe.t, fmt.safe.r, fmt.safe.b, fmt.safe.l].join(" ")} (از محدودهٔ امن)"></div>
    <div class="frow two"><div class="field"><label>فاصلهٔ عناصر</label><input type="number" data-tp="gap" value="${t.gap ?? 40}"></div>
    <div class="field"><label>چیدمان عمودی</label><select data-tp="justify">${["start", "center", "end", "between"].map(j => `<option value="${j}" ${(t.justify || "start") === j ? "selected" : ""}>${{ start: "از بالا", center: "وسط", end: "از پایین", between: "پخش" }[j]}</option>`).join("")}</select></div></div>
    <div class="field"><label>یادداشت برای تیم</label><textarea data-tp="notes" rows="2">${esc(t.notes || "")}</textarea></div>`;
}
let B_;

/* ---------- mutations ---------- */
function removeBlock(id) { const t = tpl(); const hit = findBlock(t, id); if (!hit) return; hit.list.splice(hit.index, 1); if (S.ui.sel === id) S.ui.sel = null; }
function moveBlock(id, d) { const hit = findBlock(tpl(), id); if (!hit) return; const j = hit.index + d; if (j < 0 || j >= hit.list.length) return; const [x] = hit.list.splice(hit.index, 1); hit.list.splice(j, 0, x); }
function dupBlock(id) { const hit = findBlock(tpl(), id); if (!hit) return; const c = clone(hit.block); const f = b => { b.id = uid(); (b.children || []).forEach(f); }; f(c); if (c.float) { c.float.x = (c.float.x || 0) + 30; c.float.y = (c.float.y || 0) + 30; } hit.list.splice(hit.index + 1, 0, c); S.ui.sel = c.id; }
function toggleFloat(id) {
  const t = tpl(); const hit = findBlock(t, id); if (!hit) return; const b = hit.block;
  hit.list.splice(hit.index, 1);
  if (b.float) { delete b.float; t.blocks.push(b); }
  else {
    const fw = $("#fw"), el = fw && fw.querySelector(`[data-bid="${CSS.escape(id)}"]`); let x = 100, y = 100, w;
    if (el) { const s = +fw.dataset.scale, fr = fw.getBoundingClientRect(), r = el.getBoundingClientRect(); x = Math.round((r.left - fr.left) / s); y = Math.round((r.top - fr.top) / s); w = Math.round(r.width / s); }
    b.float = { x, y, w }; delete b.push; delete b.bleed; delete b.bleedTop; delete b.bleedBottom; delete b.grow;
    t.floats = t.floats || []; t.floats.push(b);
  }
}
function setProp(b, key, val) {
  const t = tpl();
  if (key === "itemsText") { b.items = String(val).split("\n").filter(x => x.trim()).map(l => { const [label, field] = l.split("|").map(s => s.trim()); return { label, field: field || label }; }); return; }
  if (key === "headersText") { b.headers = String(val).split(/[،,]/).map(s => s.trim()).filter(Boolean); return; }
  if (S.ui.themeOnly && !key.startsWith("float.") && key !== "label" && key !== "field") {
    b.byTheme = b.byTheme || {}; b.byTheme[t.theme] = b.byTheme[t.theme] || {};
    const top = key.split(".")[0];
    if (key.includes(".")) { const base = clone(b.byTheme[t.theme][top] ?? b[top] ?? {}); setPath({ [top]: base }, key, val); b.byTheme[t.theme][top] = base; }
    else if (val === undefined || val === "") delete b.byTheme[t.theme][key]; else b.byTheme[t.theme][key] = val;
    return;
  }
  setPath(b, key, val);
  if (key.startsWith("fit.") && b.fit && b.fit.ref == null && b.fit.min == null) delete b.fit;
  if (key.startsWith("border.") && b.border && !b.border.w) delete b.border;
}
function parseVal(el) {
  if (el.type === "checkbox") return el.dataset.deftrue ? (el.checked ? undefined : false) : (el.checked ? true : undefined);
  if (el.dataset.nums) { const ns = el.value.trim().split(/[\s,،]+/).filter(Boolean).map(Number).filter(n => !isNaN(n)); return ns.length ? (ns.length === 1 ? ns[0] : ns) : undefined; }
  if (el.type === "number") return el.value === "" ? undefined : Number(el.value);
  if (el.dataset.prop === "w") { const v = el.value.trim(); return v === "" ? undefined : v === "full" ? "full" : isNaN(+v) ? v : +v; }
  return el.value === "" ? undefined : el.value;
}

/* ---------- export ---------- */
async function exportTemplate(t, b, idx) {
  if (!window.htmlToImage) { toast("کتابخانهٔ خروجی بارگذاری نشد"); return false; }
  const r = renderFrame(S, b || brand(), t, {});
  const host = document.createElement("div"); host.style.cssText = `position:fixed;left:-99999px;top:0;width:${r.fmt.w}px;height:${r.fmt.h}px`;
  host.innerHTML = r.html; document.body.appendChild(host);
  try {
    if (document.fonts) await document.fonts.ready;
    const blob = await window.htmlToImage.toBlob(host.firstElementChild, { width: r.fmt.w, height: r.fmt.h, pixelRatio: 1, cacheBust: false });
    download(`${(b || brand()).id}-${idx != null ? String(idx).padStart(2, "0") + "-" : ""}${t.id}-${r.fmt.w}x${r.fmt.h}.png`, blob);
    return true;
  } catch (e) { toast("ساخت تصویر ممکن نشد: " + (e.message || e)); return false; }
  finally { host.remove(); }
}

/* ================= SETS ================= */
function renderSets() {
  const b = brand(); b.sets = b.sets || [];
  $("#main").innerHTML = `<section class="view"><h2>توالی‌ها · ${esc(b.name)}</h2><p class="lead">کاروسل‌ها، توالی استوری و کیت‌ها را کنار هم ببینید. روی هر قاب بزنید تا در ویرایشگر باز شود.</p>
  ${b.sets.map((s, si) => `<div class="panel setcard"><div class="hd"><input value="${esc(s.name)}" data-setname="${si}" aria-label="نام توالی"><div class="addrow">
    <select class="inp" data-setadd="${si}"><option value="">+ افزودن قالب…</option>${b.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select>
    <button class="btn sm" data-setexport="${si}">خروجی همه (PNG)</button><button class="btn sm danger" data-setdel="${si}">حذف توالی</button></div></div>
    <input class="inp" value="${esc(s.note || "")}" data-setnote="${si}" placeholder="یادداشت یا منطق توالی">
    <div class="strip">${s.ids.map((id, i) => { const t = b.templates.find(x => x.id === id); if (!t) return ""; const f = formatOf(S, t.format); const w = f.w > f.h ? 380 : 220; return `<div class="cell"><div class="cap"><b>${fa(i + 1)} · ${esc(t.name)}</b><span><button class="btn sm ghost" data-setmv="${si}:${i}:-1">→</button><button class="btn sm ghost" data-setmv="${si}:${i}:1">←</button><button class="btn sm ghost" data-setrm="${si}:${i}">✕</button></span></div><button class="open" data-open="${esc(t.id)}">${frameScaled(t, w).html}</button></div>`; }).join("")}</div></div>`).join("")}
  <button class="btn" id="set-new">+ توالی تازه</button></section>`;
}

/* ================= GRID ================= */
function renderGrid() {
  const b = brand(); b.grid = b.grid || { ids: [], pinned: 3 }; b.highlights = b.highlights || { template: "", items: [] };
  const hlT = b.templates.find(t => t.id === b.highlights.template);
  const hlMini = (it) => { if (!hlT) return ""; const f = formatOf(S, hlT.format); const r = renderFrame(S, b, Object.assign({}, hlT, { theme: it.theme || hlT.theme }), { fields: { word: it.text } }); const s = 68 / (f.circle ? f.circle.r * 2 : f.w); const oy = f.circle ? -(f.circle.cy - f.circle.r) * s : 0, ox = f.circle ? -(f.circle.cx - f.circle.r) * s : 0; return r.html.replace('style="position:relative;', `style="transform:translate(${ox}px,${oy}px) scale(${s});position:absolute;`); };
  $("#main").innerHTML = `<section class="view"><h2>شبکهٔ پروفایل و هایلایت‌ها · ${esc(b.name)}</h2><p class="lead">برش ۳:۴ مرکز هر قالب، به همان شکلی که در پروفایل دیده می‌شود.</p>
  <div class="two"><div><div class="igrid">${b.grid.ids.map((id, i) => { const t = b.templates.find(x => x.id === id); return t ? `<button class="tile" data-open="${esc(id)}" title="${esc(t.name)}">${i < (b.grid.pinned || 0) ? '<span class="pin"></span>' : ""}${cropTile(t)}</button>` : ""; }).join("")}</div></div>
  <div class="panel card"><h3>ترتیب شبکه</h3><div class="field"><label>تعداد سنجاق‌شده</label><input type="number" id="grid-pinned" value="${b.grid.pinned || 0}" min="0" max="3"></div>
    ${b.grid.ids.map((id, i) => { const t = b.templates.find(x => x.id === id); return `<div class="layer"><span class="nm">${fa(i + 1)} · ${esc(t ? t.name : id)}</span><button class="ib" data-gmv="${i}:-1">↑</button><button class="ib" data-gmv="${i}:1">↓</button><button class="ib" data-grm="${i}">✕</button></div>`; }).join("")}
    <select class="inp" id="grid-add"><option value="">+ افزودن به شبکه…</option>${b.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div></div>
  <div class="panel card" style="margin-top:16px"><h3>هایلایت‌ها</h3>
    <div class="field"><label>قالب هایلایت</label><select id="hl-tpl"><option value="">—</option>${b.templates.map(t => `<option value="${esc(t.id)}" ${t.id === b.highlights.template ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select><span class="hint" style="font-size:11.5px;color:var(--mute)">قالب باید فیلدی به نام word داشته باشد.</span></div>
    <div class="hlrow">${b.highlights.items.map((it, i) => `<div class="hl"><div class="ring"><div>${hlMini(it)}</div></div><input class="inp" style="width:90px;text-align:center" value="${esc(it.text)}" data-hltext="${i}"><select class="inp" style="width:90px" data-hltheme="${i}">${b.themes.map(x => `<option value="${x.id}" ${x.id === it.theme ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><button class="btn sm ghost" data-hlrm="${i}">حذف</button></div>`).join("")}
    <button class="btn" id="hl-add" style="align-self:center">+ هایلایت</button></div></div></section>`;
}

/* ================= BRAND ================= */
function renderBrand() {
  const b = brand();
  const colorRow = (c, i) => `<tr><td><input type="color" value="${c.hex.length === 7 ? c.hex : "#000000"}" data-bc="${i}:hex"></td><td><input class="ltr" value="${esc(c.id)}" data-bc="${i}:id"></td><td><input value="${esc(c.name || "")}" data-bc="${i}:name"></td><td><input class="ltr" value="${esc(c.hex)}" data-bc="${i}:hex"></td><td><input value="${esc(c.note || "")}" data-bc="${i}:note"></td><td><button class="btn sm ghost" data-bcdel="${i}">✕</button></td></tr>`;
  const roleKeys = [...new Set(b.themes.flatMap(t => Object.keys(t)).filter(k => !["id", "name"].includes(k)))];
  const themeCell = (t, ti, k) => { const v = t[k] || ""; const hex = resolveColor({ brand: b, theme: t }, v) || ""; const solid = (hex.match(/#[0-9a-fA-F]{6}/) || [""])[0]; return `<td><div class="colorpick" style="min-width:130px"><span class="sw" style="background:${esc(hex || "transparent")}"></span><select data-th="${ti}:${k}"><option value="">—</option>${(b.colors || []).map(c => `<option value="${c.id}" ${v === c.id ? "selected" : ""}>${esc(c.name || c.id)}</option>`).join("")}${(b.gradients || []).map(g => `<option value="grad:${g.id}" ${v === "grad:" + g.id ? "selected" : ""}>${esc(g.name || g.id)}</option>`).join("")}${v && !(b.colors || []).find(c => c.id === v) && !v.startsWith("grad:") ? `<option selected value="${esc(v)}">${esc(v)}</option>` : ""}</select></div></td>`; };
  const pairs = [["text", "bg"], ["cardText", "card"], ["ctaText", "cta"], ["pillText", "pill"], ["bandText", "band"], ["chipText", "chip"], ["coverText", "coverBand"]];
  const contrastRow = t => pairs.filter(([f, g]) => t[f] && t[g]).map(([f, g]) => { const ctx = { brand: b, theme: t }; const fg = resolveColor(ctx, "@" + f), bg = resolveColor(ctx, "@" + g); const stops = (String(bg).match(/#[0-9a-fA-F]{6}/g) || [bg]); let r = 99; for (const s of stops) { try { r = Math.min(r, contrast(fg, s)); } catch (e) { } } return `<span class="pill ${r >= 4.5 ? "ok" : r >= 3 ? "" : "warn"}" title="${f} روی ${g}">${f}/${g}: ${r.toFixed(1)}</span>`; }).join(" ");
  const families = [...new Set((b.fonts || []).map(f => f.family).concat(Object.values(S.brands).flatMap(x => (x.fonts || []).map(f => f.family))))];
  $("#main").innerHTML = `<section class="view"><h2>هویت برند · ${esc(b.name)}</h2><p class="lead">هر تغییری این‌جا فقط روی قالب‌های همین برند اثر می‌گذارد. قالب‌ها به نقش‌های پوسته (مثل ‎@text و ‎@card) وصل‌اند؛ پس با عوض کردن رنگ یک نقش، همهٔ قالب‌ها با هم عوض می‌شوند.</p>
  <div class="panel section"><h3>مشخصات</h3><div class="frow two">
    <div class="field"><label>نام برند</label><input type="text" data-bf="name" value="${esc(b.name)}"></div><div class="field"><label>شناسه (پوشه در مخزن)</label><input type="text" dir="ltr" value="${esc(b.id)}" disabled></div>
    <div class="field"><label>نشانی سایت (در پاورقی)</label><input type="text" dir="ltr" data-bf="url" value="${esc(b.url || "")}"></div><div class="field"><label>نام صفحه در اینستاگرام</label><input type="text" data-bf="pageName" value="${esc(b.pageName || "")}" placeholder="برای پیش‌نمایش در جای واقعی"></div>
    <div class="field"><label>وضعیت هویت</label><input type="text" data-bf="status" value="${esc(b.status || "")}"></div><div class="field"><label>دعوت به اقدام پیش‌فرض</label><input type="text" data-bf="cta" value="${esc(b.cta || "")}"></div></div>
    <div class="field"><label>لحن و صدا</label><textarea data-bf="voice" rows="3">${esc(b.voice || "")}</textarea></div></div>
  <div class="panel section"><h3>رنگ‌ها <button class="btn sm" id="bc-add">+ رنگ</button></h3><div class="tscroll"><table class="doc"><thead><tr><th></th><th>شناسه</th><th>نام</th><th>HEX</th><th>یادداشت/منبع</th><th></th></tr></thead><tbody>${(b.colors || []).map(colorRow).join("")}</tbody></table></div>
    <h3 style="font-size:14px">گرادیان‌ها <button class="btn sm" id="bg-add">+ گرادیان</button></h3>${(b.gradients || []).map((g, i) => `<div class="addrow"><span class="sw" style="width:60px;height:30px;background:${esc(g.css)}"></span><input class="inp ltr" style="max-width:120px" value="${esc(g.id)}" data-bgr="${i}:id"><input class="inp" style="max-width:160px" value="${esc(g.name || "")}" data-bgr="${i}:name"><input class="inp ltr" value="${esc(g.css)}" data-bgr="${i}:css"><button class="btn sm ghost" data-bgdel="${i}">✕</button></div>`).join("") || `<span class="lead" style="font-size:12px">گرادیانی تعریف نشده.</span>`}</div>
  <div class="panel section"><h3>پوسته‌ها <span><button class="btn sm" id="th-add">+ پوسته (کپی اولی)</button> <button class="btn sm" id="role-add">+ نقش رنگ</button></span></h3>
    <div class="tscroll"><table class="doc"><thead><tr><th>پوسته</th>${roleKeys.map(k => `<th class="ltr">@${k}</th>`).join("")}<th></th></tr></thead><tbody>${b.themes.map((t, ti) => `<tr><td style="min-width:150px"><input value="${esc(t.name)}" data-thname="${ti}"><div class="ltr" style="font-size:11px;color:var(--mute)">${esc(t.id)}</div></td>${roleKeys.map(k => themeCell(t, ti, k)).join("")}<td><button class="btn sm ghost" data-thdel="${ti}">✕</button></td></tr><tr><td colspan="${roleKeys.length + 2}" style="background:var(--soft)">${contrastRow(t)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="panel section"><h3>فونت‌ها <span class="btn sm file">+ بارگذاری فایل فونت<input type="file" accept=".woff2,.woff,.ttf,.otf" id="font-up"></span></h3>
    <div class="frow">${["display", "body", "latin"].map(r => `<div class="field"><label>نقش ${{ display: "تیتر", body: "متن", latin: "لاتین" }[r]}</label><select data-frole="${r}">${families.map(f => `<option ${(b.fontRoles || {})[r] === f ? "selected" : ""}>${esc(f)}</option>`).join("")}<option ${!families.includes((b.fontRoles || {})[r]) ? "selected" : ""} value="${esc((b.fontRoles || {})[r] || "")}">${esc((b.fontRoles || {})[r] || "—")}</option></select></div>`).join("")}</div>
    <div class="tscroll"><table class="doc"><thead><tr><th>خانواده</th><th>وزن</th><th>فایل</th><th></th></tr></thead><tbody>${(b.fonts || []).map((f, i) => `<tr><td><input value="${esc(f.family)}" data-bfont="${i}:family"></td><td><input type="number" value="${f.weight || 400}" data-bfont="${i}:weight"></td><td class="ltr" style="font-size:11px">${esc(String(f.src).startsWith("data:") ? "بارگذاری‌شده (منتشر نشده)" : f.src)}</td><td><button class="btn sm ghost" data-bfontdel="${i}">✕</button></td></tr>`).join("")}</tbody></table></div>
    <div class="hint" style="font-size:12px;color:var(--mute)">مخزن عمومی است؛ هر فایل فونتی که منتشر کنید برای همه قابل دانلود است. مجوز فونت را بررسی کنید.</div></div>
  <div class="panel section"><h3>سبک‌های متن</h3><div class="tscroll"><table class="doc"><thead><tr><th>سبک</th><th>اندازه</th><th>وزن</th><th>فاصلهٔ خطوط</th><th>فونت</th><th></th></tr></thead><tbody>${Object.entries(b.type || {}).map(([k, v]) => `<tr><td class="ltr">${esc(k)}</td><td><input type="number" value="${v.size}" data-ty="${k}:size"></td><td><input type="number" value="${v.weight}" data-ty="${k}:weight"></td><td><input type="number" step="0.02" value="${v.lh}" data-ty="${k}:lh"></td><td><select data-ty="${k}:font">${["display", "body", "latin"].map(f => `<option ${v.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></td><td><span style="font-family:${esc(`"${(b.fontRoles || {})[v.font] || ""}"`)};font-weight:${v.weight};font-size:${Math.max(12, Math.round(v.size * .28))}px">نمونهٔ متن ۱۴۰۵</span></td></tr>`).join("")}</tbody></table></div><div class="addrow"><input class="inp ltr" id="ty-new" placeholder="نام سبک تازه (لاتین)"><button class="btn sm" id="ty-add">+ سبک</button></div></div>
  <div class="panel section"><h3>لوگوها <span class="btn sm file">+ بارگذاری لوگو<input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" id="logo-up"></span></h3>
    <div class="logo-grid">${(b.logos || []).map((l, i) => `<div class="logo-card"><div class="pv"><div style="background:#fff">${l.src ? `<img src="${esc(assetUrl(b.id, l.src))}" alt="">` : ""}</div><div style="background:#1b1d27">${l.src ? `<img src="${esc(assetUrl(b.id, l.src))}" alt="">` : ""}</div></div>
      <input class="inp" value="${esc(l.name || "")}" data-lg="${i}:name"><input class="inp ltr" value="${esc(l.id)}" data-lg="${i}:id"><input class="inp" value="${esc(l.note || "")}" data-lg="${i}:note" placeholder="قاعدهٔ استفاده">
      <div class="addrow"><span class="btn sm file">جایگزینی فایل<input type="file" accept="image/*" data-lgfile="${i}"></span><button class="btn sm danger" data-lgdel="${i}">حذف</button></div></div>`).join("")}</div>
    <h3 style="font-size:14px">دسته‌های لوگو <button class="btn sm" id="ls-add">+ دسته</button></h3><p class="lead" style="font-size:12px;margin:0">عنصر لوگو در قالب به یک «دسته» وصل است و نسخهٔ روشن یا تیره را خودکار از رنگ زمینه انتخاب می‌کند.</p>
    <div class="tscroll"><table class="doc"><thead><tr><th>دسته</th><th>روی زمینهٔ روشن</th><th>روی زمینهٔ تیره</th><th></th></tr></thead><tbody>${Object.entries(b.logoSets || {}).map(([k, v]) => `<tr><td class="ltr">${esc(k)}</td>${["light", "dark"].map(g => `<td><select data-ls="${k}:${g}"><option value="">— (پلاک سفید) —</option>${(b.logos || []).map(l => `<option value="${esc(l.id)}" ${v[g] === l.id ? "selected" : ""}>${esc(l.name || l.id)}</option>`).join("")}</select></td>`).join("")}<td><button class="btn sm ghost" data-lsdel="${k}">✕</button></td></tr>`).join("")}</tbody></table></div>
    <div class="field" style="max-width:260px"><label>فاصلهٔ امن لوگو (نسبت به ارتفاع)</label><input type="number" step="0.01" data-bf="clearSpace" value="${b.clearSpace ?? ""}"></div></div>
  <div class="panel section"><h3>کارهای برند</h3><div class="addrow" style="flex-wrap:wrap"><button class="btn" id="brand-dup">تکثیر این برند</button><button class="btn danger" id="brand-del">حذف این برند از این مرورگر</button></div></div>
  </section>`;
}

/* ================= FORMATS ================= */
function renderFormats() {
  const b = brand();
  const used = {}; b.templates.forEach(t => used[t.format] = (used[t.format] || 0) + 1);
  $("#main").innerHTML = `<section class="view"><h2>اندازه‌ها و محدوده‌های امن</h2><p class="lead">این فهرست بین همهٔ برندها مشترک است. محدودهٔ امن همان فاصلهٔ داخلی پیش‌فرض قاب است؛ نوار بالا/پایین جای رابط اپ را نشان می‌دهد.</p>
  <div class="tscroll"><table class="doc"><thead><tr><th>شناسه</th><th>نام</th><th>عرض</th><th>ارتفاع</th><th>امن بالا</th><th>راست</th><th>پایین</th><th>چپ</th><th>حاشیه</th><th>نوار رابط بالا</th><th>نوار رابط پایین</th><th>برش شبکه (عرض×ارتفاع)</th><th>قالب‌ها در این برند</th><th></th></tr></thead><tbody>
  ${S.formats.map((f, i) => { const top = (f.ui || []).find(u => u.side === "top"), bot = (f.ui || []).find(u => u.side === "bottom"); return `<tr><td><input class="ltr" value="${esc(f.id)}" data-fmt="${i}:id" style="min-width:80px"></td><td><input value="${esc(f.name)}" data-fmt="${i}:name" style="min-width:120px"></td><td><input type="number" value="${f.w}" data-fmt="${i}:w"></td><td><input type="number" value="${f.h}" data-fmt="${i}:h"></td>${["t", "r", "b", "l"].map(k => `<td><input type="number" value="${f.safe ? f.safe[k] : 0}" data-fmt="${i}:safe.${k}"></td>`).join("")}<td><input type="number" value="${f.margin || ""}" data-fmt="${i}:margin"></td><td><input type="number" value="${top ? top.h : ""}" data-fmtui="${i}:top"></td><td><input type="number" value="${bot ? bot.h : ""}" data-fmtui="${i}:bottom"></td><td><input class="ltr" value="${f.grid ? f.grid.w + "x" + f.grid.h : ""}" data-fmtgrid="${i}" placeholder="1012x1350"></td><td>${fa(used[f.id] || 0)}</td><td><button class="btn sm ghost" data-fmtdel="${i}" ${used[f.id] ? "disabled title='در حال استفاده'" : ""}>✕</button></td></tr>`; }).join("")}
  </tbody></table></div><div class="addrow" style="margin-top:10px"><button class="btn" id="fmt-add">+ اندازهٔ تازه</button></div>
  <div class="panel section" style="margin-top:16px"><h3>تبدیل گروهی</h3><div class="addrow" style="flex-wrap:wrap">همهٔ قالب‌های <select class="inp" style="max-width:200px" id="conv-from">${S.formats.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select> در برند «${esc(b.name)}» را به <select class="inp" style="max-width:200px" id="conv-to">${S.formats.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select><button class="btn primary" id="conv-go">تبدیل کن</button></div><p class="lead" style="font-size:12px;margin:0">مثلاً همهٔ پست‌های ۴:۵ را به ۳:۴ تبدیل کنید. قالب‌هایی که فاصلهٔ داخلی دستی دارند را بعد بررسی کنید.</p></div></section>`;
}

/* ================= RULES & HANDOFF ================= */
function renderRules() {
  const b = brand(); b.rules = b.rules || []; b.checklist = b.checklist || []; b.checklistState = b.checklistState || {};
  const used = {}; b.templates.forEach(t => used[t.format] = (used[t.format] || 0) + 1);
  $("#main").innerHTML = `<section class="view"><h2>قواعد برند و تحویل تولید · ${esc(b.name)}</h2>
  <div class="panel section"><h3>قواعد و منبع هر تصمیم <button class="btn sm" id="rule-add">+ قاعده</button></h3><div class="tscroll"><table class="doc"><thead><tr><th>موضوع</th><th>تصمیم</th><th>منبع</th><th></th></tr></thead><tbody>${b.rules.map((r, i) => `<tr><td style="width:18%"><input value="${esc(r.topic)}" data-rule="${i}:topic"></td><td><textarea rows="2" data-rule="${i}:decision">${esc(r.decision)}</textarea></td><td style="width:18%"><input value="${esc(r.source)}" data-rule="${i}:source"></td><td><button class="btn sm ghost" data-ruledel="${i}">✕</button></td></tr>`).join("")}</tbody></table></div></div>
  <div class="two"><div class="panel section"><h3>فهرست تأیید پیش از انتشار <button class="btn sm" id="chk-add">+ مورد</button></h3>${b.checklist.map((c, i) => `<div class="addrow"><input type="checkbox" data-chk="${i}" ${b.checklistState[i] ? "checked" : ""}><input class="inp" value="${esc(c)}" data-chktext="${i}"><button class="btn sm ghost" data-chkdel="${i}">✕</button></div>`).join("")}</div>
  <div class="panel section"><h3>خلاصهٔ تحویل</h3>
    <div><b>اندازه‌های استفاده‌شده:</b> ${Object.entries(used).map(([k, n]) => { const f = formatOf(S, k); return `<span class="pill">${esc(f.name)} ${fa(f.w)}×${fa(f.h)} · ${fa(n)}</span>`; }).join(" ")}</div>
    <div><b>فونت‌ها:</b> ${Object.entries(b.fontRoles || {}).map(([r, f]) => `<span class="pill">${r}: ${esc(f)}</span>`).join(" ")}</div>
    <div><b>لوگوها:</b> ${(b.logos || []).map(l => `<span class="pill ${l.src ? "ok" : "warn"}">${esc(l.name || l.id)}</span>`).join(" ")}</div>
    <div><b>مواردی که در قالب‌ها باز مانده:</b><ul style="margin:4px 0;padding-inline-start:18px">${b.templates.map(t => { const r = renderFrame(S, b, t, {}); const n = checkTemplate(S, b, t, r.report).filter(x => x[0] === "w").length; return n ? `<li><a href="#" data-open="${esc(t.id)}">${esc(t.name)}</a>: ${fa(n)} مورد</li>` : ""; }).join("")}</ul></div></div></div></section>`;
}

/* ================= PUBLISH ================= */
function renderPublish() {
  const g = S.gh;
  const rows = S.order.map(id => `<tr><td><b>${esc(S.brands[id].name)}</b> <span class="ltr" style="color:var(--mute);font-size:11px">${id}</span></td><td>${S.localOnly[id] ? `<span class="pill warn">فقط در این مرورگر</span>` : S.dirty[id] ? `<span class="pill warn">تغییرات منتشرنشده</span>` : `<span class="pill ok">منتشرشده</span>`}</td><td><div class="addrow" style="flex-wrap:wrap"><button class="btn sm primary" data-pub="${id}">انتشار در گیت‌هاب</button><button class="btn sm" data-projexp="${id}">دانلود فایل پروژه</button><button class="btn sm" data-manual="${id}">بارگذاری دستی</button>${S.dirty[id] && !S.localOnly[id] ? `<button class="btn sm danger" data-revert="${id}">دور ریختن تغییرات</button>` : ""}</div></td></tr>`).join("");
  $("#main").innerHTML = `<section class="view"><h2>ذخیره و انتشار</h2>
  <p class="lead">هر تغییری خودکار در همین مرورگر ذخیره می‌شود (IndexedDB). برای ماندگاری واقعی، یا در گیت‌هاب منتشر کنید (بعد از حدود یک دقیقه روی سایت دیده می‌شود و روی هر دستگاهی در دسترس است)، یا فایل پروژه را دانلود و نگه دارید.</p>
  <div class="panel section"><h3>برندها</h3><div class="tscroll"><table class="doc"><tbody>${rows}<tr><td><b>اندازه‌ها</b> (مشترک)</td><td>${S.dirty.__formats ? `<span class="pill warn">تغییرات منتشرنشده</span>` : `<span class="pill ok">منتشرشده</span>`}</td><td><button class="btn sm primary" id="pub-formats">انتشار اندازه‌ها</button></td></tr></tbody></table></div>
    <div class="addrow" style="flex-wrap:wrap"><button class="btn primary" id="pub-all">انتشار همهٔ تغییرات</button><span class="btn file">باز کردن فایل پروژه (.json)<input type="file" accept=".json,application/json" id="proj-imp"></span></div></div>
  <div class="panel section"><h3>اتصال به گیت‌هاب</h3>
    <div class="frow"><div class="field"><label>حساب</label><input type="text" dir="ltr" data-gh="owner" value="${esc(g.owner)}"></div><div class="field"><label>مخزن</label><input type="text" dir="ltr" data-gh="repo" value="${esc(g.repo)}"></div><div class="field"><label>شاخه</label><input type="text" dir="ltr" data-gh="branch" value="${esc(g.branch)}"></div></div>
    <div class="field"><label>توکن دسترسی (Fine-grained personal access token)</label><input type="password" dir="ltr" data-gh="token" value="${esc(g.token)}" autocomplete="off" placeholder="github_pat_..."></div>
    <label class="check"><input type="checkbox" data-gh="remember" ${g.remember ? "checked" : ""}> توکن را در این مرورگر نگه دار (روی کامپیوتر مشترک خاموش کنید)</label>
    <div class="addrow"><button class="btn" id="gh-test">آزمایش اتصال</button></div>
    <details class="fset"><summary>ساختن توکن در دو دقیقه</summary><ol style="margin:6px 0;padding-inline-start:20px;font-size:13px">
      <li>در گیت‌هاب: Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
      <li>Repository access: <b>Only select repositories</b> → <span class="ltr">${esc(g.repo)}</span>.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. بقیه را دست نزنید.</li>
      <li>تاریخ انقضا بگذارید (مثلاً یک سال)، توکن را کپی و این‌جا بچسبانید.</li></ol>
      <p style="font-size:12.5px;margin:0">توکن فقط در مرورگر شما می‌ماند و مستقیم به api.github.com فرستاده می‌شود. اگر لو رفت، از همان صفحه حذفش کنید.</p></details>
    <div class="log" id="gh-log">${esc(S.log.join("\n")) || "هنوز کاری انجام نشده."}</div></div></section>`;
}
function logGH(m) { S.log.push(new Date().toLocaleTimeString("fa-IR") + " · " + m); const el = $("#gh-log"); if (el) { el.textContent = S.log.join("\n"); el.scrollTop = el.scrollHeight; } }
async function publishBrand(id) {
  const gh = new GitHub(S.gh); if (!gh.ok) { toast("اول حساب، مخزن و توکن را در بخش «اتصال به گیت‌هاب» وارد کنید"); S.ui.view = "publish"; render(); return false; }
  try {
    logGH(`انتشار «${S.brands[id].name}»…`);
    const pub = await gh.publishBrand(S.brands[id], m => logGH(m));
    if (S.localOnly[id] || !S.published[id]) {
      logGH("به‌روزرسانی فهرست برندها");
      const ids = [...new Set([...S.order.filter(x => S.published[x] || x === id)])];
      await gh.putText("brands/index.json", JSON.stringify({ brands: ids }, null, 2), `Add brand ${id}`);
    }
    S.brands[id] = pub; S.published[id] = JSON.stringify(pub); S.dirty[id] = false; delete S.localOnly[id];
    await idbDel("draft:" + id); injectFonts();
    logGH("✓ منتشر شد. سایت تا حدود یک دقیقه دیگر به‌روز می‌شود."); toast("منتشر شد"); return true;
  } catch (e) { logGH("✕ " + (e.message || e)); toast("انتشار ناموفق بود؛ جزئیات در گزارش"); return false; }
}
async function publishFormats() {
  const gh = new GitHub(S.gh); if (!gh.ok) { toast("اتصال گیت‌هاب تنظیم نشده"); return; }
  try { logGH("انتشار اندازه‌ها…"); await gh.putText("data/formats.json", JSON.stringify(S.formats, null, 2), "Update formats from Brand Studio"); S.pubFormats = JSON.stringify(S.formats); S.dirty.__formats = false; await idbDel("draft:formats"); logGH("✓ اندازه‌ها منتشر شد"); }
  catch (e) { logGH("✕ " + e.message); }
}

/* ================= NEW BRAND ================= */
function starterBrand(id, name) {
  const b = {
    id, name, url: "", status: "تازه", voice: "", cta: "", clearSpace: 0.25,
    colors: [{ id: "primary", name: "رنگ اصلی", hex: "#3D4BD8" }, { id: "dark", name: "تیره", hex: "#14162B" }, { id: "light", name: "روشن", hex: "#FFFFFF" }, { id: "soft", name: "ملایم", hex: "#EEF0FB" }, { id: "gray", name: "خاکستری", hex: "#8A8FA3" }, { id: "red", name: "هشدار", hex: "#B3261E" }],
    gradients: [], fonts: [...[["Regular", 400], ["Bold", 700], ["ExtraBold", 800]].map(([n, w]) => ({ family: "Kalameh", weight: w, src: `../mehrayan/fonts/KalamehNoEn-${n}.woff2` })), ...[400, 600, 700].map(w => ({ family: "Open Sans", weight: w, src: `../_shared/fonts/open-sans-${w}.woff2` }))],
    fontRoles: { display: "Kalameh", body: "Kalameh", latin: "Open Sans" },
    type: { display: { size: 128, weight: 800, lh: 1.3, font: "display" }, h1: { size: 96, weight: 800, lh: 1.35, font: "display" }, h2: { size: 72, weight: 800, lh: 1.35, font: "display" }, lead: { size: 48, weight: 400, lh: 1.7, font: "body" }, body: { size: 42, weight: 400, lh: 1.75, font: "body" }, small: { size: 32, weight: 500, lh: 1.6, font: "body" }, label: { size: 36, weight: 700, lh: 1.3, font: "body" } },
    logos: [], logoSets: { primary: { light: "", dark: "" } },
    themes: [
      { id: "light", name: "روشن", bg: "light", text: "dark", muted: "gray", accent: "primary", line: "gray", card: "soft", cardText: "dark", cta: "primary", ctaText: "light", pill: "soft", pillText: "dark", chip: "soft", chipText: "dark", band: "light", bandText: "dark" },
      { id: "dark", name: "تیره", bg: "dark", text: "light", muted: "gray", accent: "primary", line: "gray", card: "light", cardText: "dark", cta: "light", ctaText: "dark", pill: "light", pillText: "dark", chip: "light", chipText: "dark", band: "dark", bandText: "light" },
      { id: "brand", name: "رنگ برند", bg: "primary", text: "light", muted: "light", accent: "light", line: "light", card: "light", cardText: "dark", cta: "light", ctaText: "dark", pill: "light", pillText: "dark", chip: "light", chipText: "dark", band: "primary", bandText: "light" }],
    templates: [], sets: [], grid: { ids: [], pinned: 3 }, highlights: { template: "", items: [] }, rules: [], checklist: ["لوگوهای رسمی", "مجوز فونت", "تأیید رنگ‌ها"], checklistState: {}
  };
  const base = (tid, name, fmt, family, extra = []) => ({ id: tid, name, family, stage: "آگاهی", format: fmt, theme: "light", themes: ["light", "dark", "brand"], gap: 40,
    fields: { kicker: "برچسب", h: "تیتر اصلی این‌جا می‌آید", b: "متن توضیحی کوتاه و روشن.", cta: "دعوت به اقدام" }, fieldMeta: { kicker: { label: "برچسب" }, h: { label: "تیتر", multi: true, max: 50 }, b: { label: "متن اصلی", multi: true, max: 160 }, cta: { label: "دعوت به اقدام" } },
    blocks: [{ type: "row", children: [{ type: "logo", set: "primary", h: 100 }] }, { type: "text", role: "label", field: "kicker", marker: "square", align: "start" }, { type: "text", role: "h1", field: "h", fit: { ref: 30 } }, { type: "text", role: "body", field: "b" }, ...extra, { type: "text", role: "label", field: "cta", bg: "@cta", color: "@ctaText", pad: [22, 40], radius: 12, align: "start" }, { type: "footer", pager: "none", push: true }], floats: [] });
  b.templates.push(base("post", "پست پایه", "post45", "پایه"), base("story", "استوری پایه", "story", "پایه"), base("cover", "کاور ریلز پایه", "reel", "پایه"));
  b.templates.forEach(ensureIds);
  b.sets = [{ id: "base", name: "پایه", ids: ["post", "story", "cover"] }]; b.grid.ids = ["post", "cover"];
  return b;
}
function newBrandModal() {
  modal(`<h3>برند تازه</h3><div class="field"><label>نام برند</label><input type="text" id="nb-name" placeholder="مثلاً دستان"></div>
    <div class="field"><label>شناسه (فقط حروف لاتین کوچک، عدد و خط تیره)</label><input type="text" dir="ltr" id="nb-id" placeholder="dastan"></div>
    <div class="field"><label>شروع از</label><select id="nb-from"><option value="">برند خالی با سه قالب پایه</option>${S.order.map(id => `<option value="${id}">کپی کامل «${esc(S.brands[id].name)}»</option>`).join("")}</select></div>
    <p class="lead" style="margin:0;font-size:12.5px">بعد از ساختن، در «هویت برند» رنگ، فونت و لوگو را عوض کنید.</p>
    <div class="acts"><button class="btn primary" id="nb-go">بساز</button><button class="btn ghost" data-close>انصراف</button></div><div id="nb-err" style="color:var(--warn)"></div>`);
}
function modal(html) { $("#modal-box").innerHTML = html; $("#modal").hidden = false; const f = $("#modal-box input,#modal-box select"); if (f) f.focus(); }
function closeModal() { $("#modal").hidden = true; }
async function importProject(file) {
  let data; try { data = JSON.parse(await readFile(file, "text")); } catch (e) { toast("فایل پروژه خوانا نیست"); return; }
  const brands = data.brands ? data.brands : [data];
  for (const b of brands) {
    if (!b || !b.id || !b.templates) { toast("این فایل پروژهٔ برند نیست"); return; }
    let id = b.id; if (S.brands[id]) { id = id + "-" + Math.random().toString(36).slice(2, 5); b.id = id; b.name = b.name + " (واردشده)"; }
    b.templates.forEach(ensureIds);
    S.brands[id] = b; S.order.push(id); S.localOnly[id] = true; markDirty(id);
    S.ui.brand = id;
  }
  injectFonts(); toast("پروژه وارد شد؛ در این مرورگر ذخیره شد"); render();
}

/* ================= EVENTS ================= */
document.addEventListener("click", async e => {
  const el = e.target.closest("button,[data-open],.layer,[data-bid],a[data-open]");
  if (!el) return;
  const d = el.dataset;
  if (el.id === "toggle-guides") { S.ui.guides = !S.ui.guides; render(); return; }
  if (el.id === "go-publish") { S.ui.view = "publish"; render(); return; }
  if (el.id === "new-brand") { newBrandModal(); return; }
  if (d.close != null) { closeModal(); return; }
  if (el.id === "nb-go") {
    const name = $("#nb-name").value.trim(), id = $("#nb-id").value.trim().toLowerCase(), from = $("#nb-from").value;
    if (!name || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) { $("#nb-err").textContent = "نام و شناسهٔ لاتین معتبر لازم است."; return; }
    if (S.brands[id]) { $("#nb-err").textContent = "این شناسه قبلاً استفاده شده."; return; }
    let b; if (from) { b = clone(S.brands[from]); b.id = id; b.name = name; b.fonts = (b.fonts || []).map(f => Object.assign(f, { src: /^(data:|https?:|\.\.\/)/.test(f.src) ? f.src : `../${from}/${f.src}` })); b.logos = (b.logos || []).map(l => Object.assign(l, { src: !l.src || /^(data:|https?:|\.\.\/)/.test(l.src) ? l.src : `../${from}/${l.src}` })); b.templates.forEach(t => { for (const k of Object.keys(t.fields || {})) { const v = t.fields[k]; if (typeof v === "string" && /^(assets|logos)\//.test(v)) t.fields[k] = `../${from}/${v}`; } }); }
    else b = starterBrand(id, name);
    S.brands[id] = b; S.order.push(id); S.localOnly[id] = true; S.ui.brand = id; S.ui.view = "brand"; markDirty(id); injectFonts(); closeModal(); render(); return;
  }
  if (d.view) { S.ui.view = d.view; render(); window.scrollTo({ top: 0 }); return; }
  if (d.open) { e.preventDefault(); S.ui.tpl[S.ui.brand] = d.open; S.ui.view = "editor"; S.ui.sel = null; S.hist = []; S.fut = []; render(); window.scrollTo({ top: 0 }); return; }
  if (d.tpl) { S.ui.tpl[S.ui.brand] = d.tpl; S.ui.sel = null; S.hist = []; S.fut = []; saveUI(); renderEditor(); return; }
  if (d.mode) { S.ui.mode = d.mode; saveUI(); renderEditor(); return; }
  if (d.theme) { mut(t => { t.theme = d.theme; }, { insp: true }); drawThemebar(); return; }
  if (d.itab) { S.ui.itab = d.itab; saveUI(); drawInspector(); return; }
  if (el.id === "undo") { undo(); return; } if (el.id === "redo") { redo(); return; }
  if (el.id === "export") { el.disabled = true; await exportTemplate(tpl()); el.disabled = false; return; }
  // template list tools
  if (el.id === "t-new") {
    modal(`<h3>قالب تازه</h3><div class="field"><label>نام</label><input type="text" id="nt-name" value="قالب تازه"></div><div class="field"><label>اندازه</label><select id="nt-fmt">${S.formats.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div><div class="field"><label>شروع از</label><select id="nt-from"><option value="">قالب پایه (لوگو، تیتر، متن، دکمه)</option>${brand().templates.map(t => `<option value="${esc(t.id)}">کپی «${esc(t.name)}»</option>`).join("")}</select></div><div class="acts"><button class="btn primary" id="nt-go">بساز</button><button class="btn ghost" data-close>انصراف</button></div>`); return;
  }
  if (el.id === "nt-go") {
    const b = brand(); const from = $("#nt-from").value; let t;
    if (from) t = clone(b.templates.find(x => x.id === from)); else { t = starterBrand("x", "x").templates[0]; const sb = Object.keys(b.logoSets || {})[0]; walk(t.blocks, bl => { if (bl.type === "logo") bl.set = sb; }); t.themes = b.themes.map(x => x.id); t.theme = t.themes[0]; }
    t.name = $("#nt-name").value.trim() || "قالب تازه"; t.format = $("#nt-fmt").value; t.id = "t" + Date.now().toString(36); delete t.pad; ensureIds(t); const f = b => { b.id = uid(); (b.children || []).forEach(f); }; (t.blocks || []).forEach(f); (t.floats || []).forEach(f);
    b.templates.push(t); S.ui.tpl[b.id] = t.id; markDirty(); closeModal(); renderEditor(); return;
  }
  if (el.id === "t-dup") { const b = brand(), t = tpl(); if (!t) return; const c = clone(t); c.id = t.id + "-" + Math.random().toString(36).slice(2, 5); c.name = t.name + " (کپی)"; b.templates.splice(b.templates.indexOf(t) + 1, 0, c); S.ui.tpl[b.id] = c.id; markDirty(); renderEditor(); return; }
  if (el.id === "t-up" || el.id === "t-down") { const b = brand(), t = tpl(); const i = b.templates.indexOf(t), j = i + (el.id === "t-up" ? -1 : 1); if (j < 0 || j >= b.templates.length) return; b.templates.splice(i, 1); b.templates.splice(j, 0, t); markDirty(); drawList(); return; }
  if (el.id === "t-del") { const t = tpl(); if (!t) return; modal(`<h3>حذف «${esc(t.name)}»؟</h3><p class="lead" style="margin:0">از توالی‌ها و شبکه هم برداشته می‌شود. تا انتشار، نسخهٔ منتشرشده در گیت‌هاب دست نمی‌خورد.</p><div class="acts"><button class="btn danger" id="t-del-go">حذف کن</button><button class="btn ghost" data-close>انصراف</button></div>`); return; }
  if (el.id === "t-del-go") { const b = brand(), t = tpl(); b.templates = b.templates.filter(x => x !== t); (b.sets || []).forEach(s => s.ids = s.ids.filter(i => i !== t.id)); if (b.grid) b.grid.ids = b.grid.ids.filter(i => i !== t.id); S.ui.tpl[b.id] = (b.templates[0] || {}).id; markDirty(); closeModal(); renderEditor(); return; }
  // selection on canvas
  if (el.closest("#fw") && !el.closest(".selbox")) { const bl = e.target.closest("[data-bid]"); if (bl) { S.ui.sel = bl.dataset.bid; if (S.ui.itab === "content") S.ui.itab = "element"; drawSelection(); drawInspector(); } return; }
  if (d.issue) { S.ui.sel = d.issue; S.ui.itab = "element"; drawSelection(); drawInspector(); return; }
  // layers
  if (d.lhide) { mut(() => { const h = findBlock(tpl(), d.lhide); h.block.hidden = !h.block.hidden || undefined; }, { insp: true }); return; }
  if (d.lmove) { const [id, dd] = d.lmove.split(":"); mut(() => moveBlock(id, +dd), { insp: true }); return; }
  if (d.ldup) { mut(() => dupBlock(d.ldup), { insp: true }); return; }
  if (d.ldel) { mut(() => removeBlock(d.ldel), { insp: true }); return; }
  if (el.classList.contains("layer") && d.layer) { S.ui.sel = d.layer; drawSelection(); drawInspector(); return; }
  if (el.id === "add-go") {
    const type = $("#add-type").value, where = $("#add-where").value; const nb = NEW_BLOCK[type](); ensureIds({ blocks: [nb] });
    mut(t => {
      const hit = S.ui.sel && findBlock(t, S.ui.sel);
      if (where === "float") { nb.float = { x: 120, y: 200, w: 600 }; t.floats = t.floats || []; t.floats.push(nb); }
      else if (where === "inside" && hit && (hit.block.type === "card" || hit.block.type === "row")) (hit.block.children = hit.block.children || []).push(nb);
      else if (where === "after" && hit) hit.list.splice(hit.index + 1, 0, nb);
      else t.blocks.push(nb);
      if (nb.field && !(t.fields || {}).hasOwnProperty(nb.field)) { t.fields[nb.field] = ""; t.fieldMeta = t.fieldMeta || {}; t.fieldMeta[nb.field] = { label: nb.field, multi: type === "list" || type === "table", type: type === "image" ? "image" : undefined }; }
      S.ui.sel = nb.id;
    }, { insp: true }); S.ui.itab = "element"; drawInspector(); return;
  }
  if (d.el) {
    const id = S.ui.sel; if (!id) return;
    if (d.el === "del") mut(() => removeBlock(id), { insp: true });
    if (d.el === "dup") mut(() => dupBlock(id), { insp: true });
    if (d.el === "up" || d.el === "down") mut(() => moveBlock(id, d.el === "up" ? -1 : 1), { insp: true });
    if (d.el === "float") mut(() => toggleFloat(id), { insp: true });
    return;
  }
  if (el.id === "clear-theme-ov") { mut(t => { const h = findBlock(t, S.ui.sel); delete h.block.byTheme[t.theme]; if (!Object.keys(h.block.byTheme).length) delete h.block.byTheme; }, { insp: true }); return; }
  if (el.id === "nf-add") { const k = $("#nf-key").value.trim(), l = $("#nf-label").value.trim(); if (!/^[A-Za-z_][\w]*$/.test(k)) { toast("کلید باید لاتین باشد"); return; } mut(t => { t.fields = t.fields || {}; t.fieldMeta = t.fieldMeta || {}; if (!(k in t.fields)) t.fields[k] = ""; t.fieldMeta[k] = Object.assign(t.fieldMeta[k] || {}, { label: l || k }); }, { insp: true }); return; }
  if (d.delfield) { mut(t => { delete t.fields[d.delfield]; delete (t.fieldMeta || {})[d.delfield]; }, { insp: true }); return; }
  if (d.clearfield) { mut(t => { t.fields[d.clearfield] = ""; }, { insp: true }); return; }
  // sets
  if (d.setexport) { const b = brand(), s = b.sets[+d.setexport]; el.disabled = true; let i = 0; for (const id of s.ids) { const t = b.templates.find(x => x.id === id); if (t) { i++; await exportTemplate(t, b, i); await new Promise(r => setTimeout(r, 400)); } } el.disabled = false; toast(`${fa(i)} تصویر ساخته شد`); return; }
  if (d.setdel) { bmut(b => b.sets.splice(+d.setdel, 1)); return; }
  if (d.setmv) { const [si, i, dd] = d.setmv.split(":").map(Number); bmut(b => { const a = b.sets[si].ids; const j = i + dd; if (j < 0 || j >= a.length) return; const [x] = a.splice(i, 1); a.splice(j, 0, x); }); return; }
  if (d.setrm) { const [si, i] = d.setrm.split(":").map(Number); bmut(b => b.sets[si].ids.splice(i, 1)); return; }
  if (el.id === "set-new") { bmut(b => b.sets.push({ id: "set" + Date.now().toString(36), name: "توالی تازه", ids: [] })); return; }
  // grid
  if (d.gmv) { const [i, dd] = d.gmv.split(":").map(Number); bmut(b => { const a = b.grid.ids, j = i + dd; if (j < 0 || j >= a.length) return; const [x] = a.splice(i, 1); a.splice(j, 0, x); }); return; }
  if (d.grm) { bmut(b => b.grid.ids.splice(+d.grm, 1)); return; }
  if (d.hlrm) { bmut(b => b.highlights.items.splice(+d.hlrm, 1)); return; }
  if (el.id === "hl-add") { bmut(b => b.highlights.items.push({ text: "واژه", theme: (b.themes[0] || {}).id })); return; }
  // brand
  if (el.id === "bc-add") { bmut(b => b.colors.push({ id: "c" + (b.colors.length + 1), name: "رنگ تازه", hex: "#888888" })); return; }
  if (d.bcdel) { bmut(b => b.colors.splice(+d.bcdel, 1)); return; }
  if (el.id === "bg-add") { bmut(b => { b.gradients = b.gradients || []; b.gradients.push({ id: "g" + (b.gradients.length + 1), name: "گرادیان", css: "linear-gradient(135deg,#3D4BD8,#14162B)" }); }); return; }
  if (d.bgdel) { bmut(b => b.gradients.splice(+d.bgdel, 1)); return; }
  if (el.id === "th-add") { bmut(b => { const c = clone(b.themes[0]); c.id = "theme" + (b.themes.length + 1); c.name = "پوستهٔ تازه"; b.themes.push(c); }); return; }
  if (el.id === "role-add") { modal(`<h3>نقش رنگ تازه</h3><div class="field"><label>نام نقش (لاتین، مثلاً highlight)</label><input type="text" dir="ltr" id="nr-key"></div><div class="acts"><button class="btn primary" id="nr-go">افزودن</button><button class="btn ghost" data-close>انصراف</button></div>`); return; }
  if (el.id === "nr-go") { const k = $("#nr-key").value.trim(); if (!/^[A-Za-z]\w*$/.test(k)) return; bmut(b => b.themes.forEach(t => { if (!(k in t)) t[k] = t.text || ""; })); closeModal(); return; }
  if (d.thdel) { const b = brand(); if (b.themes.length < 2) { toast("دست‌کم یک پوسته لازم است"); return; } bmut(b => b.themes.splice(+d.thdel, 1)); return; }
  if (d.bfontdel) { bmut(b => b.fonts.splice(+d.bfontdel, 1)); injectFonts(); return; }
  if (el.id === "ty-add") { const k = $("#ty-new").value.trim(); if (!/^[A-Za-z]\w*$/.test(k)) return; bmut(b => b.type[k] = { size: 40, weight: 400, lh: 1.6, font: "body" }); return; }
  if (d.lgdel) { bmut(b => b.logos.splice(+d.lgdel, 1)); return; }
  if (el.id === "ls-add") { modal(`<h3>دستهٔ لوگوی تازه</h3><div class="field"><label>نام دسته (لاتین)</label><input type="text" dir="ltr" id="nls-key" placeholder="horizontal"></div><div class="acts"><button class="btn primary" id="nls-go">افزودن</button><button class="btn ghost" data-close>انصراف</button></div>`); return; }
  if (el.id === "nls-go") { const k = $("#nls-key").value.trim(); if (!/^[A-Za-z]\w*$/.test(k)) return; bmut(b => { b.logoSets = b.logoSets || {}; b.logoSets[k] = { light: "", dark: "" }; }); closeModal(); return; }
  if (d.lsdel) { bmut(b => delete b.logoSets[d.lsdel]); return; }
  if (el.id === "brand-dup") { S.ui.view = "brand"; newBrandModal(); $("#nb-from").value = S.ui.brand; return; }
  if (el.id === "brand-del") { modal(`<h3>حذف «${esc(brand().name)}» از این مرورگر؟</h3><p class="lead" style="margin:0">نسخهٔ منتشرشده در گیت‌هاب (اگر هست) پاک نمی‌شود و بعد از بارگذاری دوباره برمی‌گردد. برای حذف کامل، پوشهٔ brands/${esc(S.ui.brand)} را در گیت‌هاب پاک کنید.</p><div class="acts"><button class="btn danger" id="brand-del-go">حذف کن</button><button class="btn ghost" data-close>انصراف</button></div>`); return; }
  if (el.id === "brand-del-go") { const id = S.ui.brand; await idbDel("draft:" + id); delete S.brands[id]; S.order = S.order.filter(x => x !== id); delete S.dirty[id]; await idbSet("local-order", S.order); S.ui.brand = S.order[0] || ""; closeModal(); render(); return; }
  // formats
  if (el.id === "fmt-add") { S.formats.push({ id: "custom" + (S.formats.length + 1), name: "اندازهٔ تازه", w: 1080, h: 1080, safe: { t: 80, r: 80, b: 80, l: 80 } }); saveFormats(); render(); return; }
  if (d.fmtdel) { S.formats.splice(+d.fmtdel, 1); saveFormats(); render(); return; }
  if (el.id === "conv-go") { const from = $("#conv-from").value, to = $("#conv-to").value; let n = 0; bmut(b => b.templates.forEach(t => { if (t.format === from) { t.format = to; n++; } })); toast(`${fa(n)} قالب تبدیل شد`); return; }
  // rules
  if (el.id === "rule-add") { bmut(b => b.rules.push({ topic: "", decision: "", source: "" })); return; }
  if (d.ruledel) { bmut(b => b.rules.splice(+d.ruledel, 1)); return; }
  if (el.id === "chk-add") { bmut(b => b.checklist.push("مورد تازه")); return; }
  if (d.chkdel) { bmut(b => { b.checklist.splice(+d.chkdel, 1); b.checklistState = {}; }); return; }
  // publish
  if (el.id === "gh-test") { try { const j = await new GitHub(S.gh).test(); logGH(`✓ اتصال برقرار است: ${j.full_name} (${j.private ? "خصوصی" : "عمومی"})`); } catch (err) { logGH("✕ " + err.message); } return; }
  if (d.pub) { el.disabled = true; await publishBrand(d.pub); renderPublish(); updateSaveState(); return; }
  if (el.id === "pub-formats") { await publishFormats(); renderPublish(); return; }
  if (el.id === "pub-all") { el.disabled = true; for (const id of S.order) if (S.dirty[id]) await publishBrand(id); if (S.dirty.__formats) await publishFormats(); renderPublish(); updateSaveState(); return; }
  if (d.manual) {
    const id = d.manual; const b = S.brands[id];
    download(`brand.json`, JSON.stringify(b, null, 2));
    modal(`<h3>بارگذاری دستی «${esc(b.name)}» بدون API</h3><ol style="margin:0;padding-inline-start:20px;line-height:2">
      <li>فایل <b class="ltr">brand.json</b> همین حالا دانلود شد (تصویرها و فونت‌های تازه داخل خودش هستند).</li>
      <li>در گیت‌هاب به مخزن <span class="ltr">${esc(S.gh.owner)}/${esc(S.gh.repo)}</span> بروید، پوشهٔ <span class="ltr">brands/${esc(id)}/</span> را باز کنید${S.published[id] ? "" : " (اگر نیست: Add file → Upload files و مسیر را در نام فایل بنویسید)"}.</li>
      <li>Add file → <b>Upload files</b> → فایل را بکشید → Commit changes.</li>
      ${S.published[id] ? "" : `<li>برند تازه است؛ فایل <span class="ltr">brands/index.json</span> را هم ویرایش کنید و <span class="ltr">"${esc(id)}"</span> را به فهرست اضافه کنید.</li>`}
      <li>بعد از حدود یک دقیقه سایت به‌روز می‌شود. اگر نسخهٔ این مرورگر با سایت یکی شد، «دور ریختن تغییرات» نسخهٔ محلی را با نسخهٔ سایت هم‌سان می‌کند.</li></ol>
      <div class="acts"><button class="btn primary" data-close>فهمیدم</button></div>`);
    return;
  }
  if (d.projexp) { const b = await inlineAssets(S.brands[d.projexp]); download(`${b.id}-brand-studio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2)); return; }
  if (d.revert) { const id = d.revert; S.brands[id] = JSON.parse(S.published[id]); S.brands[id].templates.forEach(ensureIds); S.dirty[id] = false; await idbDel("draft:" + id); injectFonts(); render(); toast("به نسخهٔ منتشرشده برگشت"); return; }
});
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

/* ---- inputs ---- */
let histArmed = null;
document.addEventListener("focusin", e => { const el = e.target; if (el.closest && el.closest("#insp") && (el.dataset.field || el.dataset.prop || el.dataset.tp || el.dataset.fm)) { if (histArmed !== el) { pushHist(); histArmed = el; } } });
let pvT = null;
const soon = (fn, ms = 90) => { clearTimeout(pvT); pvT = setTimeout(fn, ms); };
document.addEventListener("input", e => {
  const el = e.target, d = el.dataset;
  if (el.id === "tq") { S.ui.q = el.value; drawList(); const q = $("#tq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
  if (d.field != null) {
    const t = tpl(); t.fields[d.field] = el.value; markDirty();
    const m = (t.fieldMeta || {})[d.field] || {}; const c = $("#cnt-" + CSS.escape(d.field)); if (c) { c.textContent = fa(el.value.length) + (m.max ? " / " + fa(m.max) : ""); c.classList.toggle("over", !!m.max && el.value.length > m.max); }
    soon(drawPreview); return;
  }
  if (d.prop && el.type !== "checkbox" && el.tagName !== "SELECT") { const hit = findBlock(tpl(), S.ui.sel); if (!hit) return; setProp(hit.block, d.prop, parseVal(el)); markDirty(); soon(drawPreview); return; }
  if (d.colorhex) { const hit = findBlock(tpl(), S.ui.sel); if (!hit) return; setProp(hit.block, d.colorhex, el.value); markDirty(); soon(drawPreview); return; }
  if (d.tphex) { tpl()[d.tphex] = el.value; markDirty(); soon(drawPreview); return; }
  if (d.tp && el.tagName !== "SELECT") {
    const t = tpl();
    if (d.tp === "pad") { const ns = el.value.trim().split(/[\s,،]+/).filter(Boolean).map(Number); if (!el.value.trim()) delete t.pad; else if (ns.length === 4 && ns.every(n => !isNaN(n))) t.pad = ns; }
    else if (d.tp === "gap") t.gap = el.value === "" ? undefined : +el.value;
    else if (d.tp === "id") { const v = el.value.trim(); if (!/^[\w-]+$/.test(v) || brand().templates.some(x => x !== t && x.id === v)) return; const old = t.id; t.id = v; S.ui.tpl[brand().id] = v; (brand().sets || []).forEach(s => s.ids = s.ids.map(i => i === old ? v : i)); if (brand().grid) brand().grid.ids = brand().grid.ids.map(i => i === old ? v : i); }
    else t[d.tp] = el.value;
    markDirty(); soon(() => { drawPreview(); if (d.tp === "name" || d.tp === "family" || d.tp === "stage") drawList(); }); return;
  }
  if (d.fm && el.type !== "checkbox" && el.tagName !== "SELECT") { const [k, prop] = d.fm.split(":"); const t = tpl(); t.fieldMeta = t.fieldMeta || {}; t.fieldMeta[k] = t.fieldMeta[k] || {}; const v = prop === "max" ? (el.value === "" ? undefined : +el.value) : el.value || undefined; if (v === undefined) delete t.fieldMeta[k][prop]; else t.fieldMeta[k][prop] = v; markDirty(); soon(drawPreview); return; }
  // brand-level text inputs (no full rerender while typing)
  const b = brand();
  if (d.bf) { b[d.bf] = d.bf === "clearSpace" ? (el.value === "" ? undefined : +el.value) : el.value; markDirty(); if (d.bf === "name") $("#brand-select").selectedOptions[0].textContent = el.value; return; }
  if (d.bc) { const [i, k] = d.bc.split(":"); b.colors[+i][k] = el.value; markDirty(); if (el.type === "color") { const tx = el.closest("tr").querySelector(`input[data-bc="${i}:hex"]:not([type=color])`); if (tx) tx.value = el.value; } return; }
  if (d.bgr) { const [i, k] = d.bgr.split(":"); b.gradients[+i][k] = el.value; markDirty(); if (k === "css") el.parentElement.querySelector(".sw").style.background = el.value; return; }
  if (d.thname) { b.themes[+d.thname].name = el.value; markDirty(); return; }
  if (d.bfont) { const [i, k] = d.bfont.split(":"); b.fonts[+i][k] = k === "weight" ? +el.value : el.value; markDirty(); clearTimeout(injectFonts.t); injectFonts.t = setTimeout(injectFonts, 500); return; }
  if (d.ty && el.tagName !== "SELECT") { const [k, p] = d.ty.split(":"); b.type[k][p] = +el.value; markDirty(); return; }
  if (d.lg) { const [i, k] = d.lg.split(":"); b.logos[+i][k] = el.value; markDirty(); return; }
  if (d.setname) { b.sets[+d.setname].name = el.value; markDirty(); return; }
  if (d.setnote) { b.sets[+d.setnote].note = el.value; markDirty(); return; }
  if (d.hltext) { b.highlights.items[+d.hltext].text = el.value; markDirty(); return; }
  if (d.rule) { const [i, k] = d.rule.split(":"); b.rules[+i][k] = el.value; markDirty(); return; }
  if (d.chktext) { b.checklist[+d.chktext] = el.value; markDirty(); return; }
  if (d.gh) { if (el.type !== "checkbox") { S.gh[d.gh] = d.gh === "token" ? el.value.replace(/[^\x21-\x7E]/g, "") : el.value.trim(); saveGH(); } return; }
  if (d.fmt) { const [i, k] = d.fmt.split(":"); const f = S.formats[+i]; const num = el.type === "number"; setPath(f, k, num ? (el.value === "" ? undefined : +el.value) : el.value); saveFormats(); return; }
  if (d.fmtui) { const [i, side] = d.fmtui.split(":"); const f = S.formats[+i]; f.ui = (f.ui || []).filter(u => u.side !== side); if (el.value) f.ui.push({ side, h: +el.value, label: side === "top" ? "رابط اپ (بالا)" : "رابط اپ (پایین)" }); saveFormats(); return; }
  if (d.fmtgrid) { const f = S.formats[+d.fmtgrid]; const m = el.value.match(/(\d+)\s*[x×]\s*(\d+)/); if (m) f.grid = { w: +m[1], h: +m[2], label: "۳:۴" }; else if (!el.value.trim()) delete f.grid; saveFormats(); return; }
});
document.addEventListener("change", async e => {
  const el = e.target, d = el.dataset;
  if (el.id === "brand-select") { S.ui.brand = el.value; S.ui.sel = null; S.hist = []; S.fut = []; render(); return; }
  if (el.id === "tfam") { S.ui.fam = el.value; drawList(); return; }
  if (d.field != null && el.tagName === "SELECT") { mut(t => { t.fields[d.field] = el.value; }); return; }
  if (d.prop) {
    const hit = findBlock(tpl(), S.ui.sel); if (!hit) return;
    let v = parseVal(el);
    if (d.color && v === "__custom") { const hexEl = el.parentElement.querySelector("input[type=color]"); hexEl.hidden = false; v = hexEl.value; }
    else if (d.color) { const hexEl = el.parentElement.querySelector("input[type=color]"); if (hexEl) hexEl.hidden = true; }
    if (el.type === "checkbox" || el.tagName === "SELECT") pushHist();
    setProp(hit.block, d.prop, v); markDirty(); drawPreview();
    if (["field", "brand", "set", "role", "float.ax", "float.ay"].includes(d.prop) || el.type === "checkbox") drawInspector();
    return;
  }
  if (el.id === "theme-only") { S.ui.themeOnly = el.checked; drawInspector(); return; }
  if (d.showif) { mut(t => { const h = findBlock(t, S.ui.sel); const f = $("[data-showif=field]").value, n = $("[data-showif=not]").value; if (!f) delete h.block.showIf; else h.block.showIf = n ? { field: f, not: n } : { field: f, filled: true }; }); return; }
  if (d.tp && el.tagName === "SELECT") {
    if (d.tp === "bg") { let v = el.value; const hexEl = el.parentElement.querySelector("input[type=color]"); if (v === "__custom") { hexEl.hidden = false; v = hexEl.value; } else hexEl.hidden = true; mut(t => { if (v) t.bg = v; else delete t.bg; }); return; }
    mut(t => { t[d.tp] = el.value; if (d.tp === "theme" && t.themes && !t.themes.includes(el.value)) t.themes.push(el.value); }, { insp: true }); drawThemebar(); return;
  }
  if (d.allowtheme) { mut(t => { t.themes = t.themes || []; if (el.checked) { if (!t.themes.includes(d.allowtheme)) t.themes.push(d.allowtheme); } else t.themes = t.themes.filter(x => x !== d.allowtheme); if (!t.themes.length) t.themes = [t.theme]; }); drawThemebar(); return; }
  if (d.fm && (el.type === "checkbox" || el.tagName === "SELECT")) { const [k, prop] = d.fm.split(":"); mut(t => { t.fieldMeta = t.fieldMeta || {}; t.fieldMeta[k] = t.fieldMeta[k] || {}; const v = el.type === "checkbox" ? (el.checked || undefined) : (el.value || undefined); if (v === undefined) delete t.fieldMeta[k][prop]; else t.fieldMeta[k][prop] = v; }, { insp: true }); return; }
  if (d.imgfield) { const f = el.files && el.files[0]; if (!f) return; if (f.size > 4e6) toast("تصویر بزرگ است؛ برای سرعت بهتر زیر ۲ مگابایت نگه دارید", 3500); const url = await readFile(f); mut(t => { t.fields[d.imgfield] = url; }, { insp: true }); return; }
  // brand-level
  const b = brand();
  if (d.th) { const [i, k] = d.th.split(":"); b.themes[+i][k] = el.value; markDirty(); renderBrand(); return; }
  if (d.frole) { b.fontRoles = b.fontRoles || {}; b.fontRoles[d.frole] = el.value; markDirty(); renderBrand(); return; }
  if (d.ty && el.tagName === "SELECT") { const [k, p] = d.ty.split(":"); b.type[k][p] = el.value; markDirty(); return; }
  if (d.ls) { const [k, g] = d.ls.split(":"); b.logoSets[k][g] = el.value; markDirty(); return; }
  if (d.bc || d.bfont || d.lg || d.bgr) { renderBrand(); return; }
  if (el.id === "font-up") { const f = el.files[0]; if (!f) return; const url = await readFile(f); const fam = f.name.replace(/[-_ ]?(regular|bold|medium|light|black|extrabold|semibold|thin)?\.(woff2?|ttf|otf)$/i, "").replace(/[-_]/g, " ").trim() || "Custom"; const w = /black/i.test(f.name) ? 900 : /extrabold/i.test(f.name) ? 800 : /semibold/i.test(f.name) ? 600 : /bold/i.test(f.name) ? 700 : /medium/i.test(f.name) ? 500 : /light/i.test(f.name) ? 300 : 400; b.fonts.push({ family: fam, weight: w, src: url }); markDirty(); injectFonts(); renderBrand(); toast(`فونت «${fam}» با وزن ${w} اضافه شد؛ نام و وزن را بررسی کنید`, 3500); return; }
  if (el.id === "logo-up") { const f = el.files[0]; if (!f) return; const url = await readFile(f); b.logos.push({ id: "logo" + (b.logos.length + 1), name: f.name.replace(/\.\w+$/, ""), src: url }); markDirty(); renderBrand(); return; }
  if (d.lgfile) { const f = el.files[0]; if (!f) return; b.logos[+d.lgfile].src = await readFile(f); markDirty(); renderBrand(); return; }
  if (d.setadd) { if (!el.value) return; bmut(b => b.sets[+d.setadd].ids.push(el.value)); return; }
  if (el.id === "grid-pinned") { bmut(b => b.grid.pinned = +el.value || 0); return; }
  if (el.id === "grid-add") { if (!el.value) return; bmut(b => b.grid.ids.push(el.value)); return; }
  if (el.id === "hl-tpl") { bmut(b => b.highlights.template = el.value); return; }
  if (d.hltheme) { bmut(b => b.highlights.items[+d.hltheme].theme = el.value); return; }
  if (d.hltext) { renderGrid(); return; }
  if (d.chk) { b.checklistState[d.chk] = el.checked; markDirty(); return; }
  if (d.gh === "remember") { S.gh.remember = el.checked; saveGH(); return; }
  if (el.id === "proj-imp") { const f = el.files[0]; if (f) importProject(f); return; }
  if (d.fmt || d.fmtui || d.fmtgrid) { renderFormats(); return; }
});

/* ---- drag floats ---- */
let drag = null;
document.addEventListener("pointerdown", e => {
  const box = e.target.closest(".selbox.float"); if (!box) return;
  const fw = $("#fw"); const hit = findBlock(tpl(), S.ui.sel); if (!hit || !hit.block.float) return;
  e.preventDefault(); pushHist();
  const el = fw.querySelector(`[data-bid="${CSS.escape(S.ui.sel)}"]`);
  const s = +fw.dataset.scale;
  drag = { mode: e.target.dataset.rs || "move", x0: e.clientX, y0: e.clientY, f0: clone(hit.block.float), s, w0: el ? el.getBoundingClientRect().width / s : hit.block.float.w || 400, h0: el ? el.getBoundingClientRect().height / s : 200 };
  box.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", e => {
  if (!drag) return; const hit = findBlock(tpl(), S.ui.sel); if (!hit) return; const f = hit.block.float;
  const dx = (e.clientX - drag.x0) / drag.s, dy = (e.clientY - drag.y0) / drag.s;
  const snap = v => e.shiftKey ? v : Math.round(v / 4) * 4;
  if (drag.mode === "move") { f.x = snap(drag.f0.x + (f.ax === "right" ? -dx : dx)); f.y = snap(drag.f0.y + (f.ay === "bottom" ? -dy : dy)); }
  if (drag.mode === "e") { f.w = Math.max(40, snap(drag.w0 + (f.ax === "right" ? -dx : dx) * (f.ax === "right" ? -1 : 1))); if (f.ax === "right") f.x = snap(drag.f0.x - dx); }
  if (drag.mode === "w") { const nw = Math.max(40, snap(drag.w0 - dx)); if (f.ax !== "right") f.x = snap(drag.f0.x + (drag.w0 - nw)); f.w = nw; }
  if (drag.mode === "s") { f.h = Math.max(20, snap(drag.h0 + (f.ay === "bottom" ? -dy : dy) * (f.ay === "bottom" ? -1 : 1))); }
  drawPreview();
});
document.addEventListener("pointerup", () => { if (drag) { drag = null; markDirty(); if (S.ui.itab === "element") drawInspector(); } });
document.addEventListener("mouseover", e => { const fw = $("#fw"); const hb = $("#hoverbox"); if (!fw || !hb) return; const bl = e.target.closest && e.target.closest("#fw [data-bid]"); if (!bl || bl.dataset.bid === S.ui.sel) { hb.hidden = true; return; } const fr = fw.getBoundingClientRect(), r = bl.getBoundingClientRect(); Object.assign(hb.style, { left: (r.left - fr.left) + "px", top: (r.top - fr.top) + "px", width: r.width + "px", height: r.height + "px" }); hb.hidden = false; });

/* ---- keyboard ---- */
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && S.ui.view === "editor" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (S.ui.sel) { S.ui.sel = null; drawSelection(); drawInspector(); } return; }
  if (typing || S.ui.view !== "editor" || !S.ui.sel) return;
  const hit = findBlock(tpl(), S.ui.sel); if (!hit) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); mut(() => removeBlock(S.ui.sel), { insp: true }); return; }
  if (hit.block.float && e.key.startsWith("Arrow")) {
    e.preventDefault(); const st = e.shiftKey ? 20 : 2, f = hit.block.float;
    mut(() => { if (e.key === "ArrowLeft") f.x += f.ax === "right" ? st : -st; if (e.key === "ArrowRight") f.x += f.ax === "right" ? -st : st; if (e.key === "ArrowUp") f.y += f.ay === "bottom" ? st : -st; if (e.key === "ArrowDown") f.y += f.ay === "bottom" ? -st : st; });
  }
});
window.addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(() => { if (S.ui.view === "editor") drawPreview(); }, 150); });
window.addEventListener("beforeunload", e => { if (Object.values(saveT).some(Boolean)) { } });

boot();
