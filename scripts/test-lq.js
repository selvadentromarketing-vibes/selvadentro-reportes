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
//   · `decision` trae aparte, con tope de tiempo, el rango FIJO de Conclusiones (30 días
//     cerrados y 7 contra 7): estado, inicio, último cambio, presupuesto, frecuencia, URL,
//     Audience Network, días por campaña y keywords, por anuncio dentro de su conjunto.
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

  console.log("\n[lead-quality] detalle por anuncio sin campos extra (lo de la decisión va aparte)");
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

  console.log("\n[lead-quality] decision: rango fijo de 30 días cerrados y 7 contra 7, por anuncio dentro de su conjunto");
  const V = { hoy: "2026-10-09", ini: "2026-09-09", fin: "2026-10-08", ini7: "2026-10-02", fin7: "2026-10-08", iniP: "2026-09-25", finP: "2026-10-01" };
  const E9 = "120251374799490275";
  const simDec = (cuelga) => async (url) => {
    const u = String(url), f = decodeURIComponent((u.match(/fields=([^&]*)/) || [])[1] || ""), desde = (u.match(/date_from=([\d-]+)/) || [])[1];
    pedidas.push(u);
    if (cuelga && cuelga.test(f)) return new Promise(() => {});
    let data = [];
    if (u.includes("/facebook") && f.includes("frequency")) data = [
      { campaign_id: E9, campaign: "INVESTORS_US/CA_ESCAPE_090926", campaign_effective_status: "ACTIVE", campaign_start_time: "2026-09-09T13:30:00-0600", campaign_daily_budget: 40000, campaign_lifetime_budget: 0,
        adset_id: "g1", adset_name: "EN_LLAMADA_ESCAPE", adset_daily_budget: null, adset_lifetime_budget: null, adset_created_time: "2026-09-09T12:50:58-0600", adset_updated_time: "2026-09-28T15:27:19-0600",
        ad_id: "a1", ad_name: "EN_LLAMADA_ESCAPE-TY-COLD", effective_status: "ACTIVE", ad_created_time: "2026-09-09T12:51:02-0600", website_destination_url: "https://lotes.selvadentrotulum.com/en/escape", link: "", frequency: 3.4, spend: 1771.2, actions_lead: 2, clicks: 40, impressions: 900 },
      { campaign_id: E9, campaign: "INVESTORS_US/CA_ESCAPE_090926", campaign_effective_status: "ACTIVE", campaign_start_time: "2026-09-09T13:30:00-0600", campaign_daily_budget: 40000,
        adset_id: "g2", adset_name: "EN_LLAMADA_SEGURIDAD-TULUM", adset_created_time: "2026-09-28T15:27:27-0600", adset_updated_time: "2026-09-28T15:27:46-0600",
        ad_id: "a2", ad_name: "EN_LLAMADA_ESCAPE-TY-COLD", effective_status: "ACTIVE", ad_created_time: "2026-09-28T15:27:29-0600", website_destination_url: "https://seguridad.selvadentrotulum.com/en/seguridadtulum/", frequency: 1.2, spend: 300, actions_lead: 1, clicks: 9, impressions: 300 }];
    else if (u.includes("/facebook") && f.includes("publisher_platform")) data = [
      { campaign_id: E9, adset_id: "g1", adset_name: "EN_LLAMADA_ESCAPE", publisher_platform: "audience_network", spend: 900, actions_lead: 1 },
      { campaign_id: E9, adset_id: "g1", adset_name: "EN_LLAMADA_ESCAPE", publisher_platform: "facebook", spend: 871.2, actions_lead: 1 }];
    else if (u.includes("/facebook") && f.startsWith("date,")) data = [
      { date: "2026-10-03", campaign_id: E9, adset_id: "g1", ad_id: "a1", spend: 100, actions_lead: 0 }, { date: "2026-10-08", campaign_id: E9, adset_id: "g1", ad_id: "a1", spend: 50, actions_lead: 1 },
      { date: "2026-09-26", campaign_id: E9, adset_id: "g1", ad_id: "a1", spend: 80, actions_lead: 1 }, { date: "2026-09-26", campaign_id: E9, adset_id: "g2", ad_id: "a2", spend: 20, actions_lead: 0 }];
    else if (u.includes("/facebook")) data = desde === V.fin ? [
      { campaign_id: E9, campaign: "INVESTORS_US/CA_ESCAPE_090926", campaign_effective_status: "ACTIVE", adset_id: "g3", adset_name: "EN_LLAMADA_PREMIUMLOTS", ad_id: "a3",
        ad_name: "EN_LLAMADA_PREMIUMLOTS-SUSPIRO-SELVA-CLEAN_091026", effective_status: "ACTIVE", ad_created_time: "2026-10-09T12:07:42-0600", adset_created_time: "2026-09-09T12:50:58-0600", adset_updated_time: "2026-09-09T12:51:17-0600", spend: 3.87 }] : [];
    else if (f.includes("campaign_status")) data = [
      { campaign_id: "23715389989", campaign: "INVESTORS - GOOGLE SEARCH - US+CAN", campaign_status: "PAUSED", campaign_primary_status: "PAUSED", campaign_primary_status_reasons: '["CAMPAIGN_PAUSED"]',
        ad_group_name: "Investment Intent", ad_group_id: "193313814165", ad_id: "803228657690", ad_name: "Tulum Real Estate Investment | Invest in Tulum", ad_group_ad_status: "ENABLED",
        ad_group_ad_policy_summary_approval_status: "APPROVED", ad_final_urls: '["https://lotes.selvadentrotulum.com/"]', spend: 8053.14, clicks: 120, conversions: 4, impressions: 3000 }];
    else if (f.startsWith("date,campaign_id,spend")) data = [
      { date: "2026-10-07", campaign_id: "23715389989", spend: 79.85, conversions: 0, budget_amount: 480 }, { date: "2026-09-30", campaign_id: "23715389989", spend: 406.44, conversions: 0, budget_amount: 450 }];
    else if (f.startsWith("campaign_id,ad_group_name,ad_group_id,keyword_text")) data = [
      { campaign_id: "23715389989", ad_group_name: "Investment Intent", ad_group_id: "193313814165", keyword_text: "buying property in tulum mexico", spend: 2500.5, clicks: 60, conversions: 1 }];
    else if (f.startsWith("date,campaign_id,ad_group_id,keyword_text")) data = [
      { date: "2026-10-04", campaign_id: "23715389989", ad_group_id: "193313814165", keyword_text: "Buying property in tulum mexico", spend: 300, conversions: 0 },
      { date: "2026-09-28", campaign_id: "23715389989", ad_group_id: "193313814165", keyword_text: "buying property in tulum mexico", spend: 200, conversions: 1 }];
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => "" };
  };
  pedidas.length = 0; global.fetch = simDec(null);
  const rdm = await LQ.handler(ev({ action: "decision", plat: "meta", ventana: V }));
  const dm = JSON.parse(rdm.body);
  const cE9 = dm.camps && dm.camps[E9];
  ok(rdm.statusCode === 200 && pedidas.length === 4 && pedidas.every((u) => !u.includes("date_from=2026-07")), "Meta: 4 consultas con las fechas de la ventana, no las del selector", pedidas.length);
  ok(cE9 && cE9.estado === "ACTIVE" && cE9.inicio === "2026-09-09" && cE9.cb === 400 && cE9.lb === null, "estado de hoy, inicio en hora de Tulum y presupuesto de campaña (CBO) en MXN", cE9);
  ok(cE9 && cE9.cambio && cE9.cambio.fecha === "2026-10-09" && /anuncio nuevo EN_LLAMADA_PREMIUMLOTS-SUSPIRO-SELVA-CLEAN_091026 en EN_LLAMADA_PREMIUMLOTS/.test(cE9.cambio.que),
    "último cambio: el anuncio nuevo de hoy (Windsor no da la edición significativa; se usa anuncio / conjunto creado o editado)", cE9 && cE9.cambio);
  const a1 = (dm.ads || []).find((a) => a.id === "a1"), a2 = (dm.ads || []).find((a) => a.id === "a2");
  ok(a1 && a2 && a1.grp === "EN_LLAMADA_ESCAPE" && a2.grp === "EN_LLAMADA_SEGURIDAD-TULUM" && a1.sp === 1771.2 && a1.res === 2 && a1.fq === 3.4 && a1.url === "https://lotes.selvadentrotulum.com/en/escape",
    "el mismo creativo en dos conjuntos son dos anuncios (id), con gasto, leads, frecuencia y URL de 30 días", { a1, a2 });
  ok(a1 && a1.sp7 === 150 && a1.res7 === 1 && a1.spP === 80 && a1.resP === 1 && a2.spP === 20, "gasto y leads de los últimos 7 días y de los 7 anteriores, por anuncio", a1);
  ok(dm.an && dm.an.length === 1 && dm.an[0].grp === "EN_LLAMADA_ESCAPE" && dm.an[0].sp === 900, "Audience Network por conjunto (solo esa ubicación)", dm.an);
  ok(dm.dias && dm.dias[E9] && dm.dias[E9]["2026-09-26"].sp === 100 && dm.dias[E9]["2026-10-08"].res === 1, "gasto y leads de plataforma por día y campaña (para gasto detenido y medición rota)", dm.dias && dm.dias[E9]);
  pedidas.length = 0;
  const rdg = await LQ.handler(ev({ action: "decision", plat: "google", ventana: V }));
  const dg = JSON.parse(rdg.body), cUS = dg.camps && dg.camps["23715389989"], kUS = (dg.kw || [])[0];
  ok(rdg.statusCode === 200 && cUS && cUS.estado === "PAUSED" && cUS.cb === 480 && (dg.ads || [])[0].url === "https://lotes.selvadentrotulum.com/" && dg.dias["23715389989"]["2026-10-07"].sp === 79.85,
    "Google: estado de la campaña, presupuesto del día más reciente, URL final (ad_final_urls) y días", { cUS, ads: dg.ads });
  ok(kUS && kUS.sp === 2500.5 && kUS.sp7 === 300 && kUS.spP === 200 && kUS.cvP === 1, "keywords: 30 días y 7 contra 7 (sin importar mayúsculas)", kUS);
  process.env.LQ_TOPE_MS = "200"; global.fetch = simDec(/publisher_platform/);
  const t0 = Date.now();
  const rdt = await LQ.handler(ev({ action: "decision", plat: "meta", ventana: V }));
  const dt = JSON.parse(rdt.body);
  ok(rdt.statusCode === 200 && Date.now() - t0 < 2000 && dt.faltan.join("|") === "Audience Network de Meta" && dt.ads.length >= 2,
    "si Windsor no contesta a tiempo, decision responde con lo que llegó y dice qué faltó", { ms: Date.now() - t0, faltan: dt.faltan });
  delete process.env.LQ_TOPE_MS;
  const rbad = await LQ.handler(ev({ action: "decision", plat: "meta", ventana: { ini: "2026-09-09" } }));
  ok(rbad.statusCode === 400, "sin ventana completa responde 400", rbad.statusCode);

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
