// Netlify Function: proxy seguro para el módulo "Calidad de Leads" (tab en vivo).
// Combina dos fuentes: contactos de GoHighLevel (calificación, tags, atribución)
// e inversión publicitaria de Windsor.ai (Meta + Google), opcional.
//
// Env vars:
//   GHL_API_KEY      — Private Integration Token (pit-...). Requiere el scope
//                      contacts.readonly además de los que ya usa ghl-report.
//   GHL_LOCATION_ID  — Location ID de la subcuenta
//   WINDSOR_API_KEY  — (opcional) API key de Windsor.ai; sin ella la sección de
//                      inversión se apaga con aviso, el resto funciona.
//
// Acciones (POST JSON + Authorization: Bearer <token>):
//   { action:"bootstrap" }
//     → { users:{id:nombre}, fields:[{id,name,options}], windsor:bool }
//   { action:"leads", start, end, searchAfter? }
//     → { leads:[...], total, fetched, searchAfter|null }
//     Pagina /contacts/search en bloques; el frontend repite con searchAfter.
//   { action:"opps", startAfter?, startAfterId? }
//     → { opps:[{ct,st,c,v}], cursor|null, total, fetched }
//     Recorre todas las oportunidades (con contactId) para unirlas a los leads
//     por campaña: OPPs y WONs que produjo cada campaña.
//   { action:"spend", start, end }   (fechas YYYY-MM-DD)
//     → { configured:bool, rows:[{d,src,camp,spend,clicks,impr}] }
//   { action:"ads", start, end }     (fechas YYYY-MM-DD)
//     → { configured:bool, ads:[...] }  Detalle por anuncio (Meta + Google) vía
//     Windsor: estado activo/pausado, link de preview, resultados.

const S = require("./lib/shared.js");

const API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const WINDSOR_KEY = process.env.WINDSOR_API_KEY;
const BASE = "https://services.leadconnectorhq.com";
const PAGES_PER_CALL = 5;
const PAGE_SIZE = 100;

const json = S.json;

async function ghl(path, opts) {
  const headers = { Authorization: "Bearer " + API_KEY, Version: "2021-07-28", Accept: "application/json" };
  if (opts && opts.body) headers["Content-Type"] = "application/json";
  const doFetch = () => fetch(BASE + path, { method: opts?.method || "GET", headers, body: opts?.body ? JSON.stringify(opts.body) : undefined });
  let resp = await doFetch();
  if (resp.status === 429) { await new Promise((r) => setTimeout(r, 1200)); resp = await doFetch(); }
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`GHL ${resp.status} en ${path.split("?")[0]}`);
    err.status = resp.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  return resp.json();
}

// Última atribución disponible del contacto (utm campaign/source/medium/anuncio),
// con fallback a la primera; los nombres de propiedad varían entre versiones del API.
function attrOf(c) {
  const list = Array.isArray(c.attributions) ? c.attributions : [];
  const pick = (o, ...keys) => { for (const k of keys) { if (o && typeof o[k] === "string" && o[k]) return o[k]; } return ""; };
  const last = list[list.length - 1] || c.lastAttributionSource || {};
  const first = list[0] || c.attributionSource || {};
  return {
    camp: pick(last, "campaign", "utmCampaign") || pick(first, "campaign", "utmCampaign"),
    src: pick(last, "utmSource", "sessionSource") || pick(first, "utmSource", "sessionSource"),
    med: pick(last, "utmMedium", "medium") || pick(first, "utmMedium", "medium"),
    ad: pick(last, "adName", "utmContent") || pick(first, "adName", "utmContent"),
    grp: pick(last, "adGroupName", "adGroupId", "utmTerm") || pick(first, "adGroupName", "adGroupId", "utmTerm"),
  };
}

const slim = (c) => ({
  id: c.id,
  n: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "(sin nombre)",
  em: (c.email || "").trim().toLowerCase(),
  ph: String(c.phone || "").replace(/[^\d]/g, "").slice(-10), // últimos 10 dígitos p/ detectar duplicados
  c: c.dateAdded || "",
  src: (c.source || "").trim(),
  u: c.assignedTo || "",
  tags: Array.isArray(c.tags) ? c.tags : [],
  cf: (c.customFields || []).reduce((m, f) => {
    if (f && f.id != null) m[f.id] = Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "");
    return m;
  }, {}),
  attr: attrOf(c),
});

