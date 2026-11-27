// Prueba de la regla "candidato-asesor" del lado del servidor, con GoHighLevel SIMULADO: no llama
// al CRM, no necesita llaves reales ni red.
//
// La landing de reclutamiento manda a GHL (webhook) a quienes piden trabajo de asesor, con la
// etiqueta "candidato-asesor". No son clientes: no cuentan como lead en ningún reporte. Cubre:
//   · el helper compartido (lib/shared.js): etiqueta sin mayúsculas y recortada (arreglo o lista
//     "a, b"), fuente "reclutamiento-asesores" (contacto o atribución) y campaña de reclutamiento;
//   · que index.html use la MISMA etiqueta y la misma comparación (el navegador filtra los
//     contactos de Calidad de Leads, Desempeño y Primer contacto con su copia);
//   · que las oportunidades de un candidato no salgan de ninguna function que las recorra:
//     ghl-report (CRM en vivo), sla-report (Desempeño), lead-quality (Calidad de Leads) y
//     pc-report (Primer contacto) — y que la de un lead sin la etiqueta sí salga.
// Lo del navegador (que el contacto no cuente como lead en cada reporte) lo prueba
// scripts/smoke-ui.js ("[candidato-asesor] …").
//
// Correr: node scripts/test-candidato-asesor.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";

const fs = require("fs");
const path = require("path");
const S = require("../netlify/functions/lib/shared.js");
const T0 = Date.parse("2026-11-23T15:00:00Z");
const iso = (t) => new Date(t).toISOString();

// Oportunidades simuladas: /opportunities/search trae el contacto embebido con sus etiquetas.
const opp = (id, ct, tags) => ({ id, contactId: ct, assignedTo: "ase1", status: "open", pipelineId: "pV", pipelineStageId: "s1",
  source: "landing", monetaryValue: 0, createdAt: iso(T0), lastStageChangeAt: iso(T0), customFields: [],
  ...(tags ? { contact: { id: ct, name: "Contacto " + ct, tags } } : {}) });
const OPPS = [
  opp("opCand", "ctCand", ["candidato-asesor"]),                 // candidato: fuera
  opp("opCandMay", "ctCandMay", ["landing-reclutamiento", " Candidato-Asesor "]),   // otra grafía: fuera
  opp("opLead", "ctLead", ["facebook-lead", "candidato-asesoria"]),   // lead (etiqueta parecida, no igual): cuenta
  opp("opSinCt", "ctSinCt", null),                               // sin contacto embebido: cuenta (no hay cómo saber)
  Object.assign(opp("opFte", "ctFte", []), { source: "reclutamiento-asesores" }),   // solo la fuente: fuera
];
S.ghlFetch = async (p) => {
  if (p.startsWith("/opportunities/search")) {
    const ct = new URLSearchParams(p.split("?")[1]).get("contact_id");
    return ct ? { opportunities: OPPS.filter((o) => o.contactId === ct) } : { opportunities: OPPS, meta: { total: OPPS.length } };
  }
  throw Object.assign(new Error("ruta no simulada: " + p), { status: 404 });
};
const fn = (n) => require("../netlify/functions/" + n + ".js").handler;
const H = { ghl: fn("ghl-report"), sla: fn("sla-report"), lq: fn("lead-quality"), pc: fn("pc-report") };
const tok = S.signToken({ email: "prueba@selvadentrotulum.com", role: "admin", channels: [] });
const call = async (h, body) => { const r = await h({ httpMethod: "POST", headers: { authorization: "Bearer " + tok }, body: JSON.stringify(body) }); return { status: r.statusCode, d: JSON.parse(r.body) }; };

