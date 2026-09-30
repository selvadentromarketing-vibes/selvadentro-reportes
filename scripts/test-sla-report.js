// Prueba del backend de Desempeño (netlify/functions/sla-report.js) con GoHighLevel
// SIMULADO: no llama al CRM, no necesita llaves reales ni red.
//
// Cubre lo que la spec v1.1 (Lead Filters, 1-oct-2026) pone del lado del servidor:
//   · R-01 corte: un lead real descartado se mide hasta su entrada a Descalificado; el
//     mensaje posterior no cuenta (caso de aceptación 2).
//   · R-05 evidencia anterior a "Sin llamada - fecha de inicio": intentos no conectados y
//     sus días, mensaje entrante, llamada ≥90 s, e intentos después del retiro.
//   · R-06 contacto efectivo = respuesta del lead o llamada ≥90 s; un toque manual solo no.
//   · Campos personalizados de oportunidad y la acción `tagged`.
//
// Correr: node scripts/test-sla-report.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";

const S = require("../netlify/functions/lib/shared.js");
const H = 3600e3, T0 = Date.parse("2026-10-05T15:00:00Z");     // lunes 10:00 hora Tulum
const iso = (t) => new Date(t).toISOString();
const msg = (id, t, o) => Object.assign({ id, dateAdded: iso(t), direction: "outbound", messageType: "TYPE_WHATSAPP", source: "app", userId: "u1", status: "delivered" }, o);

// Conversaciones simuladas por contacto
const CONV = {
  // Caso 2: 3 toques manuales, descalificado a las T0+30h, y un mensaje más a las T0+40h.
  real: [msg("a", T0 + 1 * H), msg("b", T0 + 10 * H, { messageType: "TYPE_CALL", status: "no-answer" }), msg("c", T0 + 20 * H, { messageType: "TYPE_EMAIL" }), msg("d", T0 + 40 * H)],
  // R-06: el asesor escribió, el lead nunca contestó, pero hubo una llamada de 120 s.
  llamada90: [msg("a", T0 + 1 * H), msg("b", T0 + 2 * H, { messageType: "TYPE_CALL", status: "completed", meta: { call: { duration: 120 } } })],
  // R-06: solo toques manuales, sin respuesta ni llamada larga → sin contacto efectivo.
  soloToques: [msg("a", T0 + 1 * H), msg("b", T0 + 2 * H, { messageType: "TYPE_CALL", status: "no-answer", meta: { call: { duration: 20 } } })],
  // R-05 número inválido: 2 intentos fallidos en 2 días antes de la etiqueta (T0+50h), uno después del retiro.
  nciOk: [msg("a", T0 + 1 * H, { messageType: "TYPE_CALL", status: "no-answer" }), msg("b", T0 + 26 * H, { messageType: "TYPE_CALL", status: "busy" }), msg("c", T0 + 80 * H, { messageType: "TYPE_CALL", status: "no-answer" })],
  // Caso 8: un solo intento fallido.
  nciMal: [msg("a", T0 + 1 * H, { messageType: "TYPE_CALL", status: "no-answer" })],
  // Caso 7: solo mensaje con un WhatsApp entrante previo del lead.
  ncmOk: [msg("a", T0 + 1 * H), msg("b", T0 + 3 * H, { direction: "inbound", userId: null, source: "" })],
};
const TAREAS = { real: [{ dueDate: iso(T0 + 20 * H), completed: true, dateUpdated: iso(T0 + 19 * H) }, { dueDate: iso(T0 + 50 * H), completed: false }] };
const CITAS = { real: [{ startTime: iso(T0 + 45 * H), appointmentStatus: "confirmed" }] };
let tagFiltro = null;
S.ghlFetch = async (path, opts) => {
  let m;
  if ((m = path.match(/^\/conversations\/search\?.*contactId=([^&]+)/))) return { conversations: CONV[decodeURIComponent(m[1])] ? [{ id: "cv-" + m[1] }] : [] };
  if ((m = path.match(/^\/conversations\/cv-([^/]+)\/messages/))) return { messages: { messages: CONV[m[1]] || [], nextPage: false } };
  if ((m = path.match(/^\/contacts\/([^/]+)\/tasks/))) return { tasks: TAREAS[m[1]] || [] };
  if ((m = path.match(/^\/contacts\/([^/]+)\/appointments/))) return { events: CITAS[m[1]] || [] };
  if (path.startsWith("/opportunities/search")) return { opportunities: [{ id: "o1", contactId: "real", assignedTo: "u1", status: "open", pipelineId: "p1", pipelineStageId: "s9", createdAt: iso(T0), lastStageChangeAt: iso(T0 + 30 * H), customFields: [{ id: "fCausa", fieldValueString: "No alineado" }, { id: "fFecha", fieldValue: iso(T0 + 30 * H) }, { id: "fMulti", fieldValueArray: ["a", "b"] }] }], meta: {} };
  if (path === "/contacts/search") {
    const f = opts.body.filters[0]; tagFiltro = f.operator;
    if (f.operator === "contains") { const e = new Error("Bad Request"); e.status = 422; throw e; }   // obliga al respaldo
    return { contacts: [{ id: "rev1", contactName: "Lead Revertido", dateAdded: iso(T0 - 30 * 24 * H), tags: ["descalificacion injustificada"], assignedTo: "cesar", customFields: [] }] };
  }
  if (path.startsWith("/users/")) return { users: [{ id: "u1", name: "Daniela Arana" }] };
  if (path.includes("customFields?model=opportunity")) return { customFields: [{ id: "fCausa", name: "Causa de descalificación", model: "opportunity" }] };
  if (path.includes("customFields")) return { customFields: [{ id: "fNc", name: "Sin llamada - fecha de inicio" }] };
  if (path.startsWith("/opportunities/pipelines")) return { pipelines: [] };
  throw Object.assign(new Error("ruta no simulada: " + path), { status: 404 });
};
const { handler } = require("../netlify/functions/sla-report.js");
const token = S.signToken({ email: "prueba@selvadentrotulum.com", role: "admin", channels: [] });
const call = async (body) => { const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) }); return { status: r.statusCode, d: JSON.parse(r.body) }; };

