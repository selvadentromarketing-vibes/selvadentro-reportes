// Netlify Function: analiza un KPI con Claude (Anthropic API) y devuelve una conclusión breve.
//
// Env vars requeridas:
//   ANTHROPIC_API_KEY — sk-ant-... (console.anthropic.com → API Keys)
//
// Body esperado (POST JSON):
//   {
//     canal: "Brokers",              // nombre legible del canal / módulo
//     kpi: "Leads registrados",       // etiqueta del KPI
//     unidad: "leads",                // opcional: "leads" | "MXN" | "%" | etc.
//     meta: 30,                       // opcional: meta del periodo (misma unidad que valor)
//     puntos: [                       // serie temporal ordenada de más antigua a más reciente
//       { periodo: "2026-W13", valor: 4 },
//       { periodo: "2026-W14", valor: 1 },
//       ...
//     ],
//     periodicidad: "semanal"         // "semanal" | "mensual"
//   }

const API_KEY = process.env.ANTHROPIC_API_KEY;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!API_KEY) return json(500, { error: "ANTHROPIC_API_KEY no configurada en el entorno" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const { canal, kpi, unidad, meta, puntos, periodicidad } = payload;
  if (!kpi || !Array.isArray(puntos) || !puntos.length) {
    return json(400, { error: "Se requieren kpi y puntos con al menos 1 registro" });
  }

  const serie = puntos
    .map((p) => `${p.periodo}: ${p.valor}${unidad ? " " + unidad : ""}`)
    .join("\n");
  const totalValor = puntos.reduce((a, p) => a + Number(p.valor || 0), 0);
  const ultimos4 = puntos.slice(-4);
  const primeros4 = puntos.slice(0, 4);
  const avgReciente = ultimos4.reduce((a, p) => a + Number(p.valor || 0), 0) / (ultimos4.length || 1);
  const avgInicio = primeros4.reduce((a, p) => a + Number(p.valor || 0), 0) / (primeros4.length || 1);
  const tendencia = avgReciente > avgInicio * 1.1
    ? "creciente"
    : avgReciente < avgInicio * 0.9
    ? "decreciente"
    : "estable";

  const metaLine = meta != null && meta !== "" ? `Meta del periodo: ${meta}${unidad ? " " + unidad : ""}.` : "";

  const prompt = `Eres analista de negocio de Selvadentro (desarrollo inmobiliario boutique en Tulum, México — venta de lotes premium para inversión). Analiza este KPI:

Canal/Módulo: ${canal || "General"}
KPI: ${kpi}
Periodicidad: ${periodicidad || "semanal"}
${metaLine}
Total acumulado en el periodo: ${totalValor}${unidad ? " " + unidad : ""}.
Promedio inicio (primeras ${primeros4.length}): ${avgInicio.toFixed(2)}.
Promedio reciente (últimas ${ultimos4.length}): ${avgReciente.toFixed(2)}.
Tendencia calculada: ${tendencia}.

Serie completa:
${serie}

Escribe una conclusión ejecutiva en español de 2 a 3 oraciones (máximo 60 palabras). Sé directo, cuantifica el cambio, y si aplica compara vs la meta. No repitas la data punto por punto — interpreta. Sin viñetas, en prosa. Termina con una recomendación accionable concreta si aplica.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json(resp.status, { error: "Anthropic API error", detail: errText });
    }

    const data = await resp.json();
    const texto = (data.content && data.content[0] && data.content[0].text) || "";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        conclusion: texto.trim(),
        tendencia,
        total: totalValor,
        avgReciente,
        avgInicio,
        usage: data.usage,
      }),
    };
  } catch (e) {
    return json(500, { error: "Fallo al llamar Anthropic", detail: String(e) });
  }
};
