// Netlify Function: datos para el reporte del Ejecutivo de Primer Contacto y Rescate
// (Manual Operativo de Primer Contacto y Rescate, Dirección General, oct-2026), directo del
// CRM (GoHighLevel). La definición de acción manual, canal, desenlace y duración de llamada
// es la MISMA de Desempeño de Ventas: se importa de sla-report.js, no se copia.
//
// Env vars: GHL_API_KEY, GHL_LOCATION_ID.
//
// Acciones (POST JSON + Authorization: Bearer <token>):
//   { action:"users" }                       → catálogo de usuarios, campos y pipelines (igual que Desempeño)
//   { action:"contacts", start, end, searchAfter? } → leads creados en el rango (igual que Desempeño)
//   { action:"citas", start, end }           → citas por fecha de la cita, con cb = quién la creó
//   { action:"conversaciones", desde, cursor? }
//     → { convs:[{id, ct, k}], cursor|null, modo, ordenOk, sinFecha, paginas }
//     Conversaciones con actividad MANUAL desde `desde` (ms), de la más reciente hacia atrás:
//     el universo de la cartera que trabajó el ejecutivo sin depender de que Sistemas le
//     ponga una etiqueta a cada contacto. modo = "manual" (orden por último mensaje manual) o
//     "todos" (el API no aceptó ese orden y se usó el del último mensaje: más lento, igual
//     de completo). ordenOk = false si el API no devolvió las fechas en orden: el corte por
//     fecha deja de ser confiable y el front lo avisa.
//   { action:"eventos", convs?:[{id, ct}], cts?:[contactId], desde, hasta? }   (máx 10 por llamada)
//     → { res:[{ ct, cv:[convId], ev:[[t, canal, origen, userId, desenlace?, duración?]], err }] }
//     Un evento por mensaje de la conversación dentro de [desde, hasta]. origen: "m" acción
//     manual de un usuario, "a" automática (workflow, campaña, envío masivo, API o sin
//     usuario: el marcador automático cae aquí aunque traiga el usuario del ejecutivo), "i"
//     entrante del prospecto, "p" entrante que no es respuesta (mensaje predeterminado de nuestras
//     páginas o respuesta automática del prospecto). canal: call/whatsapp/sms/email/social. Las llamadas traen su
//     desenlace (ok/na/linea/otro) y su duración en segundos (null si el CRM no la trae).
//     Sin cuerpos de mensaje: el reporte cuenta toques, no lee conversaciones.
//   { action:"contactos", ids:[contactId], tareas? }   (máx 30 por llamada)
//     → { contactos:[{id,n,c,src,u,tags,attr,cf, tk?}], fallidos[] }
//     tk = tareas: abiertas con fecha (para auditar Largo plazo: "motivo, fecha y tarea").
//   { action:"regresan", start, end, campo, searchAfter? }
//     → { contactos:[…como contacts], searchAfter|null, revisados }
//     Leads que regresan (10.4): contactos que ya existían antes de `start`, se actualizaron
//     después, y cuyo campo `campo` (la fecha del último formulario, que llena el workflow) cae en
//     [start, end]. El filtro por el campo se hace aquí para no mandar al navegador todo lo actualizado.
//   { action:"opps", contactIds:[...] }      (máx 40 por llamada)
//     → { opps:[{id,ct,u,st,p,s,sc,scE,c,cf}], fallidos[] }

const S = require("./lib/shared.js");
const SLA = require("./sla-report.js").internals;

const API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const json = S.json;
const ghl = S.ghlFetch;
const { ts, chanOf, callStatus, callDesenlace, callDur, cfMap, mapContact, AUTO_SOURCES, esPlantillaEntrante } = SLA;

// Cada llamada debe caber en los 10 s de una Netlify Function: 5 páginas de conversaciones
// (500) y 10 conversaciones con sus mensajes. El front sigue con el cursor / el siguiente lote.
const CONV_PAGINAS = 5;
const EV_MAX = 10;
const CT_MAX = 30;
const OPP_MAX = 40;
const ID_RX = /^[A-Za-z0-9_-]{4,64}$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// --- Conversaciones con actividad manual desde una fecha ----------------------------------
// kM = fecha del último mensaje MANUAL de la conversación; kL = del último mensaje de
// cualquier tipo. El orden lo pide el front al API (sortBy); el corte se hace con la fecha
// que garantiza no perder nada: kL ≥ kM siempre, así que kL < desde implica que ya no hay
// actividad manual desde `desde` en esa ni en las siguientes, con cualquiera de los dos órdenes.
const num = (x) => { const n = Number(x); return isFinite(n) && n > 0 ? n : null; };
function sortVal(cv) { return Array.isArray(cv.sort) && cv.sort.length ? num(cv.sort[0]) : null; }

