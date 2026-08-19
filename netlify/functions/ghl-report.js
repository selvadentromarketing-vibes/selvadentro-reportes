// Netlify Function: proxy seguro hacia GoHighLevel (LeadConnector) para el módulo "CRM en vivo".
//
// Env vars requeridas:
//   GHL_API_KEY     — Private Integration Token (pit-...) de la subcuenta
//   GHL_LOCATION_ID — Location ID de la subcuenta
//
// Acciones (POST JSON):
//   { action: "bootstrap" }
//     → { pipelines:[...], users:{ id: nombre } }
//   { action: "crawl", startAfter?, startAfterId?, pages? }
//     → { opps:[{p,s,st,src,c,u,v,stc}], cursor:{startAfter,startAfterId}|null, total, fetched }
//     Pagina /opportunities/search en bloques (default 6 páginas × 100) para no
//     exceder el timeout de la función; el frontend repite con el cursor hasta terminar.

const S = require("./lib/shared.js");

const API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const BASE = "https://services.leadconnectorhq.com";
const PAGES_PER_CALL = 6;

const json = (status, body) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

async function ghl(path) {
  let resp = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + API_KEY, Version: "2021-07-28", Accept: "application/json" },
  });
  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    resp = await fetch(BASE + path, {
      headers: { Authorization: "Bearer " + API_KEY, Version: "2021-07-28", Accept: "application/json" },
    });
  }
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`GHL ${resp.status} en ${path.split("?")[0]}`);
    err.status = resp.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  return resp.json();
}

const slim = (o) => ({
  p: o.pipelineId || "",
  s: o.pipelineStageId || "",
  st: o.status || "open",
  src: (o.source || "").trim().toLowerCase(),
  c: o.createdAt || "",
  u: o.assignedTo || "",
  v: Number(o.monetaryValue) || 0,
  stc: o.lastStatusChangeAt || o.createdAt || "",
});

async function bootstrap() {
  const [pipes, usersResp] = await Promise.all([
    ghl(`/opportunities/pipelines?locationId=${LOCATION_ID}`),
    ghl(`/users/?locationId=${LOCATION_ID}`).catch(() => null), // scope opcional: degradar sin romper
  ]);
  const users = {};
  if (usersResp && Array.isArray(usersResp.users)) {
    usersResp.users.forEach((u) => { if (u.id && !u.deleted) users[u.id] = u.name || u.email || u.id; });
  }
  const pipelines = (pipes.pipelines || []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: (p.stages || [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => ({ id: s.id, name: s.name })),
  }));
  return { pipelines, users };
}

async function crawl({ startAfter, startAfterId, pages }) {
  const maxPages = Math.min(Number(pages) || PAGES_PER_CALL, 8);
  const opps = [];
  let cursor = startAfter && startAfterId ? { startAfter, startAfterId } : null;
  let total = 0;

  for (let i = 0; i < maxPages; i++) {
    let qs = `location_id=${LOCATION_ID}&limit=100`;
    if (cursor) qs += `&startAfter=${encodeURIComponent(cursor.startAfter)}&startAfterId=${encodeURIComponent(cursor.startAfterId)}`;
    const data = await ghl(`/opportunities/search?${qs}`);
    const batch = data.opportunities || [];
    batch.forEach((o) => opps.push(slim(o)));
    total = (data.meta && data.meta.total) || total;
    const meta = data.meta || {};
    if (batch.length < 100 || !meta.startAfterId) { cursor = null; break; }
    cursor = { startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return { opps, cursor, total, fetched: opps.length };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!API_KEY || !LOCATION_ID) return json(500, { error: "GHL_API_KEY / GHL_LOCATION_ID no configuradas en el entorno" });

  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  if (session.role !== "admin" && !(session.channels || []).includes("crm_live")) {
    return json(403, { error: "Sin acceso al CRM en vivo" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  try {
    if (payload.action === "bootstrap") return json(200, await bootstrap());
    if (payload.action === "crawl") return json(200, await crawl(payload));
    return json(400, { error: "action debe ser 'bootstrap' o 'crawl'" });
  } catch (e) {
    return json(e.status === 429 ? 429 : 502, { error: String(e.message || e), detail: e.detail });
  }
};
