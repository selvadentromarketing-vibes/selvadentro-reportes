// Datos SINTÉTICOS para probar el reporte de Primer Contacto (pcBuild) sin CRM: una semana
// del puesto (W44, 26-oct → 1-nov-2026) con los casos del manual, y el resultado esperado de
// cada indicador calculado a mano. Ningún nombre ni ID es real.
//
// Lo usan scripts/smoke-ui.js (prueba) y la vista previa. Se evalúa DENTRO de la página, así
// que fixtureTexto() devuelve el código de una función autocontenida.
function pcFixture() {
  const M = 60e3, H = 3600e3, DIA = 86400e3;
  const T = Date.parse("2026-10-26T15:00:00Z");           // lunes 26-oct, 10:00 Tulum
  const call = (t, u, o, x, s) => [t, "call", o || "m", u, x || "na", s == null ? null : s];
  const msg = (t, u, ch, o) => [t, ch, o || "m", u];
  const inb = (t, ch) => [t, ch, "i", ""];
  const iso = (t) => new Date(t).toISOString();
  const E = "epc1", A1 = "ase1", A2 = "ase2";
  const lead = (id, n, c, extra) => Object.assign({ id, n, c: iso(c), src: "", u: E, tags: [], attr: {}, cf: {} }, extra || {});
  const opp = (ct, p, s, sc, u, cf) => ({ id: "op-" + ct, ct, u: u || A1, st: "open", p, s, sc: iso(sc), scE: iso(sc), c: iso(sc), cf: cf || {} });
  const L6c = T + 2 * DIA, L9c = T + DIA, L7c = T + 2 * DIA + H, L8c = T + 3 * DIA, L2c = T + H;
  const VIE = Date.parse("2026-10-30T15:00:00Z"), L10c = T + 3 * DIA + 2 * H, L11c = VIE + H;
  const leads = [
    lead("lead00001", "Lead Uno", T),
    lead("lead00002", "Lead Dos", L2c),
    lead("lead00003", "Lead Tres", Date.parse("2026-10-31T17:00:00Z")),       // sábado 12:00: fuera de la ventana L–V
    lead("lead00004", "Lead Referido", T + 2 * H),
    lead("lead00005", "test lead", T + 3 * H),
    lead("lead00006", "Lead Seis", L6c, { cf: { f1: "Invertir", f2: "6 meses", f3: "2-3 MDP", f4: "Primera compra", f5: "Los cenotes" }, tags: ["cita calificada"] }),
    lead("lead00007", "Lead Siete", L7c),
    lead("lead00008", "Lead Ocho", L8c),
    lead("lead00009", "Lead Nueve", L9c, { cf: { f1: "Vivir" } }),
    lead("lead00010", "Lead Diez", L10c),
    lead("lead00011", "Lead Once", L11c),
  ];
  const ev = {
    lead00001: [call(T + 30e3, E, "a", "na", 40), call(T + 60e3, E, "m", "ok", 300), msg(T + 40 * M, A1, "whatsapp")],
    lead00002: [call(L2c + 3 * M, E), call(L2c + 4 * M, E), msg(L2c + 5 * M, E, "whatsapp"),
      call(L2c + 2 * H, E), call(L2c + 2 * H + M, E), msg(L2c + 2 * H + 2 * M, E, "sms"),
      call(L2c + DIA + 5 * H, E), call(L2c + DIA + 5 * H + M, E), msg(L2c + DIA + 5 * H + 2 * M, E, "email"),
      call(L2c + 3 * DIA, E), call(L2c + 3 * DIA + M, E), msg(L2c + 3 * DIA + 2 * M, E, "whatsapp"),
      call(L2c + 5 * DIA, E), call(L2c + 5 * DIA + M, E), msg(L2c + 5 * DIA + 2 * M, E, "whatsapp"),
      msg(L2c + 6 * DIA, E, "whatsapp")],
    lead00003: [call(Date.parse("2026-11-02T14:05:00Z"), E)],
    lead00006: [call(L6c + 40e3, E, "m", "ok", 90), call(L6c + 3 * H, A2, "m", "ok", 200)],
    lead00007: [msg(L7c + 2 * M, E, "whatsapp"), inb(L7c + 30 * M, "whatsapp")],
    lead00008: [call(L8c + 2 * M, E, "m", "ok", 95)],
    // Protocolo del primer toque (13-oct-2026): la automática del CRM entra primero, aquí SIN
    // usuario. Lead Diez: contestó 120 s → contacto efectivo y primer toque completo.
    lead00010: [call(L10c + 20e3, "", "a", "ok", 120), msg(L10c + 30 * M, A2, "whatsapp")],
    // Lead Once: conectó 30 s (<90) y el ejecutivo remarcó a mano 4 min después: tarde.
    lead00011: [call(L11c + 25e3, "", "a", "ok", 30), call(L11c + 5 * M, E)],
    lead00009: [call(L9c + 50e3, E, "m", "ok", 65)],
    // Cartera
    cart00001: [call(T + DIA + 2 * H, E), call(T + DIA + 2 * H + M, E), msg(T + DIA + 2 * H + 2 * M, E, "whatsapp"),
      msg(T + DIA + 2 * H + 3 * M, E, "email"), msg(T + DIA + 2 * H + 40 * M, E, "whatsapp"),
      call(T + 2 * DIA + 4 * H, E), call(T + 2 * DIA + 4 * H + M, E)],
    cart00002: [call(T + 3 * DIA + 2 * H, E, "m", "ok", 120)],
    cart00003: [call(VIE + 3 * H, E), call(VIE + 5 * H, E, "m", "linea")],
    cart00004: [call(T + 2 * DIA + H, E)],
    cart00005: [call(VIE, E, "m", "ok", 200), msg(VIE + 5 * H, A2, "whatsapp")],
  };
  const cts = {
    lead00007: { id: "lead00007", tk: { abiertas: 1, fut: 1, venc: 0 } },
    cart00001: { id: "cart00001", n: "Cartera Uno", c: "2026-03-01T15:00:00Z", tags: ["cartera vencida"], cf: {} },
    cart00002: { id: "cart00002", n: "Cartera Dos", c: "2026-02-01T15:00:00Z", tags: [], cf: {} },
    cart00003: { id: "cart00003", n: "Cartera Tres", c: "2026-01-10T15:00:00Z", tags: [], cf: {} },
    cart00004: { id: "cart00004", n: "Broker Equis", c: "2026-05-10T15:00:00Z", tags: [], cf: {} },
    cart00005: { id: "cart00005", n: "Cartera Cinco", c: "2025-12-10T15:00:00Z", tags: [], cf: {} },
  };
  const viejo = Date.parse("2026-06-01T15:00:00Z");
  const opps = {
    lead00001: [opp("lead00001", "pV", "sCE", T + 10 * M, A1)],
    lead00002: [opp("lead00002", "pV", "sSR", L2c + 6 * DIA + H, E)],
    lead00003: [opp("lead00003", "pV", "sNL", Date.parse("2026-10-31T17:00:00Z"), E)],
    lead00004: [opp("lead00004", "pR", "sRef", T + 2 * H, A1)],
    lead00006: [opp("lead00006", "pV", "sZA", L6c + 10 * M, A2)],
    lead00007: [opp("lead00007", "pV", "sLP", L7c + 40 * M, A1, { oLPm: "Sin presupuesto este año", oLPf: "2027-06-01" })],
    lead00008: [opp("lead00008", "pV", "sDQ", L8c + 10 * M, E)],
    lead00009: [opp("lead00009", "pV", "sZA", L9c + 5 * M, A1)],
    cart00002: [opp("cart00002", "pV", "sSR", viejo, A2)],
    cart00003: [opp("cart00003", "pV", "sRe", viejo, A1)],
    cart00004: [opp("cart00004", "pB", "sBP", viejo, A2)],
    cart00005: [opp("cart00005", "pV", "sZA", VIE + 12 * M, A2)],
    lead00010: [opp("lead00010", "pV", "sCE", L10c + 10 * M, A2)],
    lead00011: [opp("lead00011", "pV", "sNL", L11c, E)],
  };
  const citas = [
    { id: "c6", ct: "lead00006", u: A2, t: T + 3 * DIA, ag: L6c + 8 * M, st: "showed", cal: "Zoom", cb: E },
    { id: "c9", ct: "lead00009", u: A1, t: L9c + DIA + 2 * H, ag: L9c + 3 * M, st: "noshow", cal: "Zoom", cb: E },
    { id: "c5", ct: "cart00005", u: A2, t: Date.parse("2026-11-02T15:00:00Z"), ag: VIE + 10 * M, st: "confirmed", cal: "Zoom", cb: "" },
    { id: "cx", ct: "cart00002", u: A1, t: T + 4 * DIA, ag: T + 3 * DIA + 5 * H, st: "showed", cal: "Zoom", cb: A1 },
  ];
  const pipelines = [
    { id: "pV", name: "Seguimiento de ventas", stages: [["sNL", "Nuevo lead (no contactado)"], ["sCE", "Contacto establecido"], ["sZA", "Zoom agendado"], ["sZR", "Zoom realizado"],
      ["sLP", "Largo plazo"], ["sSR", "Sin Respuesta"], ["sRe", "Rescate"], ["sDQ", "Descalificado"]].map(([id, name]) => ({ id, name })) },
    { id: "pR", name: "Programa de referidos", stages: [{ id: "sRef", name: "Nuevo referido" }] },
    { id: "pB", name: "Brokers - Producción (B2B2C)", stages: [{ id: "sBP", name: "Activo" }] },
  ];
  const D = {
    per: { tipo: "semana", clave: "2026-W44", ini: Date.parse("2026-10-26T05:00:00Z"), fin: Date.parse("2026-11-02T04:59:59.999Z"), iniYMD: "2026-10-26", finYMD: "2026-11-01" },
    epc: [E], ensayo: false, users: { epc1: "Ejecutivo Prueba", ase1: "Asesora Uno", ase2: "Asesor Dos" }, pipelines,
    leads, cts, ev, evErr: {}, opps, citas, fallos: [],
    diag: { convModo: "manual", convOrden: true, convN: 5, convTrunc: false, cobN: 7, cobOk: 7, cobSoloLlam: 0 },
  };
  const cfg = { usuarios: [E], activa: "2026-10-26", marcador: "2026-10-26",
    campos5: { motivo: "c:f1", horizonte: "c:f2", rango: "c:f3", experiencia: "c:f4", atractivo: "c:f5" },
    lp: { motivo: "o:oLPm", fecha: "o:oLPf" }, calif: { campo: "", si: "cita calificada", no: "cita no calificada" } };
  const now = Date.parse("2026-11-09T18:00:00Z");
  // Lo que el manual dice que debe salir, calculado a mano (ver comentarios en smoke-ui.js).
  // Contacto efectivo = llamada ≥90 s, respuesta escrita o sesión agendada por el ejecutivo:
  // Lead Nueve (llamada de 65 s) es efectivo por su cita; Lead Diez por la automática de 120 s.
  const esperado = { nU: 9, excl: { fuera: 1, prueba: 1 }, vel: { ok: 5, den: 8 }, puntos: 23, habiles: 5, conv60: 7,
    dia: { "2026-10-26": 4, "2026-10-27": 6, "2026-10-28": 3, "2026-10-29": 5, "2026-10-30": 2, "2026-10-31": 2, "2026-11-01": 1 },
    entrega: { ent: 5, den: 7 }, res: { entregado: 5, lpOk: 1, descarte: 1, sinCierre: 1 }, asist: { as: 1, den: 2 }, calif: { si: 1, no: 0 },
    datos: { ok: 1, n: 3 }, cad: { silencio: 3, completos: 1 }, cart: { vencida: [2, 4], fria: [1, 1], sindato: [1, 1] }, fueraPts: 1,
    t1: { lead00001: [true, "corta", 0], lead00010: [true, "90", null], lead00011: [false, "corta", 245e3] },
    recep: { lead00001: ["ok", ""], lead00006: ["tarde", "si"], lead00009: ["sin", "no"], cart00005: ["tarde", "si"], lead00010: ["ok", ""] } };
  return { D, cfg, now, esperado };
}
module.exports = { pcFixture, fixtureTexto: () => pcFixture.toString() };
