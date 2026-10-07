// Netlify Function: datos para el reporte "SLA y Seguimiento" (Anexo 1 del
// proceso comercial): SLA de primera respuesta, contactos efectivos, último
// toque, citas y show rate — directo del CRM (GoHighLevel), con nombres.
//
// Env vars: GHL_API_KEY (todos los scopes), GHL_LOCATION_ID.
//
// Acciones (POST JSON + Authorization: Bearer <token>):
//   { action:"contacts", start, end, searchAfter? }
//     → { contacts:[{id,n,c,src,u,tags,attr}], total, searchAfter|null }
//   { action:"sweep", ids:[contactId,...], opts?:{ [contactId]: { cut?, ncD?, ncR? } } }   (máx 8 por llamada)
//     → { results:[{id, fo, fi, fe, lm, foM, foMch, foC, days[], calls, callsOk, chans[], deliv{}, users[], cerr, aerr, ap{}, cl{}, tel{}, nc?, cortados}] }
//     cl = llamadas manuales del asesor: intentos, desenlace (ok/na/linea/otro), conectadas sin
//     duración (dn) y el momento de cada intento (t) · tel = diagnóstico de duración de TODAS
//     las llamadas (con duración, 0 s por no conectar, sin duración) · foMch = canal del 1er toque ·
//     foA / nA = primera llamada AUTOMÁTICA con contacto (≥90 s) y cuántas hubo
//     Change Spec v1.1 (1-oct-2026): cut = fecha de entrada a Descalificado de un lead real
//     descartado — nada posterior cuenta (mensajes, tareas con fecha posterior, citas
//     posteriores). ncD = "Sin llamada - fecha de inicio": nc trae la evidencia ANTERIOR a
//     esa fecha (intentos de llamada no conectados y sus días, mensaje entrante, llamada
//     ≥90 s) y ncR = fecha en que la etiqueta se vio retirada: nc.post = intentos de llamada
//     después de esa fecha. fe = primer contacto EFECTIVO: respuesta del lead o llamada ≥90 s.
//     foM = primer contacto MANUAL (excluye workflows/campañas) · foC = primera llamada
//     CONECTADA · days = días distintos con contacto manual · calls = intentos de llamada ·
//     callsOk = llamadas conectadas · deliv = estado de entrega
//     cerr/aerr = no se pudieron leer conversaciones/citas (≠ "no hubo")
//     fo = primer mensaje SALIENTE (ts) · fi = primer mensaje ENTRANTE (ts)
//     lm = último mensaje (ts) · ap = citas: total, showed, noshow, futuras, f = cita más temprana (ts)
//   { action:"opps", startAfter?, startAfterId? }
//     → { opps:[{id,ct,u,st,c,stc,v,p,s,sc,cf}], cursor|null, total, fetched }
//     cf = campos personalizados de la oportunidad (id → valor): Causa, Evidencia, Asesor
//     que descalificó y Fecha de entrada a Descalificado (spec v1.1 §2).
//   { action:"users" } → { users, fields, oppFields, pipelines }
//   { action:"citas", start, end } → { citas:[{id,ct,u,t,st,cal}], calendarios, errores[] }
//     citas de TODOS los calendarios por fecha de la cita (no por alta del lead)
//   { action:"tagged", tag } → { contacts:[…como contacts], filtro }
//     contactos con esa etiqueta, de cualquier fecha: las descalificaciones revertidas se
//     cuentan por la fecha de descalificación, no por la de alta del lead.

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

