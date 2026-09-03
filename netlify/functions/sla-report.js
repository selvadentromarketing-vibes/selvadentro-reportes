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

const ghl = S.ghlFetch;   // cliente compartido (lib/shared.js)

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
  // El diagnóstico del 2026-08-26 encontró TYPE_CAMPAIGN_CALL en el feed real: es una
  // llamada disparada por una campaña, no un asesor marcando. Cualquier TYPE_CAMPAIGN_*
  // queda fuera por tipo, sin depender de que `source` venga bien poblado.
  if (/^TYPE_CAMPAIGN/i.test(String(m.messageType || m.type || ""))) return false;
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
    // Diagnóstico de telefonía (spec A4): qué valores trae DE VERDAD el campo status de
    // las llamadas, con conteo, y cuántas llamadas traen duración legible. Con esto la
    // pantalla puede responder "por qué las llamadas conectadas daban 0%" con datos.
    cst: {},                              // { status: n } de TODOS los mensajes tipo CALL
    cdur: 0,                              // llamadas con duración legible
    c90: 0,                               // llamadas de ≥90 s (llamada efectiva, spec D4)
    // Histograma de la hora (Tulum) de cada acción manual del asesor: permite MEDIR el
    // horario real de trabajo en vez de asumirlo. hrs[0..23], dow[0..6] (0 = domingo).
    hrs: new Array(24).fill(0),
    dow: new Array(7).fill(0),
    users: [],                            // asesores que tocaron el contacto
    ap: { tot: 0, sh: 0, ns: 0, fut: 0, f: null },
  };
  const dset = new Set(), cset = new Set(), uset = new Set();
  // Conversaciones del contacto
  try {
    const cs = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${encodeURIComponent(id)}&limit=20`);
    const convs = cs.conversations || [];
    // Si el token tiene el scope de conversaciones pero NO el de mensajes, la búsqueda
    // responde 200 y todos los mensajes vuelven vacíos: el reporte concluía "nunca
    // contactado" y le ponía 1 de 5 a todos los asesores. Contamos los fallos para
    // poder distinguir "no lo contactaron" de "no pudimos leerlo".
    let convFallidas = 0;
    for (const cv of convs) {
      const lmd = ts(cv.lastMessageDate);
      if (lmd && (!out.lm || lmd > out.lm)) out.lm = lmd;
      const msgs = await allMessages(cv.id).catch(() => { convFallidas++; return []; });
      for (const m of msgs) {
        const t = ts(m.dateAdded); if (!t) continue;
        // Toda llamada (manual o no) alimenta el diagnóstico de telefonía (A4/D4)
        if (chanOf(m) === "call") {
          const cs = String(m.status || "").toLowerCase() || "(sin status)";
          out.cst[cs] = (out.cst[cs] || 0) + 1;
          const dur = Number(m.callDuration ?? m.duration ?? (m.meta && m.meta.call && m.meta.call.duration));
          if (isFinite(dur) && dur > 0) { out.cdur++; if (dur >= 90) out.c90++; }
        }
        if (m.direction === "outbound" && (!out.fo || t < out.fo)) out.fo = t;
        if (m.direction === "inbound" && (!out.fi || t < out.fi)) out.fi = t;
        if (!out.lm || t > out.lm) out.lm = t;
        if (m.direction === "outbound" && isManual(m)) {
          if (!out.foM || t < out.foM) out.foM = t;
          dset.add(dayKey(t));
          const ch = chanOf(m); cset.add(ch);
          if (ch === "call") out.calls++;
          const loc = new Date(t - TZ_MS);
          out.hrs[loc.getUTCHours()]++;
          out.dow[loc.getUTCDay()]++;
          // Actividad efectiva. Una llamada CONECTADA es el caso más efectivo que
          // existe, pero su status es "connected" y antes caía en el else, es decir
          // sumaba al denominador sin sumar al numerador: castigaba justo al asesor
          // que trabaja por teléfono. Lo mismo con "answered".
          const st = String(m.status || "").toLowerCase();
          // "sent" NO es entregado: contarlo en el numerador inflaba la actividad
          // efectiva. Y un status desconocido (p.ej. opened/clicked de email) tampoco
          // debe caer al denominador sin ir al numerador: se trata como ilegible.
          // "completed" es el status REAL de una llamada conectada en la telefonía de
          // GoHighLevel: los valores "connected"/"answered" que se filtraban antes no
          // existen en esa capa (queued, ringing, in-progress, completed, busy,
          // no-answer, canceled, failed) — por eso "llamadas conectadas" daba 0% (A4).
          if (st === "read" || st === "connected" || st === "answered" || st === "completed" || st === "opened" || st === "clicked") out.deliv.read++;
          else if (st === "delivered") out.deliv.delivered++;
          else if (st === "failed" || st === "undelivered" || st === "no-answer" || st === "busy" || st === "voicemail" || st === "canceled") out.deliv.failed++;
          else if (st === "sent" || st === "pending" || st === "scheduled" || st === "queued" || st === "ringing" || st === "in-progress") out.deliv.sent++;
          else out.deliv.sin++;                   // sin status legible: fuera del %
          if (m.userId) uset.add(m.userId);
        }
      }
    }
    // Había conversaciones pero NINGUNA devolvió mensajes: es un fallo de lectura
    // (típicamente falta el scope de mensajes en el token), no ausencia de contacto.
    if (convs.length && convFallidas === convs.length) out.cerr = true;
  } catch (e) { out.cerr = true; /* conversaciones no disponibles: se marca, no se asume "sin contacto" */ }
  // Tareas del contacto (spec C1): programadas, cerradas en fecha y vencidas abiertas.
  // El manual gobierna cada cadencia con tareas, así que son evidencia que el asesor ya
  // produce — no un campo nuevo que alguien tenga que acordarse de llenar.
  out.tk = { prog: 0, enFecha: 0, venc: 0 };
  out.tkerr = false;
  try {
    const tk = await ghl(`/contacts/${encodeURIComponent(id)}/tasks`);
    const now = Date.now();
    for (const t of (tk.tasks || [])) {
      out.tk.prog++;
      const due = ts(t.dueDate);
      const done = t.completed === true || /^complet/i.test(String(t.status || ""));
      // El API no siempre trae la fecha de cierre; se aproxima con la última
      // actualización. Si ni eso hay, una tarea completada con fecha límite cuenta
      // como en fecha (criterio a favor del asesor, declarado en pantalla).
      const doneAt = ts(t.completedAt || t.dateUpdated || t.updatedAt);
      if (done) { if (!due || !doneAt || doneAt <= due + 86400e3) out.tk.enFecha++; }
      else if (due && due < now) out.tk.venc++;
    }
  } catch (e) { out.tkerr = true; /* tareas no disponibles: se marca, no se asume 0 */ }
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
  const [resp, fieldsResp, pipesResp] = await Promise.all([
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null),
    ghl(`/locations/${LOCATION_ID}/customFields`).catch(() => null),
    // Catálogo de pipelines y etapas, LITERAL como lo escribe el CRM (spec B1/D1/E1):
    // contra esta columna se codifican los filtros de etapa, carácter por carácter.
    ghl(`/opportunities/pipelines?locationId=${LOCATION_ID}`).catch(() => null),
  ]);
  const map = {};
  if (resp && Array.isArray(resp.users)) {
    resp.users.forEach((u) => { if (u.id && !u.deleted) map[u.id] = u.name || u.email || u.id; });
  }
  const fields = ((fieldsResp && fieldsResp.customFields) || []).map((f) => ({
    id: f.id, name: f.name || f.fieldKey || "", key: f.fieldKey || "",
  }));
  const pipelines = ((pipesResp && pipesResp.pipelines) || []).map((p) => ({
    id: p.id, name: p.name || "",
    stages: (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => ({ id: s.id, name: s.name || "" })),
  }));
  return { users: map, fields, pipelines };
}

async function opps({ startAfter, startAfterId, since }) {
  const out = [];
  let cursor = startAfter && startAfterId ? { startAfter, startAfterId } : null;
  let total = 0;
  // Mismo acotado que en lead-quality: solo el rango analizado, no el CRM entero.
  let usarFiltro = !!since;
  for (let i = 0; i < 6; i++) {
    const base = `location_id=${LOCATION_ID}&limit=100`;
    let qs = base + (usarFiltro ? `&date=${encodeURIComponent(since)}` : "");
    if (cursor) qs += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
    let data;
    try {
      data = await ghl(`/opportunities/search?${qs}`);
    } catch (e) {
      if (!usarFiltro || e.status !== 400) throw e;
      usarFiltro = false;
      let q2 = base;
      if (cursor) q2 += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
      data = await ghl(`/opportunities/search?${q2}`);
    }
    const batch = data.opportunities || [];
    batch.forEach((o) => out.push({
      ct: o.contactId || (o.contact && o.contact.id) || "",   // para fijar el traspaso a ventas
      u: o.assignedTo || "",
      st: o.status || "open",
      c: o.createdAt || "",
      stc: o.lastStatusChangeAt || o.createdAt || "",
      v: Number(o.monetaryValue) || 0,
      p: o.pipelineId || "",                                   // pipeline (alcance D1)
      s: o.pipelineStageId || "",                              // etapa actual (E1)
      sc: o.lastStageChangeAt || o.lastStatusChangeAt || o.updatedAt || o.createdAt || "",
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
    // SESSION_SECRET hace falta para verificar el token de sesión, y sin ella
  // crypto.createHmac lanza y la function responde 502 SIN cabeceras CORS: el navegador
  // reporta un error de CORS en vez de decir que falta una variable. Solo tres de las
  // nueve functions comprobaban esto.
  const miss = S.missingEnv();
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });
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
