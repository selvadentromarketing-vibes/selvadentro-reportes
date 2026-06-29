// Netlify Function: crear usuario en Supabase kv + email de invitación vía Resend
//
// Env vars requeridas en Netlify (Site settings → Environment variables):
//   SUPABASE_URL        — https://vsnggxcuznleuvoyoenn.supabase.co
//   SUPABASE_ANON_KEY   — el anon key público (Settings → API → anon public)
//   RESEND_API_KEY      — re_... (crea cuenta en resend.com, API Keys)
//   FROM_EMAIL          — remitente verificado en Resend (ej. no-reply@selvadentrotulum.com)
//   SITE_URL            — opcional, default https://team.selvadentrotulum.com

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.FROM_EMAIL;
const SITE_URL     = process.env.SITE_URL || "https://team.selvadentrotulum.com";

const USERS_KEY = "selvadentro:users";

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const supaHeaders = () => ({
  apikey: ANON_KEY,
  Authorization: "Bearer " + ANON_KEY,
  "Content-Type": "application/json",
});

async function kvGet(k) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/kv?k=eq.${encodeURIComponent(k)}&select=v`,
    { headers: supaHeaders() }
  );
  if (!r.ok) throw new Error("kv get " + r.status);
  const arr = await r.json();
  return arr.length ? JSON.parse(arr[0].v) : null;
}

async function kvSet(k, val) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/kv`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ k, v: JSON.stringify(val) }),
  });
  if (!r.ok) throw new Error("kv set " + r.status + " " + (await r.text()));
}

async function sha256Hex(salt, pass) {
  const data = new TextEncoder().encode(salt + ":" + pass);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSaltHex() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function sendEmail({ to, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + RESEND_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("Resend " + r.status + " " + t);
  return JSON.parse(t);
}

function inviteHtml({ email, password, role, siteUrl }) {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;background:#465241;padding:32px;color:#FAF8F3">
    <div style="max-width:520px;margin:auto;background:#FAF8F3;color:#2E332B;border-radius:14px;border:1px solid #CF8543;padding:32px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:32px;color:#465241;line-height:1">Selvadentro</div>
        <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:5px;color:#CF8543;text-transform:lowercase;margin-top:3px">tierra de cenotes</div>
      </div>
      <h2 style="font-family:Georgia,serif;color:#465241;font-weight:400;font-size:20px;margin:0 0 14px">Te dimos acceso al Sistema de Reportes</h2>
      <p style="font-size:14px;line-height:1.55">Estas son tus credenciales:</p>
      <table style="font-size:14px;margin:14px 0 20px;border-collapse:collapse">
        <tr><td style="padding:6px 12px 6px 0;color:#6F7468">Email</td><td style="padding:6px 0"><b>${esc(email)}</b></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6F7468">Contraseña</td><td style="padding:6px 0"><code style="background:#F1ECE1;padding:3px 8px;border-radius:5px">${esc(password)}</code></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6F7468">Rol</td><td style="padding:6px 0"><b>${esc(role)}</b></td></tr>
      </table>
      <p style="margin:18px 0">
        <a href="${esc(siteUrl)}" style="display:inline-block;background:#CF8543;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;font-size:14px">Entrar al sistema</a>
      </p>
      <p style="font-size:12px;color:#6F7468;margin-top:24px">Te recomendamos cambiar la contraseña en cuanto entres. Si no esperabas este correo, ignóralo.</p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return json(405, { error: "Method not allowed" });

  for (const [name, v] of [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_ANON_KEY", ANON_KEY],
    ["RESEND_API_KEY", RESEND_KEY],
    ["FROM_EMAIL", FROM_EMAIL],
  ]) {
    if (!v) return json(500, { error: "Falta env var: " + name });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Body inválido" }); }

  const { adminEmail, adminPassword, newUser } = body;
  if (!adminEmail || !adminPassword || !newUser || !newUser.email || !newUser.password) {
    return json(400, { error: "Faltan campos" });
  }
  if (newUser.password.length < 6)
    return json(400, { error: "Contraseña del nuevo user demasiado corta" });
  const role = newUser.role === "admin" ? "admin" : "user";

  // 1) Verificar admin
  let users = (await kvGet(USERS_KEY)) || [];
  const adminLc = adminEmail.toLowerCase();
  const admin = users.find((u) => u.email.toLowerCase() === adminLc);
  if (!admin || admin.role !== "admin")
    return json(403, { error: "No autorizado" });
  const adminHash = await sha256Hex(admin.salt, adminPassword);
  if (adminHash !== admin.hash)
    return json(403, { error: "Credenciales de admin inválidas" });

  // 2) Validar que el nuevo email no exista
  const newLc = newUser.email.trim().toLowerCase();
  if (users.some((u) => u.email.toLowerCase() === newLc))
    return json(409, { error: "Ya existe un usuario con ese email" });

  // 3) Crear hash + salt y agregar
  const salt = randomSaltHex();
  const hash = await sha256Hex(salt, newUser.password);
  users.push({ email: newLc, salt, hash, role, created_at: new Date().toISOString() });
  await kvSet(USERS_KEY, users);

  // 4) Mandar email
  try {
    await sendEmail({
      to: newLc,
      subject: "Acceso al Sistema de Reportes Selvadentro",
      html: inviteHtml({ email: newLc, password: newUser.password, role, siteUrl: SITE_URL }),
    });
  } catch (e) {
    // El user ya quedó creado; reportamos el error de email pero no rollback.
    return json(207, {
      ok: true,
      user_created: true,
      email_sent: false,
      warning: "Usuario creado pero el email no se envió: " + e.message,
    });
  }

  return json(200, { ok: true, user_created: true, email_sent: true });
};
