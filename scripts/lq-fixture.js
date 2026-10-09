// Datos sintéticos para probar Calidad de Leads sin CRM ni Windsor (2026-W37 a 2026-W40).
// Nombres de campaña e IDs como los de la cuenta; montos y leads INVENTADOS, redondos.
// Devuelve exactamente lo que recibe buildLqAgg(boot, rawLeads, spendRows, weeks,
// oppsByContact, adRows), en JSON plano para pasarlo a la página con page.evaluate.
//
// Resultado esperado del semáforo (meta 4,000 MXN por SQL, umbral 8,000 MXN; con menos de
// 8,000 invertidos el color se calcula igual pero la acción es "Mantener (muestra chica)"):
//   MX_DYNAMIC_090926   9,200 · 2 SQL+ de 10 leads (8 con atribución inferida) → AMARILLO, optimizar costo
//                       (tasa SQL 20% ≥ 10%, CPL 920 MXN > 400)
//   US/CA_ESCAPE_090926 11,200 · 0 SQL+ · 43% trabajados, 14% contactados → ROJO, revisar seguimiento antes de pausar
//   US/CA_ESCAPE_100626 10,000 · 2 SQL+ de 22 leads → AMARILLO, optimizar calidad y costo (tasa 9.1%, CPL 455)
//   EN_FORMULARIOMETA   7,000 · 2 SQL+ (cruce por ID)  · alerta de CPL   → VERDE, mantener (muestra chica)
//   GOOGLE SEARCH MX    3,600 · 3 leads (2 con utm = ID 23710551755, 1 con
//                       el alias INVESTORS-GOOGLE-SEARCH-MX) · 1 SQL+    → AMARILLO, mantener (muestra chica)
//   GOOGLE US+CAN      13,600 · 0 SQL+ (utm numérico) · 100% trabajados, 60% contactados → ROJO pausar
//   MX_DYNAMIC_150726  10,400 · 3 SQL+                                  → VERDE, subir presupuesto diario 20%
//   Total pagado       65,000 · 10 SQL+ → 6,500 MXN por SQL · 4 leads sin campaña
//   3 leads de brokers (uno es "Jennifer Guillaume", WON) excluidos de todo: no mueven ninguna
//   cifra; un contacto del pipeline de reclutamiento de brokers sí cuenta (orgánico).
//
// Recomendaciones concretas (lqRecomendar). La inversión de cada campaña se reparte entre sus
// conjuntos y anuncios reales (mismos totales); URL de destino, presupuesto diario y gasto por
// keyword como los de la cuenta:
//   MX_DYNAMIC_150726  → subir el presupuesto diario de 360 a 432 MXN + capacidad del telemarketer
//   ESCAPE_100626      → pausar el conjunto EN_LLAMADA_ESCAPE (4,000 MXN, 8 leads, 0 SQL+, CBO),
//                        creativos nuevos junto a EN_LLAMADA_PREMIUMLOTS-5MIN (…/en/premium), landing
//   MX_DYNAMIC_090926  → pausar ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC del conjunto del mismo nombre
//                        (2,300 MXN, 0 leads; único anuncio de su conjunto), reemplazarlo, landing
//   ESCAPE_090926      → trabajar los leads sin trabajar, por asesor; reevaluar en 7 días
//   Google US+CAN      → pausar la campaña (keywords con leads por utm_term)
//   EN_FORMULARIOMETA  → ⚠ CPL al alza: conjunto EN_LLAMADA_PREMIUMLOTS, frecuencia en Meta Ads
//
// Decisión de hoy (Conclusiones) con hoy fijo = 2026-10-05 (window.LQ_HOY_FIJO en la prueba):
//   Atender hoy   ESCAPE_100626 (anuncio rechazado EN_LLAMADA_ESCAPE-DIANA; preliminar hasta el 09-oct)
//                 Google MX (medición rota: 2 conversiones el 03–04 oct y 0 leads en el CRM)
//   Decidir hoy   ESCAPE_090926 (revisar seguimiento) y MX_DYNAMIC_090926 (optimizar costo)
//   Preliminares  EN_FORMULARIOMETA (faltan 1,000 MXN de gasto, ~4 días: la ventana de 30 días es móvil) y MX_DYNAMIC_150726 si la
//                 bitácora trae un cambio reciente
//   Pausadas      Google US+CAN (PAUSED, último gasto 04-oct)
function fixture() {
  const ETAPAS = ["Nuevo lead (no contactado)", "1er toque", "2ndo toque", "3er toque", "Ultimátum", "Break up", "Sin respuesta",
    "Contacto establecido", "Interés identificado", "Zoom agendado", "Zoom no show / re agendar", "Zoom realizado", "Tour agendado",
    "Tour no show / re agendar", "Tour realizado", "Cotización enviada", "Seguimiento de OPP", "Carta Oferta", "Apartado", "WON",
    "Largo Plazo", "Rescate", "Corretaje", "Nurturing", "Descalificado", "Redes Sociales"];
  const stages = {};
  ETAPAS.forEach((s, i) => { stages["st" + i] = { p: "Seguimiento de ventas", s, i }; });
  // Pipeline de brokers: sus leads salen de Calidad de Leads (y el de reclutamiento no).
  ["Registro", "Seguimiento", "Apartado", "WON"].forEach((s, i) => { stages["bk" + i] = { p: "Brokers - Producción (B2B2C)", s, i }; });
  ["Prospecto broker", "Activo"].forEach((s, i) => { stages["bx" + i] = { p: "Brokers - Expansión y activación", s, i }; });
  const sid = (nombre) => "st" + ETAPAS.indexOf(nombre);
  const boot = {
    users: { u1: "Asesora Uno", u2: "Asesor Dos" },
    fields: [{ id: "f_camp", name: "utm_campaign" }, { id: "f_cont", name: "utm_content" }, { id: "f_term", name: "utm_term" }, { id: "f_cal", name: "Calificación del lead" }],
    oppFields: [], stages, windsor: true,
  };
  const LUNES = { "2026-W37": "2026-09-07", "2026-W38": "2026-09-14", "2026-W39": "2026-09-21", "2026-W40": "2026-09-28" };
  const dia = (w, k) => { const d = new Date(LUNES[w] + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const C = {
    dyn:   { plat: "Meta",   camp: "INVESTORS_MX_DYNAMIC-TOPLPS_090926", cid: "120251374772050275", grp: "ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO", sem: [2300, 2300, 2300, 2300], res: [6, 6, 5, 5] },
    esc:   { plat: "Meta",   camp: "INVESTORS_US/CA_ESCAPE_090926",       cid: "120251374799490275", grp: "EN_LLAMADA_ESCAPE",                   sem: [2800, 2800, 2800, 2800], res: [2, 2, 1, 2] },
    esc2:  { plat: "Meta",   camp: "INVESTORS_US/CA_ESCAPE_100626",       cid: "120247999032690275", grp: "EN_LLAMADA_PREMIUMLOTS",              sem: [2500, 2500, 2500, 2500], res: [1, 1, 1, 1] },
    form:  { plat: "Meta",   camp: "INVESTORS_EN_FORMULARIOMETA_TULUM_100626", cid: "120248002284280275", grp: "EN_LLAMADA_PREMIUMLOTS",       sem: [1500, 1500, 1500, 2500], res: [3, 3, 2, 1] },
    gmx:   { plat: "Google", camp: "INVESTORS - GOOGLE SEARCH -- MX",    cid: "23710551755", grp: "Inversión Tulum MX",                         sem: [900, 900, 900, 900],     res: [1, 1, 1, 0] },
    gus:   { plat: "Google", camp: "INVESTORS - GOOGLE SEARCH - US+CAN", cid: "23715389989", grp: "Tulum land US",                              sem: [3400, 3400, 3400, 3400], res: [2, 1, 1, 2] },
    dyn2:  { plat: "Meta",   camp: "INVESTORS_MX_DYNAMIC-TOPLPS_150726", cid: "120250010904330275", grp: "ES_LLAMADA_NUEVO6-ESCAPE_CENOTES",      sem: [2600, 2600, 2600, 2600], res: [3, 2, 2, 2] },
  };
  // Anuncios de cada campaña: parte de la inversión semanal (frac), si se lleva los resultados
  // de plataforma, URL de destino y ubicación (pp). Sin `ads` = un solo anuncio con todo.
  const L = "https://lotes.selvadentrotulum.com", SG = "https://seguridad.selvadentrotulum.com";
  // (en la cuenta real el creativo dinámico se llama igual en todos los conjuntos; aquí se
  // usan nombres que no chocan con los de MX_DYNAMIC_150726 para no mezclar sus leads)
  C.dyn.ads = [
    { grp: "ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO", name: "ES_LLAMADA_NUEVO6-PATRIMONIO_DYNAMIC", frac: 0.75, res: true, url: SG + "/seguridadpatrimonio/" },
    { grp: "ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC", name: "ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC", frac: 0.25, url: L + "/seguridad" }];
  C.esc.ads = [
    { grp: "EN_LLAMADA_ESCAPE", name: "EN_LLAMADA_ESCAPE-TY-COLD", frac: 0.6, res: true, url: L + "/en/escape" },
    { grp: "EN_LLAMADA_PREMIUMLOTS", name: "EN_LLAMADA_PREMIUMLOTS-5MIN", frac: 0.4, url: L + "/en/premium" }];
  C.esc2.ads = [
    { grp: "EN_LLAMADA_PREMIUMLOTS", name: "EN_LLAMADA_PREMIUMLOTS-5MIN", frac: 0.5, res: true, url: L + "/en/premium" },
    { grp: "EN_LLAMADA_PREMIUMLOTS", name: "EN_LLAMADA_PREMIUMLOTS-5MIN", frac: 0.1, url: L + "/en/premium", pp: "audience_network" },
    { grp: "EN_LLAMADA_ESCAPE", name: "EN_LLAMADA_ESCAPE-TY-COLD", frac: 0.24, url: L + "/en/escape" },
    { grp: "EN_LLAMADA_ESCAPE", name: "EN_LLAMADA_ESCAPE-DIANA", frac: 0.16, url: L + "/en/escape" }];
  C.form.ads = [{ grp: "EN_LLAMADA_PREMIUMLOTS", name: "EN_LLAMADA_ESCAPE-CENOTES", frac: 1, res: true, url: "http://fb.me/" }];
  C.dyn2.ads = [{ grp: "ES_LLAMADA_NUEVO6-ESCAPE_CENOTES", name: "ES_LLAMADA_NUEVO6-ESCAPE_CENOTES", frac: 1, res: true, url: L + "/escape" }];
  const weeks = Object.keys(LUNES);
  const adRows = [], spendRows = [];
  Object.entries(C).forEach(([k, c], ci) => {
    weeks.forEach((w, wi) => {
      (c.ads || [{ grp: c.grp, name: "Anuncio " + k.toUpperCase(), frac: 1, res: true, url: "" }]).forEach((a, ai) => {
        const sp = c.sem[wi] * a.frac;
        adRows.push({ d: dia(w, 2), plat: c.plat, camp: c.camp, grp: a.grp, id: "ad_" + k + "_" + ai, cid: c.cid, gid: "g_" + k + "_" + lqSlug(a.grp), name: a.name,
          pp: a.pp || (c.plat === "Meta" ? (wi % 2 ? "instagram" : "facebook") : "Google Ads"), status: k === "esc" ? "PAUSED" : "ACTIVE", link: "", url: a.url,
          tags: "utm_campaign={{campaign.name}}&utm_content={{adset.name}}", spend: sp, impr: sp * 9, clicks: Math.round(sp / 25), results: a.res ? c.res[wi] : 0 });
      });
      for (let k2 = 0; k2 < 7; k2++) spendRows.push({ d: dia(w, k2), src: c.plat === "Meta" ? "facebook" : "google", camp: c.camp, cid: c.cid, spend: c.sem[wi] / 7, clicks: 1, impr: 10, cur: "MXN" });
    });
  });
  // Gasto por keyword de Google (reparte la inversión semanal de cada campaña) y presupuesto
  // diario vigente por ID de campaña, como los devuelve la function `ads`.
  const KW = {
    gus: [["buying property in tulum mexico", 0.35], ["buying a home in tulum mexico", 0.3], ["tulum real estate", 0.2], ["land for sale tulum mexico", 0.15]],
    gmx: [["terrenos en tulum", 0.6], ["venta de lotes en tulum", 0.4]],
  };
  const kw = [];
  Object.entries(KW).forEach(([k, lista]) => weeks.forEach((w, wi) => lista.forEach(([t, f]) =>
    kw.push({ d: dia(w, 2), cid: C[k].cid, camp: C[k].camp, grp: C[k].grp, gid: "g_" + k + "_" + lqSlug(C[k].grp), kw: t, spend: C[k].sem[wi] * f, clicks: Math.round(C[k].sem[wi] * f / 40), conv: wi === 1 ? 1 : 0 }))));
  // La URL de destino de Meta solo llega con la decisión (no en el detalle de exploración).
  const url = {};
  adRows.forEach((r) => { if (r.plat === "Meta") { if (r.url) url[r.id] = r.url; delete r.url; } });
  // Datos de la DECISIÓN DE HOY, como los devuelve la acción `decision` con hoy = 2026-10-05:
  // 30 días cerrados = 05-sep → 04-oct (toda la data W37–W40), 7 días = W40, 7 anteriores = W39.
  const V = { hoy: "2026-10-05", ini: "2026-09-05", fin: "2026-10-04", ini7: "2026-09-28", fin7: "2026-10-04", iniP: "2026-09-21", finP: "2026-09-27" };
  const en = (d, a, b) => d >= a && d <= b;
  const META = { camps: {}, grps: {}, ads: [], an: [], dias: {}, faltan: [] }, GOO = { camps: {}, ads: [], kw: [], dias: {}, faltan: [] };
  const ESTADO = { dyn: "ACTIVE", esc: "ACTIVE", esc2: "ACTIVE", form: "ACTIVE", dyn2: "ACTIVE", gus: "PAUSED", gmx: "ENABLED" };
  const INICIO = { dyn: "2026-09-09", esc: "2026-09-09", esc2: "2026-06-10", form: "2026-06-10", dyn2: "2026-07-15" };
  const CB = { dyn: 360, esc: 400, esc2: 400, form: 100, dyn2: 360, gus: 480, gmx: 150 };
  //   ESCAPE_090926: conjunto nuevo el 28-sep → decidir hoy (28-sep + 7 = 05-oct)
  //   ESCAPE_100626: anuncio nuevo el 02-oct → preliminar hasta el 09-oct; además un anuncio rechazado → Atender hoy
  const CAMBIO = { esc: { fecha: "2026-09-28", que: "conjunto nuevo EN_LLAMADA_SEGURIDAD-TULUM" }, esc2: { fecha: "2026-10-02", que: "anuncio nuevo EN_LLAMADA_PREMIUMLOTS-5MIN en EN_LLAMADA_PREMIUMLOTS" } };
  const FQ = { "ad_esc2_0": 3.6, "ad_esc2_1": 3.6 };          // EN_LLAMADA_PREMIUMLOTS-5MIN cansado
  const RECHAZADO = { "ad_esc2_3": "DISAPPROVED" };            // EN_LLAMADA_ESCAPE-DIANA
  Object.entries(C).forEach(([k, c]) => {
    const meta = c.plat === "Meta", P = meta ? META : GOO;
    P.camps[c.cid] = meta ? { name: c.camp, estado: ESTADO[k], inicio: INICIO[k] || "", cb: CB[k], lb: null, cambio: CAMBIO[k] || null }
                          : { name: c.camp, estado: ESTADO[k], primario: ESTADO[k] === "PAUSED" ? "PAUSED" : "ELIGIBLE", motivos: "", cb: CB[k], inicio: "", cambio: null };
    const porAd = {};
    adRows.filter((r) => r.cid === c.cid).forEach((r) => {
      // (la fila de Audience Network es una ubicación del MISMO anuncio: se une por conjunto + nombre)
      const A = porAd[r.grp + "|" + r.name] = porAd[r.grp + "|" + r.name] || { cid: c.cid, gid: r.gid, grp: r.grp, id: r.id, name: r.name, estado: RECHAZADO[r.id] || (meta ? "ACTIVE" : "ENABLED"), aprobacion: meta ? undefined : "APPROVED",
        url: url[r.id] || r.url || "", sp: 0, res: 0, cl: 0, im: 0, fq: meta ? (FQ[r.id] || 1.8) : undefined, sp7: 0, res7: 0, spP: 0, resP: 0 };
      A.sp += r.spend; A.res += r.results; A.cl += r.clicks; A.im += r.impr;
      if (en(r.d, V.ini7, V.fin7)) { A.sp7 += r.spend; A.res7 += r.results; } else if (en(r.d, V.iniP, V.finP)) { A.spP += r.spend; A.resP += r.results; }
      if (meta && r.pp === "audience_network") { const b = P.an.find((x) => x.cid === c.cid && x.grp === r.grp) || (P.an.push({ cid: c.cid, gid: r.gid, grp: r.grp, sp: 0, res: 0 }), P.an[P.an.length - 1]); b.sp += r.spend; b.res += r.results; }
    });
    P.ads.push(...Object.values(porAd));
    spendRows.filter((r) => r.cid === c.cid && en(r.d, V.iniP, V.fin)).forEach((r) => { const D = P.dias[c.cid] = P.dias[c.cid] || {}; D[r.d] = { sp: r.spend, res: 0 }; });
  });
  //   Google MX: la plataforma reporta 2 conversiones el 03 y 04-oct y al CRM no llegó ninguna → medición rota
  GOO.dias[C.gmx.cid]["2026-10-03"].res = 1; GOO.dias[C.gmx.cid]["2026-10-04"].res = 1;
  const porKw = {};
  kw.forEach((r) => { const k = r.cid + "|" + r.kw;
    const b = porKw[k] = porKw[k] || { cid: r.cid, gid: r.gid, grp: r.grp, kw: r.kw, sp: 0, cl: 0, cv: 0, sp7: 0, cv7: 0, spP: 0, cvP: 0 };
    b.sp += r.spend; b.cl += r.clicks; b.cv += r.conv;
    if (en(r.d, V.ini7, V.fin7)) { b.sp7 += r.spend; b.cv7 += r.conv; } else if (en(r.d, V.iniP, V.finP)) { b.spP += r.spend; b.cvP += r.conv; } });
  GOO.kw = Object.values(porKw);
  const adExtra = { ventana: V, meta: META, google: GOO, faltan: [] };
  const rawLeads = [], opps = {};
  let n = 0;
  const lead = (w, k, o) => {
    n++;
    const id = "c" + n;
    const L = { id, n: "Lead " + n, em: "lead" + n + "@ejemplo.com", ph: String(9990000000 + n), c: dia(w, k) + "T16:00:00.000Z",
      src: o.src || "", u: n % 2 ? "u1" : "u2", tags: o.tags || [], cf: o.cf || {}, attr: o.attr || {} };
    rawLeads.push(L);
    if (o.etapa) {
      const st = sid(o.etapa);
      const enOpp = ["Seguimiento de OPP", "Carta Oferta", "Apartado", "WON"].includes(o.etapa);
      opps[id] = { o: enOpp ? 1 : 0, pr: 1, w: o.etapa === "WON" ? 1 : 0, v: 0, ov: 0, s: st, sc: 1, st: o.etapa === "WON" ? "won" : "open", ap: o.ap || { tot: 0, sh: 0, ns: 0 } };
    }
    return L;
  };
  // MX_DYNAMIC_090926: 8 leads de la landing de seguridad SIN UTM (atribución inferida) + 2 por ID
  const etDyn = ["Seguimiento de OPP", "Zoom realizado", "Contacto establecido", "1er toque", "Sin respuesta", "2ndo toque", "Nuevo lead (no contactado)", "Zoom agendado"];
  etDyn.forEach((e, i) => lead(weeks[i % 4], i % 5, { src: "landing-seguridad", attr: {}, etapa: e }));
  lead("2026-W38", 3, { src: "fb", attr: { camp: "Formulario seguridad", cid: C.dyn.cid, src: "facebook" }, etapa: "3er toque" });
  lead("2026-W40", 1, { src: "fb", attr: { camp: "Formulario seguridad", cid: C.dyn.cid, src: "facebook" }, etapa: "Descalificado" });
  // US/CA ESCAPE: 7 leads por utm_campaign, ninguno SQL+
  // …y la mayoría siguen en "Nuevo lead": nadie los ha trabajado (3 de 7 trabajados, 1 contactado)
  ["Nuevo lead (no contactado)", "1er toque", "Nuevo lead (no contactado)", "Contacto establecido", "Nuevo lead (no contactado)", "Sin respuesta", "Nuevo lead (no contactado)"]
    .forEach((e, i) => lead(weeks[(i + 3) % 4], 2, { src: "Meta ads", cf: { f_camp: C.esc.camp }, attr: { src: "facebook" }, etapa: e }));
  // EN_FORMULARIOMETA: 9 leads con el nombre del FORMULARIO en la atribución y el campaignId real
  const etForm = ["WON", "Seguimiento de OPP", "1er toque", "Sin respuesta", "1er toque", "Contacto establecido", "2ndo toque", "Sin respuesta", "1er toque"];
  const semForm = ["2026-W37", "2026-W37", "2026-W37", "2026-W38", "2026-W38", "2026-W38", "2026-W39", "2026-W39", "2026-W40"];
  etForm.forEach((e, i) => lead(semForm[i], 1 + (i % 3), { src: "Meta ads", attr: { camp: "Intelligent Investors", cid: C.form.cid, src: "facebook" }, etapa: e }));
  // Google MX: dos con utm_campaign = ID numérico de la campaña y uno con el alias nuevo → 1 SQL+
  lead(weeks[0], 4, { src: "google", cf: { f_camp: "23710551755" }, attr: { src: "google" }, etapa: "Interés identificado" });
  lead(weeks[1], 4, { src: "google", cf: { f_camp: "23710551755" }, attr: { src: "google" }, etapa: "1er toque" });
  lead(weeks[2], 4, { src: "google", cf: { f_camp: "INVESTORS-GOOGLE-SEARCH-MX" }, attr: { src: "google" }, etapa: "Contacto establecido" });
  // US/CA_ESCAPE_100626: 22 leads y 2 SQL+ → costo por SQL 5,000 (AMARILLO). Tasa SQL 9.1% (< 10%)
  // y CPL 455 MXN (> 400): "Optimizar calidad y costo". utm_content = nombre del conjunto:
  // EN_LLAMADA_PREMIUMLOTS 14 leads y los 2 SQL+; EN_LLAMADA_ESCAPE 8 leads y 0 SQL+.
  [...Array(2).fill("Interés identificado"), ...Array(8).fill("Contacto establecido"), ...Array(6).fill("Sin respuesta"), ...Array(6).fill("1er toque")]
    .forEach((e, i) => lead(weeks[(i + 3) % 4], 6, { src: "Meta ads", attr: { src: "facebook" }, etapa: e,
      cf: { f_camp: C.esc2.camp, f_cont: [2, 3, 12, 13, 18, 19, 20, 21].includes(i) ? "EN_LLAMADA_ESCAPE" : "EN_LLAMADA_PREMIUMLOTS" } }));
  // Google US+CAN: utm_campaign = id numérico de la campaña. 5 leads, todos trabajados, 3 con
  // conversación (60%) y 0 SQL+: no contestan bien, el problema es el lead → ROJO, pausar
  // utm_term = la keyword ({keyword} en el sufijo de la cuenta)
  ["Contacto establecido", "Nurturing", "Largo Plazo", "Sin respuesta", "1er toque"]
    .forEach((e, i) => lead(weeks[i % 4], 0, { src: "google", cf: { f_camp: "23715389989", f_term: KW.gus[i % 4][0] }, attr: { src: "google" }, etapa: e }));
  // MX_DYNAMIC_150726: 6 leads, 3 SQL+ (dos sin utm_campaign pero con el conjunto en utm_content)
  ["Carta Oferta", "Interés identificado", "Zoom agendado", "Zoom realizado", "1er toque", "Sin respuesta"]
    .forEach((e, i) => lead(weeks[(i + 3) % 4], 5, i < 2 ? { src: "fb", cf: { f_cont: C.dyn2.grp }, attr: { src: "facebook" }, etapa: e }
                                              : { src: "fb", cf: { f_camp: C.dyn2.camp }, attr: { src: "facebook" }, etapa: e }));
  // Sin campaña: 3 de Meta y 1 de Google, sin UTM ni ID
  lead("2026-W37", 2, { src: "fb", attr: { src: "facebook" }, etapa: "1er toque" });
  lead("2026-W38", 2, { src: "fb", attr: { src: "facebook" }, etapa: "Interés identificado" });
  lead("2026-W39", 2, { src: "ig", attr: { src: "instagram" } });
  lead("2026-W40", 2, { src: "google", attr: { src: "google" }, etapa: "Sin respuesta" });
  // Orgánico
  lead("2026-W39", 3, { src: "", attr: {}, etapa: "Contacto establecido" });
  lead("2026-W40", 3, { src: "", attr: {} });
  // Landing de seguridad el 08-oct (ya con UTMs reales en la vida real): SIN utm NO se infiere
  lead("2026-W40", 0, { src: "landing-seguridad", attr: {} }).c = "2026-10-08T17:00:00.000Z";
  // Leads de brokers (los sube el equipo comercial): NO deben cambiar ninguna cifra de arriba.
  //   Jennifer Guillaume: WON en el pipeline de brokers + tag broker-client, sin campaña ("Otra fuente")
  const jg = lead("2026-W38", 0, { src: "", attr: { src: "CRM UI" }, tags: ["stop auto", "broker-client", "sv_apartado", "cliente"] });
  jg.n = "Jennifer Guillaume";
  opps[jg.id] = { o: 1, pr: 1, w: 1, v: 1820471.7, ov: 1820471.7, s: "bk3", sc: 1, st: "won", ap: { tot: 0, sh: 0, ns: 0 }, bk: 1 };
  //   solo el tag, con oportunidad en el embudo normal
  lead("2026-W39", 1, { src: "fb", attr: { src: "facebook" }, tags: ["Broker-Client"], etapa: "Interés identificado" });
  //   solo el pipeline de brokers, sin tag
  const p2 = lead("2026-W40", 1, { src: "", attr: { src: "CRM UI" } });
  opps[p2.id] = { o: 0, pr: 1, w: 0, v: 0, ov: 0, s: "bk1", sc: 1, st: "open", ap: { tot: 0, sh: 0, ns: 0 }, bk: 1 };
  //   pipeline de RECLUTAMIENTO de brokers: este sí cuenta (no es un lead de broker)
  const rx = lead("2026-W40", 2, { src: "", attr: {} });
  opps[rx.id] = { o: 0, pr: 1, w: 0, v: 0, ov: 0, s: "bx0", sc: 1, st: "open", ap: { tot: 0, sh: 0, ns: 0 } };
  return { boot, rawLeads, spendRows, weeks, opps, adRows, adExtra };
}
function lqSlug(s) { return String(s || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24); }
module.exports = { fixture };
