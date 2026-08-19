// Migra todos los registros de la tabla kv del proyecto Supabase viejo (público)
// al backend nuevo (slvd_kv con RLS, vía RPC slvd_kv_op).
//
// Uso:  node scripts/migrate-kv.mjs
// Lee la config del .env de la raíz (SUPABASE_URL, SUPABASE_ANON_KEY, KV_API_SECRET)
// y del proyecto viejo (OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY).
// Es idempotente: upsert por clave. Se puede re-correr en el cutover para
// traer los datos frescos que el equipo haya capturado entre tanto.

import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const OLD_URL = process.env.OLD_SUPABASE_URL;
const OLD_KEY = process.env.OLD_SUPABASE_ANON_KEY;
const NEW_URL = process.env.SUPABASE_URL;
const NEW_KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.KV_API_SECRET;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY || !SECRET) {
  console.error("Faltan env vars (OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, KV_API_SECRET)");
  process.exit(1);
}

const oldRows = [];
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${OLD_URL}/rest/v1/kv?select=k,v&order=k`, {
    headers: { apikey: OLD_KEY, Range: `${from}-${from + 999}` },
  });
  if (!r.ok) throw new Error("old kv read " + r.status);
  const batch = await r.json();
  oldRows.push(...batch);
  if (batch.length < 1000) break;
}
console.log(`Leídos ${oldRows.length} registros del proyecto viejo.`);

let done = 0;
async function put(row) {
  const r = await fetch(`${NEW_URL}/rest/v1/rpc/slvd_kv_op`, {
    method: "POST",
    headers: { apikey: NEW_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: SECRET, p_op: "set", p_k: row.k, p_v: row.v }),
  });
  if (!r.ok) throw new Error(`set ${row.k}: ${r.status} ${await r.text()}`);
  done++;
  if (done % 25 === 0) console.log(`  ${done}/${oldRows.length}…`);
}

const queue = [...oldRows];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) await put(queue.shift());
}));
console.log(`Migrados ${done}/${oldRows.length} registros ✓`);