// Valor de un campo personalizado, tolerante a las formas del API de GHL: los contactos
// traen `value`; las oportunidades `fieldValue` o `fieldValueString/Number/Date/Array`.
function cfMap(list) {
  const m = {};
  (Array.isArray(list) ? list : []).forEach((f) => {
    if (!f || f.id == null) return;
    let v = f.fieldValue ?? f.fieldValueString ?? f.fieldValueNumber ?? f.fieldValueDate ?? f.fieldValueArray ?? f.value ?? "";
    if (Array.isArray(v)) v = v.join(", ");
    else if (v && typeof v === "object") v = JSON.stringify(v);
    m[f.id] = String(v ?? "");
  });
  return m;
}
const mapContact = (c) => ({
  id: c.id,
  n: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "(sin nombre)",
  c: c.dateAdded || "",
  src: (c.source || "").trim(),
  u: c.assignedTo || "",
  tags: Array.isArray(c.tags) ? c.tags : [],
  attr: attrOf(c),
  cf: cfMap(c.customFields),
});

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
    batch.forEach((c) => out.push(mapContact(c)));
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

// Desenlace de una llamada por su status. La telefonía de GHL lo escribe en m.status; se
// usa meta.call.status solo si m.status viene vacío.
//   ok    conectó (completed / connected / answered)
//   na    sonó y nadie contestó (no-answer, buzón)
//   linea la línea falló: failed, busy, canceled — no es desempeño del asesor (oct-2026:
//         153 de 594 llamadas, 26%, y caían igual que "nunca marcó")
//   otro  sin status legible o intermedio (queued, ringing, in-progress…)
const CALL_OK = new Set(["connected", "answered", "completed"]);
const CALL_NA = new Set(["no-answer", "no_answer", "noanswer", "voicemail"]);
const CALL_LINEA = new Set(["failed", "busy", "canceled", "cancelled"]);
const callStatus = (m) => String(m.status || (m.meta && m.meta.call && m.meta.call.status) || "").toLowerCase().trim();
const callDesenlace = (st) => CALL_OK.has(st) ? "ok" : CALL_NA.has(st) ? "na" : CALL_LINEA.has(st) ? "linea" : "otro";
// Duración de una llamada en segundos, o null si el CRM no la trae. 0 ES una duración
// válida: antes `dur > 0` mandaba a "ilegible" toda llamada que no conectó, y por eso la
// pantalla decía que solo el 40% traía duración. Se acepta número, texto numérico y
// "mm:ss" / "hh:mm:ss", en los lugares donde GHL la ha puesto según el origen.
function callDur(m) {
  const mt = m.meta || {}, mc = mt.call || {};
  for (const v of [m.callDuration, m.duration, mc.duration, mt.callDuration, mt.duration, mc.callDuration]) {
    if (v == null || v === "") continue;
    if (typeof v === "number") { if (isFinite(v) && v >= 0) return v; continue; }
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const hm = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (hm) return (+(hm[1] || 0)) * 3600 + (+hm[2]) * 60 + (+hm[3]);
  }
  return null;
}
// Llaves presentes en una llamada sin duración: dice dónde buscarla si GHL la cambia de lugar.
const llavesDe = (m) => [...Object.keys(m || {}), ...Object.keys((m && m.meta) || {}).map((k) => "meta." + k),
  ...Object.keys((m && m.meta && m.meta.call) || {}).map((k) => "meta.call." + k)];

