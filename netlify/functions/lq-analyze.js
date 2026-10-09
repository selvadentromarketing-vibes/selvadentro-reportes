// Netlify Function: conclusiones y acciones recomendadas para Calidad de Leads.
// Recibe el resumen ya agregado en el navegador (nunca datos personales de leads)
// y devuelve un diagnóstico ejecutivo con acciones concretas.
//
// Env vars: ANTHROPIC_API_KEY — sk-ant-… (console.anthropic.com → API Keys)
//
// Body (POST JSON + Authorization: Bearer <token>):
//   { rango, moneda:"MXN", parametros:{metaCostoSql,minSqlVerde,subirPct,topeAmarillo,umbralEval,alertaCpl},
//     totales:{inv,leads,sqlPlus,invPagada,sqlPlusPagado,costoSql,won,sinCampania:{leads,sqlPlus}},
//     campanias:[{nombre,plataforma,inv,leadsPlataforma,leads,sqlPlus,costoSql,cpl,zoom,opp,won,
//       contactadosPct,semaforo,accion,regla,muestraChica,alertaCpl,inferidos}],
//     anuncios:[{nombre,estado,inv,leads,sqlPlus}], integridad:{fuente,asesor,calificacion,duplicados} }
//
// El semáforo (y por lo tanto la acción de cada campaña) lo calcula la app con sus
// parámetros; la IA no lo reinterpreta, lo explica y agrega el detalle.

const S = require("./lib/shared.js");
const API_KEY = process.env.ANTHROPIC_API_KEY;
const json = S.json;

