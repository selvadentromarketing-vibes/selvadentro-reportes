// Netlify Function: proxy autenticado hacia el kv (Supabase slvd_kv con RLS).
// Toda la app lee y escribe a través de aquí; sin token firmado no hay acceso,
// y el registro de usuarios (selvadentro:users) exige rol admin.
//
// POST JSON + Authorization: Bearer <token>
//   { op:"get",  k }        → { v }            (v = string o null)
//   { op:"set",  k, v }     → { ok:true }
//   { op:"del",  k }        → { ok:true }
//   { op:"list", prefix }   → { keys:[...] }
//   { op:"dump", prefix }   → { rows:[{k,v}] } (carga inicial en bloque)

const S = require("./lib/shared.js");

const MAX_KEY = 256;
const MAX_VAL = 512 * 1024;

// --- Autorización por canal, del lado del servidor ---
// Antes los canales solo existían en el navegador: la function validaba la sesión y
// nada más. Cualquier usuario con sesión podía leer sla:agg (con nombres de asesores)
// o borrar los registros de otro canal desde la consola. El panel de administración
// presentaba los canales como permisos reales; el backend no los conocía.
const CANALES_VENTAS = ["brokers", "paid_organico", "seminarios", "referidos", "pd_leads", "pd_brokers", "rp_vip"];

// Prefijo de clave → canales que dan acceso. Quien tenga CUALQUIERA de ellos entra.
function canalesDeClave(k) {
  const key = String(k || "");
  // Registros de un canal de ventas: "<canal>:week:…" o "<canal>:rec:…"
  const m = key.match(/^([a-z_]+):(?:week|rec|metas|last_resp):/);
  if (m && CANALES_VENTAS.includes(m[1])) return [m[1], "direccion_general", "direccion_comercial"];
  if (key.startsWith("crm:agg")) return ["crm_live", "direccion_comercial"];
  if (key.startsWith("sla:agg")) return ["sla_view", "crm_live", "direccion_comercial"];
  if (key.startsWith("lq:agg")) return ["mkt_lq", "marketing"];
  if (key.startsWith("mkt_")) return ["marketing", "mkt_rrss", "mkt_lq"];
  return null;                       // clave compartida (logo, asesores, config): sin restricción
}

function puede(session, k) {
  if (session.role === "admin") return true;
  const req = canalesDeClave(k);
  if (!req) return true;
  const tiene = Array.isArray(session.channels) ? session.channels : [];
  return req.some((c) => tiene.includes(c));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return S.json(405, { error: "Method not allowed" });
  const miss = S.missingEnv();
  if (miss.length) return S.json(500, { error: "Faltan env vars: " + miss.join(", ") });

  const session = S.authFromEvent(event);
  if (!session) return S.json(401, { error: "Sesión inválida o expirada" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return S.json(400, { error: "JSON inválido" }); }

  const { op, k, v, prefix } = body;
  if (!["get", "set", "del", "list", "dump"].includes(op)) return S.json(400, { error: "op inválida" });

  if ((op === "get" || op === "set" || op === "del")) {
    if (typeof k !== "string" || !k || k.length > MAX_KEY) return S.json(400, { error: "k inválida" });
    if (k === S.USERS_KEY && session.role !== "admin") return S.json(403, { error: "Solo admin" });
    if (!puede(session, k)) return S.json(403, { error: "Sin acceso a ese canal" });
  }
  if (op === "set" && (typeof v !== "string" || v.length > MAX_VAL)) return S.json(400, { error: "v inválida (máx 512KB)" });
  if ((op === "list" || op === "dump")) {
    if (typeof prefix !== "string" || !prefix || prefix.length > MAX_KEY) return S.json(400, { error: "prefix inválido" });
    if (op === "dump" && S.USERS_KEY.startsWith(prefix) && session.role !== "admin") {
      return S.json(403, { error: "Solo admin" });
    }
  }

  try {
    if (op === "get") return S.json(200, { v: await S.kvGet(k) });
    if (op === "set") { await S.kvSet(k, v); return S.json(200, { ok: true }); }
    if (op === "del") { await S.kvDel(k); return S.json(200, { ok: true }); }
    // list y dump se FILTRAN por canal en vez de negarse: la carga inicial usa prefijos
    // amplios y el usuario debe recibir lo suyo, no un 403 que rompa la app.
    if (op === "list") {
      const keys = await S.kvList(prefix);
      return S.json(200, { keys: keys.filter((x) => puede(session, x)) });
    }
    const rows = await S.kvDump(prefix);
    return S.json(200, { rows: rows.filter((r) => puede(session, r && r.k)) });
  } catch (e) {
    return S.json(502, { error: String(e.message || e) });
  }
};
