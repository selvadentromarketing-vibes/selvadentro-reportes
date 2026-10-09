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
//       trabajadosPct,contactadosPct,semaforo,accion,accionTexto,regla,nota,decision,atenderHoy,recomendaciones,esperar,muestraChica,alertaCpl,inferidos}],
//     pausadas:[{nombre,plataforma,inv,leads,sqlPlus,costoSql,pausada}],
//     anuncios:[{nombre,conjunto,campania,estado,inv,leadsPlataforma,leads,sqlPlus,frecuencia}], integridad:{fuente,asesor,calificacion,duplicados} }
// Desde el 9-oct-2026 el periodo es FIJO (últimos 30 días cerrados; tendencia 7 contra 7): es la
// decisión de hoy, no depende del filtro de fechas de la pantalla.
//
// El semáforo (y por lo tanto la acción de cada campaña) lo calcula la app con sus
// parámetros; la IA no lo reinterpreta, lo explica y agrega el detalle. Lo mismo las
// recomendaciones (Dirección, 9-oct-2026): llegan ya con el conjunto, anuncio, keyword o URL
// exactos y su evidencia; la IA no inventa objetos ni da instrucciones genéricas.

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
  const P = Object.assign({ metaCostoSql: 4000, minSqlVerde: 2, subirPct: 20, topeAmarillo: 6000, umbralEval: 8000, minTrabajados: 50, capacidadTelemarketer: 140, tasaSqlMin: 10, cplMax: 400, muestraPausa: 2, maxAcciones: 3, reevaluarDias: 7, frecuenciaMax: 3 }, d.parametros || {});
  const minPausa = (Number(P.muestraPausa) || 2) * (Number(P.cplMax) || 400);
  const corta = (x) => String(x || "").slice(0, 700);
  // Tope de tamaño: sin él, un body arbitrario infla el prompt (y la cuenta de la API).
  const camps = (d.campanias || []).slice(0, 20).map((c) =>
    `- ${c.nombre} [${c.plataforma || "?"}]: inversión ${money(c.inv)} · ${c.leadsPlataforma ?? "—"} leads en plataforma · ${c.leads} leads en CRM · ` +
    `${c.sqlPlus} SQL+ · costo por SQL ${c.costoSql != null ? money(c.costoSql) : "sin SQL+"} · CPL ${money(c.cpl)} · ` +
    `${c.zoom} Zoom realizado · ${c.opp} OPP · ${c.won} WON · ${c.trabajadosPct ?? "—"}% trabajados · ${c.contactadosPct ?? "—"}% contactados · ` +
    `SEMÁFORO ${c.semaforo}${c.muestraChica ? " (muestra chica)" : ""} → acción "${c.accion}" porque ${c.regla}` +
    (c.accionTexto && c.accionTexto.toLowerCase() !== String(c.accion || "").toLowerCase() ? ` (${c.accionTexto})` : "") +
    (c.decision ? `\n    DECISIÓN: ${corta(c.decision)}` : "") +
    (Array.isArray(c.atenderHoy) && c.atenderHoy.length ? `\n    ATENDER HOY: ${c.atenderHoy.slice(0, 3).map(corta).join(" / ")}` : "") +
    (c.nota ? ` · NOTA: ${c.nota}` : "") +
    (Array.isArray(c.recomendaciones) && c.recomendaciones.length
      ? `\n    QUÉ HACER (ya calculado, en orden de impacto): ${c.recomendaciones.slice(0, P.maxAcciones).map((x, i) => `${i + 1}) ${corta(x)}`).join(" ")}` : "") +
    (c.esperar ? `\n    ${corta(c.esperar)}` : "") +
    (c.alertaCpl ? ` · ALERTA CPL: ${c.alertaCpl}` : "") +
    (c.inferidos ? ` · ${c.inferidos} leads con atribución inferida (landing de seguridad sin UTM)` : "")
  ).join("\n");

  const ads = (d.anuncios || []).slice(0, 12).map((a) =>
    `- ${a.nombre}${a.conjunto ? ` (conjunto ${a.conjunto}${a.campania ? `, campaña ${a.campania}` : ""})` : ""} [${a.estado || "?"}]: ${money(a.inv)} · ` +
    `${a.leadsPlataforma != null ? `${a.leadsPlataforma} leads en plataforma · ` : ""}${a.leads} leads CRM · ${a.sqlPlus ?? 0} SQL+` +
    (a.frecuencia != null ? ` · frecuencia ${a.frecuencia}` : "")
  ).join("\n");
  const pausadas = (d.pausadas || []).slice(0, 20).map((c) =>
    `- ${c.nombre} [${c.plataforma || "?"}]: inversión ${money(c.inv)} · ${c.leads} leads · ${c.sqlPlus} SQL+ · costo por SQL ${c.costoSql != null ? money(c.costoSql) : "sin SQL+"} · pausada el ${c.pausada || "?"}`
  ).join("\n");

  const integ = d.integridad || {};
  const sinC = T.sinCampania || {};

  const prompt = `Eres el analista de paid media y CRM de Selvadentro, un desarrollo inmobiliario boutique en Tulum que vende lotes premium para inversión (ticket mínimo 100,000 USD). Analizas el cruce entre la inversión publicitaria (Meta y Google) y la calidad real de los leads que llegaron al CRM. Todo el dinero está en MXN: escribe las cifras como "12,345 MXN", nunca con "$".

Definiciones que NO se reinterpretan: SQL+ = SQL + SQL Selvadentro, la métrica principal (la única definición de lead "bueno") · Costo por SQL = inversión de la campaña en el rango ÷ SQL+ de esa campaña · CQL y MQL son solo volumen · Embudo: Lead → CQL → MQL → SQL → Zoom realizado → OPP → WON (una cita o visita de sitio no es Zoom realizado) · % trabajados = leads que ya salieron de "Nuevo lead (no contactado)" (Sin respuesta y toques incluidos); si es bajo, el problema es de seguimiento, no de la campaña · % contactados = leads con conversación (Contacto establecido, Interés identificado, Nurturing, Zoom, Largo plazo, OPP, WON o posterior; Sin respuesta y toques no cuentan); trabajados altos con contactados bajos = los leads no contestan, problema de calidad del lead.

SEMÁFORO (ya calculado por la app, no lo recalcules ni lo cambies): meta de costo por SQL ${money(P.metaCostoSql)}. VERDE = costo por SQL ≤ ${money(P.metaCostoSql)} con al menos ${P.minSqlVerde} SQL+ → subir presupuesto diario ${P.subirPct}% (máx. 1 vez por semana, solo si sigue en verde y sin rebasar la capacidad del telemarketer de ~${P.capacidadTelemarketer} leads/mes) · AMARILLO = costo por SQL entre ${money(P.metaCostoSql)} y ${money(P.topeAmarillo)} → optimizar sin tocar presupuesto ni puja, según la causa que ya diagnosticó la app: tasa SQL (SQL+ ÷ leads) < ${P.tasaSqlMin}% = optimizar calidad, CPL > ${money(P.cplMax)} = optimizar costo; un cambio a la vez y reevaluar en 7 días · ROJO = costo por SQL > ${money(P.topeAmarillo)}, o inversión ≥ ${money(P.umbralEval)} con 0 SQL+ → pausar; PERO si menos del ${P.minTrabajados}% de sus leads está trabajado (la mayoría sigue en "Nuevo lead") → revisar seguimiento antes de pausar (el problema puede ser de ventas, no de la campaña); si ya están trabajados y no contestan, se pausa (el problema es la calidad del lead) · EN EVALUACIÓN = inversión < ${money(P.umbralEval)} sin SQL+. MUESTRA CHICA = inversión < ${money(P.umbralEval)}: el color se calcula igual, pero la acción SIEMPRE es mantener; nunca recomiendes subir presupuesto (ni pausar) una campaña con muestra chica, aunque vaya en verde. La alerta de CPL (los últimos 7 días cerrados contra los 7 anteriores) es solo una alerta: no cambia la acción.

DECISIÓN DE HOY: el semáforo se calcula con los últimos 30 días cerrados. Cada campaña ACTIVA trae su DECISIÓN: "Decidir hoy" o "(preliminar) — Decisión el <fecha>: <motivo>" (la fecha más tardía entre último cambio + ${P.reevaluarDias} días, llegar a ${money(P.umbralEval)} de gasto en 30 días al ritmo actual, e inicio + 7 días). Una acción PRELIMINAR no se ejecuta antes de su fecha: dilo así. Lo que venga en ATENDER HOY (anuncio rechazado, gasto detenido, medición rota) se atiende hoy, antes que cualquier otra cosa. Las campañas PAUSADAS RECIENTEMENTE no llevan acción: no recomiendes nada para ellas.

PERIODO: ${d.rango || "—"}

TOTALES: inversión ${money(T.inv)} · ${T.leads} leads en CRM · ${T.sqlPlus} SQL+ · campañas con inversión: ${money(T.invPagada)} y ${T.sqlPlusPagado} SQL+ → costo por SQL ${T.costoSql != null ? money(T.costoSql) : "sin SQL+"} · ${T.won} WON · ${sinC.leads || 0} leads sin campaña atribuida (${sinC.sqlPlus || 0} SQL+).

CAMPAÑAS ACTIVAS HOY (con su semáforo y su decisión):
${camps || "(sin campañas activas con inversión)"}

PAUSADAS RECIENTEMENTE (últimos 30 días; sin acción):
${pausadas || "(ninguna)"}

ANUNCIOS (los de mayor inversión, cada uno dentro de su conjunto):
${ads || "(sin detalle por anuncio)"}

INTEGRIDAD DEL CRM: ${integ.fuente || "—"} de los leads con fuente identificada · ${integ.asesor || "—"} con asesor asignado · ${integ.calificacion || "—"} calificados en el campo del CRM · ${integ.duplicados ?? 0} posibles duplicados.

Devuelve SOLO un objeto JSON válido, sin texto alrededor y sin bloques de código, con esta forma exacta:
{
  "lectura": "2 a 3 oraciones: qué pasó con el dinero y los SQL+ en los últimos 30 días, con el costo por SQL total contra la meta, qué se atiende hoy y qué decisiones están en espera y hasta cuándo.",
  "campanias": [{"nombre":"nombre exacto de la campaña","accion":"subir presupuesto diario ${P.subirPct}%|mantener|optimizar|pausar|revisar seguimiento","regla":"la regla del semáforo que la justifica, con su cifra","detalle":"1 a 2 oraciones, máximo 40 palabras: la acción 1 de su QUÉ HACER con el objeto exacto y su evidencia"}],
  "acciones": [{"prioridad":"alta|media|baja","titulo":"acción transversal en 6-10 palabras","detalle":"1-2 oraciones con la cifra que la justifica","responsable":"Ads|CRM|Ventas|Dirección"}],
  "riesgos": ["dato que no cuadra o riesgo, 1 oración cada uno"],
  "preguntas": ["pregunta concreta que el reporte no puede responder y hay que verificar en la fuente"]
}

Reglas: "campanias" lleva TODAS las campañas ACTIVAS de la lista (no las pausadas), en el mismo orden, y su "accion" es exactamente la del semáforo. Si su DECISIÓN es preliminar, el "detalle" empieza diciendo la fecha de decisión. En "detalle" explica la acción 1 de su QUÉ HACER con los MISMOS nombres (plataforma › campaña › conjunto › anuncio, o keyword en Google, o la URL) y su evidencia (gasto, leads, SQL+ y CPL o costo por SQL) y menciona si aplica: muestra chica, alerta de CPL, % trabajados bajo (seguimiento, no campaña), leads de plataforma que no llegaron al CRM (atribución antes de pausar) o atribución inferida.

REGLA GENERAL DE TODA RECOMENDACIÓN (campanias y acciones): específica y accionable, nunca genérica. Nombra el objeto exacto; si dices pausar, revisar, cambiar o probar algo, di cuál. Usa solo los conjuntos, anuncios, keywords y URLs que aparecen arriba: no inventes ninguno. Nunca recomiendes pausar algo con gasto menor a ${money(minPausa)} (${P.muestraPausa || 2}× el CPL objetivo de ${money(P.cplMax)}); si la campaña dice "Sin muestra suficiente para pausar; esperar", no recomiendes pausar nada de ella. Si la acción depende de un dato que el reporte no tiene (frecuencia, términos de búsqueda, calidad del creativo), dilo y di dónde revisarlo (p. ej. "Revisar en Meta Ads › Anuncios › columna Frecuencia"). Si pausas un conjunto en Meta y la campaña usa presupuesto de campaña (CBO), agrega: "Pausar conjuntos chicos tiene poco efecto: Meta ya reasigna el presupuesto". Si la frecuencia de un anuncio pasa de ${P.frecuenciaMax}, recomienda renovar ESE creativo, nombrando el anuncio y su conjunto. Calcula siempre por anuncio dentro de su conjunto: el mismo creativo se repite en varios conjuntos. Máximo ${P.maxAcciones || 3} acciones por campaña y recuerda: "Un cambio a la vez; reevaluar en ${P.reevaluarDias || 7} días."

"acciones" son 2 a 4 acciones que no son de una sola campaña (atribución, seguimiento, CRM), cada una con el objeto exacto (campo del CRM, asesor, etapa, campaña). Si el volumen es demasiado bajo para concluir, dilo en riesgos. Todo en español de México, tono directo y ejecutivo.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 3000,
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
