// Netlify Function: crear usuario en el kv (backend con RLS) + email de invitación vía Resend
//
// Env vars requeridas en Netlify (Site settings → Environment variables):
//   SUPABASE_URL / SUPABASE_ANON_KEY / KV_API_SECRET / SESSION_SECRET — backend kv (ver lib/shared.js)
//   RESEND_API_KEY      — re_... (crea cuenta en resend.com, API Keys)
//   FROM_EMAIL          — remitente verificado en Resend (ej. no-reply@selvadentrotulum.com)
//   SITE_URL            — opcional, default https://team.selvadentrotulum.com

const S = require("./lib/shared.js");

const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.FROM_EMAIL;
const SITE_URL     = process.env.SITE_URL || "https://team.selvadentrotulum.com";

const USERS_KEY = S.USERS_KEY;
const json = S.json;

const kvGet = (k) => S.kvGetJSON(k);
const kvSet = (k, val) => S.kvSetJSON(k, val);
const sha256Hex = async (salt, pass) => S.sha256Hex(salt, pass);
const randomSaltHex = () => S.randomHex(12);

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

function inviteHtml({ email, password, role, channels, siteUrl }) {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const NAMES = { brokers:"Brokers", paid_organico:"Paid Orgánico", seminarios:"Seminarios", referidos:"Referidos", pd_leads:"PD Leads", pd_brokers:"PD Brokers", rp_vip:"RP VIP", direccion_general:"Dir. General", direccion_comercial:"Dir. Comercial", crm_live:"CRM en vivo", marketing:"Marketing", mkt_rrss:"Redes Sociales", mkt_ppc:"PPC Ads", mkt_crm:"CRM Manager", mkt_lq:"Calidad de Leads" };
  const chsList = role === "admin"
    ? "todos"
    : (channels && channels.length ? channels.map(c => NAMES[c] || c).join(", ") : "ninguno aún");
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
        <tr><td style="padding:6px 12px 6px 0;color:#6F7468">Canales</td><td style="padding:6px 0">${esc(chsList)}</td></tr>
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

  const miss = S.missingEnv();
  if (!RESEND_KEY) miss.push("RESEND_API_KEY");
  if (!FROM_EMAIL) miss.push("FROM_EMAIL");
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });

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
  const ALL_CH = ["brokers","paid_organico","seminarios","referidos","pd_leads","pd_brokers","rp_vip","direccion_general","direccion_comercial","crm_live","marketing","mkt_rrss","mkt_ppc","mkt_crm","mkt_lq"];
  let channels = Array.isArray(newUser.channels) ? newUser.channels.filter(c => ALL_CH.includes(c)) : [];
  if (role === "admin") channels = ALL_CH.slice();

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
  users.push({ email: newLc, salt, hash, password: newUser.password, role, channels, created_at: new Date().toISOString() });
  await kvSet(USERS_KEY, users);

  // 4) Mandar email
  try {
    await sendEmail({
      to: newLc,
      subject: "Acceso al Sistema de Reportes Selvadentro",
      html: inviteHtml({ email: newLc, password: newUser.password, role, channels, siteUrl: SITE_URL }),
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