async function bootstrap() {
  const [fieldsResp, usersResp] = await Promise.all([
    ghl(`/locations/${LOCATION_ID}/customFields`).catch(() => null), // scope opcional: degradar sin romper
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null),
  ]);
  const users = {};
  if (usersResp && Array.isArray(usersResp.users)) {
    usersResp.users.forEach((u) => { if (u.id && !u.deleted) users[u.id] = u.name || u.email || u.id; });
  }
  const fields = ((fieldsResp && fieldsResp.customFields) || []).map((f) => ({
    id: f.id,
    name: f.name || f.fieldKey || "",
    options: (f.picklistOptions || f.options || []).map((o) => (typeof o === "string" ? o : o?.name || o?.value || "")).filter(Boolean),
  }));
  return { users, fields, windsor: !!WINDSOR_KEY };
}

async function leads({ start, end, searchAfter }) {
  if (!start || !end) throw Object.assign(new Error("start y end requeridos (ISO datetime)"), { status: 400 });
  const out = [];
  let cursor = Array.isArray(searchAfter) && searchAfter.length ? searchAfter : null;
  let total = 0;
  for (let i = 0; i < PAGES_PER_CALL; i++) {
    const body = {
      locationId: LOCATION_ID,
      pageLimit: PAGE_SIZE,
      filters: [{ field: "dateAdded", operator: "range", value: { gte: start, lte: end } }],
      sort: [{ field: "dateAdded", direction: "asc" }],
    };
    if (cursor) body.searchAfter = cursor;
    const data = await ghl("/contacts/search", { method: "POST", body });
    const batch = data.contacts || [];
    batch.forEach((c) => out.push(slim(c)));
    total = data.total ?? total;
    const lastRaw = batch[batch.length - 1];
    cursor = batch.length === PAGE_SIZE && lastRaw && Array.isArray(lastRaw.searchAfter) ? lastRaw.searchAfter : null;
    if (!cursor) break;
  }
  return { leads: out, total, fetched: out.length, searchAfter: cursor };
}

