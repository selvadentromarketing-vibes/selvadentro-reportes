// Netlify Function: sintetiza notas/aprendizajes/cambios cualitativos con Claude.
//
// Env vars requeridas:
//   ANTHROPIC_API_KEY — sk-ant-...
//
// Body esperado (POST JSON):
//   {
//     canal: "Brokers",              // nombre legible del canal/módulo/vista
//     entradas: [                    // array de registros con texto
//       {
//         periodo: "2026-W28",
//         canal: "Brokers",          // opcional, útil en vistas de Dirección
//         dims: "Mariano Molina",    // opcional (asesor/ciudad concatenados)
//         responsable: "Diana",       // opcional
//         notas: "…",
//         aprendizajes: "…",
//         cambios: "…"
//       }, ...
//     ]
//   }

const API_KEY = process.env.ANTHROPIC_API_KEY;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
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
  try { payload = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON inválido" }); }

  const { canal, entradas } = payload;
  if (!Array.isArray(entradas) || !entradas.length) {
    return json(400, { error: "Se requieren entradas con al menos 1 registro con texto" });
  }

  const bloque = entradas.map((e) => {
    const partes = [];
    if (e.notas) partes.push(`Notas: ${e.notas}`);
    if (e.aprendizajes) partes.push(`Aprendizajes: ${e.aprendizajes}`);
    if (e.cambios) partes.push(`Cambios: ${e.cambios}`);
    const head = [e.periodo, e.canal, e.dims, e.responsable ? `resp. ${e.responsable}` : null]
      .filter(Boolean).join(" · ");
    return `[${head}]\n${partes.join("\n")}`;
  }).join("\n\n");

  const prompt = `Eres analista de negocio de Selvadentro (desarrollo inmobiliario boutique en Tulum, México — venta de lotes premium para inversión). Recibes las notas cualitativas de los reportes semanales/mensuales del canal/vista "${canal || "General"}":

${bloque}

Sintetiza en 3-5 oraciones (máximo 130 palabras) qué está pasando cualitativamente: patrones o comportamientos recurrentes, cambios operativos importantes, aprendizajes clave, riesgos u obstáculos que se repiten. Sé concreto y específico, no genérico. Cita elementos textuales solo si aportan claridad. Termina con 1-2 recomendaciones accionables. Prosa continua en español, sin viñetas ni listas.`;

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
        max_tokens: 500,
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
      body: JSON.stringify({ conclusion: texto.trim(), entradas: entradas.length, usage: data.usage }),
    };
  } catch (e) {
    return json(500, { error: "Fallo al llamar Anthropic", detail: String(e) });
  }
};
