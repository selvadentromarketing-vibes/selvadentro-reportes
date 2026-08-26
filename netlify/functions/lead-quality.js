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
  // GoHighLevel usa distintas grafías segun el origen (formulario nativo, lead ad de
  // Meta, UTM del sitio): se prueban todas antes de darla por vacía.
  const CAMP = ["campaign", "campaignName", "utmCampaign", "utm_campaign"];
  const SRC = ["utmSource", "utm_source", "sessionSource", "source"];
  const MED = ["utmMedium", "utm_medium", "medium"];
  const AD = ["adName", "ad_name", "utmContent", "utm_content", "adId", "ad_id"];
  const GRP = ["adGroupName", "adsetName", "adSetName", "adset_name", "ad_group_name", "utmTerm", "utm_term", "adGroupId", "adset_id"];
  return {
    camp: pick(last, ...CAMP) || pick(first, ...CAMP),
    src: pick(last, ...SRC) || pick(first, ...SRC),
    med: pick(last, ...MED) || pick(first, ...MED),
    ad: pick(last, ...AD) || pick(first, ...AD),
    grp: pick(last, ...GRP) || pick(first, ...GRP),
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
  const [fieldsResp, usersResp, pipesResp] = await Promise.all([
    ghl(`/locations/${LOCATION_ID}/customFields`).catch(() => null), // scope opcional: degradar sin romper
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null),
    ghl(`/opportunities/pipelines?locationId=${LOCATION_ID}`).catch(() => null),
  ]);
  // Mapa etapa → { pipeline, etapa } para mostrar la etapa REAL del CRM en cada lead
  const stages = {};
  ((pipesResp && pipesResp.pipelines) || []).forEach((p) => {
    (p.stages || []).forEach((s, i) => { if (s.id) stages[s.id] = { p: p.name || "", s: s.name || "", i: s.position ?? i }; });
  });
  const users = {};
  if (usersResp && Array.isArray(usersResp.users)) {
    usersResp.users.forEach((u) => { if (u.id && !u.deleted) users[u.id] = u.name || u.email || u.id; });
  }
  const fields = ((fieldsResp && fieldsResp.customFields) || []).map((f) => ({
    id: f.id,
    name: f.name || f.fieldKey || "",
    options: (f.picklistOptions || f.options || []).map((o) => (typeof o === "string" ? o : o?.name || o?.value || "")).filter(Boolean),
  }));
  return { users, fields, stages, windsor: !!WINDSOR_KEY };
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
// `since` (epoch ms) acota el recorrido: una oportunidad no puede existir antes que su
// contacto, así que filtrar desde el inicio de la ventana no pierde ninguna oportunidad
// de los leads analizados. Antes se recorría TODO el histórico del CRM en cada
// sincronización — con auto-refresco cada 30 min por usuario — solo para descartarlo al
// filtrar por semana. Si el API rechaza el filtro, se reintenta sin él.
async function opps({ startAfter, startAfterId, since }) {
  const out = [];
  let cursor = startAfter && startAfterId ? { startAfter, startAfterId } : null;
  let total = 0;
  let usarFiltro = !!since;
  for (let i = 0; i < 6; i++) {
    const base = `location_id=${LOCATION_ID}&limit=100&getCalendarEvents=true`;
    let qs = base + (usarFiltro ? `&date=${encodeURIComponent(since)}` : "");
    if (cursor) qs += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
    let data;
    try {
      data = await ghl(`/opportunities/search?${qs}`);
    } catch (e) {
      if (!usarFiltro || e.status !== 400) throw e;
      usarFiltro = false;                       // el API no acepta el formato: seguir sin filtro
      let q2 = base;
      if (cursor) q2 += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
      data = await ghl(`/opportunities/search?${q2}`);
    }
    const batch = data.opportunities || [];
    batch.forEach((o) => {
      // Citas embebidas (si el API las devuelve): señal fuerte de calificación
      const evs = Array.isArray(o.calendarEvents) ? o.calendarEvents : [];
      const ap = { tot: 0, sh: 0, ns: 0 };
      evs.forEach((e) => {
        ap.tot++;
        const st = String(e.appointmentStatus || e.status || "").toLowerCase();
        if (st === "showed" || st === "completed") ap.sh++;
        else if (st === "noshow") ap.ns++;
      });
      out.push({
        ct: o.contactId || (o.contact && o.contact.id) || "",
        st: o.status || "open",
        c: o.createdAt || "",
        v: Number(o.monetaryValue) || 0,
        s: o.pipelineStageId || "",                                        // etapa real del pipeline
        sc: o.lastStageChangeAt || o.lastStatusChangeAt || o.updatedAt || o.createdAt || "",
        ap,
      });
    });
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
  // El super-conector /all no garantiza `currency` (Meta lo llama currency, Google
  // account_currency_code). Se pide, y si el API lo rechaza se reintenta sin él en vez
  // de perder toda la inversión.
  const base = `https://connectors.windsor.ai/all?api_key=${encodeURIComponent(WINDSOR_KEY)}` +
    `&date_from=${start}&date_to=${end}&fields=date,source,campaign,spend,clicks,impressions`;
  let url = base + ",currency";
  let resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok && resp.status === 400) resp = await fetch(base, { headers: { Accept: "application/json" } });
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
    cur: String(r.currency || "").toUpperCase(),   // sin esto se sumaban pesos con dólares
  })).filter((r) => r.spend || r.clicks || r.impr);
  // Monedas distintas en la misma suma = total sin sentido. Se reporta para avisarlo.
  const monedas = [...new Set(rows.map((r) => r.cur).filter(Boolean))];
  return { configured: true, rows, monedas };
}

