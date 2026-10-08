// Prueba del backend de Calidad de Leads (lead-quality.js y lq-analyze.js) SIN red:
// GoHighLevel y la API de Anthropic se simulan.
//
// Cubre el rediseño del 8-oct-2026:
//   · La atribución del contacto trae el ID de campaña: campaignId de la atribución de GHL
//     (Meta, aunque sea número) o hsa_cam en la URL de la landing (Google), y el dominio de
//     la landing (seguridad.selvadentrotulum.com) para la atribución inferida.
//   · El prompt de Conclusiones usa el semáforo: cada campaña llega con su acción y su
//     regla, todo en MXN, y pide una acción por campaña.
//
// Correr: node scripts/test-lq.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";
process.env.ANTHROPIC_API_KEY = "sk-prueba";

const S = require("../netlify/functions/lib/shared.js");
const fallas = [];
const ok = (cond, que, extra) => { if (!cond) { fallas.push(que); console.log("  ✗", que, extra !== undefined ? JSON.stringify(extra) : ""); } else console.log("  ✓", que); };

const CONTACTOS = [
  { id: "m1", contactName: "Meta por ID", email: "a@x.com", phone: "+5219991112233", dateAdded: "2026-09-22T15:00:00Z", source: "Meta ads",
    attributions: [{ campaign: "Intelligent Investors", campaignId: "120248002284280275", utmSource: "facebook" }] },
  // Un ID que llega como número (los de Google caben en un entero de JS; los de Meta, de 18
  // dígitos, no: GHL los manda como texto).
  { id: "g2", contactName: "Google numérico", email: "d@x.com", dateAdded: "2026-09-23T16:00:00Z", source: "google",
    attributionSource: { campaignId: 23715389989, utmSource: "google" } },
  { id: "g1", contactName: "Google hsa", email: "b@x.com", dateAdded: "2026-09-23T15:00:00Z", source: "google",
    lastAttributionSource: { url: "https://selvadentrotulum.com/inversion?utm_campaign=INVESTORS-GOOGLE-SEARCH-MX&hsa_cam=23710551755&gclid=x", utmSource: "google" } },
  { id: "s1", contactName: "Landing seguridad", email: "c@x.com", dateAdded: "2026-09-24T15:00:00Z", source: "landing-seguridad",
    attributionSource: { url: "https://seguridad.selvadentrotulum.com/?ref=1" } },
];
S.ghlFetch = async (path) => {
  if (path === "/contacts/search") return { contacts: CONTACTOS, total: CONTACTOS.length };
  throw Object.assign(new Error("no simulado: " + path), { status: 404 });
};

(async () => {
  const LQ = require("../netlify/functions/lead-quality.js");
  const token = S.signToken({ email: "dg@selvadentrotulum.com", role: "admin", channels: ["mkt_lq"] });
  const ev = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) });

  console.log("\n[lead-quality] atribución con ID de campaña y dominio de la landing");
  const r = await LQ.handler(ev({ action: "leads", start: "2026-09-01T00:00:00-05:00", end: "2026-10-04T23:59:59-05:00" }));
  const d = JSON.parse(r.body);
  const by = Object.fromEntries((d.leads || []).map((l) => [l.id, l]));
  ok(r.statusCode === 200 && d.leads.length === 4, "responde los 4 contactos", r.statusCode);
  ok(by.m1 && by.m1.attr.cid === "120248002284280275", "Meta: campaignId de la atribución", by.m1 && by.m1.attr);
  ok(by.g2 && by.g2.attr.cid === "23715389989", "campaignId que llega como número se convierte a texto", by.g2 && by.g2.attr);
  ok(by.m1 && by.m1.attr.camp === "Intelligent Investors", "Meta: el nombre de la atribución se conserva (el ID manda en la app)");
  ok(by.g1 && by.g1.attr.cid === "23710551755", "Google: hsa_cam de la URL de la landing", by.g1 && by.g1.attr);
  ok(by.s1 && by.s1.attr.host === "seguridad.selvadentrotulum.com" && !by.s1.attr.camp, "Landing de seguridad: dominio sin utm_campaign", by.s1 && by.s1.attr);

  console.log("\n[lq-analyze] el prompt usa el semáforo y pide una acción por campaña");
  let enviado = null;
  global.fetch = async (url, opt) => {
    enviado = JSON.parse(opt.body);
    const analisis = { lectura: "x", campanias: [{ nombre: "INVESTORS_US/CA_ESCAPE_090926", accion: "pausar", regla: "r", detalle: "d" }], acciones: [], riesgos: [], preguntas: [] };
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(analisis) }], stop_reason: "end_turn", usage: {} }), text: async () => "" };
  };
  const A = require("../netlify/functions/lq-analyze.js");
  const payload = {
    rango: "2026-W37 → 2026-W40", moneda: "MXN",
    parametros: { metaCostoSql: 4000, minSqlVerde: 2, subirPct: 20, topeAmarillo: 6000, umbralEval: 8000 },
    totales: { inv: 30000, leads: 40, sqlPlus: 6, invPagada: 30000, sqlPlusPagado: 5, costoSql: 6000, won: 1, sinCampania: { leads: 3, sqlPlus: 1 } },
    campanias: [
      { nombre: "INVESTORS_US/CA_ESCAPE_090926", plataforma: "Meta", inv: 11360, leadsPlataforma: 13, leads: 9, sqlPlus: 0, costoSql: null, cpl: 1262, zoom: 0, opp: 0, won: 0,
        contactadosPct: 30, semaforo: "ROJO", accion: "pausar", regla: "inversión 11,360 MXN ≥ 8,000 MXN con 0 SQL+", muestraChica: false, alertaCpl: "", inferidos: 0 },
    ],
    anuncios: [], integridad: { fuente: "90%", asesor: "95%", calificacion: "20%", duplicados: 0 },
  };
  const ra = await A.handler(ev(payload));
  const da = JSON.parse(ra.body);
  const prompt = enviado ? enviado.messages[0].content : "";
  ok(ra.statusCode === 200 && da.analisis && Array.isArray(da.analisis.campanias), "devuelve el análisis con campanias", ra.statusCode);
  ok(/SEMÁFORO ROJO → acción "pausar" porque inversión 11,360 MXN ≥ 8,000 MXN con 0 SQL\+/.test(prompt), "cada campaña llega con su semáforo, acción y regla");
  ok(/"campanias": \[\{"nombre"/.test(prompt) && /subir 20%\|mantener\|optimizar\|pausar/.test(prompt), "pide una acción por campaña con el vocabulario fijo");
  ok(/meta de costo por SQL 4,000 MXN/.test(prompt) && /costo por SQL 6,000 MXN/.test(prompt), "cifras en MXN");
  ok(!/\$\d/.test(prompt), "ningún monto con $ en el prompt");
  ok(/SQL\+ = SQL \+ SQL Selvadentro/.test(prompt) && !/MQL \+ SQL \+ SQL Selvadentro/.test(prompt), "una sola definición de bueno: SQL+");

  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas del backend de Calidad de Leads pasaron");
  process.exit(fallas.length ? 1 : 0);
})().catch((e) => { console.error("FALLO:", e); process.exit(2); });
