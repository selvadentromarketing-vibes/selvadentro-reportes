// Netlify Function: datos para el reporte "SLA y Seguimiento" (Anexo 1 del
// proceso comercial): SLA de primera respuesta, contactos efectivos, último
// toque, citas y show rate — directo del CRM (GoHighLevel), con nombres.
//
// Env vars: GHL_API_KEY (todos los scopes), GHL_LOCATION_ID.
//
// Acciones (POST JSON + Authorization: Bearer <token>):
//   { action:"contacts", start, end, searchAfter? }
//     → { contacts:[{id,n,c,src,u,tags,attr}], total, searchAfter|null }
//   { action:"sweep", ids:[contactId,...] }   (máx 8 por llamada)
//     → { results:[{id, fo, fi, lm, cerr, aerr, ap:{tot,sh,ns,fut}}] }
//     cerr/aerr = no se pudieron leer conversaciones/citas (≠ "no hubo")
//     fo = primer mensaje SALIENTE (ts) · fi = primer mensaje ENTRANTE (ts)
//     lm = último mensaje (ts) · ap = citas: total, showed, noshow, futuras
//   { action:"opps", startAfter?, startAfterId? }
//     → { opps:[{u,st,c,stc,v}], cursor|null, total, fetched }

const S = require("./lib/shared.js");

const API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const BASE = "https://services.leadconnectorhq.com";
const SWEEP_MAX = 8;

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

function attrOf(c) {
  const list = Array.isArray(c.attributions) ? c.attributions : [];
  const pick = (o, ...keys) => { for (const k of keys) { if (o && typeof o[k] === "string" && o[k]) return o[k]; } return ""; };
  const last = list[list.length - 1] || c.lastAttributionSource || {};
  const first = list[0] || c.attributionSource || {};
  return {
    camp: pick(last, "campaign", "utmCampaign") || pick(first, "campaign", "utmCampaign"),
    src: pick(last, "utmSource", "sessionSource") || pick(first, "utmSource", "sessionSource"),
    med: pick(last, "utmMedium", "medium") || pick(first, "utmMedium", "medium"),
    ad: "",
  };
}

async function contacts({ start, end, searchAfter }) {
  if (!start || !end) throw Object.assign(new Error("start y end requeridos (ISO datetime)"), { status: 400 });
  const out = [];
  let cursor = Array.isArray(searchAfter) && searchAfter.length ? searchAfter : null;
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const body = {
      locationId: LOCATION_ID,
      pageLimit: 100,
      filters: [{ field: "dateAdded", operator: "range", value: { gte: start, lte: end } }],
      sort: [{ field: "dateAdded", direction: "asc" }],
    };
    if (cursor) body.searchAfter = cursor;
    const data = await ghl("/contacts/search", { method: "POST", body });
    const batch = data.contacts || [];
    batch.forEach((c) => out.push({
      id: c.id,
      n: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "(sin nombre)",
      c: c.dateAdded || "",
      src: (c.source || "").trim(),
      u: c.assignedTo || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      attr: attrOf(c),
    }));
    total = data.total ?? total;
    const lastRaw = batch[batch.length - 1];
    cursor = batch.length === 100 && lastRaw && Array.isArray(lastRaw.searchAfter) ? lastRaw.searchAfter : null;
    if (!cursor) break;
  }
  return { contacts: out, total, fetched: out.length, searchAfter: cursor };
}

const ts = (x) => { const t = new Date(x || 0).getTime(); return isFinite(t) && t > 0 ? t : null; };

// Mensajes de una conversación, tolerante a las dos formas de respuesta del API
// (plana o anidada bajo "messages"), paginando hasta 3 páginas hacia lo más viejo.
async function allMessages(convId) {
  const msgs = [];
  let lastId = null;
  for (let i = 0; i < 3; i++) {
    let qs = "limit=100";
    if (lastId) qs += `&lastMessageId=${encodeURIComponent(lastId)}`;
    const data = await ghl(`/conversations/${convId}/messages?${qs}`);
    const box = data && data.messages && Array.isArray(data.messages.messages) ? data.messages : data;
    const list = Array.isArray(box.messages) ? box.messages : [];
    msgs.push(...list);
    if (!box.nextPage || !box.lastMessageId || !list.length) break;
    lastId = box.lastMessageId;
  }
  return msgs.filter((m) => !/^TYPE_ACTIVITY/.test(m.messageType || ""));
}