async function sweepOne(id, opt) {
  // Opciones de la spec v1.1, todas en ms. Sin opciones el barrido es el de siempre.
  const num = (x) => { const n = Number(x); return isFinite(n) && n > 0 ? n : null; };
  const cut = num(opt && opt.cut), ncD = num(opt && opt.ncD), ncR = num(opt && opt.ncR);
  const out = {
    id, fo: null, fi: null, lm: null, li: null, cerr: false, aerr: false,
    fe: null,                             // primer contacto EFECTIVO: respuesta del lead o llamada ≥90 s (R-06)
    cortados: 0,                          // mensajes posteriores a la fecha de descalificación, fuera (R-01)
    foM: null,                            // primer contacto MANUAL (base del SLA del asesor)
    foC: null,                            // primera llamada del asesor que SÍ conectó
    lmM: null,                            // ÚLTIMO toque manual (para "días sin toque")
    callsOk: 0,                           // llamadas manuales conectadas / contestadas
    days: [],                             // días distintos con contacto manual (para la regla de 10 días)
    calls: 0,                             // intentos de llamada manuales
    chans: [],                            // canales usados manualmente
    deliv: { sent: 0, delivered: 0, read: 0, failed: 0, linea: 0, sin: 0 },  // actividad efectiva vs realizada; sin = sin status legible; linea = llamadas failed/busy/canceled
    // Diagnóstico de telefonía (spec A4): qué valores trae DE VERDAD el campo status de
    // las llamadas, con conteo, y cuántas llamadas traen duración legible. Con esto la
    // pantalla puede responder "por qué las llamadas conectadas daban 0%" con datos.
    cst: {},                              // { status: n } de TODOS los mensajes tipo CALL
    // Duración de TODAS las llamadas: dExp = la trae el CRM (0 incluido); d0 = no la trae
    // pero no conectó (0 s por definición); dNo = conectó o sin status y NO la trae — de
    // esas no se puede saber si llegaron a 90 s. c90 = llamadas de ≥90 s (spec D4).
    tel: { tot: 0, dExp: 0, d0: 0, dNo: 0, c90: 0, noSt: {}, llaves: [],
      // Por ORIGEN: del asesor (manual), automática (workflow, campaña, envío masivo, API o
      // sin usuario) y entrante (llamó el lead). El diagnóstico agregado mezclaba las tres.
      por: { manual: { tot: 0, ok: 0, na: 0, linea: 0, otro: 0, c90: 0, dNo: 0 },
             auto: { tot: 0, ok: 0, na: 0, linea: 0, otro: 0, c90: 0, dNo: 0 },
             entrante: { tot: 0, ok: 0, na: 0, linea: 0, otro: 0, c90: 0, dNo: 0 } } },
    // Llamadas MANUALES del asesor a este lead: intentos y su desenlace, y los momentos de
    // cada intento (para el primero y los de las primeras 24 h). dn = conectadas sin duración.
    cl: { n: 0, ok: 0, na: 0, linea: 0, otro: 0, dn: 0, t: [] },
    foMch: null,                          // canal del primer toque manual (call/whatsapp/sms/email)
    // Llamada AUTOMÁTICA con contacto (spec v1.2 §3; Dirección General, 7-oct-2026): el CRM
    // marcó solo —workflow, campaña, marcador— y la llamada duró ≥90 s. Cuenta como contacto
    // a su hora real, con la misma evidencia que una llamada del asesor. foA = la primera.
    foA: null, nA: 0,
    // Histograma de la hora (Tulum) de cada acción manual del asesor: permite MEDIR el
    // horario real de trabajo en vez de asumirlo. hrs[0..23], dow[0..6] (0 = domingo).
    hrs: new Array(24).fill(0),
    dow: new Array(7).fill(0),
    users: [],                            // asesores que tocaron el contacto
    ap: { tot: 0, sh: 0, ns: 0, fut: 0, f: null },
  };
  const dset = new Set(), cset = new Set(), uset = new Set(), llaves = new Set();
  // Evidencia de una etiqueta "sin llamada" (R-05), SIEMPRE anterior a su fecha de inicio:
  // intentos de llamada del asesor que no conectaron y en cuántos días distintos, algún
  // mensaje entrante del lead, alguna llamada ≥90 s. post = intentos después del retiro.
  const ncDias = new Set();
  if (ncD) out.nc = { calls: 0, dias: 0, inb: false, c90: false, post: 0 };
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
      if (lmd && (!cut || lmd <= cut) && (!out.lm || lmd > out.lm)) out.lm = lmd;
      const msgs = await allMessages(cv.id).catch(() => { convFallidas++; return []; });
      for (const m of msgs) {
        const t = ts(m.dateAdded); if (!t) continue;
        const esLlamada = chanOf(m) === "call", dur = esLlamada ? callDur(m) : null;
        if (out.nc) {
          if (t < ncD) {
            if (m.direction === "inbound") out.nc.inb = true;
            if (dur != null && dur >= 90) out.nc.c90 = true;
            if (esLlamada && m.direction === "outbound" && isManual(m) && !CALL_OK.has(callStatus(m))) {
              out.nc.calls++; ncDias.add(dayKey(t));
            }
          }
          if (ncR && t > ncR && esLlamada && m.direction === "outbound" && isManual(m)) out.nc.post++;
        }
        // Lead real descartado (R-01): nada posterior a su entrada a Descalificado cuenta.
        if (cut && t > cut) { out.cortados++; continue; }
        // Contacto efectivo (R-06): el lead respondió, o hubo una llamada de ≥90 s —suya o
        // del asesor—. Una acción manual sola nunca es contacto efectivo.
        const autoContacto = esLlamada && m.direction === "outbound" && !isManual(m) && dur != null && dur >= 90;
        if (autoContacto) { out.nA++; if (!out.foA || t < out.foA) out.foA = t; }
        const efectivo = m.direction === "inbound" || (dur != null && dur >= 90 && (m.direction === "inbound" || isManual(m) || autoContacto));
        if (efectivo && (!out.fe || t < out.fe)) out.fe = t;
        // Toda llamada (manual o no) alimenta el diagnóstico de telefonía (A4/D4)
        if (esLlamada) {
          const st = callStatus(m), des = callDesenlace(st);
          out.cst[st || "(sin status)"] = (out.cst[st || "(sin status)"] || 0) + 1;
          out.tel.tot++;
          const po = out.tel.por[m.direction === "inbound" ? "entrante" : isManual(m) ? "manual" : "auto"];
          po.tot++; po[des]++;
          if (dur != null && dur >= 90) po.c90++;
          if (dur == null && (des === "ok" || des === "otro")) po.dNo++;
          if (dur != null) { out.tel.dExp++; if (dur >= 90) out.tel.c90++; }
          else if (des === "na" || des === "linea") out.tel.d0++;
          else {
            out.tel.dNo++; out.tel.noSt[st || "(sin status)"] = (out.tel.noSt[st || "(sin status)"] || 0) + 1;
            if (llaves.size < 30) llavesDe(m).forEach((k) => llaves.add(k));
          }
        }
        if (m.direction === "outbound" && (!out.fo || t < out.fo)) out.fo = t;
        if (m.direction === "inbound") {
          if (!out.fi || t < out.fi) out.fi = t;
          if (!out.li || t > out.li) out.li = t;      // última respuesta del lead
        }
        if (!out.lm || t > out.lm) out.lm = t;
        if (m.direction === "outbound" && isManual(m)) {
          if (!out.foM || t < out.foM) { out.foM = t; out.foMch = chanOf(m); }
          if (!out.lmM || t > out.lmM) out.lmM = t;   // último toque manual del asesor
          dset.add(dayKey(t));
          const ch = chanOf(m); cset.add(ch);
          if (ch === "call") {
            out.calls++;
            const des = callDesenlace(callStatus(m));
            out.cl.n++; out.cl[des]++;
            if (des === "ok" && dur == null) out.cl.dn++;
            if (out.cl.t.length < 80) out.cl.t.push(t);
          }
          const loc = new Date(t - TZ_MS);
          out.hrs[loc.getUTCHours()]++;
          out.dow[loc.getUTCDay()]++;
          const st = ch === "call" ? callStatus(m) : String(m.status || "").toLowerCase();
          // Llamada que SÍ entró. Un intento que cayó a buzón es una acción del asesor
          // pero no es un contacto, y el reporte por asesor no distinguía las dos cosas.
          // "completed" incluido: es el status que la telefonía de GHL escribe de verdad
          // (spec A4) — filtrar solo connected/answered dejaba esta cifra en 0 para siempre.
          if (ch === "call" && (st === "connected" || st === "answered" || st === "completed")) {
            out.callsOk++;
            if (!out.foC || t < out.foC) out.foC = t;
          }
          // Actividad efectiva. Una llamada CONECTADA es el caso más efectivo que
          // existe, pero su status es "connected" y antes caía en el else, es decir
          // sumaba al denominador sin sumar al numerador: castigaba justo al asesor
          // que trabaja por teléfono. Lo mismo con "answered".
          // "sent" NO es entregado: contarlo en el numerador inflaba la actividad
          // efectiva. Y un status desconocido (p.ej. opened/clicked de email) tampoco
          // debe caer al denominador sin ir al numerador: se trata como ilegible.
          // "completed" es el status REAL de una llamada conectada en la telefonía de
          // GoHighLevel: los valores "connected"/"answered" que se filtraban antes no
          // existen en esa capa (queued, ringing, in-progress, completed, busy,
          // no-answer, canceled, failed) — por eso "llamadas conectadas" daba 0% (A4).
          // Llamada que la LÍNEA no completó (failed, busy, canceled): aparte. Es telefonía,
          // no desempeño, y el front decide desde qué periodo sale del denominador.
          if (ch === "call" && CALL_LINEA.has(st)) out.deliv.linea++;
          else if (st === "read" || st === "connected" || st === "answered" || st === "completed" || st === "opened" || st === "clicked") out.deliv.read++;
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
    if (out.nc) out.nc.dias = ncDias.size;
    out.cl.t.sort((a, b) => a - b);
    out.tel.llaves = [...llaves].slice(0, 30);
  } catch (e) { out.cerr = true; /* conversaciones no disponibles: se marca, no se asume "sin contacto" */ }
  // Tareas del contacto (spec C1): programadas, cerradas en fecha y vencidas abiertas.
  // El manual gobierna cada cadencia con tareas, así que son evidencia que el asesor ya
  // produce — no un campo nuevo que alguien tenga que acordarse de llenar.
  // abiertasFut = tareas abiertas con fecha límite hoy o después: el "next step con fecha"
  // que el Anexo 1 exige a toda oportunidad (integridad de pipeline, spec B2-2).
  out.tk = { prog: 0, enFecha: 0, venc: 0, abiertasFut: 0 };
  out.tkerr = false;
  try {
    const tk = await ghl(`/contacts/${encodeURIComponent(id)}/tasks`);
    const now = Date.now();
    for (const t of (tk.tasks || [])) {
      const due = ts(t.dueDate);
      if (cut && due && due > cut) continue;          // vencía después de descalificarlo: no cuenta
      out.tk.prog++;
      const done = t.completed === true || /^complet/i.test(String(t.status || ""));
      // El API no siempre trae la fecha de cierre; se aproxima con la última
      // actualización. Si ni eso hay, una tarea completada con fecha límite cuenta
      // como en fecha (criterio a favor del asesor, declarado en pantalla).
      const doneAt = ts(t.completedAt || t.dateUpdated || t.updatedAt);
      if (done) { if (!due || !doneAt || doneAt <= due + 86400e3) out.tk.enFecha++; }
      else if (due && due < now) out.tk.venc++;
      else if (due) out.tk.abiertasFut++;
    }
  } catch (e) { out.tkerr = true; /* tareas no disponibles: se marca, no se asume 0 */ }
  // Citas del contacto
  try {
    const ap = await ghl(`/contacts/${encodeURIComponent(id)}/appointments`);
    const evs = ap.events || [];
    const now = Date.now();
    for (const ev of evs) {
      if (cut && ts(ev.startTime) > cut) continue;    // cita posterior a la descalificación
      out.ap.tot++;
      const st = String(ev.appointmentStatus || ev.status || "").toLowerCase();
      if (st === "showed" || st === "completed") out.ap.sh++;
      else if (st === "noshow") out.ap.ns++;
      else if (ts(ev.startTime) > now) out.ap.fut++;
      // Confirmación el mismo día (Anexo 1). Solo es medible mientras la cita sigue en
      // "confirmed": GHL no guarda la hora de confirmación, así que se aproxima con la
      // última actualización, y una cita que ya se marcó showed/noshow pisó ese dato. Se
      // cuenta cuántas se pudieron medir para que el % nunca se lea sin su base.
      if (st === "confirmed") {
        out.ap.conf = (out.ap.conf || 0) + 1;
        const a = ts(ev.dateAdded), u = ts(ev.dateUpdated);
        if (a && u && dayKey(a) === dayKey(u)) out.ap.confDia = (out.ap.confDia || 0) + 1;
      }
      // Cita más temprana: base del SLA de agendamiento (40% a Zoom en 48 h)
      const stt = ts(ev.startTime);
      if (stt && (!out.ap.f || stt < out.ap.f)) out.ap.f = stt;
    }
  } catch (e) { out.aerr = true; /* citas no disponibles */ }
  out.days = [...dset]; out.chans = [...cset]; out.users = [...uset];
  return out;
}

async function sweep({ ids, opts }) {
  if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error("ids requerido"), { status: 400 });
  const batch = ids.slice(0, SWEEP_MAX).filter((x) => typeof x === "string" && x);
  const o = opts && typeof opts === "object" ? opts : {};
  const results = [];
  // Concurrencia 4 para quedar lejos del burst limit de GHL (100 req/10s)
  for (let i = 0; i < batch.length; i += 4) {
    const part = await Promise.all(batch.slice(i, i + 4).map((id) => sweepOne(id, o[id])));
    results.push(...part);
  }
  return { results };
}