// Todas las oportunidades del CRM, adelgazadas al mínimo para el join con leads:
// contactId, estatus, fecha de creación y valor. Mismo patrón de cursor que ghl-report.
async function opps({ startAfter, startAfterId }) {
  const out = [];
  let cursor = startAfter && startAfterId ? { startAfter, startAfterId } : null;
  let total = 0;
  for (let i = 0; i < 6; i++) {
    let qs = `location_id=${LOCATION_ID}&limit=100`;
    if (cursor) qs += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
    const data = await ghl(`/opportunities/search?${qs}`);
    const batch = data.opportunities || [];
    batch.forEach((o) => out.push({
      ct: o.contactId || (o.contact && o.contact.id) || "",
      st: o.status || "open",
      c: o.createdAt || "",
      v: Number(o.monetaryValue) || 0,
    }));
    total = (data.meta && data.meta.total) || total;
    const meta = data.meta || {};
    if (batch.length < 100 || !meta.startAfterId) { cursor = null; break; }
    cursor = { startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return { opps: out, cursor, total, fetched: out.length };
}

// Inversión por día × campaña desde Windsor.ai (todas las fuentes conectadas de la
// cuenta; el frontend filtra/agrupa). Fechas en YYYY-MM-DD.
async function spend({ start, end }) {
  if (!WINDSOR_KEY) return { configured: false, rows: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) {
    throw Object.assign(new Error("start y end requeridos (YYYY-MM-DD)"), { status: 400 });
  }
  const url = `https://connectors.windsor.ai/all?api_key=${encodeURIComponent(WINDSOR_KEY)}` +
    `&date_from=${start}&date_to=${end}&fields=date,source,campaign,spend,clicks,impressions`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`Windsor ${resp.status}`);
    err.status = resp.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  const data = await resp.json();
  const rows = (Array.isArray(data.data) ? data.data : []).map((r) => ({
    d: r.date || "",
    src: String(r.source || "").toLowerCase(),
    camp: r.campaign || "(sin campaña)",
    spend: Number(r.spend) || 0,
    clicks: Number(r.clicks) || 0,
    impr: Number(r.impressions) || 0,
  })).filter((r) => r.spend || r.clicks || r.impr);
  return { configured: true, rows };
}

async function windsorGet(connector, params) {
  const url = `https://connectors.windsor.ai/${connector}?api_key=${encodeURIComponent(WINDSOR_KEY)}&${params}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`Windsor ${connector} ${resp.status}`);
    err.status = resp.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  const data = await resp.json();
  return Array.isArray(data.data) ? data.data : [];
}

// Detalle por anuncio para "Paid Media en vivo": estado, links y resultados.
// Conectores por separado ( /facebook y /google_ads ) porque los campos ad-level
// no son homogéneos en el super-conector /all.
async function ads({ start, end }) {
  if (!WINDSOR_KEY) return { configured: false, ads: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) {
    throw Object.assign(new Error("start y end requeridos (YYYY-MM-DD)"), { status: 400 });
  }
  const range = `date_from=${start}&date_to=${end}`;
  const num = (x) => Number(x) || 0;
  const [fb, gg] = await Promise.all([
    windsorGet("facebook", `${range}&fields=date,campaign,adset_name,ad_id,ad_name,effective_status,ad_preview_shareable_link,spend,impressions,clicks,actions_leadgen_grouped`)
      // si el campo de leads no está disponible en la cuenta, degradar sin resultados
      .catch(() => windsorGet("facebook", `${range}&fields=date,campaign,adset_name,ad_id,ad_name,effective_status,ad_preview_shareable_link,spend,impressions,clicks`).catch(() => [])),
    windsorGet("google_ads", `${range}&fields=date,campaign,ad_group_name,ad_id,ad_name,ad_group_ad_status,ad_final_urls,spend,impressions,clicks,conversions`).catch(() => []),
  ]);
  // Filas por día × anuncio: el frontend las agrupa por semana/rango seleccionado
  const rows = [];
  fb.forEach((r) => rows.push({
    d: r.date || "", plat: "Meta", camp: r.campaign || "", grp: r.adset_name || "", id: String(r.ad_id || ""),
    name: r.ad_name || "", status: r.effective_status || "", link: r.ad_preview_shareable_link || "",
    spend: num(r.spend), impr: num(r.impressions), clicks: num(r.clicks), results: num(r.actions_leadgen_grouped),
  }));
  gg.forEach((r) => rows.push({
    d: r.date || "", plat: "Google", camp: r.campaign || "", grp: r.ad_group_name || "", id: String(r.ad_id || ""),
    name: r.ad_name || "", status: r.ad_group_ad_status || "", link: String(r.ad_final_urls || "").split(",")[0] || "",
    spend: num(r.spend), impr: num(r.impressions), clicks: num(r.clicks), results: num(r.conversions),
  }));
  return { configured: true, ads: rows.filter((r) => r.spend || r.clicks || r.impr || r.results) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!API_KEY || !LOCATION_ID) return json(500, { error: "GHL_API_KEY / GHL_LOCATION_ID no configuradas en el entorno" });

  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  const ch = session.channels || [];
  if (session.role !== "admin" && !ch.includes("mkt_lq") && !ch.includes("marketing")) {
    return json(403, { error: "Sin acceso a Calidad de Leads" });
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }

  try {
    if (payload.action === "bootstrap") return json(200, await bootstrap());
    if (payload.action === "leads") return json(200, await leads(payload));
    if (payload.action === "opps") return json(200, await opps(payload));
    if (payload.action === "spend") return json(200, await spend(payload));
    if (payload.action === "ads") return json(200, await ads(payload));
    return json(400, { error: "action debe ser 'bootstrap', 'leads', 'opps', 'spend' o 'ads'" });
  } catch (e) {
    const status = e.status === 429 ? 429 : e.status === 400 ? 400 : 502;
    return json(status, { error: String(e.message || e), detail: e.detail });
  }
};
