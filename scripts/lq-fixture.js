// Datos sintéticos para probar Calidad de Leads sin CRM ni Windsor (2026-W37 a 2026-W40).
// Nombres de campaña e IDs como los de la cuenta; montos y leads INVENTADOS, redondos.
// Devuelve exactamente lo que recibe buildLqAgg(boot, rawLeads, spendRows, weeks,
// oppsByContact, adRows), en JSON plano para pasarlo a la página con page.evaluate.
//
// Resultado esperado del semáforo (meta 4,000 MXN por SQL, umbral 8,000 MXN; con menos de
// 8,000 invertidos el color se calcula igual pero la acción es "Mantener (muestra chica)"):
//   MX_DYNAMIC_090926   9,200 · 2 SQL+ (8 leads con atribución inferida) → AMARILLO optimizar
//   US/CA_ESCAPE       11,200 · 0 SQL+                                  → ROJO pausar
//   EN_FORMULARIOMETA   7,000 · 2 SQL+ (cruce por ID)  · alerta de CPL   → VERDE, mantener (muestra chica)
//   GOOGLE SEARCH MX    3,600 · 1 SQL+ (alias de UTM)                    → AMARILLO, mantener (muestra chica)
//   GOOGLE US+CAN       6,000 · 0 SQL+ (utm numérico)                    → EN EVALUACIÓN, mantener (muestra chica)
//   MX_DYNAMIC_150726  10,400 · 3 SQL+                                  → VERDE subir 20%
//   Total pagado       47,400 · 8 SQL+ → 5,925 MXN por SQL · 4 leads sin campaña
function fixture() {
  const ETAPAS = ["Nuevo lead (no contactado)", "1er toque", "2ndo toque", "3er toque", "Ultimátum", "Break up", "Sin respuesta",
    "Contacto establecido", "Interés identificado", "Zoom agendado", "Zoom no show / re agendar", "Zoom realizado", "Tour agendado",
    "Tour no show / re agendar", "Tour realizado", "Cotización enviada", "Seguimiento de OPP", "Carta Oferta", "Apartado", "WON",
    "Largo Plazo", "Rescate", "Corretaje", "Nurturing", "Descalificado", "Redes Sociales"];
  const stages = {};
  ETAPAS.forEach((s, i) => { stages["st" + i] = { p: "Seguimiento de ventas", s, i }; });
  const sid = (nombre) => "st" + ETAPAS.indexOf(nombre);
  const boot = {
    users: { u1: "Asesora Uno", u2: "Asesor Dos" },
    fields: [{ id: "f_camp", name: "utm_campaign" }, { id: "f_cont", name: "utm_content" }, { id: "f_cal", name: "Calificación del lead" }],
    oppFields: [], stages, windsor: true,
  };
  const LUNES = { "2026-W37": "2026-09-07", "2026-W38": "2026-09-14", "2026-W39": "2026-09-21", "2026-W40": "2026-09-28" };
  const dia = (w, k) => { const d = new Date(LUNES[w] + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const C = {
    dyn:   { plat: "Meta",   camp: "INVESTORS_MX_DYNAMIC-TOPLPS_090926", cid: "120251374772050275", grp: "ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO", sem: [2300, 2300, 2300, 2300], res: [6, 6, 5, 5] },
    esc:   { plat: "Meta",   camp: "INVESTORS_US/CA_ESCAPE_090926",       cid: "120251374799490275", grp: "EN_LLAMADA_ESCAPE",                   sem: [2800, 2800, 2800, 2800], res: [2, 2, 1, 2] },
    form:  { plat: "Meta",   camp: "INVESTORS_EN_FORMULARIOMETA_TULUM_100626", cid: "120248002284280275", grp: "EN_LLAMADA_PREMIUMLOTS",       sem: [1500, 1500, 1500, 2500], res: [3, 3, 2, 1] },
    gmx:   { plat: "Google", camp: "INVESTORS - GOOGLE SEARCH -- MX",    cid: "23710551755", grp: "Inversión Tulum MX",                         sem: [900, 900, 900, 900],     res: [1, 1, 1, 0] },
    gus:   { plat: "Google", camp: "INVESTORS - GOOGLE SEARCH - US+CAN", cid: "23715389989", grp: "Tulum land US",                              sem: [1500, 1500, 1500, 1500], res: [1, 0, 1, 1] },
    dyn2:  { plat: "Meta",   camp: "INVESTORS_MX_DYNAMIC-TOPLPS_150726", cid: "120250010904330275", grp: "ES_LLAMADA_NUEVO6-ESCAPE_CENOTES",      sem: [2600, 2600, 2600, 2600], res: [3, 2, 2, 2] },
  };
  const weeks = Object.keys(LUNES);
  const adRows = [], spendRows = [];
  Object.entries(C).forEach(([k, c], ci) => {
    weeks.forEach((w, wi) => {
      adRows.push({ d: dia(w, 2), plat: c.plat, camp: c.camp, grp: c.grp, id: "ad_" + k, cid: c.cid, gid: "g_" + k, name: "Anuncio " + k.toUpperCase(),
        pp: c.plat === "Meta" ? (wi % 2 ? "instagram" : "facebook") : "Google Ads", status: k === "esc" ? "PAUSED" : "ACTIVE", link: "",
        tags: "utm_campaign={{campaign.name}}", spend: c.sem[wi], impr: c.sem[wi] * 9, clicks: Math.round(c.sem[wi] / 25), results: c.res[wi] });
      for (let k2 = 0; k2 < 7; k2++) spendRows.push({ d: dia(w, k2), src: c.plat === "Meta" ? "facebook" : "google_ads", camp: c.camp, spend: c.sem[wi] / 7, clicks: 1, impr: 10, cur: "MXN" });
    });
  });
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
  ["Sin respuesta", "1er toque", "Break up", "Contacto establecido", "Descalificado", "Ultimátum", "Nuevo lead (no contactado)"]
    .forEach((e, i) => lead(weeks[(i + 3) % 4], 2, { src: "Meta ads", cf: { f_camp: C.esc.camp }, attr: { src: "facebook" }, etapa: e }));
  // EN_FORMULARIOMETA: 9 leads con el nombre del FORMULARIO en la atribución y el campaignId real
  const etForm = ["WON", "Seguimiento de OPP", "1er toque", "Sin respuesta", "1er toque", "Contacto establecido", "2ndo toque", "Sin respuesta", "1er toque"];
  const semForm = ["2026-W37", "2026-W37", "2026-W37", "2026-W38", "2026-W38", "2026-W38", "2026-W39", "2026-W39", "2026-W40"];
  etForm.forEach((e, i) => lead(semForm[i], 1 + (i % 3), { src: "Meta ads", attr: { camp: "Intelligent Investors", cid: C.form.cid, src: "facebook" }, etapa: e }));
  // Google MX: utm_campaign con guiones (alias) → 1 SQL+
  ["Interés identificado", "1er toque", "Sin respuesta", "Contacto establecido"]
    .forEach((e, i) => lead(weeks[i], 4, { src: "google", cf: { f_camp: "INVESTORS-GOOGLE-SEARCH-MX" }, attr: { src: "google" }, etapa: e }));
  // Google US+CAN: utm_campaign = id numérico de la campaña → 0 SQL+
  ["1er toque", "Sin respuesta", "Nuevo lead (no contactado)"]
    .forEach((e, i) => lead(weeks[i + 1], 0, { src: "google", cf: { f_camp: "23715389989" }, attr: { src: "google" }, etapa: e }));
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
  return { boot, rawLeads, spendRows, weeks, opps, adRows };
}
module.exports = { fixture };