async function users() {
  const [resp, fieldsResp, pipesResp, oppFieldsResp] = await Promise.all([
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null),
    ghl(`/locations/${LOCATION_ID}/customFields`).catch(() => null),
    // Catálogo de pipelines y etapas, LITERAL como lo escribe el CRM (spec B1/D1/E1):
    // contra esta columna se codifican los filtros de etapa, carácter por carácter.
    ghl(`/opportunities/pipelines?locationId=${LOCATION_ID}`).catch(() => null),
    // Campos personalizados de OPORTUNIDAD (spec v1.1 §2: Causa, Evidencia, Asesor que
    // descalificó, Fecha de entrada a Descalificado). El catálogo por defecto trae solo los
    // de contacto; si el API no acepta model=opportunity se pide model=all y se filtra.
    ghl(`/locations/${LOCATION_ID}/customFields?model=opportunity`)
      .catch(() => ghl(`/locations/${LOCATION_ID}/customFields?model=all`).catch(() => null)),
  ]);
  const map = {};
  if (resp && Array.isArray(resp.users)) {
    resp.users.forEach((u) => { if (u.id && !u.deleted) map[u.id] = u.name || u.email || u.id; });
  }
  const fields = ((fieldsResp && fieldsResp.customFields) || []).map((f) => ({
    id: f.id, name: f.name || f.fieldKey || "", key: f.fieldKey || "",
  }));
  const oppFields = ((oppFieldsResp && oppFieldsResp.customFields) || [])
    .filter((f) => !f.model || f.model === "opportunity")
    .map((f) => ({ id: f.id, name: f.name || f.fieldKey || "", key: f.fieldKey || "" }));
  const pipelines = ((pipesResp && pipesResp.pipelines) || []).map((p) => ({
    id: p.id, name: p.name || "",
    stages: (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => ({ id: s.id, name: s.name || "" })),
  }));
  return { users: map, fields, oppFields, oppFieldsOk: !!oppFieldsResp, pipelines };
}

