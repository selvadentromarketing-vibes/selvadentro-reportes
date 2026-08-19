// Utilidades compartidas por las Netlify Functions: acceso al kv (Supabase con RLS,
// vía RPC slvd_kv_op) y sesiones firmadas (HMAC).
//
// Env vars:
//   SUPABASE_URL       — proyecto Supabase del backend (tabla slvd_kv)
//   SUPABASE_ANON_KEY  — anon key del proyecto (solo transporta la llamada al RPC)
//   KV_API_SECRET      — secreto que exige el RPC slvd_kv_op (vive solo en el servidor)
//   SESSION_SECRET     — llave HMAC para firmar los tokens de sesión

const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const KV_API_SECRET = process.env.KV_API_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

const USERS_KEY = "selvadentro:users";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function missingEnv() {
  return [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
    ["KV_API_SECRET", KV_API_SECRET],
    ["SESSION_SECRET", SESSION_SECRET],
  ].filter(([, v]) => !v).map(([n]) => n);
}

const json = (status, body) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

const corsPreflight = () => ({
  statusCode: 204,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  },
  body: "",
});

async function kvOp(op, { k, v, prefix } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/slvd_kv_op`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: KV_API_SECRET, p_op: op, p_k: k ?? null, p_v: v ?? null, p_prefix: prefix ?? null }),
  });
  if (!r.ok) throw new Error(`kv ${op} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const kvGet = async (k) => (await kvOp("get", { k })).v ?? null;
const kvSet = (k, v) => kvOp("set", { k, v });
const kvDel = (k) => kvOp("del", { k });
const kvList = async (prefix) => (await kvOp("list", { prefix })).keys || [];
const kvDump = async (prefix) => (await kvOp("dump", { prefix })).rows || [];
async function kvGetJSON(k) { const s = await kvGet(k); return s == null ? null : JSON.parse(s); }
const kvSetJSON = (k, val) => kvSet(k, JSON.stringify(val));

function sha256Hex(salt, pass) {
  return crypto.createHash("sha256").update(salt + ":" + pass).digest("hex");
}
function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url").toString("utf8");

function signToken({ email, role, channels }) {
  const payload = b64u(JSON.stringify({ email, role, channels: channels || [], exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `v1.${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[1]).digest("base64url");
  const a = Buffer.from(parts[2]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64u(parts[1]));
    if (!payload.email || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Sesión desde el header Authorization: Bearer <token>. Devuelve el payload o null.
function authFromEvent(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1]) : null;
}

const getUsers = async () => (await kvGetJSON(USERS_KEY)) || [];
const findUser = (users, email) => users.find((u) => u.email.toLowerCase() === String(email || "").trim().toLowerCase());

module.exports = {
  USERS_KEY, missingEnv, json, corsPreflight,
  kvGet, kvSet, kvDel, kvList, kvDump, kvGetJSON, kvSetJSON,
  sha256Hex, randomHex, signToken, verifyToken, authFromEvent,
  getUsers, findUser,
};
