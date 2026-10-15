// Prueba de la foto diaria de Meta y Google (netlify/functions/lead-quality.js → fotoDiaria,
// diffFotos) con Windsor y el kv SIMULADOS: no llama a Windsor ni a Supabase.
//
// Dos mañanas seguidas. Entre una y otra: Meta sube el presupuesto de la campaña, pausa un anuncio
// y un conjunto entero (sus anuncios pasan a ADSET_PAUSED); Google sube el presupuesto, le rechazan
// un anuncio y cambian sus keywords con gasto. Además: una campaña nueva (no hay contra qué
// comparar), un anuncio que dejó de salir en Windsor (no se da por pausado), la foto del mismo día
// (no se repite) y una plataforma que no respondió (conserva su foto anterior).
//
// Correr: node scripts/test-lq-foto.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";
process.env.WINDSOR_API_KEY = "windsor-prueba";

const KV = {};
let DIA = 1, FALLA_META = false;
const W = {
  1: {
    meta: [
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 36000, adset_id: "G1", adset_name: "CONJ_1", ad_id: "a1", ad_name: "AD_1", effective_status: "ACTIVE", website_destination_url: "https://x.com/1" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 36000, adset_id: "G1", adset_name: "CONJ_1", ad_id: "a2", ad_name: "AD_2", effective_status: "ACTIVE" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 36000, adset_id: "G2", adset_name: "CONJ_2", ad_id: "a3", ad_name: "AD_3", effective_status: "ACTIVE" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 36000, adset_id: "G2", adset_name: "CONJ_2", ad_id: "a4", ad_name: "AD_4", effective_status: "ACTIVE" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 36000, adset_id: "G1", adset_name: "CONJ_1", ad_id: "a5", ad_name: "AD_5", effective_status: "ACTIVE" },
    ],
    gA: [{ campaign_id: "X", campaign: "GOOGLE_X", campaign_status: "ENABLED", ad_group_name: "Grupo 1", ad_group_id: "g1", ad_id: "ga1", ad_name: "", ad_group_ad_status: "ENABLED", ad_group_ad_policy_summary_approval_status: "APPROVED", ad_final_urls: '["https://y.com/a"]' }],
    gB: [{ date: "2026-10-14", campaign_id: "X", campaign: "GOOGLE_X", budget_amount: 267 }],
    gK: [{ campaign_id: "X", ad_group_name: "Grupo 1", ad_group_id: "g1", keyword_text: "tulum land", spend: 50 }],
  },
  2: {
    meta: [
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 43200, adset_id: "G1", adset_name: "CONJ_1", ad_id: "a1", ad_name: "AD_1", effective_status: "ACTIVE", website_destination_url: "https://x.com/1" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 43200, adset_id: "G1", adset_name: "CONJ_1", ad_id: "a2", ad_name: "AD_2", effective_status: "PAUSED" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 43200, adset_id: "G2", adset_name: "CONJ_2", ad_id: "a3", ad_name: "AD_3", effective_status: "ADSET_PAUSED" },
      { campaign_id: "A", campaign: "CAMP_A", campaign_effective_status: "ACTIVE", campaign_daily_budget: 43200, adset_id: "G2", adset_name: "CONJ_2", ad_id: "a4", ad_name: "AD_4", effective_status: "ADSET_PAUSED" },
      { campaign_id: "B", campaign: "CAMP_B", campaign_effective_status: "ACTIVE", campaign_daily_budget: 10000, adset_id: "G9", adset_name: "CONJ_9", ad_id: "b1", ad_name: "AD_B", effective_status: "ACTIVE" },
    ],
    gA: [{ campaign_id: "X", campaign: "GOOGLE_X", campaign_status: "ENABLED", ad_group_name: "Grupo 1", ad_group_id: "g1", ad_id: "ga1", ad_name: "", ad_group_ad_status: "ENABLED", ad_group_ad_policy_summary_approval_status: "DISAPPROVED", ad_final_urls: '["https://y.com/a"]' }],
    gB: [{ date: "2026-10-14", campaign_id: "X", campaign: "GOOGLE_X", budget_amount: 267 }, { date: "2026-10-15", campaign_id: "X", campaign: "GOOGLE_X", budget_amount: 300 }],
    gK: [{ campaign_id: "X", ad_group_name: "Grupo 1", ad_group_id: "g1", keyword_text: "tulum lots", spend: 20 }],
  },
};
global.fetch = async (url, opts) => {
  const u = String(url);
  const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  if (u.includes("/rpc/slvd_kv_op")) {
    const b = JSON.parse(opts.body);
    if (b.p_op === "get") return ok({ v: KV[b.p_k] ?? null });
    if (b.p_op === "set") { KV[b.p_k] = b.p_v; return ok({ ok: true }); }
    throw new Error("op kv no simulada: " + b.p_op);
  }
  if (u.includes("connectors.windsor.ai")) {
    const d = W[DIA];
    if (u.includes("/facebook?")) { if (FALLA_META) return { ok: false, status: 500, text: async () => "caída" }; return ok({ data: d.meta }); }
    if (u.includes("keyword_text")) return ok({ data: d.gK });
    if (u.includes("budget_amount")) return ok({ data: d.gB });
    return ok({ data: d.gA });
  }
  throw new Error("fetch no simulado: " + u);
};
const LQ = require("../netlify/functions/lead-quality.js");