const money = (n) => (n == null ? "—" : Math.round(Number(n) || 0).toLocaleString("en-US") + " MXN");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return S.corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  // SESSION_SECRET hace falta para verificar el token de sesión, y sin ella
  // crypto.createHmac lanza y la function responde 502 SIN cabeceras CORS: el navegador
  // reporta un error de CORS en vez de decir que falta una variable. Solo tres de las
  // nueve functions comprobaban esto.
  const miss = S.missingEnv();
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });
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
  const P = Object.assign({ metaCostoSql: 4000, minSqlVerde: 2, subirPct: 20, topeAmarillo: 6000, umbralEval: 8000, minContactados: 50 }, d.parametros || {});
  // Tope de tamaño: sin él, un body arbitrario infla el prompt (y la cuenta de la API).
  const camps = (d.campanias || []).slice(0, 20).map((c) =>
    `- ${c.nombre} [${c.plataforma || "?"}]: inversión ${money(c.inv)} · ${c.leadsPlataforma ?? "—"} leads en plataforma · ${c.leads} leads en CRM · ` +
    `${c.sqlPlus} SQL+ · costo por SQL ${c.costoSql != null ? money(c.costoSql) : "sin SQL+"} · CPL ${money(c.cpl)} · ` +
    `${c.zoom} Zoom realizado · ${c.opp} OPP · ${c.won} WON · ${c.contactadosPct ?? "—"}% contactados · ` +
    `SEMÁFORO ${c.semaforo}${c.muestraChica ? " (muestra chica)" : ""} → acción "${c.accion}" porque ${c.regla}` +
    (c.nota ? ` · NOTA: ${c.nota}` : "") +
    (c.alertaCpl ? ` · ALERTA CPL: ${c.alertaCpl}` : "") +
    (c.inferidos ? ` · ${c.inferidos} leads con atribución inferida (landing de seguridad sin UTM)` : "")
  ).join("\n");

  const ads = (d.anuncios || []).slice(0, 12).map((a) =>
    `- ${a.nombre} [${a.estado || "?"}]: ${money(a.inv)} · ${a.leads} leads · ${a.sqlPlus ?? 0} SQL+`
  ).join("\n");

  const integ = d.integridad || {};
  const sinC = T.sinCampania || {};

  const prompt = `Eres el analista de paid media y CRM de Selvadentro, un desarrollo inmobiliario boutique en Tulum que vende lotes premium para inversión (ticket mínimo 100,000 USD). Analizas el cruce entre la inversión publicitaria (Meta y Google) y la calidad real de los leads que llegaron al CRM. Todo el dinero está en MXN: escribe las cifras como "12,345 MXN", nunca con "$".

Definiciones que NO se reinterpretan: SQL+ = SQL + SQL Selvadentro, la métrica principal (la única definición de lead "bueno") · Costo por SQL = inversión de la campaña en el rango ÷ SQL+ de esa campaña · CQL y MQL son solo volumen · Embudo: Lead → CQL → MQL → SQL → Zoom realizado → OPP → WON (una cita o visita de sitio no es Zoom realizado) · % contactados = leads que salieron de Nuevo / Sin respuesta; si es bajo, el problema puede ser de seguimiento, no de la campaña.

SEMÁFORO (ya calculado por la app, no lo recalcules ni lo cambies): meta de costo por SQL ${money(P.metaCostoSql)}. VERDE = costo por SQL ≤ ${money(P.metaCostoSql)} con al menos ${P.minSqlVerde} SQL+ → subir ${P.subirPct}% · AMARILLO = costo por SQL entre ${money(P.metaCostoSql)} y ${money(P.topeAmarillo)} → optimizar, no subir · ROJO = costo por SQL > ${money(P.topeAmarillo)}, o inversión ≥ ${money(P.umbralEval)} con 0 SQL+ → pausar; PERO si menos del ${P.minContactados}% de sus leads tiene contacto establecido → revisar seguimiento antes de pausar (la mayoría de sus leads no se han trabajado: el problema puede ser de ventas, no de la campaña) · EN EVALUACIÓN = inversión < ${money(P.umbralEval)} sin SQL+. MUESTRA CHICA = inversión < ${money(P.umbralEval)}: el color se calcula igual, pero la acción SIEMPRE es mantener; nunca recomiendes subir presupuesto (ni pausar) una campaña con muestra chica, aunque vaya en verde. La alerta de CPL es solo una alerta: no cambia la acción.

PERIODO: ${d.rango || "—"}

TOTALES: inversión ${money(T.inv)} · ${T.leads} leads en CRM · ${T.sqlPlus} SQL+ · campañas con inversión: ${money(T.invPagada)} y ${T.sqlPlusPagado} SQL+ → costo por SQL ${T.costoSql != null ? money(T.costoSql) : "sin SQL+"} · ${T.won} WON · ${sinC.leads || 0} leads sin campaña atribuida (${sinC.sqlPlus || 0} SQL+).

CAMPAÑAS CON INVERSIÓN (con su semáforo):
${camps || "(sin campañas con inversión)"}

ANUNCIOS (los de mayor inversión):
${ads || "(sin detalle por anuncio)"}

INTEGRIDAD DEL CRM: ${integ.fuente || "—"} de los leads con fuente identificada · ${integ.asesor || "—"} con asesor asignado · ${integ.calificacion || "—"} calificados en el campo del CRM · ${integ.duplicados ?? 0} posibles duplicados.

Devuelve SOLO un objeto JSON válido, sin texto alrededor y sin bloques de código, con esta forma exacta:
{
  "lectura": "2 a 3 oraciones: qué pasó con el dinero y los SQL+ este periodo, con el costo por SQL total contra la meta y las campañas concretas.",
  "campanias": [{"nombre":"nombre exacto de la campaña","accion":"subir ${P.subirPct}%|mantener|optimizar|pausar|revisar seguimiento","regla":"la regla del semáforo que la justifica, con su cifra","detalle":"1 oración, máximo 25 palabras: qué hacer exactamente en esa campaña"}],
  "acciones": [{"prioridad":"alta|media|baja","titulo":"acción transversal en 6-10 palabras","detalle":"1-2 oraciones con la cifra que la justifica","responsable":"Ads|CRM|Ventas|Dirección"}],
  "riesgos": ["dato que no cuadra o riesgo, 1 oración cada uno"],
  "preguntas": ["pregunta concreta que el reporte no puede responder y hay que verificar en la fuente"]
}

Reglas: "campanias" lleva TODAS las campañas de la lista, en el mismo orden, y su "accion" es exactamente la del semáforo. En "detalle" sé concreto (qué conjunto o anuncio tocar, cuánto subir, qué revisar) y menciona si aplica: muestra chica, alerta de CPL, % contactados bajo (seguimiento, no campaña), leads de plataforma que no llegaron al CRM (atribución antes de pausar) o atribución inferida. "acciones" son 2 a 4 acciones que no son de una sola campaña (atribución, seguimiento, CRM). Si el volumen es demasiado bajo para concluir, dilo en riesgos. Todo en español de México, tono directo y ejecutivo.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 2500,
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
