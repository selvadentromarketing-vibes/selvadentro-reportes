// Prueba del backend del reporte de Primer Contacto (netlify/functions/pc-report.js) con
// GoHighLevel SIMULADO: no llama al CRM, no necesita llaves reales ni red. Datos sintéticos.
//
// Cubre:
//   · conversaciones: orden por último mensaje manual, corte en `desde`, cursor entre
//     páginas, respaldo al orden por último mensaje si el API rechaza el manual, y aviso
//     cuando el API no devuelve las fechas en orden.
//   · eventos: origen (manual / automática / entrante) con la regla de Desempeño, Instagram y
//     Facebook como canal del ejecutivo, llamada del marcador con el usuario del ejecutivo,
//     ventana [desde, hasta], paginación de mensajes que se detiene al pasar `desde`.
//   · contactos con tareas abiertas, oportunidades por contacto y citas con su creador.
//   · permisos: pc_view entra; un canal ajeno no.
//
// Correr: node scripts/test-pc-report.js   (sale con código 1 si algo falla)
process.env.SUPABASE_URL = "https://prueba.invalid";
process.env.SUPABASE_ANON_KEY = "x";
process.env.KV_API_SECRET = "x";
process.env.SESSION_SECRET = "secreto-de-prueba";
process.env.GHL_API_KEY = "pit-prueba";
process.env.GHL_LOCATION_ID = "loc1";

const S = require("../netlify/functions/lib/shared.js");
const M = 60e3, H = 3600e3, T0 = Date.parse("2026-10-26T15:00:00Z");   // lunes 26-oct, 10:00 Tulum
const iso = (t) => new Date(t).toISOString();

// 650 conversaciones: la i-ésima tuvo su último mensaje manual en T0 + (650 − i) min.
const CONVS = Array.from({ length: 650 }, (_, i) => ({ id: "conv" + String(i).padStart(4, "0"), contactId: "ct" + String(i).padStart(4, "0"),
  lastManualMessageDate: T0 + (650 - i) * M, lastMessageDate: T0 + (650 - i) * M + 5 * M, sort: [T0 + (650 - i) * M] }));
