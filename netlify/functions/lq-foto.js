// Netlify Scheduled Function: foto diaria de Meta y Google para Calidad de Leads.
// Corre todos los días a las 7:00 hora Tulum (12:00 UTC, ver netlify.toml) entre o no alguien
// al reporte: guarda el estado actual (campañas, conjuntos, anuncios, presupuestos, keywords con
// gasto) en lq:foto:v1 y lo que cambió desde la foto anterior en lq:cambios:v1, que la bitácora
// de Conclusiones muestra como "detectado". Todo vive en el kv de Selvadentro (Supabase slvd_kv).
//
// La corre el programador de Netlify (manda next_run en el cuerpo). Un admin puede correrla a mano
// con su sesión: { forzar:true } vuelve a tomar la foto del día (sin comparar, ya hay una de hoy).
const S = require("./lib/shared.js");
const { fotoDiaria } = require("./lead-quality.js");

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse((event && event.body) || "{}"); } catch (e) { body = {}; }
  const programada = !!body.next_run;
  if (!programada) {
    const session = S.authFromEvent(event || {});
    if (!session || session.role !== "admin") return S.json(401, { error: "Solo el programador de Netlify o un admin" });
  }
  const miss = S.missingEnv();
  if (miss.length) return S.json(500, { error: "Faltan env vars: " + miss.join(", ") });
  try {
    const r = await fotoDiaria({ forzar: !programada && !!body.forzar });
    console.log("lq-foto", JSON.stringify(r));
    return S.json(r.ok ? 200 : 502, r);
  } catch (e) {
    console.error("lq-foto", e);
    return S.json(502, { ok: false, error: String((e && e.message) || e) });
  }
};
