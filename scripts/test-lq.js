// Prueba del backend de Calidad de Leads (lead-quality.js y lq-analyze.js) SIN red:
// GoHighLevel y la API de Anthropic se simulan.
//
// Cubre el rediseño del 8-oct-2026:
//   · La atribución del contacto trae el ID de campaña: campaignId de la atribución de GHL
//     (Meta, aunque sea número) o hsa_cam en la URL de la landing (Google), y el dominio de
//     la landing (seguridad.selvadentrotulum.com) para la atribución inferida.
//   · El prompt de Conclusiones usa el semáforo: cada campaña llega con su acción y su
//     regla, todo en MXN, y pide una acción por campaña.
// Y las recomendaciones concretas del 9-oct-2026:
//   · El detalle por anuncio (`ads`) hace las mismas 2 consultas de siempre: pedirle más
//     campos la volvió lenta y la sincronización se quedó sin anuncios.
//   · `adsExtra` trae aparte, con tope de tiempo, la URL de destino, el presupuesto diario
//     vigente (Meta en centavos → MXN; Google ya en MXN) y el gasto por keyword por semana.
//   · El prompt manda las acciones ya calculadas y la regla general (objeto exacto, evidencia,
//     muestra mínima, dónde revisar, CBO, máximo 3, un cambio a la vez).
//
// Correr: node scripts/test-lq.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";
process.env.ANTHROPIC_API_KEY = "sk-prueba";
process.env.WINDSOR_API_KEY = "w-prueba";

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

  console.log("\n[lead-quality] la inversión diaria de Windsor trae el ID de campaña");
  const pedidas = [];
  global.fetch = async (url) => {
    pedidas.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: [
      { date: "2026-09-22", source: "google", campaign: "INVESTORS - GOOGLE SEARCH -- MX", campaign_id: "23710551755", spend: 120.5, clicks: 3, impressions: 90, currency: "MXN" },
      { date: "2026-09-22", source: "facebook", campaign: "INVESTORS_MX_DYNAMIC-TOPLPS_090926", campaign_id: "120251374772050275", spend: 300, clicks: 9, impressions: 900 },
    ] }), text: async () => "" };
  };
  const rs = await LQ.handler(ev({ action: "spend", start: "2026-09-21", end: "2026-09-27" }));
  const dsp = JSON.parse(rs.body);
  ok(/fields=[^&]*campaign_id/.test(pedidas[0] || ""), "pide campaign_id a /all", pedidas[0]);
  ok(rs.statusCode === 200 && dsp.rows[0].cid === "23710551755" && dsp.rows[1].cid === "120251374772050275", "cada fila de inversión trae su ID de campaña", dsp.rows);

  console.log("\n[lead-quality] detalle por anuncio sin campos extra; URL, presupuesto y keywords aparte (adsExtra)");
  // Regresión del 9-oct-2026: pedir URL de destino y presupuesto en la consulta del detalle por
  // anuncio la volvió lenta y la sincronización se quedó sin anuncios. `ads` pide lo de siempre.
  const simularWindsor = (cuelga) => async (url) => {
    const u = String(url), f = decodeURIComponent((u.match(/fields=([^&]*)/) || [])[1] || "");
    pedidas.push(u);
    if (cuelga && cuelga.test(f)) return new Promise(() => {});          // Windsor que no contesta
    let data = [];
    if (u.includes("/facebook") && /website_destination_url/.test(f)) data = [
      { campaign_id: "120251374799490275", adset_id: "120251374799520275", adset_name: "EN_LLAMADA_ESCAPE", ad_id: "120251374799500275",
        website_destination_url: "https://lotes.selvadentrotulum.com/en/escape", link: "https://lotes.selvadentrotulum.com/en/escape", campaign_daily_budget: 40000, adset_daily_budget: null, spend: 100 },
      { campaign_id: "120248002284280275", adset_id: "120248002284270275", adset_name: "EN_LLAMADA_ESCAPE", ad_id: "120250807356450275",
        website_destination_url: "http://fb.me/", link: "http://fb.me/", campaign_daily_budget: null, adset_daily_budget: 15000, spend: 50 }];
    else if (u.includes("/facebook")) data = [{ date: "2026-09-22", campaign: "INVESTORS_US/CA_ESCAPE_090926", campaign_id: "120251374799490275", adset_name: "EN_LLAMADA_ESCAPE",
      adset_id: "120251374799520275", ad_id: "120251374799500275", ad_name: "EN_LLAMADA_ESCAPE-TY-COLD", publisher_platform: "facebook", effective_status: "ACTIVE",
      url_tags: "utm_content={{adset.name}}", spend: 100, impressions: 50, clicks: 3, actions_lead: 1 }];
    else if (f.includes("keyword_text")) data = [
      { date: "2026-09-22", campaign: "INVESTORS - GOOGLE SEARCH - US+CAN", campaign_id: "23715389989", ad_group_name: "Investment Intent", ad_group_id: "193313814165", keyword_text: "buying property in tulum mexico", spend: 300.5, clicks: 7, conversions: 1 },
      { date: "2026-09-27", campaign: "INVESTORS - GOOGLE SEARCH - US+CAN", campaign_id: "23715389989", ad_group_name: "Investment Intent", ad_group_id: "193313814165", keyword_text: "buying property in tulum mexico", spend: 99.5, clicks: 3, conversions: 0 },
      { date: "2026-09-28", campaign: "INVESTORS - GOOGLE SEARCH - US+CAN", campaign_id: "23715389989", ad_group_name: "Investment Intent", ad_group_id: "193313814165", keyword_text: "buying property in tulum mexico", spend: 10, clicks: 1, conversions: 0 },
      { date: "2026-09-22", campaign_id: "23715389989", keyword_text: "", spend: 5 }];
    else if (f.includes("budget_amount")) data = [{ date: "2026-09-21", campaign_id: "23715389989", budget_amount: 450 }, { date: "2026-09-22", campaign_id: "23715389989", budget_amount: 480 }];
    else if (u.includes("/google_ads")) data = [{ date: "2026-09-22", campaign: "INVESTORS - GOOGLE SEARCH - US+CAN", campaign_id: "23715389989", ad_group_name: "Investment Intent", ad_group_id: "193313814165",
      ad_id: "7771", ad_name: "", ad_group_ad_status: "ENABLED", ad_final_urls: '["https://seguridad.selvadentrotulum.com/en/seguridadselva"]', spend: 200, impressions: 100, clicks: 5, conversions: 1 }];
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => "" };
  };
  pedidas.length = 0; global.fetch = simularWindsor(null);
  const rad = await LQ.handler(ev({ action: "ads", start: "2026-09-21", end: "2026-09-27" }));
  const dad = JSON.parse(rad.body);
  const fbRow = (dad.ads || []).find((a) => a.plat === "Meta"), ggRow = (dad.ads || []).find((a) => a.plat === "Google");
  const pidioFb = decodeURIComponent(pedidas.find((u) => u.includes("/facebook")) || "");
  ok(rad.statusCode === 200 && fbRow && fbRow.results === 1 && pedidas.length === 2
     && !/website_destination_url|campaign_daily_budget|adset_daily_budget|[=,]link(,|&|$)/.test(pidioFb) && !/keyword_text|budget_amount/.test(pedidas.map(decodeURIComponent).join(" ")),
    "el detalle por anuncio hace las 2 consultas de siempre, sin campos extra (no se vuelve lento)", pidioFb);
  ok(ggRow && ggRow.url === "https://seguridad.selvadentrotulum.com/en/seguridadselva", "el anuncio de Google trae su URL final (ya venía en la consulta)", ggRow);
  pedidas.length = 0;
  const rex = await LQ.handler(ev({ action: "adsExtra", start: "2026-09-21", end: "2026-09-28" }));
  const dex = JSON.parse(rex.body);
  ok(rex.statusCode === 200 && dex.url && dex.url["120251374799500275"] === "https://lotes.selvadentrotulum.com/en/escape" && dex.url["120250807356450275"] === "http://fb.me/",
    "adsExtra: URL de destino por anuncio de Meta (fb.me = formulario instantáneo)", dex.url);
  ok(dex.presu && dex.presu["120251374799490275"] && dex.presu["120251374799490275"].cb === 400 && dex.presu["120248002284280275"].grps["120248002284270275"].gb === 150,
    "adsExtra: presupuesto de Meta en centavos → MXN (campaña CBO y conjunto)", dex.presu);
  ok(dex.presu["23715389989"] && dex.presu["23715389989"].cb === 480, "adsExtra: presupuesto de Google ya en MXN, el del día más reciente", dex.presu["23715389989"]);
  const k39 = (dex.kw || []).find((x) => x.d === "2026-09-21"), k40 = (dex.kw || []).find((x) => x.d === "2026-09-28");
  ok(dex.kw.length === 2 && k39 && k39.spend === 400 && k39.clicks === 10 && k39.conv === 1 && k39.grp === "Investment Intent" && k40 && k40.spend === 10 && !dex.faltan.length,
    "adsExtra: gasto por keyword sumado por semana ISO (d = lunes), sin filas vacías", dex.kw);
  process.env.LQ_TOPE_MS = "200"; global.fetch = simularWindsor(/keyword_text/);
  const t0 = Date.now();
  const rex2 = await LQ.handler(ev({ action: "adsExtra", start: "2026-09-21", end: "2026-09-27" }));
  const dex2 = JSON.parse(rex2.body);
  ok(rex2.statusCode === 200 && Date.now() - t0 < 2000 && dex2.faltan.join("|") === "gasto por keyword de Google" && dex2.url["120251374799500275"] && !dex2.kw.length,
    "si Windsor no contesta a tiempo, adsExtra responde igual con lo que llegó y dice qué faltó", { ms: Date.now() - t0, faltan: dex2.faltan });
  delete process.env.LQ_TOPE_MS;

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
    parametros: { metaCostoSql: 4000, minSqlVerde: 2, subirPct: 20, topeAmarillo: 6000, umbralEval: 8000, minTrabajados: 50, cplMax: 400, muestraPausa: 2, maxAcciones: 3, reevaluarDias: 7 },
    totales: { inv: 30000, leads: 40, sqlPlus: 6, invPagada: 30000, sqlPlusPagado: 5, costoSql: 6000, won: 1, sinCampania: { leads: 3, sqlPlus: 1 } },
    campanias: [
      { nombre: "INVESTORS_US/CA_ESCAPE_090926", plataforma: "Meta", inv: 11360, leadsPlataforma: 13, leads: 9, sqlPlus: 0, costoSql: null, cpl: 1262, zoom: 0, opp: 0, won: 0,
        trabajadosPct: 100, contactadosPct: 30, semaforo: "ROJO", accion: "pausar", regla: "inversión 11,360 MXN ≥ 8,000 MXN con 0 SQL+", muestraChica: false, alertaCpl: "", inferidos: 0,
        recomendaciones: ["Pausar la campaña INVESTORS_US/CA_ESCAPE_090926 — gasto 11,360 MXN, 9 leads, 0 SQL+, CPL 1,262 MXN"], esperar: "" },
      { nombre: "INVESTORS_MX_DYNAMIC-TOPLPS_090926", plataforma: "Meta", inv: 9230, leadsPlataforma: 51, leads: 10, sqlPlus: 2, costoSql: 4615, cpl: 923, zoom: 1, opp: 1, won: 0,
        trabajadosPct: 90, contactadosPct: 40, semaforo: "AMARILLO", accion: "optimizar", accionTexto: "Optimizar costo", regla: "costo por SQL 4,615 MXN", muestraChica: false, alertaCpl: "", inferidos: 8,
        recomendaciones: ["Probar 2 creativos nuevos junto a ES_LLAMADA_NUEVO6-ESCAPE_CENOTES (conjunto ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO), que hoy lleva a https://seguridad.selvadentrotulum.com/seguridadpatrimonio/ — gasto 3,965 MXN"],
        esperar: "Sin muestra suficiente para pausar; esperar. Ningún anuncio con CPL arriba de 400 MXN llega a 800 MXN de gasto." },
    ],
    anuncios: [], integridad: { fuente: "90%", asesor: "95%", calificacion: "20%", duplicados: 0 },
  };
  const ra = await A.handler(ev(payload));
  const da = JSON.parse(ra.body);
  const prompt = enviado ? enviado.messages[0].content : "";
  ok(ra.statusCode === 200 && da.analisis && Array.isArray(da.analisis.campanias), "devuelve el análisis con campanias", ra.statusCode);
  ok(/SEMÁFORO ROJO → acción "pausar" porque inversión 11,360 MXN ≥ 8,000 MXN con 0 SQL\+/.test(prompt), "cada campaña llega con su semáforo, acción y regla");
  ok(/"campanias": \[\{"nombre"/.test(prompt) && /subir presupuesto diario 20%\|mantener\|optimizar\|pausar\|revisar seguimiento/.test(prompt), "pide una acción por campaña con el vocabulario fijo");
  ok(/si menos del 50% de sus leads está trabajado \(la mayoría sigue en "Nuevo lead"\) → revisar seguimiento antes de pausar/.test(prompt)
     && /si ya están trabajados y no contestan, se pausa/.test(prompt), "ROJO: revisar seguimiento solo si menos del 50% está trabajado; trabajados que no contestan, pausar");
  ok(/% trabajados = leads que ya salieron de "Nuevo lead/.test(prompt) && /Sin respuesta y toques no cuentan/.test(prompt), "define trabajados y contactados por separado");
  ok(/meta de costo por SQL 4,000 MXN/.test(prompt) && /costo por SQL 6,000 MXN/.test(prompt), "cifras en MXN");
  ok(!/\$\d/.test(prompt), "ningún monto con $ en el prompt");
  ok(/MUESTRA CHICA = inversión < 8,000 MXN: el color se calcula igual, pero la acción SIEMPRE es mantener/.test(prompt), "muestra chica: la acción siempre es mantener, nunca subir");
  ok(/subir presupuesto diario 20% \(máx\. 1 vez por semana/.test(prompt) && /tasa SQL \(SQL\+ ÷ leads\) < 10% = optimizar calidad, CPL > 400 MXN = optimizar costo/.test(prompt), "verde con su nota y amarillo con su diagnóstico en el prompt");
  ok(/SQL\+ = SQL \+ SQL Selvadentro/.test(prompt) && !/MQL \+ SQL \+ SQL Selvadentro/.test(prompt), "una sola definición de bueno: SQL+");
  ok(/QUÉ HACER \(ya calculado, en orden de impacto\): 1\) Probar 2 creativos nuevos junto a ES_LLAMADA_NUEVO6-ESCAPE_CENOTES \(conjunto ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO\), que hoy lleva a https:\/\/seguridad/.test(prompt)
     && /Sin muestra suficiente para pausar; esperar\. Ningún anuncio/.test(prompt), "cada campaña llega con sus acciones concretas y la nota de muestra insuficiente");
  ok(/nunca genérica/.test(prompt) && /no inventes ninguno/.test(prompt) && /gasto menor a 800 MXN \(2× el CPL objetivo de 400 MXN\)/.test(prompt)
     && /Revisar en Meta Ads › Anuncios › columna Frecuencia/.test(prompt) && /CBO/.test(prompt) && /Máximo 3 acciones por campaña/.test(prompt) && /Un cambio a la vez; reevaluar en 7 días/.test(prompt),
     "regla general de recomendaciones en el prompt (objeto exacto, muestra mínima 800 MXN, dónde revisar, CBO, máximo 3)");

  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas del backend de Calidad de Leads pasaron");
  process.exit(fallas.length ? 1 : 0);
})().catch((e) => { console.error("FALLO:", e); process.exit(2); });