let rechazarManual = false, desordenar = false, pedidas = [];
const msg = (t, o) => Object.assign({ dateAdded: iso(t), direction: "outbound", messageType: "TYPE_CALL", source: "app", userId: "epc1", status: "completed" }, o);
// Conversación con 130 mensajes en la ventana (dos páginas) y más viejos que no se deben pedir.
const LARGA = [];
for (let i = 0; i < 260; i++) LARGA.push(msg(T0 + 200 * M - i * M * 2, { messageType: "TYPE_WHATSAPP", status: "delivered" }));
const MSGS = {
  convA: [
    msg(T0 + 30e3, { source: "workflow", callDuration: 40, status: "no-answer" }),                       // marcador con el usuario del ejecutivo
    msg(T0 + 60e3, { callDuration: 75 }),                                                                 // llamada del ejecutivo, 75 s
    msg(T0 + 2 * M, { messageType: "TYPE_INSTAGRAM", status: "delivered" }),                              // Instagram del ejecutivo
    msg(T0 + 3 * M, { messageType: "TYPE_EMAIL", source: "bulk_actions", status: "delivered" }),          // envío masivo
    msg(T0 + 4 * M, { messageType: "TYPE_WHATSAPP", direction: "inbound", userId: null, source: "" }),    // el prospecto responde
    msg(T0 + 4 * M + 30e3, { messageType: "TYPE_WHATSAPP", direction: "inbound", userId: null, source: "",
      body: "Hola! Solicité lotes + precios + plan de pago. ¿Me compartes disponibilidad y próximos pasos?" }),   // botón de la página de gracias
    msg(T0 + 5 * M, { messageType: "TYPE_ACTIVITY_OPPORTUNITY" }),                                        // actividad: no es toque
    msg(T0 + 6 * M, { messageType: "TYPE_FORM_SUBMISSION", direction: "inbound" }),                       // formulario: no es toque
    msg(T0 + 7 * M, { messageType: "TYPE_CALL", status: "busy", userId: "ase1" }),                        // asesor, falla de línea
    msg(T0 - 2 * H, { messageType: "TYPE_SMS" }),                                                         // antes de `desde`
    msg(T0 + 10 * 24 * H, { messageType: "TYPE_SMS" }),                                                   // después de `hasta`
  ],
  convL: LARGA,
};
S.ghlFetch = async (path, opts) => {
  let m;
  pedidas.push(path);
  if (path === "/contacts/search") {
    // Leads que regresan: actualizados en el rango; el backend filtra por la fecha del último formulario.
    const vieja = iso(T0 - 300 * 24 * H);
    return { contacts: [
      { id: "regresa01", contactName: "Regresa", dateAdded: vieja, customFields: [{ id: "fUlt", value: iso(T0 + 2 * H) }] },
      { id: "nuevo0001", contactName: "Nuevo del rango", dateAdded: iso(T0 + H), customFields: [{ id: "fUlt", value: iso(T0 + H) }] },
      { id: "solotag01", contactName: "Solo le cambiaron una etiqueta", dateAdded: vieja, customFields: [] },
      { id: "regresaV1", contactName: "Regresó hace meses", dateAdded: vieja, customFields: [{ id: "fUlt", value: iso(T0 - 60 * 24 * H) }] },
    ] };
  }
  if (path.startsWith("/conversations/search") && /contactId=/.test(path)) {
    m = path.match(/contactId=([^&]+)/);
    return { conversations: decodeURIComponent(m[1]) === "ctAlfa01" ? [{ id: "convA", contactId: "ctAlfa01" }] : [] };
  }
  if (path.startsWith("/conversations/search")) {
    const q = new URLSearchParams(path.split("?")[1]);
    if (q.get("sortBy") === "last_manual_message_date" && rechazarManual) throw Object.assign(new Error("GHL 422"), { status: 422 });
    let lista = CONVS.slice();
    if (q.get("sortBy") === "last_message_date") lista = lista.map((c) => ({ ...c, lastManualMessageDate: undefined, sort: [c.lastMessageDate] }));
    if (desordenar) lista = [lista[5], lista[0], ...lista.slice(6)];
    const after = Number(q.get("startAfterDate")) || null;
    const i0 = after ? lista.findIndex((c) => c.sort[0] < after) : 0;
    return { conversations: lista.slice(i0, i0 + 100) };
  }
  if ((m = path.match(/^\/conversations\/([^/]+)\/messages\?(.*)$/))) {
    const all = MSGS[decodeURIComponent(m[1])] || [];
    const q = new URLSearchParams(m[2]);
    const from = q.get("lastMessageId") ? Number(q.get("lastMessageId")) : 0;
    const page = all.slice(from, from + 100);
    const next = from + 100 < all.length;
    return { messages: { messages: page, nextPage: next, lastMessageId: next ? String(from + 100) : null } };
  }
  if ((m = path.match(/^\/contacts\/([^/?]+)\/tasks/))) {
    const hoy = Date.now();   // "vencida" es contra el reloj real, no contra la fecha de los datos
    return { tasks: [{ dueDate: iso(hoy + 30 * 24 * H), completed: false }, { dueDate: iso(hoy - 24 * H), completed: false }, { dueDate: iso(hoy + 24 * H), completed: true }, { completed: false }] };
  }
  if ((m = path.match(/^\/contacts\/([^/?]+)$/))) {
    const id = decodeURIComponent(m[1]);
    if (id === "ctRoto01") throw Object.assign(new Error("GHL 404"), { status: 404 });
    return { contact: { id, contactName: "Contacto sintético", dateAdded: iso(T0 - 90 * 24 * H), assignedTo: "ase1", tags: ["cartera vencida"], customFields: [{ id: "fMot", value: "Invertir" }] } };
  }
  if (path.startsWith("/opportunities/search")) {
    const ct = new URLSearchParams(path.split("?")[1]).get("contact_id");
    return { opportunities: [{ id: "op-" + ct, contactId: ct, assignedTo: "ase1", status: "open", pipelineId: "pV", pipelineStageId: "sCE", createdAt: iso(T0 - 60 * 24 * H), lastStageChangeAt: iso(T0 + H), customFields: [{ id: "fLP", fieldValueString: "Presupuesto" }] }] };
  }
  if (path.startsWith("/calendars/?")) return { calendars: [{ id: "calZ", name: "Zoom" }] };
  if (path.startsWith("/calendars/events")) {
    return { events: [{ id: "e1", contactId: "ctAlfa01", assignedUserId: "ase1", appointmentStatus: "confirmed", startTime: iso(T0 + 26 * H), dateAdded: iso(T0 + 8 * M), createdBy: { source: "app", userId: "epc1" } },
                      { id: "e2", contactId: "ctBeta01", assignedUserId: "ase1", appointmentStatus: "showed", startTime: iso(T0 + 30 * H), dateAdded: iso(T0 + 9 * M) }] };
  }
  throw Object.assign(new Error("ruta no simulada: " + path), { status: 404 });
};
const { handler } = require("../netlify/functions/pc-report.js");
const tok = (channels, role) => S.signToken({ email: "prueba@selvadentrotulum.com", role: role || "user", channels });
const call = async (body, t) => { const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer " + (t || tok([], "admin")) }, body: JSON.stringify(body) }); return { status: r.statusCode, d: JSON.parse(r.body) }; };

(async () => {
  const fallas = [];
  const ok = (cond, txt, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + txt + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!cond) fallas.push(txt); };

  // Conversaciones con actividad manual desde T0+30 min: las i ≤ 620. Cinco páginas por llamada
  // (los 10 s de una Netlify Function): 500 en la primera, el resto con el cursor.
  const c1 = await call({ action: "conversaciones", desde: T0 + 30 * M });
  ok(c1.status === 200 && c1.d.convs.length === 500 && c1.d.cursor === T0 + 151 * M && c1.d.modo === "manual" && c1.d.ordenOk && c1.d.paginas === 5,
    "conversaciones: 500 en la primera llamada (5 páginas) y un cursor para seguir", { n: c1.d.convs && c1.d.convs.length, cursor: c1.d.cursor, modo: c1.d.modo, paginas: c1.d.paginas });
  const c1b = await call({ action: "conversaciones", desde: T0 + 30 * M, cursor: c1.d.cursor });
  ok(c1b.status === 200 && c1b.d.convs.length === 121 && c1b.d.cursor === null && c1b.d.convs[0].ct === "ct0500" && c1b.d.convs[120].k === T0 + 30 * M,
    "con el cursor llegan las 121 restantes, cada una con su contacto y la fecha de su último toque manual; sin cursor pendiente", { n: c1b.d.convs.length, cursor: c1b.d.cursor, ult: c1b.d.convs[120] });
  rechazarManual = true;
  const c2 = await call({ action: "conversaciones", desde: T0 + 30 * M });
  ok(c2.status === 200 && c2.d.modo === "todos" && c2.d.convs.length === 500 && c2.d.convs[0].k === T0 + 655 * M && /422/.test(c2.d.cambio || ""),
    "si el API rechaza el orden manual, cae al del último mensaje (más amplio, no pierde nada) y lo declara", { modo: c2.d.modo, n: c2.d.convs.length, cambio: c2.d.cambio });
  rechazarManual = false; desordenar = true;
  const c3 = await call({ action: "conversaciones", desde: T0 + 30 * M });
  ok(c3.status === 200 && c3.d.ordenOk === false, "fechas fuera de orden: se avisa que el corte no es confiable", { ordenOk: c3.d.ordenOk });
  desordenar = false;

  // Eventos de una conversación por id y de un lead por contacto.
  pedidas = [];
  const e1 = await call({ action: "eventos", convs: [{ id: "convA", ct: "ctAlfa01" }], desde: T0 - H, hasta: T0 + 7 * 24 * H });
  const E = e1.d.res && e1.d.res[0];
  ok(e1.status === 200 && E && E.ct === "ctAlfa01" && !E.err, "eventos responde por contacto", E && { ct: E.ct, err: E.err });
  const porT = (t) => E.ev.find((x) => x[0] === t);
  ok(E.ev.length === 7, "7 eventos: sin actividad, sin formulario y sin lo que cae fuera de la ventana", E.ev.map((x) => x.slice(0, 3)));
  ok(porT(T0 + 4 * M + 30e3)[2] === "p", "el mensaje predeterminado del botón de WhatsApp de la página de gracias es \"p\": no es respuesta", porT(T0 + 4 * M + 30e3));
  ok(JSON.stringify(porT(T0 + 30e3)) === JSON.stringify([T0 + 30e3, "call", "a", "epc1", "na", 40]), "la llamada del marcador es automática aunque traiga el usuario del ejecutivo", porT(T0 + 30e3));
  ok(JSON.stringify(porT(T0 + 60e3)) === JSON.stringify([T0 + 60e3, "call", "m", "epc1", "ok", 75]), "llamada del ejecutivo: manual, conectada, 75 s", porT(T0 + 60e3));
  ok(JSON.stringify(porT(T0 + 2 * M)) === JSON.stringify([T0 + 2 * M, "social", "m", "epc1"]), "Instagram del ejecutivo cuenta como mensaje manual (manual 7.3)", porT(T0 + 2 * M));
  ok(porT(T0 + 3 * M)[2] === "a" && porT(T0 + 4 * M)[2] === "i", "envío masivo = automático; respuesta del prospecto = entrante", [porT(T0 + 3 * M), porT(T0 + 4 * M)]);
  ok(JSON.stringify(porT(T0 + 7 * M)) === JSON.stringify([T0 + 7 * M, "call", "m", "ase1", "linea", null]), "llamada del asesor con falla de línea", porT(T0 + 7 * M));
  const e2 = await call({ action: "eventos", cts: ["ctAlfa01", "ctSinConv"], desde: T0 - H });
  ok(e2.status === 200 && e2.d.res.length === 2 && e2.d.res[0].ev.length === 8 && e2.d.res[1].ev.length === 0 && !e2.d.res[1].err,
    "por contacto: busca su conversación; sin conversación = sin eventos, no error", e2.d.res.map((r) => ({ ct: r.ct, n: r.ev.length, err: r.err })));
  pedidas = [];
  const e3 = await call({ action: "eventos", convs: [{ id: "convL", ct: "ctL" }], desde: T0 - 30 * M });
  const pags = pedidas.filter((p) => p.startsWith("/conversations/convL/messages")).length;
  ok(e3.d.res[0].ev.length === 116 && pags === 2, "una conversación larga se lee solo hasta pasar `desde` (2 de 3 páginas)", { ev: e3.d.res[0].ev.length, paginas: pags });
  const e4 = await call({ action: "eventos", desde: T0 });
  ok(e4.status === 400, "eventos sin convs ni cts = 400", e4.status);

  // Contactos, tareas, oportunidades y citas.
  const k = await call({ action: "contactos", ids: ["ctAlfa01", "ctRoto01", "no válido!"], tareas: true });
  const K = k.d.contactos && k.d.contactos[0];
  ok(k.status === 200 && k.d.contactos.length === 1 && k.d.fallidos.join() === "ctRoto01" && K.cf.fMot === "Invertir" && K.tags[0] === "cartera vencida" && K.u === "ase1",
    "contactos por id: campos, etiquetas y dueño; el que falla se reporta y el id inválido se ignora", { n: k.d.contactos.length, fallidos: k.d.fallidos });
  ok(K.tk && K.tk.abiertas === 2 && K.tk.fut === 1 && K.tk.venc === 1, "tareas abiertas con fecha: 1 futura y 1 vencida (sin fecha y completadas no cuentan)", K.tk);
  const o = await call({ action: "opps", contactIds: ["ctAlfa01", "ctBeta01"] });
  ok(o.status === 200 && o.d.opps.length === 2 && o.d.opps[0].s === "sCE" && o.d.opps[0].scE === iso(T0 + H) && o.d.opps[0].cf.fLP === "Presupuesto",
    "oportunidades por contacto con etapa, fecha de cambio y campos", o.d.opps[0]);
  const ci = await call({ action: "citas", start: iso(T0), end: iso(T0 + 7 * 24 * H) });
  ok(ci.status === 200 && ci.d.citas.find((c) => c.id === "e1").cb === "epc1" && ci.d.citas.find((c) => c.id === "e2").cb === "",
    "citas con su creador cuando el API lo trae", ci.d.citas.map((c) => ({ id: c.id, cb: c.cb })));

  const rg = await call({ action: "regresan", start: iso(T0), end: iso(T0 + 7 * 24 * H), campo: "fUlt" });
  ok(rg.status === 200 && rg.d.contactos.map((c) => c.id).join() === "regresa01" && rg.d.revisados === 4,
    "regresan: solo contactos que ya existían y cuya fecha de último formulario cae en el rango", { ids: rg.d.contactos && rg.d.contactos.map((c) => c.id), revisados: rg.d.revisados });
  const rg2 = await call({ action: "regresan", start: iso(T0), end: iso(T0 + 7 * 24 * H) });
  ok(rg2.status === 400, "regresan sin campo = 400", rg2.status);

  // Permisos
  const p1 = await call({ action: "opps", contactIds: ["ctAlfa01"] }, tok(["pc_view"]));
  const p2 = await call({ action: "opps", contactIds: ["ctAlfa01"] }, tok(["mkt_lq"]));
  ok(p1.status === 200 && p2.status === 403, "pc_view entra; un canal de marketing no", { pc_view: p1.status, mkt_lq: p2.status });

  console.log(fallas.length ? `\n${fallas.length} prueba(s) fallaron` : "\nTodas las pruebas del backend de Primer Contacto pasaron");
  process.exit(fallas.length ? 1 : 0);
})();