async function conversaciones({ desde, cursor }) {
  const d0 = num(desde);
  if (!d0) throw bad("desde requerido (ms)");
  let sortBy = "last_manual_message_date", cambio = null;
  let after = num(cursor);
  const out = [];
  let fin = false, ordenOk = true, prevM = Infinity, sinFecha = 0, paginas = 0;
  for (let i = 0; i < CONV_PAGINAS; i++) {
    let qs = `locationId=${LOCATION_ID}&limit=100&sort=desc&sortBy=${sortBy}`;
    if (after) qs += `&startAfterDate=${after}`;
    let data;
    try { data = await ghl(`/conversations/search?${qs}`); }
    catch (e) {
      // El orden por último mensaje manual no es aceptado: se cae al del último mensaje.
      if (sortBy === "last_manual_message_date" && (e.status === 400 || e.status === 422)) {
        sortBy = "last_message_date"; cambio = String(e.message || e); i--; continue;
      }
      throw e;
    }
    paginas++;
    const list = data.conversations || [];
    for (const cv of list) {
      const kL = ts(cv.lastMessageDate);
      let kM = ts(cv.lastManualMessageDate);
      if (kM == null && sortBy === "last_manual_message_date") kM = sortVal(cv);
      if (sortBy === "last_manual_message_date" && kM != null) {
        if (kM > prevM + 1000) ordenOk = false;
        prevM = Math.min(prevM, kM);
      }
      if (kL != null && kL < d0) { fin = true; break; }
      if (ordenOk && sortBy === "last_manual_message_date" && kM != null && kM < d0) { fin = true; break; }
      const k = kM != null ? kM : kL;
      if (k == null) sinFecha++;
      else if (k < d0) continue;
      if (cv.id) out.push({ id: cv.id, ct: cv.contactId || "", k });
    }
    if (fin || list.length < 100) { fin = true; break; }
    const last = list[list.length - 1];
    after = sortVal(last) || (sortBy === "last_manual_message_date" ? ts(last.lastManualMessageDate) : null) || ts(last.lastMessageDate);
    if (!after) { fin = true; ordenOk = false; break; }
  }
  return { convs: out, cursor: fin ? null : after, modo: sortBy === "last_manual_message_date" ? "manual" : "todos",
    ordenOk, sinFecha, paginas, cambio };
}

// --- Eventos de una conversación -------------------------------------------------------
// Mensajes de la conversación hasta llegar a `desde` (el API los da del más nuevo al más
// viejo): una conversación con años de nurturing no se lee completa, solo la ventana.
async function mensajesDesde(convId, desde) {
  const msgs = [];
  let lastId = null;
  for (let i = 0; i < 6; i++) {
    let qs = "limit=100";
    if (lastId) qs += `&lastMessageId=${encodeURIComponent(lastId)}`;
    const data = await ghl(`/conversations/${encodeURIComponent(convId)}/messages?${qs}`);
    const box = data && data.messages && Array.isArray(data.messages.messages) ? data.messages : data;
    const list = Array.isArray(box.messages) ? box.messages : [];
    msgs.push(...list);
    let viejo = Infinity;
    list.forEach((m) => { const t = ts(m.dateAdded); if (t && t < viejo) viejo = t; });
    if (!box.nextPage || !box.lastMessageId || !list.length || viejo < desde) break;
    lastId = box.lastMessageId;
  }
  return msgs.filter((m) => !/^TYPE_ACTIVITY/.test(m.messageType || ""));
}

