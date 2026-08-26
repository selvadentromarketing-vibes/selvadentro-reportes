// Netlify Function: autenticación server-side.
// El cliente nunca ve la lista de usuarios ni los hashes; recibe un token firmado
// (HMAC, 30 días) que las demás functions exigen.
//
// Acciones (POST JSON):
//   { action:"status" }                → { hasUsers }        (público: decide login vs setup)
//   { action:"login", email, pass }    → { token, email, role, channels }
//   { action:"me" }    + Authorization → { token, email, role, channels }  (token refrescado)
//   { action:"setup", email, pass }    → { token, ... }      (solo si no existe ningún usuario)

const S = require("./lib/shared.js");

// Freno de fuerza bruta. La instancia de la function se recicla, así que esto no es
// un candado perfecto — pero corta el intento rápido y repetido desde una misma IP,
// que es lo que antes no tenía ningún límite.
const INTENTOS = new Map();
const VENTANA_MS = 10 * 60 * 1000;   // 10 minutos
const MAX_INTENTOS = 8;

function ipDe(event) {
  const h = event.headers || {};
  return (h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "sin-ip").split(",")[0].trim();
}
function frenado(ip) {
  const e = INTENTOS.get(ip);
  if (!e) return false;
  if (Date.now() - e.t > VENTANA_MS) { INTENTOS.delete(ip); return false; }
  return e.n >= MAX_INTENTOS;
}
function fallo(ip) {
  const e = INTENTOS.get(ip);
  if (!e || Date.now() - e.t > VENTANA_MS) INTENTOS.set(ip, { n: 1, t: Date.now() });
  else e.n++;
  if (INTENTOS.size > 5000) INTENTOS.clear();   // techo de memoria
}
const exito = (ip) => INTENTOS.delete(ip);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return S.json(405, { error: "Method not allowed" });
  const miss = S.missingEnv();
  if (miss.length) return S.json(500, { error: "Faltan env vars: " + miss.join(", ") });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return S.json(400, { error: "JSON inválido" }); }

  const sessionShape = (u) => ({
    token: S.signToken({ email: u.email, role: u.role, channels: u.channels || [] }),
    email: u.email,
    role: u.role,
    channels: u.channels || [],
  });

  try {
    if (body.action === "status") {
      const users = await S.getUsers();
      return S.json(200, { hasUsers: users.length > 0 });
    }

    if (body.action === "login") {
      const { email, pass } = body;
      if (!email || !pass) return S.json(400, { error: "Faltan email o contraseña" });
      const ip = ipDe(event);
      if (frenado(ip)) {
        return S.json(429, { error: "Demasiados intentos fallidos. Espera 10 minutos y vuelve a intentar." });
      }
      const users = await S.getUsers();
      const u = S.findUser(users, email);
      // Invitado que todavía no abre su liga: no tiene hash. Decirlo, en vez de
      // mandarlo a adivinar una contraseña que nunca existió.
      if (u && !u.hash) {
        // invitación pendiente: no cuenta como intento fallido de contraseña
        return S.json(403, { error: "Tu invitación sigue pendiente: abre la liga que te mandaron para definir tu contraseña. Si ya venció, pide una nueva." });
      }
      if (!u || S.sha256Hex(u.salt, pass) !== u.hash) {
        fallo(ip);
        return S.json(401, { error: "Email o contraseña incorrectos" });
      }
      exito(ip);
      return S.json(200, sessionShape(u));
    }

    if (body.action === "me") {
      const payload = S.authFromEvent(event);
      if (!payload) return S.json(401, { error: "Sesión inválida o expirada" });
      const users = await S.getUsers();
      const u = S.findUser(users, payload.email);
      if (!u) return S.json(401, { error: "Usuario ya no existe" });
      return S.json(200, sessionShape(u)); // token fresco con rol/canales actuales
    }

    if (body.action === "setup") {
      const { email, pass } = body;
      if (!email || !pass) return S.json(400, { error: "Faltan email o contraseña" });
      if (pass.length < 6) return S.json(400, { error: "Contraseña mínima de 6 caracteres" });
      const users = await S.getUsers();
      if (users.length > 0) return S.json(403, { error: "Ya existe un usuario; pide acceso a un admin" });
      const salt = S.randomHex(12);
      const u = {
        email: String(email).trim().toLowerCase(),
        salt,
        hash: S.sha256Hex(salt, pass),
        role: "admin",
        channels: [],
        created_at: new Date().toISOString(),
      };
      await S.kvSetJSON(S.USERS_KEY, [u]);
      return S.json(200, sessionShape(u));
    }

    return S.json(400, { error: "action inválida" });
  } catch (e) {
    return S.json(502, { error: String(e.message || e) });
  }
};
