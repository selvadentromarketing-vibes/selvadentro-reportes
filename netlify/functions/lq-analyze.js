// Netlify Function: conclusiones y acciones recomendadas para Calidad de Leads.
// Recibe el resumen ya agregado en el navegador (nunca datos personales de leads)
// y devuelve un diagnóstico ejecutivo con acciones concretas.
//
// Env vars: ANTHROPIC_API_KEY — sk-ant-… (console.anthropic.com → API Keys)
//
// Body (POST JSON + Authorization: Bearer <token>):
//   { rango, totales:{inv,leads,calif,cpl,costoCalif}, familias:[{nombre,inv,resultAds,
//     leads,calif,cpl,costoCalif,mezcla:{...}}], anuncios:[{nombre,estado,inv,leads,calif}],
//     integridad:{fuente,asesor,calificacion,duplicados}, mesAnterior:{...}, mesActual:{...} }

const S = require("./lib/shared.js");
const API_KEY = process.env.ANTHROPIC_API_KEY;
const json = S.json;

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!API_KEY) return json(500, { error: "ANTHROPIC_API_KEY no configurada en las variables de entorno del site" });

  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  const ch = session.channels || [];
  if (session.role !== "admin" && !ch.includes("mkt_lq") && !ch.includes("marketing")) {
    return json(403, { error: "Sin acceso a Calidad de Leads" });
  }

  let d;
  try { d = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }

  const T = d.totales || {};
  const fam = (d.familias || []).map((f) =>
    `- ${f.nombre}: inversión ${money(f.inv)} · ${f.resultAds ?? "—"} resultados en plataforma · ${f.leads} leads en CRM · ` +
    `${f.calif} calificados (${pct(f.calif, f.leads)}) · CPL ${f.leads ? money(f.cpl) : "—"} · costo por calificado ${f.calif ? money(f.costoCalif) : "sin calificados"}` +
    (f.mezcla ? ` · mezcla: ${Object.entries(f.mezcla).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ") || "sin leads"}` : "")
  ).join("\n");

  const ads = (d.anuncios || []).slice(0, 15).map((a) =>
    `- ${a.nombre} [${a.estado || "?"}]: ${money(a.inv)} · ${a.leads} leads · ${a.calif} calificados`
  ).join("\n");

  const integ = d.integridad || {};
  const mesLinea = d.mesAnterior && d.mesActual
    ? `Mes anterior → mes actual: leads ${d.mesAnterior.leads}→${d.mesActual.leads} · calificados ${d.mesAnterior.calif}→${d.mesActual.calif} · inversión ${money(d.mesAnterior.inv)}→${money(d.mesActual.inv)}.`
    : "";

  const prompt = `Eres el analista de paid media y CRM de Selvadentro, un desarrollo inmobiliario boutique en Tulum que vende lotes premium para inversión (ticket mínimo 100,000 USD). Analizas el cruce entre inversión publicitaria (Meta y Google) y la calidad real de los leads que llegaron al CRM.

Definiciones que NO se reinterpretan: CQL = lead capturado con primer alcance · MQL = respondió o mostró interés · SQL = interés real y activo sin perfil confirmado · SQL Selvadentro = interés real + presupuesto ≥100K USD y horizonte ≤6 meses o señal fuerte (cita asistida, cotización) · Descalificado = sin fit. "Calificados" = MQL + SQL + SQL Selvadentro.

PERIODO: ${d.rango || "—"}

TOTALES: inversión ${money(T.inv)} · ${T.leads} leads en CRM · ${T.calif} calificados (${pct(T.calif, T.leads)}) · CPL ${money(T.cpl)} · costo por calificado ${T.calif ? money(T.costoCalif) : "no hubo calificados"}.
${mesLinea}

POR FAMILIA DE CAMPAÑA:
${fam || "(sin datos de campaña)"}

ANUNCIOS (los de mayor inversión):
${ads || "(sin detalle por anuncio)"}

INTEGRIDAD DEL CRM: ${integ.fuente || "—"} de los leads con fuente identificada · ${integ.asesor || "—"} con asesor asignado · ${integ.calificacion || "—"} calificados en el campo del CRM · ${integ.duplicados ?? 0} posibles duplicados.

Devuelve SOLO un objeto JSON válido, sin texto alrededor y sin bloques de código, con esta forma exacta:
{
  "lectura": "2 a 4 oraciones en prosa: qué pasó con el dinero y la calidad este periodo. Cuantifica. Nombra las campañas concretas.",
  "acciones": [{"prioridad":"alta|media|baja","titulo":"acción concreta en 6-10 palabras","detalle":"1-2 oraciones: qué hacer exactamente y por qué, con la cifra que lo justifica","responsable":"Ads|CRM|Ventas|Dirección"}],
  "riesgos": ["riesgo o dato que no cuadra, 1 oración cada uno"],
  "preguntas": ["pregunta concreta que el reporte no puede responder y hay que verificar en la fuente"]
}

Reglas: entre 3 y 6 acciones, ordenadas por prioridad, específicas (pausar X, subir presupuesto de Y, revisar el formulario de Z, llamar a los N leads en tal etapa) y nunca genéricas tipo "optimizar campañas". Si una familia gastó dinero sin producir calificados, dilo con el monto. Si el volumen es demasiado bajo para concluir, dilo en riesgos en vez de inventar una tendencia. Todo en español de México, tono directo y ejecutivo.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 2000,
        // Netlify corta las funciones sincrónicas a los ~10 s: esfuerzo bajo para responder a tiempo
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      return json(resp.status, { error: "Anthropic API error", detail: detail.slice(0, 500) });
    }
    const data = await resp.json();
    if (data.stop_reason === "refusal") return json(502, { error: "La solicitud fue rechazada por los filtros del modelo" });
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    let parsed = null;
    try { parsed = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* se devuelve el texto crudo */ }
    return json(200, { analisis: parsed, texto: parsed ? "" : texto, usage: data.usage });
  } catch (e) {
    return json(502, { error: "Fallo al llamar Anthropic", detail: String(e && e.message || e) });
  }
};