// Windsor limita a 600 peticiones/min y 10k/día. Un 429 sin reintento apagaba la
// inversión de toda la pestaña; ahora se espera y se reintenta una vez, igual que GHL.
async function windsorGet(connector, params) {
  const url = `https://connectors.windsor.ai/${connector}?api_key=${encodeURIComponent(WINDSOR_KEY)}&${params}`;
  let resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    resp = await fetch(url, { headers: { Accept: "application/json" } });
  }
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
    windsorGet("facebook", `${range}&fields=date,campaign,adset_name,ad_id,ad_name,publisher_platform,effective_status,ad_preview_shareable_link,spend,impressions,clicks,actions_leadgen_grouped`)
      // si el campo de leads no está disponible en la cuenta, degradar sin resultados
      .catch(() => windsorGet("facebook", `${range}&fields=date,campaign,adset_name,ad_id,ad_name,publisher_platform,effective_status,ad_preview_shareable_link,spend,impressions,clicks`).catch(() => [])),
    windsorGet("google_ads", `${range}&fields=date,campaign,ad_group_name,ad_id,ad_name,ad_group_ad_status,ad_final_urls,spend,impressions,clicks,conversions`).catch(() => []),
  ]);
  // Filas por día × anuncio: el frontend las agrupa por semana/rango seleccionado
  const rows = [];
  fb.forEach((r) => rows.push({
    d: r.date || "", plat: "Meta", camp: r.campaign || "", grp: r.adset_name || "", id: String(r.ad_id || ""),
    name: r.ad_name || "", pp: r.publisher_platform || "", status: r.effective_status || "", link: r.ad_preview_shareable_link || "",
    spend: num(r.spend), impr: num(r.impressions), clicks: num(r.clicks), results: num(r.actions_leadgen_grouped),
  }));
  gg.forEach((r) => rows.push({
    d: r.date || "", plat: "Google", camp: r.campaign || "", grp: r.ad_group_name || "", id: String(r.ad_id || ""),
    name: r.ad_name || "", pp: "Google Ads", status: r.ad_group_ad_status || "", link: String(r.ad_final_urls || "").split(",")[0] || "",
    spend: num(r.spend), impr: num(r.impressions), clicks: num(r.clicks), results: num(r.conversions),
  }));
  return { configured: true, ads: rows.filter((r) => r.spend || r.clicks || r.impr || r.results) };
}