(async () => {
  const fallas = [];
  const ok = (cond, txt, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + txt + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!cond) fallas.push(txt); };

  // 1) Helper compartido
  const E = S.esCandidatoAsesor;
  ok(S.TAG_CANDIDATO_ASESOR === "candidato-asesor", "la etiqueta es \"candidato-asesor\"", S.TAG_CANDIDATO_ASESOR);
  ok(E(["candidato-asesor"]) && E(["Candidato-Asesor"]) && E([" CANDIDATO-ASESOR  "]) && E(["x", "candidato-asesor"]),
    "candidato-asesor cuenta con cualquier mayúscula y con espacios alrededor");
  ok(E("lead-web, Candidato-Asesor") && !E("lead-web, broker"), "también con la lista \"a, b\" que guardan los agregados");
  ok(!E([]) && !E(null) && !E(undefined) && !E(["candidato"]) && !E(["candidato-asesoria"]) && !E(["candidato asesor"]) && !E([null]),
    "sin la etiqueta exacta no es candidato (vacío, null, etiquetas parecidas)");
  ok(S.oppDeCandidatoAsesor(OPPS[0]) && S.oppDeCandidatoAsesor(OPPS[1]) && !S.oppDeCandidatoAsesor(OPPS[2]) && !S.oppDeCandidatoAsesor(OPPS[3]) && !S.oppDeCandidatoAsesor(null),
    "oportunidad de candidato: por las etiquetas de su contacto embebido");

  // 1b) Fuente "reclutamiento-asesores" y campaña de reclutamiento, sin la etiqueta
  ok(E({ src: "reclutamiento-asesores", tags: [] }) && E({ src: " Reclutamiento-Asesores " }) && E({ source: "RECLUTAMIENTO ASESORES" }),
    "contacto solo con fuente reclutamiento-asesores (adelgazado: src; crudo de GHL: source), con cualquier grafía");
  ok(E({ attr: { src: "reclutamiento-asesores" } }) && E({ attributionSource: { utmSource: "reclutamiento-asesores" } }) && E({ lastAttributionSource: { utm_source: "Reclutamiento-Asesores" } }),
    "fuente de la atribución (utm_source) también");
  ok(E({ attr: { camp: "RECLUTAMIENTO_ASESORES_TUL-PDC_LP-VSL_NOV26" } }) && E({ attributionSource: { campaign: "reclutamiento_asesores_cun" } }),
    "campaña de reclutamiento de asesores en la atribución (utm_campaign)");
  ok(E({ tags: ["reclutamiento-asesores-nov26"] }) && !E({ tags: ["reclutamiento-brokers"] }),
    "etiqueta que empieza con reclutamiento-asesores (DM) sí; reclutamiento de brokers no");
  ok(!E({ src: "facebook", attr: { src: "fb", camp: "INVESTORS_MX_DYNAMIC" }, tags: ["lead"] }) && !E({ src: "reclutamiento" }) && !E({}) && !E({ attr: null, tags: null }),
    "un lead normal (o una fuente que no es la de reclutamiento de asesores) no es candidato");
  ok(S.oppDeCandidatoAsesor({ source: "reclutamiento-asesores", contact: { tags: [] } }) && S.oppDeCandidatoAsesor({ contact: { source: "Reclutamiento-Asesores" } }) && !S.oppDeCandidatoAsesor({ source: "landing", contact: { tags: ["x"] } }),
    "oportunidad de candidato también por su fuente o la de su contacto embebido");

  // 2) index.html usa la MISMA regla: el bloque <regla-candidato-asesor> es idéntico y da lo mismo
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const shared = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "lib", "shared.js"), "utf8");
  const bloque = (t) => { const m = t.match(/\/\/ <regla-candidato-asesor>[\s\S]*?\/\/ <\/regla-candidato-asesor>/); return m ? m[0] : null; };
  const bH = bloque(html), bS = bloque(shared);
  ok(bH && bS && bH === bS, "index.html y lib/shared.js tienen el mismo bloque de la regla, letra por letra", bH && bS ? undefined : "falta el bloque");
  let H2 = null;
  try { H2 = bH && new Function(bH + "\nreturn { esCandidatoAsesor, oppDeCandidatoAsesor, TAG_CANDIDATO_ASESOR };")(); } catch (e) { H2 = null; }
  const casos = [["candidato-asesor"], ["Candidato-Asesor"], [" CANDIDATO-ASESOR "], "a, Candidato-Asesor", ["candidato-asesoria"], [], null, "broker", ["x", "candidato-asesor"],
    { tags: ["Candidato-Asesor"] }, { src: "reclutamiento-asesores" }, { source: "Reclutamiento Asesores" }, { attr: { camp: "RECLUTAMIENTO_ASESORES_TUL-PDC_LP-VSL_NOV26" } },
    { attr: { src: "reclutamiento-asesores" } }, { tags: ["reclutamiento-asesores-nov26"] }, { src: "facebook", attr: { camp: "INVESTORS" }, tags: ["lead"] }, {}];
  ok(H2 && H2.TAG_CANDIDATO_ASESOR === S.TAG_CANDIDATO_ASESOR && casos.every((c) => H2.esCandidatoAsesor(c) === E(c)),
    "esCandidatoAsesor de index.html da lo mismo que la del servidor (etiqueta, fuente y campaña)", H2 ? casos.map((c) => [H2.esCandidatoAsesor(c), E(c)]) : "no se pudo evaluar el bloque");

  // 3) Oportunidades: ninguna function devuelve las de un candidato; la de un lead sí.
  const ids = (arr, k) => (arr || []).map((o) => o[k]).sort().join();
  const g = await call(H.ghl, { action: "crawl" });
  ok(g.status === 200 && g.d.opps.length === 2 && g.d.candidatos === 3 && g.d.fetched === 2,
    "CRM en vivo (ghl-report crawl): fuera las 3 de candidatos (dos grafías de la etiqueta y una solo por fuente); cuentan el lead y la que no trae contacto", { n: g.d.opps && g.d.opps.length, candidatos: g.d.candidatos });
  const s = await call(H.sla, { action: "opps" });
  ok(s.status === 200 && ids(s.d.opps, "id") === "opLead,opSinCt", "Desempeño (sla-report opps): sin las de candidatos", ids(s.d.opps, "id"));
  const l = await call(H.lq, { action: "opps" });
  ok(l.status === 200 && ids(l.d.opps, "ct") === "ctLead,ctSinCt", "Calidad de Leads (lead-quality opps): sin las de candidatos", ids(l.d.opps, "ct"));
  const l2 = await call(H.lq, { action: "opps", contactIds: ["ctCand", "ctCandMay", "ctLead"] });
  ok(l2.status === 200 && ids(l2.d.opps, "ct") === "ctLead", "Calidad de Leads, por contacto (re-envíos): sin las de candidatos", ids(l2.d.opps, "ct"));
  const p = await call(H.pc, { action: "opps", contactIds: ["ctCand", "ctCandMay", "ctLead"] });
  ok(p.status === 200 && ids(p.d.opps, "ct") === "ctLead", "Primer contacto (pc-report opps): sin las de candidatos", ids(p.d.opps, "ct"));

  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas de candidato-asesor pasaron");
  process.exit(fallas.length ? 1 : 0);
})();
