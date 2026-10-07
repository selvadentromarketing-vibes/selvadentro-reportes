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
  // Telefonía (oct-2026): 6 intentos manuales con todos los desenlaces y formas de duración.
  tel: [
    msg("w", T0 + 1 * 60e3, { messageType: "TYPE_EMAIL" }),                                         // 1er toque: correo
    msg("a", T0 + 10 * 60e3, { messageType: "TYPE_CALL", status: "no-answer" }),                      // sin duración: 0 s por no conectar
    msg("b", T0 + 2 * H, { messageType: "TYPE_CALL", status: "completed", meta: { call: { duration: "2:05" } } }),   // 125 s en mm:ss
    msg("c", T0 + 3 * H, { messageType: "TYPE_CALL", status: "completed", callDuration: 0 }),         // 0 explícito: legible
    msg("d", T0 + 4 * H, { messageType: "TYPE_CALL", status: "completed", meta: { call: { recordingUrl: "x" } } }),  // conectó, sin duración
    msg("e", T0 + 5 * H, { messageType: "TYPE_CALL", status: "busy" }),                                // falla de línea
    msg("f", T0 + 30 * H, { messageType: "TYPE_CALL", status: "", meta: { call: { status: "canceled" } } }),        // falla de línea por meta.call.status
  ],
  // Llamada automática con contacto (7-oct-2026): el workflow marca a los 40 s y la llamada
  // dura 2 min; el asesor escribe a mano a los 10 min. Y una automática de 20 s, sin contacto.
  auto90: [msg("a", T0 + 40e3, { messageType: "TYPE_CALL", status: "completed", source: "workflow", userId: null, callDuration: 120 }), msg("b", T0 + 10 * 60e3)],
  auto20: [msg("a", T0 + 40e3, { messageType: "TYPE_CALL", status: "completed", source: "workflow", userId: null, callDuration: 20 }), msg("b", T0 + 10 * 60e3)],
  // Origen de cada llamada: del asesor, automática (workflow / marcador de campaña) o entrante.
  telOrg: [
    msg("a", T0 + 1 * H, { messageType: "TYPE_CALL", status: "busy" }),                                              // asesor: falla de línea
    msg("b", T0 + 2 * H, { messageType: "TYPE_CALL", status: "failed", source: "workflow", userId: null }),          // workflow: falla de línea
    msg("c", T0 + 3 * H, { messageType: "TYPE_CAMPAIGN_CALL", status: "completed", callDuration: 100 }),             // marcador de campaña, aunque traiga usuario
    msg("d", T0 + 4 * H, { messageType: "TYPE_CALL", status: "completed", direction: "inbound", userId: null, source: "", callDuration: 120 }),  // llamó el lead
  ],
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
  if (path.startsWith("/calendars/?")) return { calendars: [{ id: "calZ", name: "Zoom" }, { id: "calT", name: "Tour" }, { id: "calX", name: "Roto" }] };
  if ((m = path.match(/^\/calendars\/events\?.*calendarId=([^&]+).*startTime=(\d+)&endTime=(\d+)/))) {
    if (m[1] === "calX") throw Object.assign(new Error("Forbidden"), { status: 403 });
    const ev = { calZ: [{ id: "e1", contactId: "c1", assignedUserId: "u1", appointmentStatus: "confirmed", startTime: iso(T0 + 2 * H) }],
                 calT: [{ id: "e2", contactId: "c2", assignedUserId: "", appointmentStatus: "showed", startTime: "2026-10-06T11:00:00-05:00" }, { id: "e1", contactId: "c1", startTime: iso(T0 + 2 * H) }] }[m[1]] || [];
    return { events: ev };
  }
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
  const tl = await call({ action: "sweep", ids: ["tel"] });
  const T = tl.d.results && tl.d.results[0];
  ok(T && T.foMch === "email", "canal del primer toque manual", T && T.foMch);
  ok(T && T.cl.n === 6 && T.cl.ok === 3 && T.cl.na === 1 && T.cl.linea === 2 && T.cl.otro === 0 && T.cl.dn === 1, "intentos de llamada por desenlace: 3 conectadas, 1 sin respuesta, 2 fallas de línea, 1 conectada sin duración", T && T.cl);
  ok(T && T.cl.t.length === 6 && T.cl.t[0] === T0 + 10 * 60e3, "momentos de cada intento, el primero a los 10 min", T && T.cl.t.map(iso));
  ok(T && T.tel.tot === 6 && T.tel.dExp === 2 && T.tel.d0 === 3 && T.tel.dNo === 1 && T.tel.c90 === 1, "duración: 2 la traen (una es 0), 3 no conectaron (0 s), 1 conectó sin duración; 1 de ≥90 s", T && T.tel);
  ok(T && T.tel.noSt.completed === 1 && T.tel.llaves.includes("meta.call.recordingUrl"), "la llamada sin duración se diagnostica por status y por las llaves que sí trae", T && { noSt: T.tel.noSt, llaves: T.tel.llaves });
  ok(T && T.deliv.linea === 2 && T.deliv.failed === 1 && T.deliv.read === 3, "las fallas de línea van aparte en la actividad efectiva", T && T.deliv);
  ok(T && T.fe === T0 + 2 * H, "la llamada de 2:05 es contacto efectivo (R-06)", T && T.fe && iso(T.fe));
  const au = await call({ action: "sweep", ids: ["auto90", "auto20"] });
  const A90 = au.d.results.find((r) => r.id === "auto90"), A20 = au.d.results.find((r) => r.id === "auto20");
  ok(A90.foA === T0 + 40e3 && A90.nA === 1 && A90.fe === T0 + 40e3 && A90.foM === T0 + 10 * 60e3 && A90.cl.n === 0,
    "llamada automática de 2 min: contacto a su hora real (40 s) y contacto efectivo; no es intento del asesor", { foA: A90.foA && iso(A90.foA), fe: A90.fe && iso(A90.fe), foM: iso(A90.foM), cl: A90.cl.n });
  ok(A20.foA === null && A20.nA === 0 && A20.fe === null, "llamada automática de 20 s: no es contacto", { foA: A20.foA, fe: A20.fe });
  const ci = await call({ action: "citas", start: iso(T0 - 24 * H), end: iso(T0 + 7 * 24 * H) });
  ok(ci.status === 200 && ci.d.citas.length === 2 && ci.d.calendarios === 3 && ci.d.errores.join() === "Roto"
    && ci.d.citas.find((c) => c.id === "e1").st === "confirmed" && ci.d.citas.find((c) => c.id === "e2").t === Date.parse("2026-10-06T16:00:00Z"),
    "citas por fecha de la cita, de todos los calendarios, sin duplicados; un calendario que falla se reporta", ci.d);
  const og = await call({ action: "sweep", ids: ["telOrg"] });
  const P = og.d.results && og.d.results[0] && og.d.results[0].tel.por;
  ok(P && P.manual.tot === 1 && P.manual.linea === 1 && P.auto.tot === 2 && P.auto.linea === 1 && P.auto.ok === 1 && P.auto.c90 === 1 && P.entrante.tot === 1 && P.entrante.c90 === 1,
    "origen de cada llamada: 1 del asesor (falla de línea), 2 automáticas (workflow y marcador de campaña), 1 entrante", P);
  ok(og.d.results[0].cl.n === 1, "solo la llamada del asesor entra en sus intentos", og.d.results[0].cl);
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