// Citas por FECHA DE LA CITA (7-oct-2026). El show rate se medía solo con las citas de los
// leads que ENTRARON en el rango: una cita de esta semana de un lead de agosto no existía, y
// con un rango de una o dos semanas el show rate salía de una sola cita ("0 de 1"). Se
// listan los calendarios de la cuenta y se piden sus eventos del rango, de cualquier lead.
async function citas({ start, end }) {
  const t0 = Date.parse(start), t1 = Date.parse(end);
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) throw Object.assign(new Error("start y end requeridos (ISO datetime)"), { status: 400 });
  const cals = ((await ghl(`/calendars/?locationId=${LOCATION_ID}`)).calendars || []).filter((c) => c && c.id);
  const vistos = new Set(), out = [], errores = [];
  for (let i = 0; i < cals.length; i += 4) {
    await Promise.all(cals.slice(i, i + 4).map(async (c) => {
      try {
        const d = await ghl(`/calendars/events?locationId=${LOCATION_ID}&calendarId=${encodeURIComponent(c.id)}&startTime=${t0}&endTime=${t1}`);
        (d.events || []).forEach((ev) => {
          const t = ts(ev.startTime);
          if (!t || (ev.id && vistos.has(ev.id))) return;
          if (ev.id) vistos.add(ev.id);
          out.push({ id: ev.id || "", ct: ev.contactId || "", u: ev.assignedUserId || "", t,
            st: String(ev.appointmentStatus || ev.status || "").toLowerCase(), cal: c.name || "" });
        });
      } catch (e) { errores.push(c.name || c.id); }
    }));
  }
  return { citas: out, calendarios: cals.length, errores };
}

