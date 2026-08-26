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

const S = require("./lib/shared.js");

const API_KEY = process.env.ANTHROPIC_API_KEY;

const json = S.json;      // una sola definición, en lib/shared.js

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return S.corsPreflight();   // permite Authorization, que esta function exige
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  // SESSION_SECRET hace falta para verificar el token de sesión, y sin ella
  // crypto.createHmac lanza y la function responde 502 SIN cabeceras CORS: el navegador
  // reporta un error de CORS en vez de decir que falta una variable. Solo tres de las
  // nueve functions comprobaban esto.
  const miss = S.missingEnv();
  if (miss.length) return json(500, { error: "Faltan env vars: " + miss.join(", ") });
  if (!API_KEY) return json(500, { error: "ANTHROPIC_API_KEY no configurada en el entorno" });
  // Antes bastaba con tener sesión: cualquier usuario podía disparar llamadas a Claude
  // sin límite. Ahora exige el canal correspondiente, igual que el resto de reportes.
  const session = S.authFromEvent(event);
  if (!session) return json(401, { error: "Sesión inválida o expirada" });
  const ch = session.channels || [];
  if (session.role !== "admin" && !["direccion_general","direccion_comercial"].some((c) => ch.includes(c))) {
    return json(403, { error: "Sin acceso a los reportes de Dirección" });
  }

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