(async () => {
  const fallas = [];
  const ok = (cond, txt, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + txt + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!cond) fallas.push(txt); };
  const sw = await call({ action: "sweep", ids: ["real", "llamada90", "soloToques", "nciOk", "nciMal", "ncmOk"],
    opts: { real: { cut: T0 + 30 * H }, nciOk: { ncD: T0 + 50 * H, ncR: T0 + 70 * H }, nciMal: { ncD: T0 + 50 * H }, ncmOk: { ncD: T0 + 50 * H } } });
  ok(sw.status === 200, "sweep responde 200", sw.status);
  const R = {}; (sw.d.results || []).forEach((r) => { R[r.id] = r; });
  const r = R.real;
  ok(r && r.days.length === 2 && r.lmM === T0 + 20 * H && r.cortados === 1, "caso 2: los 3 toques cuentan y el mensaje posterior a la descalificación no", r && { dias: r.days, lmM: r.lmM && iso(r.lmM), cortados: r.cortados });
  ok(r && r.calls === 1 && r.chans.includes("email"), "caso 2: la llamada y el email previos siguen contando", r && { calls: r.calls, chans: r.chans });
  ok(r && r.tk.prog === 1 && r.ap.tot === 0, "corte: tareas con fecha y citas posteriores a la descalificación no cuentan", r && { tareas: r.tk.prog, citas: r.ap.tot });
  ok(R.llamada90 && R.llamada90.fe === T0 + 2 * H && !R.llamada90.fi, "R-06: una llamada de ≥90 s es contacto efectivo aunque el lead no escriba", R.llamada90 && { fe: R.llamada90.fe && iso(R.llamada90.fe), fi: R.llamada90.fi });
  ok(R.soloToques && R.soloToques.fe === null, "R-06: toques manuales y una llamada de 20 s no son contacto efectivo", R.soloToques && R.soloToques.fe);
  ok(R.nciOk && R.nciOk.nc.calls === 2 && R.nciOk.nc.dias === 2 && R.nciOk.nc.post === 1, "R-05: número inválido con 2 intentos en 2 días antes de la etiqueta, 1 después del retiro", R.nciOk && R.nciOk.nc);
  ok(R.nciMal && R.nciMal.nc.calls === 1 && R.nciMal.nc.dias === 1, "caso 8: número inválido con un solo intento fallido", R.nciMal && R.nciMal.nc);
  ok(R.ncmOk && R.ncmOk.nc.inb === true, "caso 7: solo mensaje con un WhatsApp entrante previo", R.ncmOk && R.ncmOk.nc);
  ok(!("nc" in R.llamada90), "sin opciones, el barrido no agrega evidencia");
  const op = await call({ action: "opps" });
  const o = op.d.opps && op.d.opps[0];
  ok(o && o.cf.fCausa === "No alineado" && o.cf.fFecha === iso(T0 + 30 * H) && o.cf.fMulti === "a, b" && o.scE === iso(T0 + 30 * H), "opps trae los campos personalizados y la fecha de cambio de etapa", o && { cf: o.cf, scE: o.scE });
  const us = await call({ action: "users" });
  ok(us.d.oppFields && us.d.oppFields[0] && us.d.oppFields[0].name === "Causa de descalificación" && us.d.fields[0].name === "Sin llamada - fecha de inicio", "users trae el catálogo de campos de oportunidad y de contacto", { opp: us.d.oppFields, ct: us.d.fields });
  const tg = await call({ action: "tagged", tag: "descalificacion injustificada" });
  ok(tg.status === 200 && tg.d.contacts.length === 1 && tg.d.filtro === "eq" && tagFiltro === "eq", "tagged cae al filtro de valor simple si el de arreglo se rechaza", { status: tg.status, filtro: tg.d.filtro });
  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas del backend pasaron");
  process.exit(fallas.length ? 1 : 0);
})().catch((e) => { console.error("FALLO DE LA PRUEBA:", e); process.exit(2); });
