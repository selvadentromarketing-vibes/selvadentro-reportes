// Netlify Function: invitación por liga mágica (magic link).
//
// Reemplaza el envío de contraseñas por correo/WhatsApp. El admin crea al usuario y
// obtiene una liga firmada; la pega en WhatsApp; la persona la abre y define su
// propia contraseña. Nadie manda contraseñas por chat y el kv nunca guarda una
// contraseña en claro.
//
// Env vars: las mismas del backend kv (SUPABASE_URL, SUPABASE_ANON_KEY,
// KV_API_SECRET, SESSION_SECRET). No hace falta ningún proveedor de correo.
//
// Acciones:
//   { action:"create", email, role, channels }  (admin)  → { link, expira }
//   { action:"relink", email }                  (admin)  → { link, expira }
//   { action:"peek",   token }                  (público)→ { email, role }
//   { action:"claim",  token, password }        (público)→ { token de sesión, ... }

const S = require("./lib/shared.js");

const SITE_URL = process.env.SITE_URL || "https://team.selvadentrotulum.com";
const json = S.json;

// Mantener en sintonía con ALL_CH_KEYS de index.html: un canal que la UI ofrece pero
// esta lista no conoce se descartaba EN SILENCIO al crear el usuario (le pasó a
// sla_view: el admin marcaba "Desempeño de Ventas", veía "Usuario creado ✓" y la
// persona no podía abrir el reporte).
const ALL_CH = ["brokers","paid_organico","seminarios","referidos","pd_leads","pd_brokers","rp_vip","direccion_general","direccion_comercial","crm_live","sla_view","marketing","mkt_rrss","mkt_ppc","mkt_crm","mkt_lq"];

const norm = (e) => String(e || "").trim().toLowerCase();
const linkFor = (email, nonce) => `${SITE_URL}/#invite=${encodeURIComponent(S.signInvite({ email, nonce }))}`;

// El admin se identifica con su token de sesión (Bearer), no reenviando su contraseña.
// El token vive 30 días y no hay revocación: además de la firma, se verifica contra el
// registro que la persona SIGA existiendo y SIGA siendo admin — un admin dado de baja
// conservaba el poder de crear usuarios hasta que su token venciera.
async function requireAdmin(event) {
  const session = S.authFromEvent(event);
  if (!session) return { error: json(401, { error: "Sesión inválida o expirada" }) };
  if (session.role !== "admin") return { error: json(403, { error: "Solo administradores" }) };
  const users = await S.getUsers();
  const u = S.findUser(users, session.email);
  if (!u || u.role !== "admin") return { error: json(403, { error: "Solo administradores" }) };
  return { session, users };
}

async function create(event, { email, role, channels }) {
  const gate = await requireAdmin(event);
  if (gate.error) return gate.error;

  const lc = norm(email);
  if (!lc || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lc)) return json(400, { error: "Email inválido" });

  const users = gate.users;
  if (users.some((u) => norm(u.email) === lc)) return json(409, { error: "Ya existe un usuario con ese email" });

  const rol = role === "admin" ? "admin" : "user";
  const chs = rol === "admin" ? ALL_CH.slice() : (Array.isArray(channels) ? channels.filter((c) => ALL_CH.includes(c)) : []);

  // Usuario sin contraseña: queda pendiente hasta que abra la liga y la defina.
  const nonce = S.randomHex(16);
  users.push({
    email: lc, salt: "", hash: "", role: rol, channels: chs,
    inv: nonce, pendiente: true, created_at: new Date().toISOString(),
  });
  await S.kvSetJSON(S.USERS_KEY, users);

  return json(200, { ok: true, email: lc, role: rol, channels: chs, link: linkFor(lc, nonce), expira_dias: 7 });
}

// Liga nueva para alguien que ya existe: sirve tanto para reinvitar como para
// restablecer contraseña. Invalida cualquier liga anterior (nonce nuevo).
async function relink(event, { email }) {
  const gate = await requireAdmin(event);
  if (gate.error) return gate.error;

  const lc = norm(email);
  const users = gate.users;
  const u = users.find((x) => norm(x.email) === lc);
  if (!u) return json(404, { error: "No existe ese usuario" });

  u.inv = S.randomHex(16);
  await S.kvSetJSON(S.USERS_KEY, users);
  return json(200, { ok: true, email: lc, link: linkFor(lc, u.inv), expira_dias: 7 });
}

// Validar la liga sin consumirla: la pantalla necesita saber a quién saludar.
async function peek({ token }) {
  const p = S.verifyInvite(token);
  if (!p) return json(400, { error: "Esta liga no es válida o ya venció. Pídele una nueva a quien te invitó." });

  const users = await S.getUsers();
  const u = users.find((x) => norm(x.email) === norm(p.email));
  if (!u) return json(404, { error: "El usuario de esta liga ya no existe." });
  if (u.inv !== p.nonce) return json(409, { error: "Esta liga ya se usó. Pídele una nueva a quien te invitó." });

  return json(200, { ok: true, email: u.email, role: u.role });
}

// Consumir la liga: define la contraseña, borra el nonce (un solo uso) y devuelve
// una sesión para que la persona entre directo sin volver a escribir nada.
async function claim({ token, password }) {
  const p = S.verifyInvite(token);
  if (!p) return json(400, { error: "Esta liga no es válida o ya venció. Pídele una nueva a quien te invitó." });
  if (!password || String(password).length < 8) {
    return json(400, { error: "La contraseña debe tener al menos 8 caracteres" });
  }

  const users = await S.getUsers();
  const u = users.find((x) => norm(x.email) === norm(p.email));
  if (!u) return json(404, { error: "El usuario de esta liga ya no existe." });
  if (u.inv !== p.nonce) return json(409, { error: "Esta liga ya se usó. Pídele una nueva a quien te invitó." });

  u.salt = S.randomHex(12);
  u.hash = await S.sha256Hex(u.salt, password);
  delete u.inv;            // un solo uso
  delete u.pendiente;
  delete u.password;       // por si quedaba texto plano de la versión anterior
  await S.kvSetJSON(S.USERS_KEY, users);

  return json(200, {
    ok: true,
    token: S.signToken({ email: u.email, role: u.role, channels: u.channels || [] }),
    email: u.email, role: u.role, channels: u.channels || [],
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const miss = S.missingEnv();
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Body inválido" }); }

  try {
    if (body.action === "create") return await create(event, body);
    if (body.action === "relink") return await relink(event, body);
    if (body.action === "peek")   return await peek(body);
    if (body.action === "claim")  return await claim(body);
    return json(400, { error: "action debe ser 'create', 'relink', 'peek' o 'claim'" });
  } catch (e) {
    return json(500, { error: String(e.message || e) });
  }
};
