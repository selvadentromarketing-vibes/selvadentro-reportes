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
//     → { results:[{id, fo, fi, lm, foM, days[], calls, chans[], deliv{}, users[], cerr, aerr, ap{}}] }
//     foM = primer contacto MANUAL (excluye workflows/campañas) · days = días distintos
//     con contacto manual · calls = intentos de llamada · deliv = estado de entrega
//     cerr/aerr = no se pudieron leer conversaciones/citas (≠ "no hubo")
//     fo = primer mensaje SALIENTE (ts) · fi = primer mensaje ENTRANTE (ts)
//     lm = último mensaje (ts) · ap = citas: total, showed, noshow, futuras, f = cita más temprana (ts)
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
      cf: (c.customFields || []).reduce((m, f) => {
        if (f && f.id != null) m[f.id] = Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "");
        return m;
      }, {}),
    }));
    total = data.total ?? total;
    const lastRaw = batch[batch.length - 1];
    cursor = batch.length === 100 && lastRaw && Array.isArray(lastRaw.searchAfter) ? lastRaw.searchAfter : null;
    if (!cursor) break;
  }
  return { contacts: out, total, fetched: out.length, searchAfter: cursor };
}

const ts = (x) => { const t = new Date(x || 0).getTime(); return isFinite(t) && t > 0 ? t : null; };

// "Acción manual" = la hizo un asesor con las manos. Definido con el cliente el
// 2026-08-26: cuentan llamadas del asesor, WhatsApp escrito por el asesor, y SMS y
// email escritos a mano desde el CRM. NO cuenta nada disparado por una
// automatización, ni los mensajes que entran por un proveedor externo vía API.
//
// Los cinco valores que documenta GoHighLevel para `source` son workflow,
// bulk_actions, campaign, api y app. Solo `app` es una persona en el CRM; `api` es
// integración de terceros y queda fuera por decisión del cliente.
const AUTO_SOURCES = new Set(["workflow", "campaign", "bulk_actions", "automation", "api"]);
// Canales que cuentan como acción manual del asesor.
const CANALES_MANUALES = new Set(["call", "whatsapp", "sms", "email"]);

function isManual(m) {
  const src = String(m.source || "").toLowerCase();
  if (AUTO_SOURCES.has(src)) return false;
  if (!CANALES_MANUALES.has(chanOf(m))) return false;   // formularios, webchat, etc. no son acción del asesor
  return !!m.userId;                      // sin usuario => no se puede atribuir a un asesor
}

// Canal a partir del messageType de GHL. Los tipos sociales (Instagram, Facebook,
// TikTok, webchat) se separan de "otro" para poder distinguir "llegó por un canal
// que no medimos" de "no se pudo clasificar".
function chanOf(m) {
  const t = String(m.messageType || m.type || "").toUpperCase();
  if (t.includes("CALL")) return "call";
  if (t.includes("WHATSAPP")) return "whatsapp";
  if (t.includes("SMS")) return "sms";
  if (t.includes("EMAIL")) return "email";
  if (/INSTAGRAM|FACEBOOK|TIKTOK|WEBCHAT|LIVE_CHAT|GMB|REVIEW/.test(t)) return "social";
  return "otro";
}
const TZ_MS = 5 * 3600e3;                 // Tulum, UTC-5 sin DST
const dayKey = (t) => new Date(t - TZ_MS).toISOString().slice(0, 10);

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
  const out = {
    id, fo: null, fi: null, lm: null, cerr: false, aerr: false,
    foM: null,                            // primer contacto MANUAL (base del SLA del asesor)
    days: [],                             // días distintos con contacto manual (para la regla de 10 días)
    calls: 0,                             // intentos de llamada manuales
    chans: [],                            // canales usados manualmente
    deliv: { sent: 0, delivered: 0, read: 0, failed: 0, sin: 0 },  // actividad efectiva vs realizada; sin = sin status legible
    users: [],                            // asesores que tocaron el contacto
    ap: { tot: 0, sh: 0, ns: 0, fut: 0, f: null },
  };
  const dset = new Set(), cset = new Set(), uset = new Set();
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
        if (m.direction === "outbound" && isManual(m)) {
          if (!out.foM || t < out.foM) out.foM = t;
          dset.add(dayKey(t));
          const ch = chanOf(m); cset.add(ch);
          if (ch === "call") out.calls++;
          // Actividad efectiva. Una llamada CONECTADA es el caso más efectivo que
          // existe, pero su status es "connected" y antes caía en el else, es decir
          // sumaba al denominador sin sumar al numerador: castigaba justo al asesor
          // que trabaja por teléfono. Lo mismo con "answered".
          const st = String(m.status || "").toLowerCase();
          if (st === "read" || st === "connected" || st === "answered") out.deliv.read++;
          else if (st === "delivered" || st === "sent") out.deliv.delivered++;
          else if (st === "failed" || st === "undelivered" || st === "no-answer" || st === "busy" || st === "voicemail") out.deliv.failed++;
          else if (!st) out.deliv.sin++;          // sin status: no se puede juzgar, fuera del %
          else out.deliv.sent++;
          if (m.userId) uset.add(m.userId);
        }
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
      // Cita más temprana: base del SLA de agendamiento (40% a Zoom en 48 h)
      const stt = ts(ev.startTime);
      if (stt && (!out.ap.f || stt < out.ap.f)) out.ap.f = stt;
    }
  } catch (e) { out.aerr = true; /* citas no disponibles */ }
  out.days = [...dset]; out.chans = [...cset]; out.users = [...uset];
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
  const [resp, fieldsResp] = await Promise.all([
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null),
    ghl(`/locations/${LOCATION_ID}/customFields`).catch(() => null),
  ]);
  const map = {};
  if (resp && Array.isArray(resp.users)) {
    resp.users.forEach((u) => { if (u.id && !u.deleted) map[u.id] = u.name || u.email || u.id; });
  }
  const fields = ((fieldsResp && fieldsResp.customFields) || []).map((f) => ({
    id: f.id, name: f.name || f.fieldKey || "", key: f.fieldKey || "",
  }));
  return { users: map, fields };
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
