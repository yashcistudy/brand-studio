// Brand Studio — rendering engine
// A template is an auto-layout column of blocks (like Figma auto layout) plus optional floating blocks.
// Colors can be: "@role" (theme role), a palette id, "grad:id", or a raw hex/css color.

export const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fa = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
export const PH_RE = /\[[^\]\n]*\]/;
export const isPh = v => v == null || String(v).trim() === "" || PH_RE.test(String(v));
export const uid = (p = "b") => p + Math.random().toString(36).slice(2, 8);

export function assetUrl(brandId, src) {
  if (!src) return null;
  if (/^(data:|https?:|blob:)/.test(src)) return src;
  return `brands/${brandId}/${src}`;
}

/* ---------- color ---------- */
export function hexToRgb(h) {
  h = String(h).trim();
  if (h.startsWith("rgb")) { const m = h.match(/[\d.]+/g).map(Number); return m.slice(0, 3); }
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lum(hex) {
  const c = hexToRgb(hex).map(v => v / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export const solidStops = css => (String(css).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []);

export function resolveColor(ctx, v, depth = 0) {
  if (v == null || v === "") return null;
  v = String(v);
  if (v === "none" || v === "transparent") return "transparent";
  if (depth > 6) return null;
  if (v[0] === "@") { const r = ctx.theme && ctx.theme[v.slice(1)]; return r ? resolveColor(ctx, r, depth + 1) : null; }
  if (v.startsWith("grad:")) { const g = (ctx.brand.gradients || []).find(x => x.id === v.slice(5)); return g ? g.css : null; }
  if (v[0] === "#" || v.startsWith("rgb") || v.includes("gradient(")) return v;
  const c = (ctx.brand.colors || []).find(x => x.id === v);
  return c ? c.hex : null;
}

/* ---------- fonts ---------- */
export function fontCSS(brands) {
  const seen = new Set(); let css = "";
  for (const b of Object.values(brands)) {
    for (const f of b.fonts || []) {
      const url = assetUrl(b.id, f.src); if (!url) continue;
      const key = f.family + "|" + f.weight + "|" + url.slice(0, 80);
      if (seen.has(key)) continue; seen.add(key);
      const fmt = /woff2/.test(url) ? "woff2" : /woff/.test(url) ? "woff" : /otf/.test(url) ? "opentype" : "truetype";
      css += `@font-face{font-family:"${f.family}";src:url("${url}") format("${fmt}");font-weight:${f.weight || 400};font-style:${f.style || "normal"};font-display:block}\n`;
    }
  }
  return css;
}
export function fontStack(ctx, role) {
  let brand = ctx.brand;
  if (role && role.includes(":")) { const [bid, r] = role.split(":"); brand = ctx.brands[bid] || brand; role = r; }
  const roles = brand.fontRoles || {};
  const fam = roles[role || "body"] || roles.body || "Tahoma";
  const latin = roles.latin || "Open Sans";
  return `'${fam}','${latin}',Tahoma,sans-serif`;
}

/* ---------- helpers ---------- */
const px = v => (typeof v === "number" ? v + "px" : v);
function padCSS(p) { if (p == null) return ""; if (typeof p === "number") return `padding:${p}px;`; if (p.length === 2) return `padding:${p[0]}px ${p[1]}px;`; return `padding:${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px;`; }
export function interpolate(str, fields) { return String(str).replace(/\{(\w+)\}/g, (m, k) => (fields && fields[k] != null && fields[k] !== "" ? fields[k] : `[${k}]`)); }
function textHTML(s, ctx) {
  let h = esc(s).replace(/\n/g, "<br>");
  if (ctx.opts.markPh) h = h.replace(/\[[^\]<]*\]/g, m => `<mark class="bs-ph">${m}</mark>`);
  return h;
}
function showIf(b, fields) {
  const c = b.showIf; if (!c) return true;
  const v = fields[c.field];
  if (c.eq != null) return v === c.eq;
  if (c.not != null) return v !== c.not;
  if (c.filled) return !!(v && String(v).trim());
  if (c.empty) return !(v && String(v).trim());
  return true;
}
function bgSolid(ctx, css, fallback) {
  if (!css || css === "transparent") return fallback;
  const st = solidStops(css); return st.length ? st : [css];
}
function commonStyle(b, ctx) {
  let s = "";
  const fg = resolveColor(ctx, b.color); if (fg) s += `color:${fg};`;
  const bg = resolveColor(ctx, b.bg); if (bg) s += `background:${bg};`;
  if (b.radius != null) s += `border-radius:${px(b.radius)};`;
  s += padCSS(b.pad);
  if (b.border && b.border.w) { const bc = resolveColor(ctx, b.border.color) || "currentColor"; s += `border:${b.border.w}px ${b.border.style || "solid"} ${bc};`; }
  if (b.w === "full") s += "align-self:stretch;";
  else if (typeof b.w === "number") s += `width:${b.w}px;max-width:100%;`;
  const al = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" }[b.align];
  if (al && b.w !== "full") s += `align-self:${al};`;
  if (b.push) s += "margin-top:auto;";
  if (b.mt) s += `margin-top:${b.mt}px;`;
  if (b.grow) s += "flex:1 1 auto;min-height:0;";
  if (b.bleed && ctx.pad) s += `margin-right:-${ctx.pad[1]}px;margin-left:-${ctx.pad[3]}px;`;
  if (b.bleedTop && ctx.pad) s += `margin-top:-${ctx.pad[0]}px;`;
  if (b.bleedBottom && ctx.pad) s += `margin-bottom:-${ctx.pad[2]}px;`;
  if (b.opacity != null) s += `opacity:${b.opacity};`;
  if (b.rotate) s += `transform:rotate(${b.rotate}deg);`;
  if (b.shadow) { const sc = resolveColor(ctx, b.shadow.color) || "rgba(0,0,0,.25)"; s += `box-shadow:${b.shadow.x || 0}px ${b.shadow.y || 12}px ${b.shadow.blur || 0}px ${sc};`; }
  return s;
}
function report(ctx, item) { if (ctx.report) ctx.report.push(item); }

/* ---------- blocks ---------- */
const R = {};
export function renderBlock(b, ctx, bgStack) {
  if (!b || b.hidden) return "";
  if (b.byTheme && ctx.theme && b.byTheme[ctx.theme.id]) b = Object.assign({}, b, b.byTheme[ctx.theme.id]);
  if (!showIf(b, ctx.fields)) return "";
  const fn = R[b.type]; if (!fn) return "";
  const own = resolveColor(ctx, b.bg);
  const stack = own && own !== "transparent" ? bgSolid(ctx, own, bgStack) : bgStack;
  const ink = b.type !== "card" ? resolveColor(ctx, b.color) : null;
  if (ink) ctx.inkStack.push(ink);
  const inner = fn(b, ctx, stack);
  if (ink) ctx.inkStack.pop();
  if (inner === null) return "";
  const sel = ctx.opts.editor ? ` data-bid="${b.id}"` : "";
  const cls = `bs-b bs-${b.type}${b.float ? " bs-float" : ""}`;
  let pos = "";
  if (b.float) {
    const f = b.float; pos = "position:absolute;";
    pos += f.ax === "right" ? `right:${f.x || 0}px;` : `left:${f.x || 0}px;`;
    pos += f.ay === "bottom" ? `bottom:${f.y || 0}px;` : `top:${f.y || 0}px;`;
    if (f.w) pos += `width:${f.w}px;`;
    if (f.h) pos += `height:${f.h}px;`;
    if (f.z != null) pos += `z-index:${f.z};`;
  }
  return `<div class="${cls}"${sel} style="${pos}${commonStyle(b, ctx)}${inner.style || ""}">${inner.html}</div>`;
}
function children(b, ctx, stack) { return (b.children || []).map(c => renderBlock(c, ctx, stack)).join(""); }

R.text = (b, ctx, stack) => {
  const fields = ctx.fields;
  let val = b.field ? fields[b.field] : (b.text != null ? interpolate(b.text, fields) : "");
  let empty = false;
  if (b.field && (val == null || String(val).trim() === "")) {
    if (b.emptyText) { val = b.emptyText; empty = true; } else if (ctx.opts.editor) { val = b.placeholder || ""; empty = true; if (!val) return { style: "min-height:20px;min-width:60px;outline:2px dashed rgba(0,110,240,.4)", html: "" }; } else return null;
  }
  const role = (ctx.brand.type || {})[b.role || "body"] || { size: 42, weight: 400, lh: 1.7, font: "body" };
  let size = b.size || role.size || 42;
  if (b.fit) { const L = String(val).length, ref = b.fit.ref || 30; if (L > ref) size = Math.round(Math.max(size * (b.fit.min || 0.6), size * Math.sqrt(ref / L))); }
  const weight = b.weight || role.weight || 400, lh = b.lh || role.lh || 1.6;
  let st = `font-family:${fontStack(ctx, b.font || role.font)};font-size:${size}px;font-weight:${weight};line-height:${lh};`;
  if (b.textAlign) st += `text-align:${b.textAlign};`;
  if (b.ltr) st += "direction:ltr;unicode-bidi:isolate;";
  if (b.maxW) st += `max-width:${b.maxW}px;`;
  if (b.balance !== false) st += "text-wrap:balance;";
  if (b.tracking) st += `letter-spacing:${b.tracking}em;`;
  if (empty && b.emptyColor) st += `color:${resolveColor(ctx, b.emptyColor)};`;
  if (b.marker) st += "display:flex;align-items:center;gap:" + (b.markerGap || 18) + "px;";
  let marker = "";
  if (b.marker) {
    const mc = resolveColor(ctx, b.markerColor || "@accent") || "currentColor", ms = b.markerSize || 24;
    const shape = b.marker === "dot" ? "border-radius:50%;" : "";
    const dims = b.marker === "bar" ? `width:${Math.max(4, ms / 5)}px;height:${ms * 2.4}px;` : `width:${ms}px;height:${ms}px;`;
    marker = `<i style="flex:0 0 auto;${dims}${shape}background:${mc}"></i>`;
  }
  // contrast report
  const fg = (empty && b.emptyColor ? resolveColor(ctx, b.emptyColor) : resolveColor(ctx, b.color)) || ctx.inkStack[ctx.inkStack.length - 1];
  if (fg && fg !== "transparent" && stack && stack.length) {
    const min = size >= 60 || (size >= 46 && weight >= 700) ? 3 : 4.5;
    let worst = 99; for (const bgc of stack) { try { worst = Math.min(worst, contrast(fg, bgc)); } catch (e) { } }
    if (worst < min) report(ctx, { kind: "contrast", bid: b.id, ratio: worst, min, label: b.label || b.field || "متن" });
  }
  const pre = b.prefix ? `<b style="font-weight:${Math.min(900, weight + 200)}">${esc(interpolate(b.prefix, fields))}</b>` : "";
  const body = marker ? `${marker}<span>${pre}${textHTML(val, ctx)}</span>` : `${pre}${textHTML(val, ctx)}`;
  return { style: st, html: body };
};

R.image = (b, ctx) => {
  const src = !ctx.opts.noAssets && b.field ? ctx.fields[b.field] : null;
  let st = `height:${b.h ? b.h + "px" : "100%"};overflow:hidden;position:${b.float ? "absolute" : "relative"};flex:0 0 auto;`;
  if (b.wpx) st += `width:${b.wpx}px;`;
  if (src) return { style: st, html: `<img src="${esc(assetUrl(ctx.brand.id, src))}" alt="" style="width:100%;height:100%;object-fit:${b.fit || "cover"};display:block">` };
  report(ctx, { kind: "image", bid: b.id, label: b.label || "تصویر" });
  const small = b.h && b.h < 200;
  return { style: st + "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;background:#CACBD1;color:#121546;outline:5px dashed #8D8E8E;outline-offset:-5px;", html: small ? `<span style="font:700 22px/1.3 inherit">${esc(b.phShort || "تصویر")}</span>` : `<b style="font-size:44px;font-weight:800">${esc(b.phTitle || "تصویر لازم است")}</b><span style="font-size:30px;line-height:1.55;max-width:26em">${esc(b.note || "")}</span>` };
};

R.logo = (b, ctx, stack) => {
  const brand = (b.brand && ctx.brands[b.brand]) || ctx.brand;
  const set = (brand.logoSets || {})[b.set || "primary"] || {};
  const bgHex = stack && stack.length ? stack[0] : "#FFFFFF";
  let ground = b.ground || (lum(bgHex) > 0.4 ? "light" : "dark");
  let id = set[ground], plate = false;
  if (!id) { id = set.light || set.dark; if (ground === "dark" && set.light && !set.dark) plate = true; }
  const lg = (brand.logos || []).find(l => l.id === id);
  const h = b.h || 110;
  const guide = ctx.opts.editor && brand.clearSpace ? `<div class="bs-guide bs-clear" style="inset:-${Math.round(h * brand.clearSpace)}px"></div>` : "";
  if (lg && lg.src && !ctx.opts.noAssets) {
    const img = `<img src="${esc(assetUrl(brand.id, lg.src))}" alt="" style="height:${h}px;width:auto;display:block">`;
    return { style: "position:relative;flex:0 0 auto;", html: plate ? `<div style="background:#fff;border-radius:${Math.round(h / 4)}px;padding:${Math.round(h / 6)}px ${Math.round(h / 4)}px">${img}</div>${guide}` : img + guide };
  }
  report(ctx, { kind: "logo", bid: b.id, label: `لوگوی ${brand.name}` });
  return { style: "position:relative;flex:0 0 auto;", html: `<div style="height:${h}px;min-width:${h * 2}px;border:4px dashed currentColor;opacity:.7;display:flex;align-items:center;justify-content:center;font-size:${Math.max(18, h / 5)}px;font-weight:700;padding:0 20px">جای لوگوی ${esc(brand.name)}</div>` };
};

R.list = (b, ctx, stack) => {
  const val = b.field ? (ctx.fields[b.field] || "") : (b.text || "");
  const lines = String(val).split("\n").filter(x => x.trim());
  if (!lines.length && !ctx.opts.editor) return null;
  const size = b.size || 38, style = b.num || "bullet", acc = resolveColor(ctx, b.markerColor || "@accent") || "#F15B29";
  const gap = b.itemGap || 16;
  if (style === "kv") {
    return { style: `display:grid;grid-template-columns:auto 1fr;gap:${gap / 2}px 24px;font-size:${size}px;line-height:1.5;font-family:${fontStack(ctx, b.font || "body")}`, html: lines.map(l => { const [k, ...v] = l.split("|"); return `<b style="font-weight:800;white-space:nowrap">${textHTML(k.trim(), ctx)}</b><span>${textHTML(v.join("|").trim(), ctx)}</span>`; }).join("") };
  }
  const items = lines.map((l, i) => {
    const [t, ...d] = l.split("|"); const on = b.active === i + 1;
    let m = "";
    const ns = Math.round(size * 2.1);
    if (style === "box") m = `<span style="flex:0 0 auto;width:${ns}px;height:${ns}px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 1.1)}px;border:5px solid ${on ? acc : (resolveColor(ctx, b.lineColor) || "#8D8E8E")};${on ? `background:${acc};color:${resolveColor(ctx, b.activeText || "@ctaText") || "#121546"};` : ""}${b.round ? "border-radius:22px;" : ""}">${fa(i + 1)}</span>`;
    else if (style === "line") m = `<span style="flex:0 0 auto;width:${ns}px;height:${ns}px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(size * 1.2)}px;color:${acc};border-left:5px solid ${acc}">${fa(i + 1)}</span>`;
    else if (style === "pill") m = `<span style="flex:0 0 auto;width:${ns}px;height:${ns}px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(size * 1.1)}px;border-radius:50%;background:${acc};color:${resolveColor(ctx, b.activeText || "@ctaText") || "#121546"}">${fa(i + 1)}</span>`;
    else if (style === "bullet") m = `<i style="flex:0 0 auto;width:${Math.round(size * .38)}px;height:${Math.round(size * .38)}px;margin-top:${Math.round(size * .55)}px;background:${acc};${b.round ? "border-radius:50%" : ""}"></i>`;
    const desc = d.length && b.showDesc !== false ? `<span style="display:block;font-size:${Math.round(size * .88)}px;opacity:.9;font-weight:400">${textHTML(d.join("|").trim(), ctx)}</span>` : "";
    return `<li style="display:flex;gap:${Math.round(size * .6)}px;align-items:${style === "bullet" ? "flex-start" : "center"}">${m}<div><span style="font-weight:${b.titleWeight || (d.length ? 800 : 500)}">${textHTML(t.trim(), ctx)}</span>${desc}</div></li>`;
  }).join("");
  return { style: `font-size:${size}px;line-height:1.5;font-family:${fontStack(ctx, b.font || "body")}`, html: `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${gap}px">${items || (ctx.opts.editor ? `<li style="opacity:.6">[فهرست خالی]</li>` : "")}</ul>` };
};

R.chips = (b, ctx) => {
  const cbg = resolveColor(ctx, b.chipBg || "@chip") || "#fff", cfg = resolveColor(ctx, b.chipText || "@chipText") || "#000", miss = resolveColor(ctx, b.missColor || "@accent") || "#E32A63";
  const html = (b.items || []).map(it => {
    const v = ctx.fields[it.field]; const m = isPh(v);
    return `<div style="display:flex;flex-direction:column;gap:2px;border-radius:${b.chipRadius ?? 26}px;padding:12px 26px;min-width:180px;${m ? `outline:4px dashed ${miss};outline-offset:-4px;` : `background:${cbg};color:${cfg};`}"><i style="font-style:normal;font-size:28px;opacity:.85">${esc(it.label)}</i><b style="font-size:38px;font-weight:${m ? 600 : 800}">${textHTML(m ? (b.missText || "[تأییدنشده]") : v, ctx)}</b></div>`;
  }).join("");
  return { style: `display:flex;flex-wrap:wrap;gap:16px;font-family:${fontStack(ctx, "body")}`, html };
};

R.table = (b, ctx) => {
  const rows = String(ctx.fields[b.field] || "").split("\n").filter(x => x.trim()).map(r => r.split("|").map(x => x.trim()));
  const cell = resolveColor(ctx, b.cellBg || "@card") || "#fff", ct = resolveColor(ctx, b.cellText || "@cardText") || "#000", ph = resolveColor(ctx, b.phBg || "@pill") || "#F1F1F4";
  const n = (b.headers || []).length || (rows[0] || []).length;
  const size = b.size || 32;
  const th = (b.headers || []).map(h => `<th style="text-align:right;font-weight:700;padding:0 14px 6px;font-size:${Math.round(size * .9)}px">${esc(h)}</th>`).join("");
  const tr = rows.map(r => `<tr>${Array.from({ length: n }, (_, i) => { const v = r[i] || "—"; const p = PH_RE.test(v); return `<td style="background:${p ? ph : cell};color:${ct};padding:18px 14px;font-weight:${i === 0 ? 800 : 500};${i === 0 ? "border-radius:0 20px 20px 0;" : i === n - 1 ? "border-radius:20px 0 0 20px;" : ""}">${textHTML(v, ctx)}</td>`; }).join("")}</tr>`).join("");
  return { style: `font-family:${fontStack(ctx, "body")}`, html: `<table style="width:100%;border-collapse:separate;border-spacing:0 12px;font-size:${size}px;line-height:1.4"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>` };
};

export function dieHTML(n, size, color, pip) {
  const P = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }; const on = P[n] || [];
  const d = Math.round(size * .19);
  return `<span style="width:${size}px;height:${size}px;border-radius:${Math.round(size * .23)}px;border:${Math.max(3, Math.round(size * .07))}px solid ${color};display:inline-grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:${Math.round(size * .1)}px;box-sizing:border-box">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `<i style="width:${d}px;height:${d}px;border-radius:50%;background:${pip || color};place-self:center;visibility:${on.includes(i) ? "visible" : "hidden"}"></i>`).join("")}</span>`;
}
R.die = (b, ctx) => ({ style: "display:flex;", html: dieHTML(b.n || 5, b.size || 120, resolveColor(ctx, b.color || "@text") || "currentColor", resolveColor(ctx, b.pip || "@accent")) });

R.footer = (b, ctx) => {
  const url = b.field ? ctx.fields[b.field] : (b.text != null ? interpolate(b.text, ctx.fields) : ctx.brand.url || "");
  const acc = resolveColor(ctx, "@accent") || "#F15B29", muted = resolveColor(ctx, b.lineColor || "@line") || "#8D8E8E";
  const i = b.i || 1, n = b.n || 0;
  let pager = "";
  if (b.pager === "dots" && n) pager = `<span style="display:flex;align-items:center;gap:14px">${Array.from({ length: n }, (_, k) => `<i style="width:${k + 1 === i ? 40 : 16}px;height:16px;border-radius:8px;background:${k + 1 === i ? acc : muted}"></i>`).join("")}<span>${fa(i)} / ${fa(n)}</span></span>`;
  else if (b.pager === "dice" && n) pager = `<span style="display:flex;align-items:center;gap:16px">${dieHTML(Math.min(6, i), 70, "currentColor", acc)}<span>${fa(i)} / ${fa(n)}</span></span>`;
  else if (b.pager === "number" && n) pager = `<span>${fa(i)} / ${fa(n)}</span>`;
  else if (b.aside) pager = `<span style="font-size:28px">${textHTML(interpolate(b.aside, ctx.fields), ctx)}</span>`;
  const line = b.line === false ? "" : `border-top:3px solid ${muted};padding-top:24px;`;
  return { style: `display:flex;justify-content:space-between;align-items:center;gap:20px;font-size:${b.size || 34}px;font-weight:600;${line}font-family:${fontStack(ctx, "body")}`, html: `<span style="direction:ltr;font-family:${fontStack(ctx, "latin")};font-weight:700">${esc(url)}</span>${pager}` };
};

R.row = (b, ctx, stack) => ({ style: `display:flex;flex-direction:row;flex-wrap:${b.wrap ? "wrap" : "nowrap"};align-items:${b.alignItems || "center"};justify-content:${b.justify || "space-between"};gap:${b.gap ?? 24}px;`, html: children(b, ctx, stack) });
R.card = (b, ctx, stack) => {
  const ink = resolveColor(ctx, b.color); if (ink) ctx.inkStack.push(ink);
  const html = children(b, ctx, stack); if (ink) ctx.inkStack.pop();
  return { style: `display:flex;flex-direction:column;gap:${b.gap ?? 24}px;justify-content:${b.justify || "flex-start"};${b.overflowHidden ? "overflow:hidden;" : ""}`, html };
};
R.spacer = (b, ctx) => ({ style: `height:${b.h || 24}px;${b.wpx ? `width:${b.wpx}px;` : ""}flex:${b.flex ? "1 1 0" : "0 0 auto"};`, html: "" });
R.zone = (b, ctx) => {
  if (!ctx.opts.editor && !ctx.opts.zones) return null;
  return { style: `height:${b.h || 300}px;border:5px dashed #3B82F6;background:rgba(59,130,246,.08);color:#1D4ED8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;font:600 30px/1.5 inherit;${b.round ? "border-radius:40px;" : ""}`, html: `<b style="font-size:34px">${esc(b.label || "جای استیکر")}</b>${b.field ? `<span>${textHTML(ctx.fields[b.field] || "", ctx)}</span>` : ""}${b.note ? `<span style="font-size:24px">در خروجی چاپ نمی‌شود</span>` : ""}`, cls: "zone" };
};

/* ---------- frame ---------- */
export function formatOf(state, id) { return (state.formats || []).find(f => f.id === id) || { id, name: id, w: 1080, h: 1350, safe: { t: 96, r: 96, b: 96, l: 96 } }; }
export function themeOf(brand, tpl) { const ts = brand.themes || []; return ts.find(t => t.id === tpl.theme) || ts[0] || {}; }

function guidesHTML(fmt) {
  let g = "";
  for (const u of fmt.ui || []) {
    const pos = u.side === "top" ? "top:0" : "bottom:0";
    g += `<div class="bs-guide bs-band" style="${pos};left:0;right:0;height:${u.h}px">${esc(u.label || "")}</div>`;
  }
  if (fmt.grid) { const gw = fmt.grid.w, gh = fmt.grid.h; g += `<div class="bs-guide bs-box" style="left:${(fmt.w - gw) / 2}px;top:${(fmt.h - gh) / 2}px;width:${gw}px;height:${gh}px"><span>برش شبکهٔ پروفایل ${esc(fmt.grid.label || "")}</span></div>`; }
  if (fmt.circle) { const c = fmt.circle; g += `<div class="bs-guide bs-box" style="left:${c.cx - c.r}px;top:${c.cy - c.r}px;width:${c.r * 2}px;height:${c.r * 2}px;border-radius:50%"><span>برش دایره</span></div>`; }
  const s = fmt.safe || {};
  if (fmt.margin) g += `<div class="bs-guide bs-box bs-margin" style="inset:${fmt.margin}px"></div>`;
  g += `<div class="bs-guide bs-safe" style="top:${s.t || 0}px;right:${s.r || 0}px;bottom:${s.b || 0}px;left:${s.l || 0}px"></div>`;
  return g;
}

export function renderFrame(state, brand, tpl, opts = {}) {
  const fmt = formatOf(state, tpl.format);
  const theme = themeOf(brand, tpl);
  const fields = Object.assign({}, tpl.fields || {}, opts.fields || {});
  const s = fmt.safe || {};
  const pad = tpl.pad || [s.t || 0, s.r || 0, s.b || 0, s.l || 0];
  const ctx = { state, brand, brands: state.brands, theme, tpl, fmt, fields, opts, pad, report: [], inkStack: [] };
  const bg = resolveColor(ctx, tpl.bg || "@bg") || "#FFFFFF";
  const ink = resolveColor(ctx, "@text") || "#000"; ctx.inkStack.push(ink);
  const stack = bgSolid(ctx, bg, ["#FFFFFF"]);
  const flow = (tpl.blocks || []).map(b => renderBlock(b, ctx, stack)).join("");
  const under = (tpl.floats || []).filter(b => b.float && b.float.under).map(b => renderBlock(b, ctx, stack)).join("");
  const over = (tpl.floats || []).filter(b => !(b.float && b.float.under)).map(b => renderBlock(b, ctx, stack)).join("");
  const just = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" }[tpl.justify || "start"];
  const html = `<div class="bs-frame" data-tid="${esc(tpl.id)}" style="position:relative;overflow:hidden;width:${fmt.w}px;height:${fmt.h}px;background:${bg};color:${ink};font-family:${fontStack(ctx, "body")};direction:rtl">${under}<div class="bs-flow" style="position:absolute;inset:0;box-sizing:border-box;padding:${pad[0]}px ${pad[1]}px ${pad[2]}px ${pad[3]}px;display:flex;flex-direction:column;gap:${tpl.gap ?? 40}px;justify-content:${just};overflow:hidden">${flow}</div>${over}${opts.guides ? guidesHTML(fmt) : ""}</div>`;
  return { html, fmt, report: ctx.report, ctx };
}

/* ---------- checks ---------- */
export function checkTemplate(state, brand, tpl, report) {
  const out = [];
  const meta = tpl.fieldMeta || {};
  for (const [k, m] of Object.entries(meta)) {
    const v = (tpl.fields || {})[k];
    if (m.required && isPh(v)) out.push(["w", `«${m.label || k}» تکمیل نشده`]);
    else if (v && PH_RE.test(String(v)) && m.type !== "image") out.push(["w", `«${m.label || k}» هنوز جانگهدار [ ] دارد`]);
    if (v && m.pattern && !isPh(v)) { try { if (!new RegExp(m.pattern).test(v)) out.push(["w", `«${m.label || k}»: ${m.patternMsg || "قالب نادرست"}`]); } catch (e) { } }
  }
  const seen = new Set();
  for (const r of report || []) {
    if (r.kind === "contrast") { const key = "c" + r.bid; if (seen.has(key)) continue; seen.add(key); out.push(["w", `تضاد ضعیف در «${r.label}»: ${r.ratio.toFixed(1)}:1 (کمینه ${r.min}:1)`, r.bid]); }
    if (r.kind === "image") out.push(["w", `«${r.label}» بارگذاری نشده`, r.bid]);
    if (r.kind === "logo") out.push(["w", `فایل ${r.label} موجود نیست`, r.bid]);
  }
  for (const n of tpl.notes ? [tpl.notes] : []) out.push(["i", n]);
  return out;
}

/* ---------- tree utils ---------- */
export function walk(blocks, fn, parent = null) { for (const b of blocks || []) { fn(b, parent); if (b.children) walk(b.children, fn, b); } }
export function findBlock(tpl, id) {
  let hit = null;
  const scan = (arr, owner) => { for (let i = 0; i < (arr || []).length; i++) { const b = arr[i]; if (b.id === id) { hit = { block: b, list: arr, index: i, owner }; return; } if (b.children) scan(b.children, b); if (hit) return; } };
  scan(tpl.blocks, null); if (!hit) scan(tpl.floats, "floats");
  return hit;
}
export function ensureIds(tpl) { const f = b => { if (!b.id) b.id = uid(); (b.children || []).forEach(f); }; (tpl.blocks || []).forEach(f); (tpl.floats || []).forEach(f); return tpl; }
