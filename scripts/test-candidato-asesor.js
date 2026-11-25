// Prueba de la regla "candidato-asesor" del lado del servidor, con GoHighLevel SIMULADO: no llama
// al CRM, no necesita llaves reales ni red.
//
// La landing de reclutamiento manda a GHL (webhook) a quienes piden trabajo de asesor, con la
// etiqueta "candidato-asesor". No son clientes: no cuentan como lead en ningún reporte. Cubre:
//   · el helper compartido (lib/shared.js): sin mayúsculas y recortada, arreglo o lista "a, b";
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

  // 2) index.html usa la misma etiqueta y la misma comparación
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const mTag = html.match(/const TAG_CANDIDATO_ASESOR = "([^"]+)";/);
  const mFn = html.match(/const esCandidatoAsesor = (\(tags\)=>[\s\S]*?;)\n/);
  ok(mTag && mTag[1] === S.TAG_CANDIDATO_ASESOR, "index.html declara la misma etiqueta que lib/shared.js", mTag && mTag[1]);
  let Ehtml = null;
  try { Ehtml = mFn && new Function("TAG_CANDIDATO_ASESOR", "return " + mFn[1])(mTag[1]); } catch (e) { Ehtml = null; }
  const casos = [["candidato-asesor"], ["Candidato-Asesor"], [" CANDIDATO-ASESOR "], "a, Candidato-Asesor", ["candidato-asesoria"], [], null, "broker", ["x", "candidato-asesor"]];
  ok(Ehtml && casos.every((c) => Ehtml(c) === E(c)), "esCandidatoAsesor de index.html da lo mismo que la del servidor en todos los casos",
    Ehtml ? casos.map((c) => [Ehtml(c), E(c)]) : "no se encontró la función en index.html");

  // 3) Oportunidades: ninguna function devuelve las de un candidato; la de un lead sí.
  const ids = (arr, k) => (arr || []).map((o) => o[k]).sort().join();
  const g = await call(H.ghl, { action: "crawl" });
  ok(g.status === 200 && g.d.opps.length === 2 && g.d.candidatos === 2 && g.d.fetched === 2,
    "CRM en vivo (ghl-report crawl): fuera las 2 de candidatos (las dos grafías); cuentan el lead y la que no trae contacto", { n: g.d.opps && g.d.opps.length, candidatos: g.d.candidatos });
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