(async () => {
  const fallas = [];
  const ok = (cond, txt, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + txt + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!cond) fallas.push(txt); };
  const r1 = await LQ.fotoDiaria({ hoy: "2026-10-15" });
  ok(r1.ok && r1.cambios === 0 && r1.base === null, "primera foto: se guarda, sin nada contra qué comparar", r1);
  const r1b = await LQ.fotoDiaria({ hoy: "2026-10-15" });
  ok(r1b.saltada === true, "la foto del mismo día no se repite", r1b);

  DIA = 2;
  const r2 = await LQ.fotoDiaria({ hoy: "2026-10-16" });
  const C = JSON.parse(KV["lq:cambios:v1"] || "[]");
  const que = C.map((c) => `${c.plat}|${c.camp}|${c.que}|${c.cuenta}`);
  console.log("    cambios:", que);
  ok(r2.ok && r2.cambios === C.length && r2.base === "2026-10-15", "segunda foto compara contra la del 15", r2);
  ok(C.every((c) => c.fecha === "2026-10-15" && c.desde === "2026-10-15"), "fecha del cambio = el día anterior a la foto", C.map((c) => c.fecha + "/" + c.desde));
  ok(que.includes("Meta|CAMP_A|presupuesto diario de la campaña de 360 MXN a 432 MXN|true"), "Meta: presupuesto de la campaña 360 → 432");
  ok(que.includes("Meta|CAMP_A|anuncio AD_2: activo → pausado|true"), "Meta: anuncio pausado");
  ok(que.includes("Meta|CAMP_A|conjunto CONJ_2 pausado|true") && !que.some((x) => /AD_3|AD_4/.test(x)), "Meta: el conjunto pausado se anota una vez, no anuncio por anuncio");
  ok(!que.some((x) => /AD_5|CAMP_B/.test(x)), "Meta: lo que dejó de salir en Windsor no se da por pausado; la campaña nueva no tiene contra qué comparar");
  ok(que.includes("Google|GOOGLE_X|presupuesto diario de la campaña de 267 MXN a 300 MXN|true"), "Google: presupuesto 267 → 300 (el del día más reciente)");
  ok(que.some((x) => /^Google\|GOOGLE_X\|anuncio ga1 \(Grupo 1\): aprobación aprobado → rechazado\|true$/.test(x)), "Google: anuncio rechazado");
  ok(que.includes('Google|GOOGLE_X|keywords con gasto que no tenían en 7 días: "tulum lots" (Grupo 1)|false')
    && que.includes('Google|GOOGLE_X|keywords sin gasto en los últimos 7 días: "tulum land" (Grupo 1)|false'), "Google: keywords que empiezan o dejan de gastar, sin reiniciar la espera (cuenta:false)");

  // Meta no responde el 17: Google se compara, Meta conserva su foto del 16 y se compara el 18
  DIA = 2; FALLA_META = true;
  const r3 = await LQ.fotoDiaria({ hoy: "2026-10-17" });
  const F = JSON.parse(KV["lq:foto:v1"]);
  ok(r3.ok && r3.meta === false && F.meta && F.meta.f === "2026-10-16", "Meta caída: se conserva su foto anterior con su fecha", { r3, metaF: F.meta && F.meta.f });
  FALLA_META = false; W[3] = JSON.parse(JSON.stringify(W[2])); W[3].meta[0].campaign_daily_budget = 50000; W[3].meta.forEach((r) => { if (r.campaign_id === "A") r.campaign_daily_budget = 50000; }); DIA = 3;
  await LQ.fotoDiaria({ hoy: "2026-10-18" });
  const C3 = JSON.parse(KV["lq:cambios:v1"]).filter((c) => c.plat === "Meta" && /432 MXN a 500 MXN/.test(c.que));
  ok(C3.length === 1 && C3[0].desde === "2026-10-16" && C3[0].fecha === "2026-10-17", "tras la caída, el cambio sale con su rango (entre el 16 y el 17)", C3);

  // La función programada: sin next_run ni sesión de admin no corre
  const F2 = require("../netlify/functions/lq-foto.js");
  const sin = await F2.handler({ body: "{}", headers: {} });
  const prog = await F2.handler({ body: JSON.stringify({ next_run: "2026-10-19T12:00:00Z" }), headers: {} });
  ok(sin.statusCode === 401 && prog.statusCode === 200, "lq-foto: la corre el programador (next_run); sin él ni sesión de admin, 401", { sin: sin.statusCode, prog: prog.statusCode });

  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas de la foto diaria pasaron");
  process.exit(fallas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
