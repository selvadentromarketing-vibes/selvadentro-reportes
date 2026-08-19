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
    if (op === "list") return S.json(200, { keys: await S.kvList(prefix) });
    return S.json(200, { rows: await S.kvDump(prefix) });
  } catch (e) {
    return S.json(502, { error: String(e.message || e) });
  }
};