async function sweepOne(id) {
  const out = { id, fo: null, fi: null, lm: null, cerr: false, aerr: false, ap: { tot: 0, sh: 0, ns: 0, fut: 0 } };
  // Conversaciones del contacto
  try {
    const cs = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${encodeURIComponent(id)}&limit=20`);
    const convs = cs.conversations || [];
    for (const cv of convs) {
      const lmd = ts(cv.lastMessageDate);
      if (lmd && (!out.lm || lmd > out.lm)) out.lm = lmd;
      const msgs = await allMessages(cv.id).catch(() => []);
      for (const m of msgs) {
        const t = ts(m.dateAdded); if (!t) continue;
        if (m.direction === "outbound" && (!out.fo || t < out.fo)) out.fo = t;
        if (m.direction === "inbound" && (!out.fi || t < out.fi)) out.fi = t;
        if (!out.lm || t > out.lm) out.lm = t;
      }
    }
  } catch (e) { out.cerr = true; /* conversaciones no disponibles: se marca, no se asume "sin contacto" */ }
  // Citas del contacto
  try {
    const ap = await ghl(`/contacts/${encodeURIComponent(id)}/appointments`);
    const evs = ap.events || [];
    const now = Date.now();
    for (const ev of evs) {
      out.ap.tot++;
      const st = String(ev.appointmentStatus || ev.status || "").toLowerCase();
      if (st === "showed" || st === "completed") out.ap.sh++;
      else if (st === "noshow") out.ap.ns++;
      else if (ts(ev.startTime) > now) out.ap.fut++;
    }
  } catch (e) { out.aerr = true; /* citas no disponibles */ }
  return out;
}

async function sweep({ ids }) {
  if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error("ids requerido"), { status: 400 });
  const batch = ids.slice(0, SWEEP_MAX).filter((x) => typeof x === "string" && x);
  const results = [];
  // Concurrencia 4 para quedar lejos del burst limit de GHL (100 req/10s)
  for (let i = 0; i < batch.length; i += 4) {
    const part = await Promise.all(batch.slice(i, i + 4).map((id) => sweepOne(id)));
    results.push(...part);
  }
  return { results };
}

async function users() {
  const resp = await ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null);
  const map = {};
  if (resp && Array.isArray(resp.users)) {
    resp.users.forEach((u) => { if (u.id && !u.deleted) map[u.id] = u.name || u.email || u.id; });
  }
  return { users: map };
}

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
      u: o.assignedTo || "",
      st: o.status || "open",
      c: o.createdAt || "",
      stc: o.lastStatusChangeAt || o.createdAt || "",
      v: Number(o.monetaryValue) || 0,
    }));
    total = (data.meta && data.meta.total) || total;
    const meta = data.meta || {};
    if (batch.length < 100 || !meta.startAfterId) { cursor = null; break; }
    cursor = { startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return { opps: out, cursor, total, fetched: out.length };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!API_KEY || !LOCATION_ID) return json(500, { error: "GHL_API_KEY / GHL_LOCATION_ID no configuradas en el entorno" });

  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  const ch = session.channels || [];
  if (session.role !== "admin" && !ch.includes("crm_live") && !ch.includes("direccion_comercial")) {
    return json(403, { error: "Sin acceso al reporte de SLA" });
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }

  try {
    if (payload.action === "contacts") return json(200, await contacts(payload));
    if (payload.action === "sweep") return json(200, await sweep(payload));
    if (payload.action === "users") return json(200, await users());
    if (payload.action === "opps") return json(200, await opps(payload));
    return json(400, { error: "action debe ser 'contacts', 'sweep', 'users' u 'opps'" });
  } catch (e) {
    const status = e.status === 429 ? 429 : e.status === 400 ? 400 : 502;
    return json(status, { error: String(e.message || e), detail: e.detail });
  }
};