// --- Diagnóstico: la app se responde a sí misma ---
// Varias "preguntas al cliente" (¿existe el campo de presupuesto?, ¿qué etapas tiene
// el pipeline?, ¿el token tiene permiso de mensajes?) no eran preguntas: eran datos
// que la app ya bajaba y tiraba. Esto los expone, y de paso PRUEBA cada endpoint para
// saber qué permisos trae realmente el token, en vez de pedirle a alguien que lea la
// pantalla de ajustes de GoHighLevel.
async function diag() {
  const probar = async (nombre, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { nombre, ok: true, ms: Date.now() - t0, nota: "", datos: r };
    } catch (e) {
      return { nombre, ok: false, ms: Date.now() - t0, nota: String(e.message || e), detalle: (e.detail || "").slice(0, 200) };
    }
  };

  // Un contacto real para poder probar mensajes y citas (dependen de un id)
  let contactoId = "";
  let candidatos = [];
  const pContactos = await probar("Contactos", async () => {
    const d = await ghl("/contacts/search", {
      method: "POST",
      body: { locationId: LOCATION_ID, pageLimit: 20, sort: [{ field: "dateAdded", direction: "desc" }] },
    });
    const c = (d.contacts || [])[0];
    // Se guardan varios: el más reciente puede no tener ninguna conversación con
    // mensajes de verdad, y entonces la prueba de mensajes no mide nada.
    candidatos = (d.contacts || []).map((x) => x && x.id).filter(Boolean);
    if (c && c.id) contactoId = c.id;
    // Qué claves trae de verdad un contacto: cierra la duda de si llegan assignedTo,
    // phone y los campos de nombre, que el esquema documentado no lista.
    return { total: d.total ?? null, claves: c ? Object.keys(c).sort() : [], atribucion: c && c.attributionSource ? Object.keys(c.attributionSource).sort() : [] };
  });

  const [pCampos, pUsuarios, pPipelines, pOpps] = await Promise.all([
    probar("Campos personalizados", async () => {
      const d = await ghl(`/locations/${LOCATION_ID}/customFields`);
      return (d.customFields || []).map((f) => ({
        id: f.id, nombre: f.name || f.fieldKey || "", tipo: f.dataType || f.type || "",
        opciones: (f.picklistOptions || f.options || []).map((o) => (typeof o === "string" ? o : o?.name || o?.value || "")).filter(Boolean),
      }));
    }),
    probar("Usuarios", async () => {
      const d = await ghl(`/users/?locationId=${LOCATION_ID}`);
      return (d.users || []).filter((u) => !u.deleted).length;
    }),
    probar("Pipelines y etapas", async () => {
      const d = await ghl(`/opportunities/pipelines?locationId=${LOCATION_ID}`);
      return (d.pipelines || []).map((p) => ({
        nombre: p.name || "",
        etapas: (p.stages || []).map((st, i) => ({ id: st.id, nombre: st.name || "", pos: st.position ?? i })).sort((a, b) => a.pos - b.pos),
      }));
    }),
    probar("Oportunidades", async () => {
      const d = await ghl(`/opportunities/search?location_id=${LOCATION_ID}&limit=1&getTasks=true`);
      const o = (d.opportunities || [])[0];
      return {
        total: d.total ?? null,
        claves: o ? Object.keys(o).sort() : [],
        // ¿Dónde vive el "próximo paso"? Si hay tareas, ahí puede vivir.
        traeTareas: !!(o && Array.isArray(o.tasks)),
        traeMotivoPerdida: !!(o && ("lostReasonId" in o)),
      };
    }),
  ]);

  // Mensajes y citas necesitan un contacto: son los dos permisos que más daño hacen
  // en silencio (sin ellos el reporte marca a todos los leads como "nunca tocados").
  let pConv = { nombre: "Conversaciones", ok: false, nota: "No se pudo probar: no hubo contacto de muestra" };
  let pMsgs = { nombre: "Mensajes de conversación", ok: false, nota: "No se pudo probar: no hubo conversación de muestra" };
  let pCitas = { nombre: "Citas", ok: false, nota: "No se pudo probar: no hubo contacto de muestra" };
  if (contactoId) {
    let convId = "";
    let muestra = null;                 // mensajes REALES encontrados, si los hay
    pConv = await probar("Conversaciones", async () => {
      // No basta con encontrar una conversación: hay que encontrar una que tenga
      // mensajes de verdad. Muchas conversaciones solo llevan TYPE_ACTIVITY_* (bitácora
      // del CRM), que nunca traen userId, y medir sobre ellas no dice nada. Se recorren
      // contactos y sus conversaciones hasta dar con mensajes reales.
      let vistos = 0, conConv = 0, convRevisadas = 0;
      for (const id of candidatos.slice(0, 10)) {
        const d = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${encodeURIComponent(id)}&limit=5`);
        const cvs = d.conversations || [];
        vistos++;
        if (!cvs.length) continue;
        conConv++;
        for (const cv of cvs.slice(0, 3)) {
          if (muestra) break;
          convRevisadas++;
          try {
            const md = await ghl(`/conversations/${encodeURIComponent(cv.id)}/messages?limit=50`);
            const arr = Array.isArray(md.messages) ? md.messages : (md.messages && md.messages.messages) || [];
            const reales = arr.filter((x) => x && !/^TYPE_ACTIVITY/i.test(String(x.messageType || "")));
            if (reales.length) { muestra = { arr, reales }; convId = cv.id; contactoId = id; }
            else if (!convId) { convId = cv.id; contactoId = id; }
          } catch (e) { /* sigue con la siguiente */ }
        }
        if (muestra) break;
      }
      return { contactosRevisados: vistos, conConversacion: conConv, conversacionesRevisadas: convRevisadas, conMensajesReales: !!muestra };
    });
    // Si el barrido ya encontró mensajes reales, se reporta sobre ellos.
    if (muestra) {
      const sal = muestra.reales.filter((x) => x.direction === "outbound");
      const base = sal.length ? sal : muestra.reales;
      pMsgs = {
        nombre: "Mensajes de conversación", ok: true, ms: 0, nota: "",
        datos: {
          mensajes: muestra.arr.length, reales: muestra.reales.length, salientes: sal.length,
          traeUserId: base.some((x) => x.userId),
          traeSource: base.some((x) => x.source),
          tipos: [...new Set(muestra.arr.map((x) => x && x.messageType).filter(Boolean))],
          claves: base[0] ? Object.keys(base[0]).sort() : [],
        },
      };
      convId = "";                       // ya está medido, no repetir abajo
    }
    if (convId) {
      pMsgs = await probar("Mensajes de conversación", async () => {
        const d = await ghl(`/conversations/${encodeURIComponent(convId)}/messages?limit=50`);
        const arr = Array.isArray(d.messages) ? d.messages : (d.messages && d.messages.messages) || [];
        // Los TYPE_ACTIVITY_* son registros de actividad del CRM, no mensajes de nadie:
        // nunca traen userId. Si se miden ellos, el diagnóstico concluye "los mensajes
        // no traen usuario" cuando en realidad no se miró ningún mensaje.
        const reales = arr.filter((x) => x && !/^TYPE_ACTIVITY/i.test(String(x.messageType || "")));
        const sal = reales.filter((x) => x && x.direction === "outbound");
        const base = sal.length ? sal : reales;
        return {
          mensajes: arr.length,
          reales: reales.length,
          salientes: sal.length,
          // De estas dos claves depende TODO el SLA por asesor. Solo tienen sentido
          // medidas sobre mensajes SALIENTES reales.
          traeUserId: base.length ? base.some((x) => x.userId) : null,
          traeSource: base.length ? base.some((x) => x.source) : null,
          tipos: [...new Set(arr.map((x) => x && x.messageType).filter(Boolean))],
          claves: base[0] ? Object.keys(base[0]).sort() : [],
        };
      });
    }
    pCitas = await probar("Citas", async () => {
      const d = await ghl(`/contacts/${encodeURIComponent(contactoId)}/appointments`);
      return { citas: (d.events || []).length };
    });
  }

  // Moneda y zona horaria de las cuentas de anuncios: son campos, no preguntas.
  let cuentas = { configurado: !!WINDSOR_KEY, meta: null, google: null, error: "" };
  if (WINDSOR_KEY) {
    try {
      const [fb, gg] = await Promise.all([
        windsorGet("facebook", "date_preset=last_7d&fields=account_name,account_currency,account_timezone").catch(() => []),
        windsorGet("google_ads", "date_preset=last_7d&fields=account_name,account_currency_code,account_time_zone").catch(() => []),
      ]);
      const f0 = fb[0] || null, g0 = gg[0] || null;
      cuentas.meta = f0 ? { cuenta: f0.account_name || "", moneda: f0.account_currency || "", zona: f0.account_timezone || "" } : null;
      cuentas.google = g0 ? { cuenta: g0.account_name || "", moneda: g0.account_currency_code || "", zona: g0.account_time_zone || "" } : null;
    } catch (e) { cuentas.error = String(e.message || e); }
  }

  return { pruebas: [pContactos, pCampos, pUsuarios, pPipelines, pOpps, pConv, pMsgs, pCitas], cuentas };
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
    if (payload.action === "diag") return json(200, await diag());
    if (payload.action === "leads") return json(200, await leads(payload));
    if (payload.action === "opps") return json(200, await opps(payload));
    if (payload.action === "spend") return json(200, await spend(payload));
    if (payload.action === "ads") return json(200, await ads(payload));
    return json(400, { error: "action debe ser 'bootstrap', 'diag', 'leads', 'opps', 'spend' o 'ads'" });
  } catch (e) {
    const status = e.status === 429 ? 429 : e.status === 400 ? 400 : 502;
    return json(status, { error: String(e.message || e), detail: e.detail });
  }
};