// Contactos con una etiqueta, de cualquier fecha (spec v1.1 R-02). El filtro de etiquetas
// del buscador de GHL se documenta de dos formas; se prueba la de arreglo y, si el API la
// rechaza, la de valor simple. El front vuelve a comprobar la etiqueta exacta de cada uno.
async function tagged({ tag }) {
  if (typeof tag !== "string" || !tag.trim()) throw Object.assign(new Error("tag requerido"), { status: 400 });
  const filtros = [
    { field: "tags", operator: "contains", value: [tag] },
    { field: "tags", operator: "eq", value: tag },
  ];
  let ultimo = null;
  for (const filtro of filtros) {
    try {
      const out = [];
      let cursor = null;
      for (let i = 0; i < 5; i++) {
        const body = { locationId: LOCATION_ID, pageLimit: 100, filters: [filtro], sort: [{ field: "dateAdded", direction: "asc" }] };
        if (cursor) body.searchAfter = cursor;
        const data = await ghl("/contacts/search", { method: "POST", body });
        const batch = data.contacts || [];
        batch.forEach((c) => out.push(mapContact(c)));
        const lastRaw = batch[batch.length - 1];
        cursor = batch.length === 100 && lastRaw && Array.isArray(lastRaw.searchAfter) ? lastRaw.searchAfter : null;
        if (!cursor) break;
      }
      return { contacts: out, filtro: filtro.operator, truncado: !!cursor };
    } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
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
      id: o.id || "",
      ct: o.contactId || (o.contact && o.contact.id) || "",   // para fijar el traspaso a ventas
      u: o.assignedTo || "",
      st: o.status || "open",
      c: o.createdAt || "",
      stc: o.lastStatusChangeAt || o.createdAt || "",
      v: Number(o.monetaryValue) || 0,
      p: o.pipelineId || "",                                   // pipeline (alcance D1)
      s: o.pipelineStageId || "",                              // etapa actual (E1)
      sc: o.lastStageChangeAt || o.lastStatusChangeAt || o.updatedAt || o.createdAt || "",
      // Solo el timestamp REAL de cambio de etapa: respaldo de "Fecha de entrada a
      // Descalificado" cuando la automatización no la llenó (spec v1.1 R-01).
      scE: o.lastStageChangeAt || "",
      cf: cfMap(o.customFields),
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
    if (payload.action === "tagged") return json(200, await tagged(payload));
    if (payload.action === "citas") return json(200, await citas(payload));
    return json(400, { error: "action debe ser 'contacts', 'sweep', 'users', 'opps', 'tagged' o 'citas'" });
  } catch (e) {
    const status = e.status === 429 ? 429 : e.status === 400 ? 400 : 502;
    return json(status, { error: String(e.message || e), detail: e.detail });
  }
};
