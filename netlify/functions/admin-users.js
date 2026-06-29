// Netlify Function: gestión de usuarios (solo admin)
// Env vars requeridas en Netlify:
//   SUPABASE_URL                — https://vsnggxcuznleuvoyoenn.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (Supabase Dashboard → Settings → API)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const svcHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: "Bearer " + SERVICE_KEY,
  "Content-Type": "application/json",
});

async function getCallerId(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + jwt },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u.id : null;
}

async function isAdmin(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${userId}&select=role`,
    { headers: svcHeaders() }
  );
  if (!r.ok) return false;
  const arr = await r.json();
  return arr.length > 0 && arr[0].role === "admin";
}

async function listUsers() {
  const ru = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: svcHeaders(),
  });
  if (!ru.ok) throw new Error("listUsers auth " + ru.status);
  const { users } = await ru.json();

  const rp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?select=user_id,email,role,channels,updated_at`,
    { headers: svcHeaders() }
  );
  if (!rp.ok) throw new Error("listUsers profiles " + rp.status);
  const profiles = await rp.json();
  const pmap = Object.fromEntries(profiles.map((p) => [p.user_id, p]));

  const rows = users.map((u) => ({
    user_id: u.id,
    email: u.email,
    last_sign_in_at: u.last_sign_in_at,
    profile: pmap[u.id] || null,
  }));
  return rows;
}

async function createUser({ email, password, role, channels }) {
  if (!email || !password) throw new Error("email y password requeridos");
  if (!["admin", "user"].includes(role)) throw new Error("role inválido");
  const channelsArr = Array.isArray(channels) ? channels : [];

  const ru = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!ru.ok) {
    const t = await ru.text();
    throw new Error("createUser auth " + ru.status + " " + t);
  }
  const u = await ru.json();

  const rp = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: u.id,
      email,
      role,
      channels: channelsArr,
    }),
  });
  if (!rp.ok) {
    const t = await rp.text();
    // Rollback: borrar el auth user si falló el profile
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
      method: "DELETE",
      headers: svcHeaders(),
    });
    throw new Error("createUser profile " + rp.status + " " + t);
  }
  const profile = (await rp.json())[0];
  return { user_id: u.id, email, profile };
}

async function updateUserProfile({ user_id, role, channels }) {
  if (!user_id) throw new Error("user_id requerido");
  const patch = {};
  if (role !== undefined) {
    if (!["admin", "user"].includes(role)) throw new Error("role inválido");
    patch.role = role;
  }
  if (channels !== undefined) {
    patch.channels = Array.isArray(channels) ? channels : [];
  }
  if (!Object.keys(patch).length) return { ok: true };
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${user_id}`,
    {
      method: "PATCH",
      headers: { ...svcHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error("updateProfile " + r.status + " " + t);
  }
  return (await r.json())[0];
}

async function setPassword({ user_id, password }) {
  if (!user_id || !password) throw new Error("user_id y password requeridos");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    method: "PUT",
    headers: svcHeaders(),
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("setPassword " + r.status + " " + t);
  }
  return { ok: true };
}

async function deleteUser({ user_id }) {
  if (!user_id) throw new Error("user_id requerido");
  // user_profiles cae solo por ON DELETE CASCADE en la FK a auth.users
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    method: "DELETE",
    headers: svcHeaders(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("deleteUser " + r.status + " " + t);
  }
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY)
    return json(500, { error: "Server env vars missing" });

  try {
    const callerId = await getCallerId(event.headers.authorization || event.headers.Authorization);
    if (!callerId) return json(401, { error: "No autenticado" });
    if (!(await isAdmin(callerId))) return json(403, { error: "Solo admin" });

    const body = JSON.parse(event.body || "{}");
    const { action } = body;

    let result;
    switch (action) {
      case "list":     result = await listUsers(); break;
      case "create":   result = await createUser(body); break;
      case "update":   result = await updateUserProfile(body); break;
      case "password": result = await setPassword(body); break;
      case "delete":   result = await deleteUser(body); break;
      default: return json(400, { error: "action desconocida: " + action });
    }
    return json(200, { ok: true, data: result });
  } catch (e) {
    return json(400, { error: String(e.message || e) });
  }
};
