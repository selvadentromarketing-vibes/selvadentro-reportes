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
      const users = await S.getUsers();
      const u = S.findUser(users, email);
      if (!u || S.sha256Hex(u.salt, pass) !== u.hash) {
        return S.json(401, { error: "Email o contraseña incorrectos" });
      }
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