// Origen de un mensaje saliente. Es la regla de Desempeño (isManual) con una diferencia que
// pide el manual (7.3): Instagram y Facebook SÍ son canal del ejecutivo ("mensaje por el
// canal donde el prospecto se acercó"); en Desempeño quedaban fuera de la acción manual.
// "p" = entrante que no es respuesta: el mensaje predeterminado de los botones de WhatsApp de
// nuestras páginas o la respuesta automática del prospecto (ver sla-report.js).
function origen(m) {
  if (m.direction === "inbound") return esPlantillaEntrante(m) ? "p" : "i";
  const tipo = String(m.messageType || m.type || "");
  const src = String(m.source || "").toLowerCase();
  if (/^TYPE_CAMPAIGN/i.test(tipo) || AUTO_SOURCES.has(src) || !m.userId) return "a";
  return "m";
}
function evento(m) {
  const t = ts(m.dateAdded); if (!t) return null;
  const ch = chanOf(m);
  if (ch === "otro") return null;               // formularios, actividad, etc.: no son toques
  const e = [t, ch, origen(m), m.userId || ""];
  if (ch === "call") e.push(callDesenlace(callStatus(m)), callDur(m));
  return e;
}

async function eventosDe(item, d0, d1) {
  const r = { ct: item.ct || "", cv: [], ev: [], err: false };
  try {
    let convIds = item.id ? [item.id] : [];
    if (!convIds.length && item.ct) {
      const cs = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${encodeURIComponent(item.ct)}&limit=20`);
      convIds = (cs.conversations || []).map((c) => c.id).filter(Boolean);
    }
    r.cv = convIds;
    let fallidas = 0;
    for (const id of convIds) {
      const msgs = await mensajesDesde(id, d0).catch(() => { fallidas++; return []; });
      msgs.forEach((m) => {
        const e = evento(m);
        if (e && e[0] >= d0 && (!d1 || e[0] <= d1)) r.ev.push(e);
      });
    }
    if (convIds.length && fallidas === convIds.length) r.err = true;
    r.ev.sort((a, b) => a[0] - b[0]);
  } catch (e) { r.err = true; }
  return r;
}

async function eventos({ convs, cts, desde, hasta }) {
  const d0 = num(desde), d1 = num(hasta);
  if (!d0) throw bad("desde requerido (ms)");
  const items = [];
  (Array.isArray(convs) ? convs : []).forEach((c) => { if (c && ID_RX.test(String(c.id || ""))) items.push({ id: String(c.id), ct: String(c.ct || "") }); });
  (Array.isArray(cts) ? cts : []).forEach((id) => { if (ID_RX.test(String(id || ""))) items.push({ ct: String(id) }); });
  if (!items.length) throw bad("convs o cts requerido");
  const lote = items.slice(0, EV_MAX), res = [];
  // Concurrencia 4: lejos del burst limit de GHL (100 req/10 s), igual que el barrido de Desempeño.
  for (let i = 0; i < lote.length; i += 4) res.push(...await Promise.all(lote.slice(i, i + 4).map((it) => eventosDe(it, d0, d1))));
  return { res };
}

// --- Contactos y oportunidades por id ---------------------------------------------------
async function contactos({ ids, tareas }) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => ID_RX.test(x)))].slice(0, CT_MAX);
  if (!lista.length) throw bad("ids requerido");
  const out = [], fallidos = [];
  const now = Date.now();
  for (let i = 0; i < lista.length; i += 6) {
    await Promise.all(lista.slice(i, i + 6).map(async (id) => {
      try {
        const d = await ghl(`/contacts/${encodeURIComponent(id)}`);
        const c = d.contact || d;
        if (!c || !c.id) { fallidos.push(id); return; }
        const x = mapContact(c);
        if (tareas) {
          // Largo plazo bien cerrado exige tarea de recontacto (10.3): una tarea abierta con fecha.
          try {
            const tk = await ghl(`/contacts/${encodeURIComponent(id)}/tasks`);
            const t = { abiertas: 0, fut: 0, venc: 0 };
            (tk.tasks || []).forEach((k) => {
              const done = k.completed === true || /^complet/i.test(String(k.status || ""));
              const due = ts(k.dueDate);
              if (done || !due) return;
              t.abiertas++; if (due >= now) t.fut++; else t.venc++;
            });
            x.tk = t;
          } catch (e) { x.tk = null; }
        }
        out.push(x);
      } catch (e) { fallidos.push(id); }
    }));
  }
  return { contactos: out, fallidos };
}

async function regresan({ start, end, campo, searchAfter }) {
  const t0 = Date.parse(start), t1 = Date.parse(end);
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) throw bad("start y end requeridos (ISO datetime)");
  if (!ID_RX.test(String(campo || ""))) throw bad("campo requerido (id del campo de la fecha del último formulario)");
  const out = [];
  let cursor = Array.isArray(searchAfter) && searchAfter.length ? searchAfter : null, revisados = 0, filtroAlta = true;
  for (let i = 0; i < 5; i++) {
    // Actualizados desde `start` hasta hoy (no hasta `end`): un contacto que regresó en el rango y se
    // volvió a tocar después tiene su dateUpdated posterior.
    const filters = [{ field: "dateUpdated", operator: "range", value: { gte: start, lte: new Date().toISOString() } }];
    if (filtroAlta) filters.push({ field: "dateAdded", operator: "range", value: { lte: start } });
    const body = { locationId: LOCATION_ID, pageLimit: 100, filters, sort: [{ field: "dateUpdated", direction: "asc" }] };
    if (cursor) body.searchAfter = cursor;
    let data;
    try { data = await ghl("/contacts/search", { method: "POST", body }); }
    catch (e) {
      // Si el API no acepta el rango abierto de dateAdded, se pide sin él y se filtra aquí
      if (!filtroAlta || !(e.status === 400 || e.status === 422)) throw e;
      filtroAlta = false; i--; continue;
    }
    const batch = data.contacts || [];
    batch.forEach((c) => {
      revisados++;
      if (!(Date.parse(c.dateAdded || "") < t0)) return;
      const x = mapContact(c), v = String(x.cf[campo] || "").trim();
      const t = /^\d{12,13}$/.test(v) ? Number(v) : Date.parse(v);
      if (v && isFinite(t) && t >= t0 - 86400e3 && t <= t1 + 86400e3) out.push(x);   // ±1 día: el front decide con la hora de Tulum
    });
    const lastRaw = batch[batch.length - 1];
    cursor = batch.length === 100 && lastRaw && Array.isArray(lastRaw.searchAfter) ? lastRaw.searchAfter : null;
    if (!cursor) break;
  }
  return { contactos: out, searchAfter: cursor, revisados };
}

async function opps({ contactIds }) {
  const lista = [...new Set((Array.isArray(contactIds) ? contactIds : []).map(String).filter((x) => ID_RX.test(x)))].slice(0, OPP_MAX);
  if (!lista.length) throw bad("contactIds requerido");
  const out = [], fallidos = [];
  for (let i = 0; i < lista.length; i += 6) {
    await Promise.all(lista.slice(i, i + 6).map(async (id) => {
      try {
        const data = await ghl(`/opportunities/search?location_id=${LOCATION_ID}&contact_id=${encodeURIComponent(id)}&limit=100`);
        (data.opportunities || []).forEach((o) => out.push({
          id: o.id || "", ct: o.contactId || (o.contact && o.contact.id) || id, u: o.assignedTo || "", st: o.status || "open",
          p: o.pipelineId || "", s: o.pipelineStageId || "",
          sc: o.lastStageChangeAt || o.lastStatusChangeAt || o.updatedAt || o.createdAt || "",
          scE: o.lastStageChangeAt || "", c: o.createdAt || "", cf: cfMap(o.customFields),
        }));
      } catch (e) { fallidos.push(id); }
    }));
  }
  return { opps: out, fallidos };
}

// Quién ve este reporte: el canal propio (pc_view, para dárselo al ejecutivo o a Gerencia de
// Ventas sin abrirles todo Desempeño) y los que ya leen el CRM con nombres.
const CANALES = ["pc_view", "sla_view", "crm_live", "direccion_comercial"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const miss = S.missingEnv();
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });
  if (!API_KEY || !LOCATION_ID) return json(500, { error: "GHL_API_KEY / GHL_LOCATION_ID no configuradas en el entorno" });
  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  const ch = session.channels || [];
  if (session.role !== "admin" && !CANALES.some((c) => ch.includes(c))) return json(403, { error: "Sin acceso al reporte de Primer Contacto" });
  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }
  try {
    switch (payload.action) {
      case "users": return json(200, await SLA.users());
      case "contacts": return json(200, await SLA.contacts(payload));
      case "citas": return json(200, await SLA.citas(payload));
      case "conversaciones": return json(200, await conversaciones(payload));
      case "eventos": return json(200, await eventos(payload));
      case "contactos": return json(200, await contactos(payload));
      case "opps": return json(200, await opps(payload));
      case "regresan": return json(200, await regresan(payload));
      default: return json(400, { error: "action debe ser users, contacts, citas, conversaciones, eventos, contactos, opps o regresan" });
    }
  } catch (e) {
    const status = e.status === 429 ? 429 : e.status === 400 ? 400 : 502;
    return json(status, { error: String(e.message || e), detail: e.detail });
  }
};
