// Prueba de humo de la interfaz, en Chromium sin cabeza y SIN backend.
//
// La app no tiene build ni pruebas automáticas, y todo lo que se rompía en pantalla lo
// veía primero el cliente. Esto la arranca con una sesión de admin simulada y los
// Netlify Functions sustituidos por stubs (kv vacío, sin CRM), recorre las 14 vistas y
// falla si hay un error de JavaScript, si alguna vista imprime "undefined", "NaN" o
// "[object Object]", o si una tabla tiene distinto número de encabezados que de celdas.
// También verifica en vivo la validación "seguimiento > total" del formulario de captura.
//
// Uso (una sola vez):  npm i -g playwright   (sin descargar navegador si ya hay uno:
//                      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)
// Correr:              node scripts/smoke-ui.js
//   CHROME_PATH=/ruta/a/chrome   → usar ese binario en vez del de Playwright
//   PORT=8765                    → puerto del servidor estático que levanta solo
// No toca el kv, no llama a GoHighLevel ni a Windsor: todo es local.
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const path = require('path');
const { fixture } = require('./lq-fixture.js');
const { pcFixture } = require('./pc-fixture.js');
const ALL = ["brokers","paid_organico","seminarios","referidos","pd_leads","pd_brokers","rp_vip","direccion_general","direccion_comercial","crm_live","sla_view","marketing","mkt_rrss","mkt_lq"];
const PORT = process.env.PORT || 8765;
(async () => {
  // Servidor estático propio sobre la raíz del repo (index.html, marketing.html)
  const raiz = path.resolve(__dirname, '..');
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', raiz], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('slvd-token-v1', 'smoke-token'); } catch (e) {} });
  const page = await ctx.newPage();
  let VISTA = 'boot';
  const errores = [], consola = [], red = [];
  page.on('pageerror', e => { const msg = String(e.stack || e.message || e).split('\n').slice(0, 2).join(' ⟶ '); errores.push({ vista: VISTA, msg }); console.log('  ✗ PAGEERROR [' + VISTA + ']', msg.slice(0, 220)); });
  page.on('console', m => { if (m.type() === 'error') consola.push({ vista: VISTA, msg: m.text().slice(0, 200) }); });
  page.on('requestfailed', r => { const u = r.url(); if (!/localhost/.test(u)) red.push(u.slice(0, 90)); });
  // Sin red externa en el sandbox: Chart.js se sustituye por un stub mínimo y fuentes/imágenes
  // responden vacío, para que los errores que queden sean del código de la app.
  await page.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, route => route.fulfill({ status: 200, contentType: 'application/javascript',
    body: 'window.Chart=class{constructor(){this.data={datasets:[]}}destroy(){}update(){}resize(){}};Chart.register=()=>{};Chart.defaults={font:{},plugins:{}};' }));
  await page.route(/fonts\.googleapis|fonts\.gstatic|filesafe\.space|\.(png|jpg|svg|woff2?)(\?|$)/, route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/.netlify/functions/**', async route => {
    const url = route.request().url(); const fn = url.split('/functions/')[1].split('?')[0];
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'auth') return ok(body.action === 'status' ? { hasUsers: true } : { token: 'smoke-token', email: 'smoke@selvadentrotulum.com', role: 'admin', channels: ALL });
    if (fn === 'kv') { const op = body.op;
      // Metas guardadas como en producción el 2026-09-11 (reporte de bug de Dirección): las
      // conversiones de Ventas → Reporte deben leer ESTAS, no los valores del código.
      if (op === 'get' && body.k === 'selvadentro:metas') return ok({ v: JSON.stringify({ __global: { conv: { zo: 0.30, to: 0.35, oa: 0.33, aw: 0.80 } } }) });
      return ok(op === 'get' ? { v: null } : op === 'list' ? { keys: [] } : op === 'dump' ? { rows: [] } : { ok: true }); }
    if (fn === 'sla-report' && body.action === 'users') return ok({ users: {}, fields: [], pipelines: [] });
    // Primer Contacto: el CRM simulado con la semana sintética de scripts/pc-fixture.js
    if (fn === 'pc-report') {
      const { D } = pcFixture(), a = body.action;
      if (a === 'users') return ok({ users: D.users, fields: [{ id: 'f1', name: '¿Para vivir o invertir?' }], oppFields: [], pipelines: D.pipelines });
      if (a === 'contacts') { const t0 = Date.parse(body.start), t1 = Date.parse(body.end); return ok({ contacts: D.leads.filter(c => Date.parse(c.c) >= t0 && Date.parse(c.c) <= t1), searchAfter: null }); }
      if (a === 'citas') return ok({ citas: D.citas, calendarios: 1, errores: [] });
      if (a === 'conversaciones') return ok({ convs: Object.keys(D.ev).map(ct => ({ id: 'cv-' + ct, ct, k: 1 })), cursor: null, modo: 'manual', ordenOk: true });
      if (a === 'eventos') return ok({ res: [...(body.cts || []).map(ct => ({ ct, cv: ['cv-' + ct], ev: D.ev[ct] || [], err: false })),
        ...(body.convs || []).map(c => ({ ct: c.ct, cv: [c.id], ev: D.ev[c.ct] || [], err: false }))] });
      if (a === 'contactos') return ok({ contactos: body.ids.map(id => D.cts[id] || D.leads.find(c => c.id === id)).filter(Boolean).map(c => body.tareas ? c : { ...c, tk: undefined }), fallidos: [] });
      if (a === 'opps') return ok({ opps: body.contactIds.flatMap(ct => D.opps[ct] || []), fallidos: [] });
    }
    // Respuesta real del lead (16-oct-2026): los ids que terminan en número par respondieron
    if (fn === 'lead-quality' && body.action === 'respuestas') {
      return ok({ res: (body.ids || []).map(ct => { const n = +((/(\d+)$/.exec(ct) || [])[1] || 1); return n % 2 === 0 ? { ct, r: 'i', t: Date.parse('2026-09-20T15:00:00Z'), ch: 'whatsapp' } : { ct, r: '' }; }) });
    }
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'stub: sin backend en la prueba' }) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const loginVisible = await page.evaluate(() => { const l = document.getElementById('login-screen'); return l && getComputedStyle(l).display !== 'none' && l.offsetParent !== null; });
  console.log('login visible tras boot:', loginVisible);
  const hallazgos = [];
  const escanear = async (vista) => {
    VISTA = vista; await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.view.active, #view-metas, #view-diag, #view-admin, #view-asesores, #view-db')].filter(v => v.offsetParent !== null);
      const txt = vis.map(v => v.innerText).join('\n');
      const malos = [];
      for (const rx of [/\bundefined\b/g, /\bNaN\b/g, /\[object Object\]/g, /\bnull\b/g]) { const m = txt.match(rx); if (m) malos.push(rx.source + ' ×' + m.length); }
      // tablas: th vs td de la primera fila de datos
      const tablas = [];
      vis.forEach(v => v.querySelectorAll('table').forEach(t => {
        const ths = t.querySelectorAll('tr:first-child th').length; const fila = [...t.querySelectorAll('tr')].find(tr => tr.querySelectorAll('td').length && !tr.querySelector('[colspan]'));
        if (ths && fila && fila.querySelectorAll('td').length !== ths) tablas.push(`th ${ths} ≠ td ${fila.querySelectorAll('td').length} · ${(t.querySelector('tr:first-child th')?.innerText || '').slice(0, 30)}`);
      }));
      return { chars: txt.length, malos, tablas, activas: vis.map(v => v.id) };
    });
    console.log(`\n[${vista}] vistas=${r.activas.join(',')} texto=${r.chars}c` + (r.malos.length ? `  ⚠ ${r.malos.join(' · ')}` : '') + (r.tablas.length ? `\n   tablas desalineadas: ${r.tablas.join(' | ')}` : ''));
    if (r.malos.length || r.tablas.length) hallazgos.push({ vista, ...r });
  };
  // Desempeño trae "Reglas" y "Detalle" plegados (14-oct-2026): las pruebas los abren para leer y
  // escanear todo; 'desempeno:bloques' revisa cómo se ve al entrar.
  await page.evaluate(() => { slaState.abierto = { reglas: true, detalle: true }; });
  await escanear('boot');
  const grupos = [['direccion', 'general'], ['direccion', 'comercial'], ['ventas', 'ingreso'], ['ventas', 'reporte'], ['ventas', 'analitica'], ['ventas', 'desempeno'], ['ventas', 'primer'], ['ventas', 'crm'], ['marketing', 'calidad'], ['marketing', 'ingreso']];
  for (const [g, s] of grupos) { const ok = await page.evaluate(([g, s]) => { try { return navIr(g, s); } catch (e) { return 'ERR ' + e.message; } }, [g, s]); if (ok !== true) console.log(`  navIr(${g},${s}) →`, ok); await escanear(`${g}/${s}`); }
  for (const t of ['metas', 'asesores', 'db', 'diag', 'admin']) { const ok = await page.evaluate(t => { try { return navIrLateral(t); } catch (e) { return 'ERR ' + e.message; } }, t); if (ok !== true) console.log(`  navIrLateral(${t}) →`, ok); await escanear(t); }
  // Ingreso: seguimiento > total debe marcar el campo y bloquear el guardado
  VISTA = 'ingreso:validacion';
  await page.evaluate(() => navIr('ventas', 'ingreso'));
  await page.evaluate(() => { const s = document.getElementById('canal-select'); s.value = 'paid_organico'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(600);
  const val = await page.evaluate(async () => {
    const tot = document.getElementById('in_zooms_realizados'), seg = document.getElementById('in_zooms_realizados_seg');
    if (!tot || !seg) return { existe: false };
    tot.value = '3'; seg.value = '5'; seg.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 100));
    const aviso = seg.parentElement.querySelector('.campo-aviso.seg');
    const rev = ingRevisarCoherencia({ valores: { zooms_realizados: 3, zooms_realizados_seg: 5 } });
    const ayuda = !!seg.closest('.frow').querySelector('.campo-ayuda');
    return { existe: true, rojo: seg.classList.contains('campo-error'), aviso: aviso ? aviso.textContent : null, bloqueo: rev.bloqueo, ayuda };
  });
  console.log('\n[ingreso:validación seg>total]', JSON.stringify(val));
  // Criterio de aceptación del reporte de bug (2026-09-11): Ventas → Reporte de Paid Orgánico
  // imprime la meta guardada en Metas (30%), no la del código (15%); la combinada se deriva.
  VISTA = 'reporte:metas';
  const metas = await page.evaluate(async () => {
    navIr('ventas', 'reporte');
    const s = document.getElementById('canal-select'); s.value = 'paid_organico'; s.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 900));
    // El reporte solo pinta sus secciones tras elegir rango y "Generar reporte" (como hace Juan).
    const si = document.getElementById('rep-semana-ini'), sf = document.getElementById('rep-semana-fin');
    if (!si.options.length) return { sinSemanas: true };
    si.value = si.options[0].value; sf.value = sf.options[sf.options.length - 1].value;
    await generarReporte();
    const t = document.getElementById('view-reporte').innerText;
    const comb = t.match(/Zoom\/Tour nuevo → OPP[\s\S]{0,40}meta (\d+\.\d+)%/);
    const combV = comb ? Number(comb[1]) : null;
    return { rango: si.value + '→' + sf.value, zoom30: /Zoom nuevo → OPP[\s\S]{0,40}meta 30\.00%/.test(t), zoom15: /meta 15\.00%/.test(t), tour35: /Tour nuevo → OPP[\s\S]{0,40}meta 35\.00%/.test(t),
      comb40: /Zoom\/Tour nuevo → OPP[\s\S]{0,40}meta 40\.00%/.test(t), combEntre: combV != null && combV >= 30 && combV <= 35, combV, derivada: /·derivada/.test(t), metasSrc: /·Metas/.test(t), nota: /Metas de conversión/.test(t) };
  });
  console.log('\n[reporte:metas] Paid Orgánico', JSON.stringify(metas));
  if (metas.sinSemanas || !metas.zoom30 || metas.zoom15 || !metas.tour35 || metas.comb40 || !metas.combEntre || !metas.derivada || !metas.metasSrc || !metas.nota) hallazgos.push({ vista: 'reporte:metas', metas });
  // Precedencia de metaConv con el código real de la página: canal > Metas > derivada > fija.
  VISTA = 'metaConv:unidad';
  const mc = await page.evaluate(() => {
    const getv = (ks) => { const v = { zooms_realizados: 10, zooms_realizados_seg: 2, tours_realizados: 2, tours_realizados_seg: 0 }; return ks.reduce((a, k) => a + (k[0] === '-' ? -(v[k.slice(1)] || 0) : (v[k] || 0)), 0); };
    const zoom = { l: 'Zoom nuevo → OPP', target: 0.15, t: 'zo' }, mix = { l: 'Zoom/Tour nuevo → OPP', target: 0.40, t: 'mix_zt' }, libre = { l: 'Presentación → OPP', target: 0.25 };
    const a = metaConv('paid_organico', zoom, getv), b = metaConv('seminarios', { ...zoom, target: 0.40 }, getv), c = metaConv('paid_organico', mix, getv), d = metaConv('brokers', libre, getv), e = metaConv('paid_organico', mix, null);
    META_OVERRIDES.paid_organico = Object.assign({}, META_OVERRIDES.paid_organico, { __conv: { 'Zoom nuevo → OPP': 0.45 } });
    const f = metaConv('paid_organico', zoom, getv); delete META_OVERRIDES.paid_organico.__conv;
    const r = { a, b, c, d, e, f };
    r.ok = a.v === 0.30 && a.src === 'metas' && b.v === 0.30 && Math.abs(c.v - (0.30 * 8 + 0.35 * 2) / 10) < 1e-9 && c.src === 'derivada' && c.v > 0.30 && c.v < 0.35 && d.v === 0.25 && d.src === 'fija' && Math.abs(e.v - 0.325) < 1e-9 && f.v === 0.45 && f.src === 'canal';
    return r;
  });
  console.log('\n[metaConv] precedencia', JSON.stringify(mc));
  if (!mc.ok) hallazgos.push({ vista: 'metaConv:unidad', mc });
  // Calificación por reglas: la etapa del pipeline manda sobre el formulario (2026-09-15).
  VISTA = 'lqAutoQualify:etapa';
  const lq = await page.evaluate(() => {
    const base = { tags: '', pstage: '', ost: '', ap: { tot: 0, sh: 0, ns: 0 }, pres: '', hor: '', o: 0, pr: 0, w: 0, wv: 0, ov: 0 };
    const q = (o) => lqAutoQualify(Object.assign({}, base, o));
    const r = {
      oppSinForm: q({ o: 1, pstage: 'Seguimiento de OPP' }).lv,                       // sqls: la etapa manda
      wonFormBajo: q({ o: 1, w: 1, pstage: 'WON', pres: '$50,000 USD', hor: '12 meses' }).lv, // sqls: la venta manda
      oppPerdida: q({ o: 1, ost: 'lost', pstage: 'Seguimiento de OPP' }).lv,           // sqls: OPP generada (15-oct-2026), antes desc
      // OPP generada caída (Dirección General, 15-oct-2026): su nivel sale de dónde cayó
      caidaLargo: q({ og: 1, pstage: 'Largo plazo' }).lv,                               // sql: horizonte fuera del perfil
      caidaRescate: q({ og: 1, pstage: 'Rescate' }).lv,                                 // sqls: tenía perfil, no se cerró
      caidaNurturing: q({ og: 1, pstage: 'Nurturing' }).lv,                             // sqls: Nurturing no dice que le falte perfil
      caidaDescTag: q({ tags: 'squeeze, opp-generada', pstage: 'Descalificado' }).lv,   // sqls: sin causa (la etiqueta basta)
      caidaYaNo: q({ og: 1, pstage: 'Descalificado', dqc: 'Ya no interesado' }).lv,     // sqls
      caidaNoAlineado: q({ og: 1, pstage: 'Descalificado', dqc: 'No alineado' }).lv,    // sql
      caidaMalint: q({ og: 1, pstage: 'Descalificado', dqc: 'Malinterpreto la campana' }).lv, // mql (sin acentos: se compara compacto)
      caidaInvalida: q({ og: 1, inv: 'Número equivocado', pstage: 'Descalificado' }).lv, // desc: causa del grupo inválido
      caidaSpam: q({ tags: 'opp-generada, spam', pstage: 'Descalificado' }).lv,          // desc: tag inválido
      sinOppDesc: q({ pstage: 'Descalificado' }).lv,                                     // desc: sin OPP, igual que antes
      whyCaida: q({ og: 1, pstage: 'Largo plazo' }).why[0] || '',
      fuerteSinForm: q({ pstage: 'Interés identificado' }).lv,                         // sql
      fuerteConPerfil: q({ pstage: 'Tour realizado', pres: '$150,000 USD', hor: '3 meses' }).lv, // sqls
      soloFormulario: q({ rsp: 'i', pres: '$150,000 USD', hor: '3 meses' }).lv,        // sql (antes sqls)
      soloRespondio: q({ rsp: 'i' }).lv,                                               // mql: mensaje entrante real
      soloEtiqueta: q({ tags: 'replied', rsp: '' }).lv,                                // nuevo: una etiqueta ya no es respuesta (16-oct-2026)
      why: q({ o: 1, pstage: 'Carta oferta', pres: '$50,000 USD' }).why.join(' · '),
    };
    r.ok = r.oppSinForm === 'sqls' && r.wonFormBajo === 'sqls' && r.oppPerdida === 'sqls'
      && r.caidaLargo === 'sql' && r.caidaRescate === 'sqls' && r.caidaNurturing === 'sqls' && r.caidaDescTag === 'sqls' && r.caidaYaNo === 'sqls' && r.caidaNoAlineado === 'sql'
      && r.caidaMalint === 'mql' && r.caidaInvalida === 'desc' && r.caidaSpam === 'desc' && r.sinOppDesc === 'desc'
      && r.whyCaida === 'llegó a OPP (etiqueta opp-generada); hoy en "Largo plazo": el horizonte ya no es el del perfil' && r.fuerteSinForm === 'sql' && r.fuerteConPerfil === 'sqls' && r.soloFormulario === 'sql' && r.soloRespondio === 'mql' && r.soloEtiqueta === 'nuevo' && /etapa del pipeline manda/.test(r.why);
    return r;
  });
  console.log('\n[lqAutoQualify] etapa > formulario', JSON.stringify(lq));
  // Regla nueva de respuesta (Dirección General, 16-oct-2026; activa: LQ_RESP_V2)
  VISTA = 'lqAutoQualify:respuesta';
  const lqr = await page.evaluate(() => {
    const base = { tags: '', pstage: '', ost: '', ap: { tot: 0, sh: 0, ns: 0 }, pres: '', hor: '', o: 0, pr: 0, w: 0, wv: 0, ov: 0 };
    const q = (o, v2) => lqAutoQualify(Object.assign({}, base, o), { v2 });
    const form = { pres: '$150,000 USD', hor: '3 meses' };
    const r = {
      flag: LQ_RESP_V2,
      tagV1: q({ tags: 'squeeze, another-device-replied-whatsapp' }, false).lv,            // mql: la etiqueta contaba
      tagV2: q({ tags: 'squeeze, another-device-replied-whatsapp', rsp: '' }, true).lv,   // nuevo: no es del lead
      toqueV1: q({ pstage: '2do toque', pr: 1 }, false).lv,                                 // mql: oportunidad movida
      toqueV2: q({ pstage: '2do toque', pr: 1, rsp: '', rspE: { ll: 5, msg: 1, em: 1 } }, true).lv, // cql: escalera completa sin respuesta
      toqueSinEsc: q({ pstage: '2do toque', pr: 1, rsp: '', rspE: { ll: 2, msg: 1, em: 0 } }, true),  // mql: ventas no completó la escalera
      sinLlamada: q({ pstage: 'Break up', pr: 1, tags: 'sin llamada - numero invalido', rsp: '', rspE: { ll: 0, msg: 1, em: 1 } }, true).lv, // cql
      notaV2: q({ pstage: 'Sin respuesta', pr: 1, rsp: 'n', rspNt: 'Hablé con él por su celular' }, true),               // mql: nota del asesor
      escDesempeno: q({ pstage: 'Ultimátum', pr: 1, rsp: '', escOk: true }, true).lv,      // cql: escalera de Desempeño
      contactoV2: q({ pstage: 'Interés identificado', pr: 1, rsp: 'i', rspCh: 'whatsapp' }, true),
      contactoEtapaV2: q({ pstage: 'Contacto establecido', pr: 1, rsp: '' }, true),       // mql: la etapa dice que contestó
      nurtFormV1: q({ pstage: 'Nurturing', pr: 1, tags: 'another-device-replied-whatsapp', ...form }, false).lv, // sql
      nurtFormRespV2: q({ pstage: 'Nurturing', pr: 1, rsp: 'i', ...form }, true),            // mql: el formulario ya no sube
      nurtFormSinV2: q({ pstage: 'Nurturing', pr: 1, rsp: '', rspE: { ll: 6, msg: 2, em: 1 }, ...form }, true).lv, // cql: escalera completa
      largoCitaV1: q({ pstage: 'Largo plazo', pr: 1, ap: { tot: 1, sh: 1, ns: 0 }, ...form }, false).lv, // sqls
      largoCitaV2: q({ pstage: 'Largo plazo', pr: 1, ap: { tot: 1, sh: 1, ns: 0 }, ...form }, true).lv,  // sql: cita, no formulario
      contactoFormV2: q({ pstage: 'Contacto establecido', pr: 1, rsp: 'c', rspD: 45, ...form }, true),    // sql: fuera de cubeta
      oppCaidaV2: q({ og: 1, pstage: 'Largo plazo', rsp: '' }, true).lv,                    // sql: la regla de OPP no cambia
      citaV2: q({ pstage: 'Zoom agendado', pr: 1, ap: { tot: 1, sh: 0, ns: 0 }, rsp: '' }, true).lv, // sql: cita agendada
      sinVerif: q({ pstage: '2do toque', pr: 1 }, true).why.join(' · '),
    };
    r.ok = r.flag === true && r.tagV1 === 'mql' && r.tagV2 === 'nuevo' && r.toqueV1 === 'mql' && r.toqueV2 === 'cql'
      && r.toqueSinEsc.lv === 'mql' && r.toqueSinEsc.sinEsc === true && /escalera incompleta \(2 llamadas, 1 WhatsApp\/SMS, 0 emails\)/.test(r.toqueSinEsc.why.join(' '))
      && r.sinLlamada === 'cql' && r.notaV2.lv === 'mql' && /nota del asesor: "Hablé con él por su celular"/.test(r.notaV2.why.join(' ')) && r.escDesempeno === 'cql'
      && r.contactoEtapaV2.lv === 'mql' && /respondió: etapa "Contacto establecido": el asesor registró que contestó/.test(r.contactoEtapaV2.why.join(' '))
      && r.nurtFormV1 === 'sql' && r.nurtFormRespV2.lv === 'mql' && /en "Nurturing" sin haber llegado a OPP: el formulario ya no lo sube a SQL/.test(r.nurtFormRespV2.why.join(' '))
      && r.nurtFormSinV2 === 'cql' && r.largoCitaV1 === 'sqls' && r.largoCitaV2 === 'sql'
      && r.contactoFormV2.lv === 'sql' && /llamada contestada de 45 s/.test(r.contactoFormV2.why.join(' '))
      && r.oppCaidaV2 === 'sql' && r.citaV2 === 'sql' && /respuesta sin verificar/.test(r.sinVerif);
    r.toqueSinEsc = r.toqueSinEsc.lv + (r.toqueSinEsc.sinEsc ? '·sinEsc' : ''); r.notaV2 = r.notaV2.lv;
    r.contactoV2 = r.contactoV2.lv; r.contactoEtapaV2 = r.contactoEtapaV2.lv; r.nurtFormRespV2 = r.nurtFormRespV2.lv; r.contactoFormV2 = r.contactoFormV2.lv;
    return r;
  });
  console.log('\n[lqAutoQualify] respuesta real (v2)', JSON.stringify(lqr));
  if (!lqr.ok) hallazgos.push({ vista: 'lqAutoQualify:respuesta', lqr });
  if (!lq.ok) hallazgos.push({ vista: 'lqAutoQualify:etapa', lq });
  // Desempeño: el Índice de calidad sale de las reglas, no del campo manual vacío (2026-09-23).
  VISTA = 'sla:indiceCalidad';
  const sla = await page.evaluate(() => {
    const c = (id, n, u, cf) => ({ id, n, c: '2026-09-15T15:00:00.000Z', src: 'facebook', u, tags: ['replied'], attr: {}, cf: cf || {} });
    const contactos = [c('c1', 'Ana Gómez', 'u1'), c('c2', 'Luis Pérez', 'u1'), c('c3', 'Marta Ruiz', 'u1', { fcal: 'MQL' }), c('c4', 'Pedro Sol', 'u1')];
    // c2 contestó (entrante real en el barrido); c4 solo trae la etiqueta "replied": ya no es respuesta (16-oct-2026)
    const sweeps = { c1: { fi: Date.parse('2026-09-15T16:00:00Z') }, c2: { fi: Date.parse('2026-09-15T17:00:00Z') }, c3: {}, c4: {} };
    const opps = [{ ct: 'c1', u: 'u1', st: 'open', c: '2026-09-16T10:00:00.000Z', stc: '', v: 0, p: 'p1', s: 's2', sc: '2026-09-17T10:00:00.000Z' }];
    const pipes = [{ id: 'p1', name: 'Pipeline de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }, { id: 's2', name: 'Seguimiento de OPP' }] }];
    const campos = [{ id: 'fcal', name: 'Calificación del lead' }];
    const agg = buildSlaAgg([lqWeekOf('2026-09-15T15:00:00.000Z')], contactos, sweeps, opps, { u1: 'Asesor Uno' }, campos, pipes);
    const by = {}; agg.leads.forEach(l => by[l.id] = { lv: l.lv, lvCrm: l.lvCrm, o: l.o });
    const score = slaScoreAsesor(agg.leads);
    return { by, califCrm: agg.califCrm, q5: score.q5, qTot: score.qTot };
  });
  console.log('\n[sla] índice de calidad por reglas', JSON.stringify(sla));
  // Desempeño con Ejecutivo de Primer Contacto (13-oct-2026): el lead que sigue en sus manos sale del
  // ranking; el que entregó se mide desde la entrega y solo con los toques del asesor.
  VISTA = 'sla:primerContacto';
  const slaPc = await page.evaluate(() => {
    const T = Date.parse('2026-10-27T15:00:00Z'), H = 3600e3;
    const c = (id, u) => ({ id, n: 'Lead ' + id, c: new Date(T).toISOString(), src: 'facebook', u, tags: [], attr: {}, cf: {} });
    const contactos = [c('p1', 'epc1'), c('p2', 'u1'), c('p3', 'u1')];
    const sweeps = {
      p1: { foM: null, ex: { n: 2, f: T + 30e3, l: T + 60e3, fe: null }, efT: [] },
      // Entregado: el ejecutivo habló a los 60 s (fe); la asesora escribe a las 3 h; el lead le contesta a las 4 h.
      // La llamada automática de 2 min a los 20 s es del marcador del ejecutivo, no de la asesora.
      p2: { foM: T + 3 * H, foA: T + 20e3, fe: T + 20e3, ex: { n: 1, f: T + 60e3, l: T + 60e3, fe: T + 60e3 }, efT: [T + 4 * H] },
      p3: { foM: T + 10 * 60e3, fi: T + H, fe: T + H },
    };
    const agg = buildSlaAgg([lqWeekOf(new Date(T).toISOString())], contactos, sweeps, [], { u1: 'Asesora Uno', epc1: 'Ejecutivo' }, [], [],
      { now: T + 48 * H, pc: { epc: ['epc1'], activaT: Date.parse('2026-10-26T05:00:00Z'), activaYMD: '2026-10-26' } });
    const by = {}; agg.leads.forEach(l => by[l.id] = { created: l.created, slaAt: l.slaAt, fi: l.fi, tAuto: l.tAuto, entPc: l.entPc });
    const r = { n: agg.leads.length, pc: agg.pc, p2: by.p2, p3: by.p3 };
    r.ok = r.n === 2 && agg.pc.enEj === 1 && agg.pc.ent === 1 && !by.p1
      && by.p2.created === T + 60e3 && by.p2.slaAt === 3 * H - 60e3 && by.p2.fi === T + 4 * H && by.p2.tAuto === false && by.p2.entPc === true
      && by.p3.created === T && by.p3.slaAt === 10 * 60e3 && by.p3.entPc === false;
    return r;
  });
  console.log('[sla] con Ejecutivo de Primer Contacto', JSON.stringify(slaPc));
  if (!slaPc.ok) hallazgos.push({ vista: 'sla:primerContacto', slaPc });
  // c1: OPP real → sqls aunque el CRM no traiga calificación; c2: contestó (entrante del barrido) → mql; c3: campo manual MQL;
  // c4: solo la etiqueta "replied", sin entrante → no es MQL.
  if (!(sla.by.c1 && sla.by.c1.lv === 'sqls' && sla.by.c1.lvCrm === 'nc' && sla.by.c1.o === 1 && sla.by.c2.lv === 'mql' && sla.by.c3.lvCrm === 'mql' && sla.by.c4 && sla.by.c4.lv !== 'mql' && sla.califCrm === 1 && sla.q5 != null && sla.q5 > 1)) hallazgos.push({ vista: 'sla:indiceCalidad', sla });
  // Change Spec v1.2 (25-sep-2026): Velocidad de primer contacto con umbrales 20·40·60·80
  // desde el 1-oct-2026. Los nueve casos de la sección 5, más: la leyenda muestra los
  // umbrales nuevos, una semana que terminó antes del 1-oct conserva su nota y un rango
  // que cruza el 1-oct muestra la nota del cambio.
  VISTA = 'rubrica:v1.2';
  const rb = await page.evaluate(() => {
    const leads = (x, n) => Array.from({ length: n }, (_, i) => ({ id: 'l' + i, u: 'u1', sd: false, bucket: i < x ? 'b5' : 'b30', d10: 0, lv: 'nc', ap: { tot: 0, sh: 0, ns: 0 }, ad: false, fi: null, opp: 0 }));
    const nueva = slaRubrica('2026-10-05', '2026-10-11');            // W41, toda después del cambio
    const nota = (x, n, rub) => { const c = slaScoreAsesor(leads(x, n), rub || nueva); return c.small ? 'insuficiente' : c.sub.vel; };
    // Muestra mínima: 5 leads (Dirección General, 30-sep-2026; la spec decía 10 y 8/9 era
    // "muestra insuficiente"). Con 5 o más se califica; con 4 o menos, nunca una nota.
    const casos = [[3, 20, 1], [4, 20, 2], [399, 1000, 2], [8, 20, 3], [12, 20, 4], [799, 1000, 4], [16, 20, 5], [20, 20, 5], [8, 9, 5], [4, 5, 5], [3, 4, 'insuficiente'], [4, 4, 'insuficiente']]
      .map(([x, n, esp]) => ({ caso: `${x}/${n}`, pct: (x * 100 / n).toFixed(1) + '%', esp, obt: nota(x, n) }));
    const r = { casos, fallan: casos.filter(c => c.obt !== c.esp).map(c => c.caso) };
    const w39 = slaUmbrales('vel', ...Object.values(slaPeriodoDe(['2026-W39'])));   // 21–27 sep: antes del cambio
    const w40 = slaUmbrales('vel', ...Object.values(slaPeriodoDe(['2026-W40'])));   // 28 sep – 4 oct: la cruza
    const w41 = slaUmbrales('vel', ...Object.values(slaPeriodoDe(['2026-W41'])));
    const w3840 = slaUmbrales('vel', ...Object.values(slaPeriodoDe(['2026-W38', '2026-W39', '2026-W40'])));
    r.periodos = { w39: w39.thr.join('/') + (w39.cambio ? ' · cambio ' + w39.cambio : ''), w40: w40.thr.join('/') + (w40.cambio ? ' · cambio ' + w40.cambio : ''),
      w41: w41.thr.join('/') + (w41.cambio ? ' · cambio ' + w41.cambio : ''), w3840: w3840.thr.join('/') + (w3840.cambio ? ' · cambio ' + w3840.cambio : '') };
    r.w39_8de20 = nota(8, 20, slaRubrica(...Object.values(slaPeriodoDe(['2026-W39']))));     // 40% con 10·20·30·45 → 4
    r.w41_8de20 = nota(8, 20);                                                                // 40% con 20·40·60·80 → 3
    // Pantalla: tabla + ficha + leyenda con un asesor del roster
    const advPrev = ADVISOR_LIST, selPrev = slaState.asesor;
    ADVISOR_LIST = [{ name: 'Asesor Uno', active: true }]; slaState.asesor = 'u1';
    const pinta = (rango, x, n) => slaAsesorSection({ rango, users: { u1: 'Asesor Uno' }, leads: leads(x, n), califCrm: 0 }, leads(x, n));
    const hCruza = pinta(['2026-W40'], 399, 1000), hAntes = pinta(['2026-W39'], 16, 20), hDespues = pinta(['2026-W41'], 16, 20), hChica = pinta(['2026-W41'], 3, 4);
    ADVISOR_LIST = advPrev; slaState.asesor = selPrev;
    const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText || d.textContent; };
    r.ui = {
      leyendaNueva: /Velocidad de primer contacto: 20 · 40 · 60 · 80%/.test(txt(hDespues)),
      tooltipNuevo: /title="Velocidad de primer contacto \(≤5 min\) · umbrales 20 · 40 · 60 · 80%/.test(hDespues),
      notaCruza: /Rúbrica cambió el 1-oct-2026/.test(hCruza), sinNotaDespues: !/Rúbrica cambió/.test(hDespues), sinNotaAntes: !/Rúbrica cambió/.test(hAntes),
      unDecimal: /2 · 39\.9%/.test(txt(hCruza)),                                   // 399/1000 → nota 2, % a un decimal
      antesConserva: /Velocidad de primer contacto: 10 · 20 · 30 · 45%/.test(txt(hAntes)) && /conserva su nota/.test(txt(hAntes)) && /5 · 80\.0%/.test(txt(hAntes)),
      despues5: /5 · 80\.0%/.test(txt(hDespues)),
      chica: /sin muestra suficiente · 75\.0%/.test(txt(hChica)) && !/sla-pill s\d/.test(hChica) && /Con menos de 5 leads no se emite nota/.test(txt(hChica)),
    };
    // Parámetro, no código: un juego guardado con fecha manda; uno inválido cae al default.
    const ovrPrev = SLA_RUBRICA_OVR;
    SLA_RUBRICA_OVR = { vel: [{ desde: null, thr: [10, 20, 30, 45] }, { desde: '2026-10-01', thr: [20, 40, 60, 80] }, { desde: '2027-01-04', thr: [25, 50, 70, 90] }] };
    r.guardado = slaUmbrales('vel', '2027-01-04', '2027-01-10').thr.join('/') + ' · ' + slaUmbrales('vel', '2026-12-28', '2027-01-03').thr.join('/');
    SLA_RUBRICA_OVR = { vel: [{ desde: 'ayer', thr: [50, 40, 30, 20] }] };
    r.invalido = slaUmbrales('vel', '2026-10-05', '2026-10-11').thr.join('/');
    SLA_RUBRICA_OVR = ovrPrev;
    r.ok = !r.fallan.length && r.periodos.w39 === '10/20/30/45' && r.periodos.w40 === '20/40/60/80 · cambio 2026-10-01' && r.periodos.w41 === '20/40/60/80'
      && r.periodos.w3840 === '20/40/60/80 · cambio 2026-10-01' && r.w39_8de20 === 4 && r.w41_8de20 === 3 && Object.values(r.ui).every(Boolean)
      && r.guardado === '25/50/70/90 · 20/40/60/80' && r.invalido === '20/40/60/80';
    return r;
  });
  console.log('\n[rubrica v1.2] casos', rb.casos.map(c => `${c.caso}=${c.obt}${c.obt !== c.esp ? '≠' + c.esp : ''}`).join(' · '));
  console.log('[rubrica v1.2] periodos', JSON.stringify(rb.periodos), '· W39 8/20 →', rb.w39_8de20, '· W41 8/20 →', rb.w41_8de20);
  console.log('[rubrica v1.2] pantalla', JSON.stringify(rb.ui), '· guardado', rb.guardado, '· inválido →', rb.invalido);
  if (!rb.ok) hallazgos.push({ vista: 'rubrica:v1.2', rb });
  // Change Spec v1.1 (Lead Filters, 1-oct-2026): los diez casos de aceptación de la
  // sección 6, con el código real de la página y datos sintéticos de la semana 5–11 oct.
  // El corte de actividad posterior a la descalificación (caso 2) vive en el backend y lo
  // prueba scripts/test-sla-report.js; aquí se comprueba que el corte se le pide.
  VISTA = 'reglas:v1.1';
  const v11 = await page.evaluate(() => {
    const Z = (local) => Date.parse(local + '-05:00');                   // hora Tulum → ms
    const iso = (t) => new Date(t).toISOString();
    const users = { u1: 'Daniela Arana', u2: 'Mariano Molina', u3: 'Diana Jiménez', ces: 'César Rescate' };
    const pipes = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }, { id: 'sD', name: 'Descalificado' }, { id: 'sR', name: 'Rescate' }] },
                   { id: 'p2', name: 'Brokers — Expansión y activación', stages: [{ id: 'sE', name: 'Nuevo' }] }];
    const oppFields = [{ id: 'fC', name: 'Causa de descalificación' }, { id: 'fE', name: 'Evidencia de descalificación' }, { id: 'fA', name: 'Asesor que descalificó' }, { id: 'fF', name: 'Fecha de entrada a Descalificado' }];
    const campos = [{ id: 'fNc', name: 'Sin llamada - fecha de inicio' }];
    const contactos = [], sweeps = {}, opps = [];
    const lead = (id, u, local, extra, sw) => {
      contactos.push(Object.assign({ id, n: 'Lead ' + id, c: iso(Z(local)), src: 'facebook', u, tags: [], attr: {}, cf: {} }, extra || {}));
      sweeps[id] = Object.assign({ foM: Z(local) + 2 * 60e3, fi: null, fe: null, days: [], calls: 0, chans: ['whatsapp'], deliv: { sent: 1, delivered: 1, read: 0, failed: 0 }, ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 } }, sw || {});
    };
    const opp = (ct, u, s, cf, p) => opps.push({ id: 'o-' + ct, ct, u, st: 'open', c: contactos.find(c => c.id === ct).c, p: p || 'p1', s, sc: '', scE: cf && cf.fF || '', cf: cf || {} });
    // 1 · respuesta ofensiva, descalificado como "Contacto inapropiado / broma" con evidencia
    lead('inv', 'u1', '2026-10-05T10:00:00', {}, { fi: Z('2026-10-05T11:00:00'), fe: Z('2026-10-05T11:00:00') });
    opp('inv', 'u1', 'sD', { fC: 'contacto inapropiado/broma ', fE: 'Respondió con insultos', fF: iso(Z('2026-10-05T13:00:00')) });
    // 2 · lead real "No alineado": se mide hasta su entrada a Descalificado
    lead('real', 'u1', '2026-10-05T11:00:00', {}, { days: ['2026-10-05', '2026-10-06'] });
    opp('real', 'u1', 'sD', { fC: 'No alineado', fE: 'Busca renta vacacional', fF: iso(Z('2026-10-06T16:00:00')) });
    // 3 · 24 h en Descalificado sin causa: el CRM puso la etiqueta y lo pasó a Rescate (César)
    lead('rev', 'ces', '2026-10-05T12:00:00', { tags: ['descalificacion injustificada'] });
    opp('rev', 'ces', 'sR', { fA: 'Daniela Arana', fF: iso(Z('2026-10-06T09:00:00')) });
    // 3b · en Descalificado hace menos de 24 h sin causa: se mide como activo
    lead('pend', 'u2', '2026-10-11T15:00:00');
    opp('pend', 'u2', 'sD', { fF: iso(Z('2026-10-12T05:00:00')) });
    // 4 · etiqueta broker asignada a Daniela; 4b · broker por el pipeline de Expansión
    lead('brk', 'u1', '2026-10-05T13:00:00', { tags: ['broker'] });
    lead('brk2', 'u2', '2026-10-05T13:30:00');
    opp('brk2', 'u2', 'sE', {}, 'p2');
    // 4c · alta a mano con una etiqueta que EMPIEZA con broker (14-oct-2026): también fuera
    lead('brk3', 'u3', '2026-10-05T14:00:00', { tags: ['Broker-signup-web'] });
    // 5 · entra 22:10, primer WhatsApp manual 10:40 del día siguiente
    lead('noche', 'u2', '2026-10-05T22:10:00', {}, { foM: Z('2026-10-06T10:40:00') });
    // 6 · entra 18:59, primer toque 19:07
    lead('tarde', 'u2', '2026-10-05T18:59:00', {}, { foM: Z('2026-10-05T19:07:00') });
    // 7 · solo mensaje con un WhatsApp previo del lead: pasos con 1 mensaje + 1 email
    lead('ncm', 'u3', '2026-10-05T10:00:00', { tags: ['sin llamada - solo mensaje'], cf: { fNc: iso(Z('2026-10-06T10:00:00')) } },
      { fi: Z('2026-10-05T12:00:00'), fe: Z('2026-10-05T12:00:00'), li: Z('2026-10-05T12:00:00'), chans: ['whatsapp', 'email'], nc: { calls: 0, dias: 0, inb: true, c90: false, post: 0 } });
    // 8 · número inválido con un solo intento fallido
    lead('nci', 'u3', '2026-10-05T10:30:00', { tags: ['sin llamada - numero invalido'], cf: { fNc: iso(Z('2026-10-06T10:00:00')) } },
      { calls: 1, chans: ['whatsapp', 'email', 'call'], nc: { calls: 1, dias: 1, inb: false, c90: false, post: 0 } });
    // (pendiente de validación: número inválido con 2 intentos en 2 días, C-20 abierto)
    lead('nciP', 'u3', '2026-10-05T11:30:00', { tags: ['sin llamada - numero invalido'], cf: { fNc: iso(Z('2026-10-07T10:00:00')) } },
      { calls: 2, chans: ['whatsapp', 'email', 'call'], nc: { calls: 2, dias: 2, inb: false, c90: false, post: 0 } });
    // 9 · Mariano con 3 de 10 leads "solo mensaje" (30%) contra 4 de 30 del equipo (13.3%)
    for (let i = 0; i < 8; i++) lead('f1' + i, 'u1', `2026-10-0${6 + (i % 3)}T10:${10 + i}:00`);
    for (let i = 0; i < 7; i++) lead('f2' + i, 'u2', `2026-10-0${6 + (i % 3)}T11:${10 + i}:00`, i < 3 ? { tags: ['sin llamada - solo mensaje'] } : {}, i < 3 ? { nc: { calls: 0, dias: 0, inb: true, c90: false, post: 0 } } : {});
    for (let i = 0; i < 7; i++) lead('f3' + i, 'u3', `2026-10-0${6 + (i % 3)}T12:${10 + i}:00`);
    const now = Z('2026-10-12T12:00:00');
    const ncState = slaActualizarSinLlamada({}, contactos, now);
    const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, opps, users, campos, pipes, { oppFields, oppFieldsOk: true, ncState, tagged: [], taggedOk: true, now });
    const C11 = slaCamposV11(campos, oppFields), disp = slaDisposiciones(contactos, opps, users, pipes, C11, now);
    const L = {}; agg.leads.forEach(l => { L[l.id] = l; });
    const V = agg.v11, r = {};
    const advPrev = ADVISOR_LIST, selPrev = slaState.asesor, aggPrev = slaState.agg;
    ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }, { name: 'Mariano Molina', active: true }, { name: 'Diana Jiménez', active: true }];
    slaState.asesor = 'u1'; slaState.agg = agg; agg.ts = now;
    navIr('ventas', 'desempeno'); slaRender();
    const vista = document.getElementById('view-sla'), txt = vista.innerText, html = vista.innerHTML;
    r.c1 = !L.inv && V.invalidos.some(x => x.id === 'inv' && x.causa === 'Contacto inapropiado / broma') && agg.leads.filter(l => l.u === 'u1' && l.fi).length === 0;
    r.c2 = !!(L.real && L.real.dq && L.real.dq.tipo === 'real' && disp.real.cut === Z('2026-10-06T16:00:00'));
    r.c3 = !!(L.rev && L.rev.uNota === 'u1' && L.rev.u === 'ces' && V.revertidas.some(x => x.id === 'rev' && x.asesorU === 'u1')) && /Descalificaciones revertidas: 1/.test(txt) && /Incluye 1 descalificación revertida, hoy en Rescate/.test(txt);
    r.c3b = !!(L.pend && L.pend.dq && L.pend.dq.tipo === 'pendiente') && V.pendientes === 1;
    r.c4 = !L.brk && !L.brk2 && !L.brk3 && V.brokers.map(x => x.id).sort().join() === 'brk,brk2,brk3'
      && (V.brokers.find(x => x.id === 'brk3') || {}).por === 'etiqueta Broker-signup-web';
    r.c5 = !!(L.noche && L.noche.fh && L.noche.velOk) && !agg.leads.filter(l => !l.fh).some(l => l.id === 'noche');
    r.c6 = !!(L.tarde && !L.tarde.fh && L.tarde.velOk === false);
    r.c7 = !!(L.ncm && L.ncm.nc && L.ncm.nc[0].estado === 'valida' && L.ncm.breakup === true);
    r.c8 = !!(L.nci && L.nci.nc[0].estado === 'sin' && L.nci.breakup === false) && /Etiquetas sin evidencia · 1/.test(txt) && /1 intento de llamada fallido más y intentos en 2 días distintos/.test(txt);
    r.pendVal = !!(L.nciP && L.nciP.nc[0].estado === 'pendiente') && /Pendiente de validación · 1/.test(txt);
    // 9: la fila de Mariano marca 30.0% con ⚠; la de Diana (1 de 10) no
    const fila = (nom) => [...vista.querySelectorAll('tr')].find(tr => tr.querySelector('td') && tr.querySelector('td').innerText.trim() === nom && /sin llamada|\(\d+ de \d+\)|·/.test(tr.innerText) && tr.closest('table').innerText.includes('LEADS SIN LLAMADA'));
    const fM = fila('Mariano Molina'), fD = fila('Diana Jiménez');
    r.c9 = !!(fM && /30\.0% \(3 de 10\) ⚠/.test(fM.innerText) && fD && !/\(1 de 10\) ⚠/.test(fD.children[3].innerText)) && /Promedio del equipo\s+30\s+6\.7%\s+13\.3%/.test(txt);
    // 10: ningún % de la pantalla pasa de 100
    const pcts = (txt.match(/\d+(?:\.\d+)?%/g) || []).map(x => parseFloat(x));
    r.c10 = pcts.length > 20 && Math.max(...pcts) <= 100;
    r.maxPct = Math.max(...pcts);
    r.rotulos = ['Reglas de medición vigentes desde el 1 de octubre de 2026', 'Leads inválidos (fuera de la nota)', 'Error de asignación', 'Descalificaciones revertidas', 'Fuera de horario atendidos antes de las 11:00', 'Etiquetas sin evidencia', 'Pendiente de validación', 'Leads sin llamada — % del asesor vs. promedio del equipo']
      .filter(t => !txt.toLowerCase().includes(t.toLowerCase()));
    r.velCampo = /Cumplieron su SLA de 1er toque/i.test(txt) && /antes de las 11:00/i.test(txt);
    // Periodo anterior al 1-oct: reglas viejas, sin exclusiones nuevas ni banner v1.1
    const aggViejo = buildSlaAgg(['2026-W39'], contactos.map(c => Object.assign({}, c, { c: new Date(Date.parse(c.c) - 14 * 86400e3).toISOString() })), sweeps, opps, users, campos, pipes, { oppFields, ncState, now });
    r.viejo = aggViejo.v11 === null && aggViejo.leads.some(l => l.id === 'inv') && aggViejo.leads.some(l => l.id === 'brk') && !/Fuera de la nota/.test(slaBannerV11(aggViejo)) && /no se aplican hacia atrás/.test(slaBannerV11(aggViejo));
    ADVISOR_LIST = advPrev; slaState.asesor = selPrev; slaState.agg = aggPrev;
    r.ok = r.c1 && r.c2 && r.c3 && r.c3b && r.c4 && r.c5 && r.c6 && r.c7 && r.c8 && r.pendVal && r.c9 && r.c10 && !r.rotulos.length && r.velCampo && r.viejo;
    return r;
  });
  // R-01 del lado de Marketing: Calidad de Leads ve los inválidos por fuente y campaña.
  const lqInv = await page.evaluate(() => {
    const a = lqInvalido({ dq: { causa: 'pruebas de marketing', evid: 'Registro de QA' } }, []);
    const b = lqInvalido({ dq: { causa: 'Pruebas de marketing', evid: 'x' } }, ['descalificacion injustificada']);
    const c = lqInvalido({ dq: { causa: 'Número equivocado', evid: '' } }, []);
    const d = lqInvalido({ dq: { causa: 'No alineado', evid: 'x' } }, []);
    const h = lqBloqueInvalidos([{ fuente: 'Meta', camp: 'INVESTORS_MX', inv: 'Pruebas de marketing' }, { fuente: 'Meta', camp: 'INVESTORS_MX', inv: '' }]);
    return { ok: a === 'Pruebas de marketing' && b === '' && c === '' && d === '' && /INVESTORS_MX/.test(h) && /50\.0%/.test(h) };
  });
  v11.lq = lqInv.ok; if (!lqInv.ok) hallazgos.push({ vista: 'reglas:v1.1:lq', lqInv });
  // Calidad de Leads rediseñada (Dirección, 8 y 9-oct-2026): costo por SQL y semáforo, atribución
  // inferida de la landing de seguridad, cruce por ID de campaña, alias de Google, aviso de
  // "sin campaña" = filas de la tabla, embudo Zoom/OPP/WON, % contactados, todo en MXN, matriz
  // de reglas detrás de un botón y Datos de campañas plegado. Desde el 9-oct: la exploración
  // (selector) solo muestra el color HISTÓRICO, sin acciones; Conclusiones = la decisión de hoy
  // con rango fijo (30 días cerrados, 7 contra 7), fecha de decisión, Atender hoy, pausadas
  // recientemente, bitácora y recomendaciones con anuncio + conjunto y cifras.
  VISTA = 'lq:rediseño';
  await page.evaluate(() => navIr('marketing', 'calidad'));
  await page.waitForTimeout(1500);
  const lqx = await page.evaluate(async (fx0) => {
    window.LQ_HOY_FIJO = '2026-10-05';                            // decisión de hoy: 05-sep → 04-oct
    const copia = () => JSON.parse(JSON.stringify(fx0));          // buildLqAgg modifica los leads
    const fx = copia();
    const agg = buildLqAgg(fx.boot, fx.rawLeads, fx.spendRows, fx.weeks, fx.opps, fx.adRows, fx.adExtra);
    agg.fallos = []; agg.monedas = ['MXN'];
    Object.assign(lqState, { agg, exp: {}, q: '', plat: 'all', level: 'camp', qual: 'auto', diagReglas: false, ia: null, bitacora: [] });
    lqPopulateWeeks();
    const rango = (a, b) => { document.getElementById('lq-sem-ini').value = a; document.getElementById('lq-sem-fin').value = b; };
    rango('2026-W37', '2026-W40');
    const r = {};
    const inf = agg.leads.filter(l => l.inf);
    r.inferidos = inf.length + ' ' + [...new Set(inf.map(l => l.camp + ' / ' + l.grp))].join('|');
    const tarde = agg.leads.find(l => String(l.c).startsWith('2026-10-08'));
    r.tardeNoInferido = !!tarde && !tarde.inf && tarde.camp !== 'INVESTORS_MX_DYNAMIC-TOPLPS_090926';
    r.porId = agg.leads.filter(l => l.pid && l.camp === 'INVESTORS_EN_FORMULARIOMETA_TULUM_100626').length;
    r.googleMX = agg.leads.filter(l => l.camp === 'INVESTORS - GOOGLE SEARCH -- MX' && l.fuente === 'Google' && l.wk >= '2026-W37' && l.wk <= '2026-W40').length;
    r.numerico = agg.leads.filter(l => l.camp === 'INVESTORS - GOOGLE SEARCH - US+CAN').length;
    const S = (inv, n) => { const x = lqSemaforo(inv, n); return x ? x.c + (x.chica ? '*' : '') + ':' + x.k : 'null'; };
    r.sem = [S(0, 0), S(7999, 0), S(8000, 0), S(8000, 2), S(12000, 3), S(12001, 3), S(18000, 3), S(18001, 3), S(3000, 1), S(7000, 2), S(7999, 2), S(7000, 1)].join(' ');
    const S2 = (inv, n, c) => { const x = lqSemaforo(inv, n, c); return x.c + ':' + x.k; };
    const D = (inv, n, nl, plat) => { const x = lqSemaforo(inv, n, { n: nl, tr: nl, plat }); return x.acc + ' [' + (x.diag ? x.diag.txt : '') + ']'; };
    r.diagUnit = [D(10000, 2, 30, 'Google'), D(10000, 2, 15, 'Meta'), D(10000, 2, 22, 'Meta'), D(7000, 1, 30, 'Google')].join(' || ');
    r.semSeg = [S2(12000, 0, { n: 10, tr: 4 }), S2(12000, 0, { n: 10, tr: 5 }), S2(30000, 3, { n: 10, tr: 1 }), S2(7000, 1, { n: 10, tr: 1 }), S2(12000, 0, { n: 0, tr: 0 })].join(' ');
    const txt = () => document.getElementById('lq-content').textContent;
    const filas = (sel) => [...document.querySelectorAll(sel + ' tr')].filter(tr => tr.querySelector('td.name'));
    const hdr = (sel) => [...document.querySelector(sel + ' tr').querySelectorAll('th')].map(th => th.textContent.trim());
    // ---- Exploración: Reporte Combinado con el selector W37–W40
    lqState.sub = 'combinado'; lqRender();
    let t = txt();
    r.tarjetas = ['Inversión total', 'Leads CRM', 'SQL+', 'Costo por SQL', 'WON'].every(k => [...document.querySelectorAll('#lq-content .crm-kpi .k-lbl')].some(e => e.textContent.trim() === k))
      && !/% calificados|Costo \/ calificado/i.test(t);
    const H = hdr('table.lq-combo');
    r.columnas = H.join('|');
    const sem = {}, celda = {};
    filas('table.lq-combo').forEach(tr => {
      const td = [...tr.querySelectorAll('td')], nombre = td[0].textContent.replace(/^(META|GOOGLE)\s*/, '').replace(/\s*\d+ con atribución inferida$/, '').trim();
      const sc = tr.querySelector('td.lq-semcell .lq-sem');
      sem[nombre] = sc ? sc.textContent + (tr.querySelector('td.lq-semcell .lq-sem-hist') ? '·hist' : '') : '—';
      celda[nombre] = Object.fromEntries(H.map((h, i) => [h, td[i] ? td[i].textContent.trim() : '']));
    });
    r.semaforos = sem;
    // Nota de SQL+: los nombres de esos leads al pasar el mouse sobre la cifra (Dirección, 13-oct-2026).
    // Cuenta = la cifra, sin ensuciar el texto de la tabla, y se cierra al salir de la celda.
    const tipDe = (td) => { td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const b = document.querySelector('.lq-tip');
      return b && !b.hidden ? b.querySelector('b').textContent + ' | ' + [...b.querySelectorAll('li')].map(li => li.textContent).join(', ') : 'sin nota'; };
    const iSql = H.indexOf('SQL+');
    const tr090 = filas('table.lq-combo').find(tr => tr.querySelector('td.name').textContent.includes('INVESTORS_MX_DYNAMIC-TOPLPS_090926'));
    const td090 = tr090 && tr090.querySelectorAll('td')[iSql];
    r.tipSql = td090 ? td090.textContent.trim() + ' · ' + tipDe(td090) : 'sin fila';
    document.querySelector('table.lq-combo td.name').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    r.tipSqlCierra = !!document.querySelector('.lq-tip') && document.querySelector('.lq-tip').hidden;
    const trTodo = document.querySelector('table.lq-combo tr.lq-total2');
    r.tipSqlTotal = trTodo ? trTodo.querySelectorAll('td')[iSql].textContent.trim() + ' · ' + tipDe(trTodo.querySelectorAll('td')[iSql]).split(' | ')[0] : '';
    r.tipSqlCero = [...document.querySelectorAll('table.lq-combo td[data-lq-tip]')].every(td => Number(td.textContent.replace(/\D/g, '')) > 0)
      && [...document.querySelectorAll('table.lq-combo tr')].every(tr => { const td = tr.querySelectorAll('td')[iSql]; return !td || td.textContent.trim() === '0' ? !(td && td.dataset.lqTip) : true; });
    // En exploración no hay acciones, ni "Qué hacer", ni alerta ⚠, ni reglas de acción.
    r.explSinAcciones = !document.querySelector('#lq-content .lq-sem-acc, #lq-content [data-pasos-btn], #lq-content .lq-recs, #lq-content .lq-alerta')
      && !/Subir presupuesto diario|Pausar la campaña|Revisar seguimiento antes de pausar|Optimizar (calidad|costo)|Qué hacer ▸/.test(t);
    r.avisoExpl = (document.getElementById('lq-aviso-expl') || {}).textContent || '';
    const lect = [...document.querySelectorAll('#lq-content .lq-lectura p')].map(p => p.textContent.replace(/\s+/g, ' ').trim());
    r.lecturaHist = lect.some(x => /^Color histórico del periodo \(referencia, no es la decisión de hoy\): VERDE .* ROJO .*US\+CAN/.test(x)) && lect.some(x => /está en Conclusiones, siempre con los últimos 30 días cerrados/.test(x));
    const d090 = celda['INVESTORS_MX_DYNAMIC-TOPLPS_090926'] || {};
    r.embudo090 = [d090['SQL+'], d090['Zoom realizado'], d090['OPP vigentes'], d090['WON'], d090['% contactados'], d090['Costo por SQL']].join(' ');
    r.cplSinAlerta = !Object.values(celda).some(v => /⚠/.test(v['CPL'] || ''));
    const tot = [...document.querySelectorAll('table.lq-combo tr.total')][0];
    r.totalPagado = tot ? tot.textContent.replace(/\s+/g, ' ') : '';
    r.inferidaBadge = /8 con atribución inferida/.test(t);
    const gb = [...document.querySelectorAll('#lq-content .lq-hbar')];
    r.grafica = !document.getElementById('lq-ch-fam') + ' ' + gb.length + ' ' + (gb[0] ? gb[0].querySelector('.lq-hbar-nom').textContent + ' | ' + gb[0].querySelector('.lq-hbar-val').textContent.replace(/\s+/g, ' ').trim() + ' | ' + gb[0].querySelector('.lq-sem').textContent : '')
      + ' | ' + /semáforo histórico del periodo elegido/.test(t);
    const card = (k) => { const c = [...document.querySelectorAll('#lq-content .crm-kpi')].find(e => e.querySelector('.k-lbl').textContent.trim() === k); return c ? c.querySelector('.k-val').textContent.trim() : ''; };
    r.tarjetasBk = [card('Leads CRM'), card('SQL+'), card('WON')].join(' ');
    r.notaBkCombo = /Excluidos de todos los cálculos en este rango: 3 leads de brokers/.test(t);
    r.sinJenniferCombo = !/Jennifer/.test(t);
    const fUS = celda['INVESTORS - GOOGLE SEARCH - US+CAN'] || {};
    r.filaUS = [fUS['Leads CRM'], fUS['% trabajados'], fUS['% contactados'], fUS['SQL+'], (sem['INVESTORS - GOOGLE SEARCH - US+CAN'] || '')].join(' ');
    const fMX = celda['INVESTORS - GOOGLE SEARCH -- MX'] || {};
    r.filaMX = [fMX['Leads CRM'], fMX['SQL+']].join(' ');
    r.sinFilasNumericas = !Object.keys(celda).some(k => /^\d{5,}$/.test(k)) && !/Windsor no reconoce/.test(t);
    r.sinPesos = !/\$/.test(t);
    // ---- Exploración: Calidad de Lead
    lqState.sub = 'calidad'; lqRender();
    t = txt();
    const av = t.match(/(\d+) de (\d+) leads del rango llegaron sin campaña/);
    const sinFilas = filas('table.lq-tree').filter(tr => /\(sin campaña atribuida\)/.test(tr.querySelector('td.name').textContent));
    const hT = hdr('table.lq-tree'), iN = hT.indexOf('Leads CRM');
    r.sinCampania = (av ? av[1] + ' de ' + av[2] : 'sin aviso') + ' · filas ' + sinFilas.reduce((a, tr) => a + Number(tr.querySelectorAll('td')[iN].textContent.replace(/\D/g, '') || 0), 0);
    r.semEnCalidad = hT.includes('SQL+') && hT.includes('Costo por SQL') && hT.includes('Semáforo histórico') && hT.includes('Zoom realizado') && hT.includes('% contactados')
      && !document.querySelector('#lq-content .lq-sem-acc, #lq-content [data-pasos-btn]');
    r.sinMetricasViejas = !/Alto valor|alto valor|Costo\/alto valor|% calificados|Calif\.(?!\w)/.test(t) && !/\$\d/.test(t);
    r.notaBkCalidad = /Excluidos de todos los cálculos en este rango: 3 leads de brokers/.test(t);
    r.sinJenniferCalidad = !/Jennifer/.test(t);
    r.brokers = agg.leads.filter(l => l.bk).map(l => l.n).join('|') + ' · vista ' + lqVista(agg).leads.filter(l => l.bk).length + ' · canal ' + agg.leads.filter(l => l.bk && l.ch === 'brokers').length;
    const acc0 = {}, st = { a: { p: 'Brokers - Producción (B2B2C)', s: 'WON', i: 3 }, b: { p: 'Brokers - Expansión y activación', s: 'Activo', i: 1 }, c: { p: 'Seguimiento de ventas', s: 'Contacto establecido', i: 7 } };
    lqSumarOpp(acc0, { ct: 'x1', s: 'a', st: 'won' }, st, {}, null); lqSumarOpp(acc0, { ct: 'x2', s: 'b', st: 'open' }, st, {}, null);
    lqSumarOpp(acc0, { ct: 'x3', s: 'c', st: 'open' }, st, {}, null); lqSumarOpp(acc0, { ct: 'x3', s: 'a', st: 'open', sc: '2020-01-01' }, st, {}, null);
    r.sumarOppBk = ['x1', 'x2', 'x3'].map(k => acc0[k].bk ? 1 : 0).join('');
    r.matrizOculta = !!document.getElementById('lq-diag-reglas') && !/Reglas automáticas vs\. captura del equipo/.test([...document.querySelectorAll('#lq-content h3')].map(h => h.textContent).join('|'));
    document.getElementById('lq-diag-reglas').click();
    r.matrizConBoton = /Reglas automáticas vs\. captura del equipo/.test([...document.querySelectorAll('#lq-content h3')].map(h => h.textContent).join('|'));
    lqState.diagReglas = false;
    // ---- Exploración: Datos de campañas
    lqState.sub = 'datos'; lqState.exp = { [lqExpKey('ads|Meta · INVESTORS_MX_DYNAMIC-TOPLPS_090926')]: true }; lqRender();
    r.datosFila = hdr('table.lq-datos').join('|');
    const pl = document.querySelector('#lq-content .lq-pliegue');
    r.datosPliegue = !!pl && ['Impresiones', 'Clics', 'CTR', 'CPC', 'Plataformas'].every(k => pl.textContent.includes(k));
    r.avisoDatos = !!document.getElementById('lq-aviso-expl');
    // Columnas del CRM por conjunto / anuncio (Dirección, 12-oct-2026). Hoy utm_content trae el
    // conjunto: el CRM va por conjunto, por anuncio "—", y lo que no cruza va en "Sin anuncio identificado".
    const pliegue = (camp) => { lqState.exp = { [lqExpKey('ads|Meta · ' + camp)]: true }; lqRender(); return document.querySelector('#lq-content .lq-pliegue'); };
    const filasPl = (p) => p ? [...p.querySelectorAll('table.lq-pl-tabla tbody tr')].map(tr => [...tr.cells].slice(0, 7).map(td => td.textContent.replace(/\s+/g, ' ').trim()).join(' ¦ ')).join(' || ') : '';
    const cuadrePl = (p) => p && p.querySelector('.lq-pl-cuadre') ? p.querySelector('.lq-pl-cuadre').textContent.replace(/\s+/g, ' ').trim() : '';
    const pE2 = pliegue('INVESTORS_US/CA_ESCAPE_100626');
    r.datosCrmCols = pE2 ? [...pE2.querySelectorAll('table.lq-pl-tabla thead th')].map(t => t.textContent.trim()).join('|') : '';
    r.datosCrmE2 = filasPl(pE2); r.datosCuadreE2 = cuadrePl(pE2);
    r.tipSqlDatos = pE2 ? [...pE2.querySelectorAll('table.lq-pl-tabla td[data-lq-tip]')].map(td => td.textContent.trim() + ' · ' + tipDe(td).split(' | ')[0]).join(' | ') : '';
    const pE9 = pliegue('INVESTORS_US/CA_ESCAPE_090926');
    r.datosCrmE9 = filasPl(pE9); r.datosCuadreE9 = cuadrePl(pE9);
    // Con utm_content={{ad.id}}: el anuncio se identifica por su ID y se llenan sus columnas
    const fx5 = copia(), ids5 = {};
    fx5.adRows.forEach(a => { ids5[a.id] = ids5[a.id] || String(9100000000 + Object.keys(ids5).length + 1); a.id = ids5[a.id]; });
    const ad5 = fx5.adRows.find(a => a.camp === 'INVESTORS_US/CA_ESCAPE_100626' && a.grp === 'EN_LLAMADA_ESCAPE');
    fx5.rawLeads.filter(l => l.cf && l.cf.f_camp === 'INVESTORS_US/CA_ESCAPE_100626' && l.cf.f_cont === 'EN_LLAMADA_ESCAPE').slice(0, 3).forEach(l => { l.cf.f_cont = ad5.id; });
    const agg5 = buildLqAgg(fx5.boot, fx5.rawLeads, fx5.spendRows, fx5.weeks, fx5.opps, fx5.adRows, fx5.adExtra); agg5.fallos = []; agg5.monedas = ['MXN'];
    lqState.agg = agg5;
    const pId = pliegue('INVESTORS_US/CA_ESCAPE_100626');
    r.datosCrmId = ad5.name + ' :: ' + filasPl(pId); r.datosCuadreId = cuadrePl(pId);
    lqState.agg = agg;
    lqState.exp = {};
    // ---- Conclusiones: la decisión de hoy, idéntica con cualquier filtro de fechas
    const foto = () => { lqState.sub = 'conclusiones'; lqRender(); return document.getElementById('lq-content').innerHTML; };
    rango('2026-W37', '2026-W40'); const c1 = foto();
    rango('2026-W38', '2026-W39'); const c2 = foto();
    rango('2026-W40', '2026-W40'); const c3 = foto();
    r.conclIdenticas = c1 === c2 && c2 === c3 && !document.getElementById('lq-aviso-expl');
    rango('2026-W37', '2026-W40'); foto();
    t = txt().replace(/\s+/g, ' ');
    r.etiqueta = (document.getElementById('lq-decision-etq') || {}).textContent.replace(/\s+/g, ' ').trim();
    const cfilas = [...document.querySelectorAll('#lq-content table.lq-concl tr[data-dec-camp]')];
    r.ordenDecision = cfilas.map(tr => tr.dataset.decCamp.replace(/^INVESTORS[_ -]+/, '') + ' [' + (tr.querySelector('.lq-cuando') || {}).textContent + ']').join(' | ');
    const fila = (n) => cfilas.find(tr => tr.dataset.decCamp === n);
    const celdaTxt = (n, i) => { const f = fila(n); return f ? f.querySelectorAll('td')[i].textContent.replace(/\s+/g, ' ').trim() : ''; };
    r.dec100 = celdaTxt('INVESTORS_US/CA_ESCAPE_100626', 2);
    r.decMX = celdaTxt('INVESTORS - GOOGLE SEARCH -- MX', 2);
    r.decForm = celdaTxt('INVESTORS_EN_FORMULARIOMETA_TULUM_100626', 2) + ' || ' + celdaTxt('INVESTORS_EN_FORMULARIOMETA_TULUM_100626', 3);
    r.dec090 = celdaTxt('INVESTORS_US/CA_ESCAPE_090926', 2);
    r.recEscape = celdaTxt('INVESTORS_US/CA_ESCAPE_100626', 4);
    r.rec090 = celdaTxt('INVESTORS_MX_DYNAMIC-TOPLPS_090926', 4);
    r.recVerde = celdaTxt('INVESTORS_MX_DYNAMIC-TOPLPS_150726', 4);
    r.recRevisar = celdaTxt('INVESTORS_US/CA_ESCAPE_090926', 4);
    r.recAlerta = celdaTxt('INVESTORS_EN_FORMULARIOMETA_TULUM_100626', 4);
    r.recItems = ['INVESTORS_US/CA_ESCAPE_100626', 'INVESTORS_MX_DYNAMIC-TOPLPS_090926', 'INVESTORS_MX_DYNAMIC-TOPLPS_150726', 'INVESTORS_US/CA_ESCAPE_090926', 'INVESTORS_EN_FORMULARIOMETA_TULUM_100626', 'INVESTORS - GOOGLE SEARCH -- MX']
      .map(n => { const f = fila(n); return f ? f.querySelectorAll('ol.lq-recs > li').length : -1; }).join(' ');
    r.pausadas = [...document.querySelectorAll('#lq-content ul.lq-pausadas li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
    r.usSinAccion = !fila('INVESTORS - GOOGLE SEARCH - US+CAN');
    const M = lqState._decision;
    r.recObjetos = M.activas.filter(m => m.recs).every(m => m.recs.items.length <= 3 && m.recs.items.every(it => it.objs.length && it.objs.every(o => o.txt)
      && (it.objs.some(o => o.ruta && o.ruta.includes(m.camp)) || /telemarketer|Trabajar los/.test(it.txt))));
    r.bitacora = [...document.querySelectorAll('#lq-bitacora tbody tr')].map(tr => [...tr.cells].slice(0, 4).map(td => td.textContent.trim()).join(' | ')).join(' || ')
      + (document.getElementById('lq-bit-form') ? ' · form' : '');
    // Un cambio registrado en la bitácora mueve la fecha de decisión (03-oct + 7 = 10-oct)
    lqState.bitacora = [{ id: 'b-prueba', fecha: '2026-10-03', camp: 'INVESTORS_MX_DYNAMIC-TOPLPS_150726', cambio: 'presupuesto de 300 a 360 MXN', motivo: 'verde', por: 'prueba', ts: 1 }];
    foto();
    r.decBitacora = (fila2 => fila2 ? fila2.querySelectorAll('td')[2].textContent.replace(/\s+/g, ' ').trim() : '')([...document.querySelectorAll('#lq-content table.lq-concl tr[data-dec-camp]')].find(tr => tr.dataset.decCamp === 'INVESTORS_MX_DYNAMIC-TOPLPS_150726'));
    lqState.bitacora = [];
    // Unitarias de lqRecomendar con los datos de la decisión
    const vista = lqVista(agg), V = agg.dec.ventana;
    const ctx = { agg: vista, dec: agg.dec, V, dias: 30, leadsRango: 0 };
    LQ_SEMAFORO.muestraPausa = 20;                                   // 8,000 MXN: nada llega
    const esc8k = lqModeloDecision(vista).activas.find(m => m.camp === 'INVESTORS_US/CA_ESCAPE_100626');
    LQ_SEMAFORO.muestraPausa = 2;
    r.recEsperar = esc8k && esc8k.recs ? esc8k.recs.sinMuestra + ' || ' + esc8k.recs.items.map(x => lqRecTexto(x, true)).join(' / ') : '';
    const us = lqModeloDecision(vista).pausadas.find(m => m.camp === 'INVESTORS - GOOGLE SEARCH - US+CAN');
    const rg = us ? lqRecomendar({ ...us, alerta: null, sem: { ...lqSemaforo(us.inv, us.sqlp, { n: us.n, tr: us.tr, plat: us.plat }), k: 'optimizar', chica: false, diag: { calidad: true, costo: false } } }, ctx) : null;
    r.recGoogleKw = rg ? rg.items.map(x => lqRecTexto(x)).join(' / ') : '';
    const Lx = (lv, n) => Array.from({ length: n }, () => ({ lv, alv: lv, tr: 1 }));
    const Ax = (name, sp, res, url) => ({ name, id: name, status: 'ACTIVE', url, spend: sp, res, clicks: Math.round(sp / 25), impr: 0, fq: null, pps: new Set(), leads: [] });
    const Gx = (name, sp, leads, ads) => ({ name, gid: '', spend: sp, res: 0, clicks: 0, impr: 0, pps: new Set(), leads, ads });
    const gA = Gx('CONJ_A', 3000, [...Lx('sql', 1), ...Lx('cql', 14)], [Ax('AD_A1', 3000, 5, 'http://fb.me/')]);
    const gB = Gx('CONJ_B', 2000, Lx('sql', 3), [Ax('AD_B1', 2000, 3, 'https://lotes.selvadentrotulum.com/en/escape')]);
    const gC = Gx('CONJ_C', 500, Lx('cql', 2), [Ax('AD_C1', 500, 0, 'https://lotes.selvadentrotulum.com/en/premium')]);
    const Cx = { key: 'Meta · CAMP_X', plat: 'Meta', camp: 'CAMP_X', cids: new Set(['111']), spend: 5500, res: 8, leads: [...gA.leads, ...gB.leads, ...gC.leads], grps: [gA, gB, gC] };
    const ctxX = { agg: { users: {} }, dec: { meta: { camps: { 111: { name: 'CAMP_X', estado: 'ACTIVE', cb: 300, lb: null } }, grps: {}, an: [] } }, V, dias: 30, leadsRango: 60 };
    const rm = lqRecomendar({ plat: 'Meta', camp: 'CAMP_X', C: Cx, inv: 5500, n: 20, sqlp: 4, res: 8, sem: { k: 'optimizar', c: 'amarillo', diag: { calidad: true, costo: false } } }, ctxX);
    r.recMetaForm = rm ? rm.items.map(x => lqRecTexto(x)).join(' / ') + ' || ' + rm.sinMuestra + ' || ' + rm.pie : '';
    // Pausar la campaña (ROJO) con la decisión: lo mismo, desde los datos de 30 días
    const rp = us ? lqRecomendar({ ...us, alerta: null, sem: lqSemaforo(us.inv, us.sqlp, { n: us.n, tr: us.tr, plat: us.plat }) }, ctx) : null;
    r.recPausar = rp ? lqRecTexto(rp.items[0]) : '';
    // Gasto no disponible (Dirección, 10-oct-2026): conjunto con leads y gasto 0 en Windsor = dato
    // faltante. Se dice, sin CPL ni costo por SQL, y no se usa para conservar ni pausar.
    r.evidNA = lqEvid({ sp: null, n: 3, sqlp: 1 });
    const gN = Gx('CONJ_N', 0, [...Lx('sql', 1), ...Lx('cql', 4)], [Ax('AD_N1', 0, 0, '')]);
    const gR = Gx('CONJ_R', 9000, Lx('cql', 5), [Ax('AD_R1', 9000, 5, 'https://lotes.selvadentrotulum.com/en/escape')]);
    const Cy = { key: 'Meta · CAMP_Y', plat: 'Meta', camp: 'CAMP_Y', cids: new Set(['111']), spend: 9000, res: 5, leads: [...gN.leads, ...gR.leads], grps: [gR, gN] };
    const ry = lqRecomendar({ plat: 'Meta', camp: 'CAMP_Y', C: Cy, inv: 9000, n: 10, sqlp: 1, res: 5, sem: { k: 'pausar', c: 'rojo' } }, ctxX);
    r.naPausar = ry ? ry.items.map(x => lqRecTexto(x, true)).join(' / ') + ' || ' + ry.gastoNA : '';
    const gS = Gx('CONJ_S', 4000, Lx('sql', 2), [Ax('AD_S1', 4000, 2, 'https://lotes.selvadentrotulum.com/en/premium')]);
    const Cz = { ...Cy, camp: 'CAMP_Z', spend: 13000, leads: [...gN.leads, ...gR.leads, ...gS.leads], grps: [gR, gS, gN] };
    const rz = lqRecomendar({ plat: 'Meta', camp: 'CAMP_Z', C: Cz, inv: 13000, n: 12, sqlp: 3, res: 7, sem: { k: 'subir', c: 'verde' } }, ctxX);
    r.naSostiene = rz ? lqRecTexto(rz.items[0]) : '';
    // Sin el detalle de 30 días de Meta: nada a nivel conjunto/anuncio, solo el aviso.
    const ctxSin = { ...ctxX, dec: { meta: { ...ctxX.dec.meta, detalle30: false, faltan: ['detalle de los 30 días de Meta (anuncios, URL, presupuesto, frecuencia)'] } } };
    const rs = lqRecomendar({ plat: 'Meta', camp: 'CAMP_X', C: Cx, inv: 5500, n: 20, sqlp: 4, res: 8, sem: { k: 'optimizar', c: 'amarillo', diag: { calidad: true, costo: true } } }, ctxSin);
    r.sinDetalleMeta = rs ? rs.items.map(x => lqRecTexto(x)).join(' / ') + ' || ' + rs.sinMuestra : '';
    // Atender hoy: gasto detenido (sintético)
    const Cg = { cids: new Set(['9']), grps: [], leads: [], sp: { dias: { '2026-10-01': 300, '2026-10-02': 300, '2026-10-03': 300 } } };
    r.gastoDetenido = lqAtenderHoy({ plat: 'Meta', activa: true }, Cg, { dias: {} }, V).map(e => e.txt).join(' | ');
    // La IA recibe la decisión de hoy (rango fijo), no el selector
    let pay = null; const orig = window.lqFn2; window.lqFn2 = async (u, b) => { pay = b; return { analisis: { lectura: 'x', campanias: [], acciones: [], riesgos: [], preguntas: [] } }; };
    try { await lqAnalizar(true); } catch (e) {}
    window.lqFn2 = orig;
    r.iaPayload = pay ? [pay.rango.slice(0, 23), pay.campanias.map(c => c.nombre).includes('INVESTORS - GOOGLE SEARCH - US+CAN'), (pay.pausadas || []).map(c => c.nombre).join('|'),
      /preliminar/.test((pay.campanias.find(c => c.nombre === 'INVESTORS_US/CA_ESCAPE_100626') || {}).decision || ''), (pay.anuncios[0] || {}).conjunto].join(' · ') : 'sin llamada';
    lqState.ia = null;
    // Regresión del 9-oct-2026: si el detalle por anuncio de Google no llega, los leads con
    // utm_campaign = ID siguen pegándose a su campaña con el ID de la inversión diaria.
    const fila3 = (nombre) => { const tr = [...document.querySelectorAll('table.lq-combo tr')].find(x => x.querySelector('td.name') && x.querySelector('td.name').textContent.replace(/^(META|GOOGLE)\s*/, '').trim() === nombre);
      if (!tr) return null; const td = [...tr.querySelectorAll('td')]; return [td[H.indexOf('Inversión')].textContent.trim(), td[H.indexOf('Leads CRM')].textContent.trim(), td[H.indexOf('SQL+')].textContent.trim()].join(' '); };
    const fx2 = copia(); fx2.adRows = fx2.adRows.filter(a => a.plat !== 'Google');
    const agg2 = buildLqAgg(fx2.boot, fx2.rawLeads, fx2.spendRows, fx2.weeks, fx2.opps, fx2.adRows, fx2.adExtra); agg2.fallos = []; agg2.monedas = ['MXN'];
    lqState.agg = agg2; lqState.sub = 'combinado'; lqRender();
    r.sinDetalleGoogle = [fila3('INVESTORS - GOOGLE SEARCH -- MX'), fila3('INVESTORS - GOOGLE SEARCH - US+CAN'), fila3('23710551755'), /Windsor no reconoce/.test(txt())].join(' | ');
    // Y si Windsor no trae el ID en ningún lado, el reporte lo dice en vez de dejar la fila suelta.
    const fx3 = copia(); fx3.adRows = fx3.adRows.filter(a => a.plat !== 'Google'); fx3.spendRows.forEach(x => { delete x.cid; });
    const agg3 = buildLqAgg(fx3.boot, fx3.rawLeads, fx3.spendRows, fx3.weeks, fx3.opps, fx3.adRows, null); agg3.fallos = []; agg3.monedas = ['MXN'];
    lqState.agg = agg3; lqRender();
    r.sinIds = /7 leads<\/b> traen como campaña un ID que Windsor no reconoce/.test(document.getElementById('lq-content').innerHTML) && /Google 23710551755 \(2\)/.test(txt()) && /Google 23715389989 \(5\)/.test(txt());
    // La consulta de 30 días de Meta no llegó (solo anuncios de ayer/hoy, sin gasto): Conclusiones
    // no sugiere conjuntos ni anuncios de Meta y la IA no recibe anuncios de Meta.
    const fx4 = copia();
    fx4.adExtra.meta.ads = fx4.adExtra.meta.ads.map(a => ({ ...a, sp: 0, res: 0, cl: 0, im: 0, fq: null, sp7: 0, res7: 0, spP: 0, resP: 0, url: '' }));
    fx4.adExtra.meta.detalle30 = false; fx4.adExtra.meta.faltan = ['detalle de los 30 días de Meta (anuncios, URL, presupuesto, frecuencia)'];
    const agg4 = buildLqAgg(fx4.boot, fx4.rawLeads, fx4.spendRows, fx4.weeks, fx4.opps, fx4.adRows, fx4.adExtra); agg4.fallos = []; agg4.monedas = ['MXN'];
    lqState.agg = agg4; lqState.sub = 'conclusiones'; lqRender();
    const filasMeta = [...document.querySelectorAll('#lq-content table.lq-concl tr[data-dec-camp]')].filter(tr => /META/.test(tr.textContent));
    const recsMeta = filasMeta.map(tr => tr.querySelectorAll('td')[4] ? tr.querySelectorAll('td')[4].textContent.replace(/\s+/g, ' ') : '').join(' ');
    let pay4 = null; const orig4 = window.lqFn2; window.lqFn2 = async (u, b) => { pay4 = b; return { analisis: { lectura: 'x', campanias: [], acciones: [], riesgos: [], preguntas: [] } }; };
    try { await lqAnalizar(true); } catch (e) {}
    window.lqFn2 = orig4; lqState.ia = null;
    r.sinA30 = [filasMeta.length, (recsMeta.match(/Sin detalle de Meta en esta sincronización; revisar en Meta Ads/g) || []).length > 0,
      /gasto 0 MXN|CPL 0 MXN|costo por SQL 0 MXN/.test(recsMeta), /Pausar el conjunto|Pausar los? \d? ?anuncios?|Lo que sostiene|conservar algo, lo único/.test(recsMeta),
      pay4 ? pay4.sinDetalleMeta : 'sin llamada', pay4 ? pay4.anuncios.filter(a => !/GOOGLE/.test(a.campania)).length : -1].join(' · ');
    lqState.agg = agg3;
    // Re-envíos de formulario (Dirección, 13-oct-2026): contacto existente que vuelve a llenar
    // un formulario. Cuenta si se dio de alta ANTES de que empezara la campaña que hoy trae.
    const RE = (id, n, c, up, camp) => ({ id, n, em: id + '@x.com', ph: '', c, up, src: 'landing-seguridad', u: '', tags: ['squeeze'],
      cf: camp ? { f_camp: camp, f_cont: 'EN_LLAMADA_ESCAPE' } : {}, attr: { camp: 'Intelligent Investors', cid: '120200000000000001', src: 'facebook' } });
    const fx6 = copia();
    const rawRe = [RE('re1', 'Contacto viejo', '2026-02-22T07:02:13Z', '2026-09-30T15:00:00Z', 'INVESTORS_US/CA_ESCAPE_090926'),
                   RE('re2', 'Alta despues del inicio', '2026-09-20T10:00:00Z', '2026-10-01T10:00:00Z', 'INVESTORS_US/CA_ESCAPE_090926'),
                   RE('re3', 'Sin utm', '2026-02-01T10:00:00Z', '2026-09-29T10:00:00Z', ''),
                   RE('re4', 'Campana anterior a la ventana', '2026-03-01T10:00:00Z', '2026-09-29T10:00:00Z', 'INVESTORS_US/CA_ESCAPE_100626')];
    const agg6 = buildLqAgg(fx6.boot, fx6.rawLeads, fx6.spendRows, fx6.weeks, fx6.opps, fx6.adRows, fx6.adExtra, rawRe); agg6.fallos = []; agg6.monedas = ['MXN'];
    r.reCuentan = (agg6.reenvios || []).map(l => `${l.n} ${l.wk} ${l.camp}${l.reAprox ? ' aprox' : ''}`).join(' | ');
    r.reFueraDeVentas = !agg6.leads.some(l => l.re);
    lqState.agg = agg6; rango('2026-W37', '2026-W40'); lqState.sub = 'combinado'; lqRender();
    const fRe = [...document.querySelectorAll('table.lq-combo tr')].find(tr => /INVESTORS_US\/CA_ESCAPE_090926/.test(tr.textContent));
    r.reCombo = fRe ? [...fRe.cells].slice(1, 4).map(td => td.innerText.replace(/\s+/g, ' ').trim()).join(' ¦ ') : '';
    lqState.sub = 'calidad'; lqRender();
    const bloque = [...document.querySelectorAll('#lq-content .lq-camp')].find(d => /INVESTORS_US\/CA_ESCAPE_090926/.test(d.querySelector('.lc-name').textContent));
    const celdaRe = bloque ? [...bloque.querySelectorAll('tbody tr td:first-child')].find(td => /Contacto viejo/.test(td.textContent)) : null;
    r.reBadge = celdaRe ? celdaRe.textContent.replace(/\s+/g, ' ').trim() + ' · ' + (celdaRe.querySelector('.lq-re') || {}).title : '';
    // Con el campo "Fecha último formulario" la fecha es exacta y basta con que caiga en otra semana que el alta
    const fx7 = copia();
    fx7.boot.fields = (fx7.boot.fields || []).concat([{ id: 'f_ult', name: 'Fecha último formulario' }]);
    const r7 = fx7.rawLeads.find(l => l.cf && l.cf.f_camp === 'INVESTORS_US/CA_ESCAPE_090926');
    r7.cf.f_ult = new Date(Date.parse(r7.c) + 8 * 86400e3).toISOString();
    const agg7 = buildLqAgg(fx7.boot, fx7.rawLeads, fx7.spendRows, fx7.weeks, fx7.opps, fx7.adRows, fx7.adExtra, []);
    r.reExacto = (agg7.reenvios || []).map(l => `${l.n === r7.n} ${l.reAprox ? 'aprox' : 'exacta'} ${agg7.campoUltForm}`).join(' | ');
    // Medición rota: solo si DESPUÉS de contar los re-envíos el CRM sigue sin leads de la campaña
    const Vd = agg.dec.ventana, d3 = [0, 1, 2].map(i => lqSumaDias(Vd.fin, -i));
    const decP = { dias: { '777': { [d3[0]]: { sp: 100, res: 1 }, [d3[1]]: { sp: 100, res: 1 } } } };
    const Cm = (leads) => ({ cids: new Set(['777']), grps: [], leads, sp: { dias: { [Vd.fin]: 100 } } });
    r.medicionSinRe = lqAtenderHoy({ plat: 'Meta' }, Cm([]), decP, Vd).map(e => e.tipo).join(',');
    r.medicionConRe = lqAtenderHoy({ plat: 'Meta' }, Cm([{ re: 1, dia: d3[1] }]), decP, Vd).map(e => e.tipo).join(',');
    lqState.agg = agg3;
    // Sin datos de decisión (Windsor no respondió): Conclusiones sigue saliendo, con aviso
    lqState.sub = 'conclusiones'; lqRender();
    r.sinDec = /No llegó de Windsor el detalle de la ventana de decisión/.test(txt()) && !!document.getElementById('lq-decision-etq');
    lqState.agg = agg; lqState.sub = 'combinado'; lqRender();
    return r;
  }, fixture());
  const semEsp = {
    'INVESTORS_US/CA_ESCAPE_090926': 'ROJO·hist', 'INVESTORS_US/CA_ESCAPE_100626': 'AMARILLO·hist', 'INVESTORS_MX_DYNAMIC-TOPLPS_150726': 'VERDE·hist',
    'INVESTORS_MX_DYNAMIC-TOPLPS_090926': 'AMARILLO·hist', 'INVESTORS_EN_FORMULARIOMETA_TULUM_100626': 'VERDE·hist', 'INVESTORS - GOOGLE SEARCH - US+CAN': 'ROJO·hist',
    'INVESTORS - GOOGLE SEARCH -- MX': 'AMARILLO·hist', '(sin campaña atribuida)': '—', 'Social orgánico · IG / WhatsApp': '—',
  };
  lqx.ok = lqx.inferidos === '8 INVESTORS_MX_DYNAMIC-TOPLPS_090926 / ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO' && lqx.tardeNoInferido
    && lqx.porId === 9 && lqx.googleMX === 3 && lqx.numerico === 5 && lqx.filaUS === '5 100% 60% 0 ROJO·hist' && lqx.filaMX === '3 1' && lqx.sinFilasNumericas
    && lqx.sinDetalleGoogle === '3,600 MXN 3 1 | 13,600 MXN 5 0 |  | false' && lqx.sinIds && lqx.sinDec
    && lqx.semSeg === 'rojo:revisar rojo:pausar rojo:revisar rojo:mantener rojo:pausar'
    && lqx.sem === 'null gris*:mantener rojo:pausar verde:subir verde:subir amarillo:optimizar amarillo:optimizar rojo:pausar amarillo*:mantener verde*:mantener verde*:mantener rojo*:mantener'
    && lqx.tarjetas && lqx.columnas === 'Campaña|Inversión|Leads CRM|CPL|% trabajados|% contactados|CQL|MQL|SQL+|Verificado por ventas|Zoom realizado|OPP vigentes|OPP generadas|SQL+ → OPP generadas|WON|Costo por SQL|Semáforo histórico'
    && /^2 · 2 leads SQL\+ \| SQL( SD)?Lead \d+, SQL( SD)?Lead \d+$/.test(lqx.tipSql) && lqx.tipSqlCierra && lqx.tipSqlTotal === '11 · 11 leads SQL+' && lqx.tipSqlCero
    && lqx.tipSqlDatos === '2 · 2 leads SQL+'
    && Object.entries(semEsp).every(([k, v]) => lqx.semaforos[k] === v)
    && lqx.explSinAcciones && lqx.cplSinAlerta && lqx.lecturaHist && lqx.avisoDatos
    && lqx.avisoExpl === 'Estás viendo 2026-W37–2026-W40 (07 sep – 04 oct 2026). La decisión de hoy está en Conclusiones.'
    && lqx.embudo090 === '2 2 1 · 40% 4,600 MXN' && /Total pagado.*65,000 MXN.*6,500 MXN/.test(lqx.totalPagado)
    && lqx.inferidaBadge && lqx.sinPesos && lqx.sinCampania === '4 de 69 · filas 4'
    && lqx.grafica === 'true 7 INVESTORS - GOOGLE SEARCH - US+CAN | 13,600 MXN · 0 SQL+ | ROJO | true'
    && lqx.tarjetasBk === '69 11 1' && lqx.notaBkCombo && lqx.sinJenniferCombo && lqx.notaBkCalidad && lqx.sinJenniferCalidad
    && /^Jennifer Guillaume\|Lead \d+\|Lead \d+ · vista 0 · canal 2$/.test(lqx.brokers) && lqx.sumarOppBk === '101' && lqx.semEnCalidad && lqx.sinMetricasViejas
    && lqx.matrizOculta && lqx.matrizConBoton && lqx.datosFila === 'Campaña|Inversión|Leads plataforma|Leads CRM|CPL' && lqx.datosPliegue
    && lqx.datosCrmCols === 'Conjunto / anuncio|Inversión|Leads plat.|Leads CRM|SQL+|Zoom|CPL CRM|Impres.|Clics|CTR|CPC'
    && lqx.datosCrmE2.includes('EN_LLAMADA_PREMIUMLOTSconjunto · Facebook, Audience Network, Instagram ¦ 6,000 MXN ¦ 4 ¦ 14 ¦ 2 ¦ 0 ¦ 429 MXN || EN_LLAMADA_PREMIUMLOTS-5MIN ¦ 6,000 MXN ¦ 4 ¦ — ¦ — ¦ — ¦ —')
    && lqx.datosCrmE2.includes('EN_LLAMADA_ESCAPEconjunto · Facebook, Instagram ¦ 4,000 MXN ¦ — ¦ 8 ¦ 0 ¦ 0 ¦ 500 MXN') && !/Sin anuncio identificado/.test(lqx.datosCrmE2)
    && /^Leads CRM de la campaña: 22 = 2 conjuntos \(22\)\. Por anuncio todavía no: El lead trae el conjunto en utm_content \(\{\{adset\.name\}\}\)/.test(lqx.datosCuadreE2)
    && /\|\| Sin anuncio identificado7 sin utm_content ¦ — ¦ — ¦ 7 ¦ 0 ¦ 0 ¦ —$/.test(lqx.datosCrmE9)
    && lqx.datosCuadreE9 === 'Leads CRM de la campaña: 7 = 2 conjuntos (0) + sin anuncio identificado (7).'
    && lqx.datosCrmId.includes('EN_LLAMADA_ESCAPE-TY-COLD ¦ 2,400 MXN ¦ — ¦ 3 ¦ 0 ¦ 0 ¦ 800 MXN || EN_LLAMADA_ESCAPE-DIANA ¦ 1,600 MXN ¦ — ¦ 0 ¦ 0 ¦ 0 ¦ — || Sin anuncio identificadoleads del conjunto que no traen el anuncio ¦ — ¦ — ¦ 5 ¦ 0 ¦ 0 ¦ —')
    && lqx.datosCrmId.includes('EN_LLAMADA_PREMIUMLOTS-5MIN ¦ 6,000 MXN ¦ 4 ¦ — ¦ — ¦ — ¦ —') && lqx.datosCuadreId === 'Leads CRM de la campaña: 22 = 2 conjuntos (22).'
    // Conclusiones: rango fijo, orden, fecha de decisión, Atender hoy, pausadas, bitácora
    && lqx.conclIdenticas
    && lqx.etiqueta.startsWith('Decisión de hoy — basada en 05 sep 2026 a 04 oct 2026 (últimos 30 días). No cambia con el filtro de fechas.')
    && lqx.ordenDecision === 'US/CA_ESCAPE_100626 [Atender hoy] | GOOGLE SEARCH -- MX [Atender hoy] | US/CA_ESCAPE_090926 [Decidir hoy] | MX_DYNAMIC-TOPLPS_150726 [Decidir hoy] | MX_DYNAMIC-TOPLPS_090926 [Decidir hoy] | EN_FORMULARIOMETA_TULUM_100626 [Preliminar]'
    && /Anuncio rechazado: EN_LLAMADA_ESCAPE-DIANA en conjunto EN_LLAMADA_ESCAPE/.test(lqx.dec100)
    && /Optimizar calidad y costo \(preliminar\) — Decisión el 09 oct \(faltan 4 días\): esperando 7 días tras el cambio del 02 oct/.test(lqx.dec100)
    && /Medición rota: Google reporta 2 leads del 02 oct al 04 oct y al CRM no llegó ninguno de esta campaña/.test(lqx.decMX)
    && /Mantener \(muestra chica\) \(preliminar\) — Sin fecha de decisión: a su ritmo de 129 MXN\/día \(últimos 7 días\) no llega a 8,000 MXN en 30 días; necesita al menos 267 MXN\/día; su presupuesto de 150 MXN\/día tampoco alcanza/.test(lqx.decMX)
    && /Mantener \(muestra chica\) \(preliminar\) — Decisión el 09 oct \(faltan 4 días\): faltan 1,000 MXN de gasto \(~4 días al ritmo de 357 MXN\/día\)/.test(lqx.decForm)
    && /⚠ 7 días: CPL 2,500 MXN vs\. 750 MXN los 7 anteriores \(\+233%\)/.test(lqx.decForm)
    && /Revisar seguimiento antes de pausar — Decidir hoy/.test(lqx.dec090) && /Último cambio \(Meta\): 28 sep · conjunto nuevo EN_LLAMADA_SEGURIDAD-TULUM/.test(lqx.dec090)
    && /Subir presupuesto diario 20% \(preliminar\) — Decisión el 10 oct \(faltan 5 días\): esperando 7 días tras el cambio del 03 oct/.test(lqx.decBitacora) && /Último cambio \(bitácora\): 03 oct · presupuesto de 300 a 360 MXN — verde/.test(lqx.decBitacora)
    && /^GOOGLE INVESTORS - GOOGLE SEARCH - US\+CAN — gasto 13,600 MXN, 5 leads, 0 SQL\+, CPL 2,720 MXN, costo por SQL — · pausada el 04 oct$/.test(lqx.pausadas) && lqx.usSinAccion
    && lqx.bitacora === '09 oct 2026 | INVESTORS_US/CA_ESCAPE_090926 | 2 anuncios nuevos con copy limpio (EN_LLAMADA_PREMIUMLOTS-SUSPIRO-CLEAN_091026 y EN_LLAMADA_PREMIUMLOTS-SUSPIRO-SELVA-CLEAN_091026) | anuncio rechazado por servicios financieros; CPL 851 MXN · form'
    && lqx.recObjetos && lqx.recItems === '3 3 2 2 1 0'
    && /Pausar el conjunto EN_LLAMADA_ESCAPE — gasto 4,000 MXN, 8 leads, 0 SQL\+, CPL 500 MXN/.test(lqx.recEscape) && /Pausar conjuntos chicos tiene poco efecto: Meta ya reasigna el presupuesto\./.test(lqx.recEscape)
    && /Renovar el creativo \(frecuencia alta\): EN_LLAMADA_PREMIUMLOTS-5MIN en conjunto EN_LLAMADA_PREMIUMLOTS, frecuencia 3\.6 en 30 días, que hoy lleva a https:\/\/lotes\.selvadentrotulum\.com\/en\/premium — gasto 6,000 MXN/.test(lqx.recEscape)
    && !/Probar 2 creativos nuevos junto a EN_LLAMADA_PREMIUMLOTS-5MIN/.test(lqx.recEscape) && /No tocar presupuesto ni puja\. Un cambio a la vez; reevaluar en 7 días\.$/.test(lqx.recEscape)
    && /Pausar el anuncio con peor CPL: ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC en conjunto ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC — gasto 2,300 MXN, 0 leads \(Meta\), 0 SQL\+ \(todo su conjunto\), CPL —/.test(lqx.rec090)
    && /único anuncio activo de su conjunto: pausarlo apaga el conjunto/.test(lqx.rec090) && /para reemplazar ES_LLAMADA_NUEVO6-SEGURIDAD_DYNAMIC .*que hoy lleva a https:\/\/lotes\.selvadentrotulum\.com\/seguridad/.test(lqx.rec090)
    && /Subir el presupuesto diario 20%: INVESTORS_MX_DYNAMIC-TOPLPS_150726, de 360 MXN a 432 MXN al día — gasto 10,400 MXN, 6 leads, 3 SQL\+, CPL 1,733 MXN, costo por SQL 3,467 MXN/.test(lqx.recVerde)
    && /Editar › Presupuesto de la campaña \(CBO\)/.test(lqx.recVerde)
    // (sus leads traen el CONJUNTO en utm_content, que se llama igual que el anuncio: no se le acreditan al anuncio)
    && /Lo que sostiene el resultado \(no tocarlo\): conjunto ES_LLAMADA_NUEVO6-ESCAPE_CENOTES — gasto 10,400 MXN, 6 leads, 3 SQL\+/.test(lqx.recVerde) && /capacidad ~140\/mes/.test(lqx.recVerde) && /Un cambio a la vez; reevaluar en 7 días\.$/.test(lqx.recVerde)
    && /Trabajar los 4 leads de la campaña que siguen sin trabajar: Asesora Uno, 4 leads — el más antiguo entró el 16\/09/.test(lqx.recRevisar) && /Nuevo lead \(no contactado\)/.test(lqx.recRevisar)
    && /⚠ CPL al alza: revisar el conjunto que más lo subió, EN_LLAMADA_PREMIUMLOTS — últimos 7 días \(28\/09–04\/10\): gasto 2,500 MXN, 1 lead, 0 SQL\+, CPL 2,500 MXN; 7 anteriores: CPL 750 MXN/.test(lqx.recAlerta)
    && /^Sin muestra suficiente para pausar; esperar\. Ningún conjunto sin SQL\+ llega a 8,000 MXN de gasto \(el de más gasto: EN_LLAMADA_ESCAPE, 4,000 MXN\)\. /.test(lqx.recEsperar)
    && /Agregar preguntas de presupuesto y de plazo en https:\/\/lotes\.selvadentrotulum\.com\/en\/escape \(landing del conjunto EN_LLAMADA_ESCAPE\)/.test(lqx.recEsperar)
    && /^Pausar las keywords: "buying property in tulum mexico" \(grupo Tulum land US\) — gasto 4,760 MXN, 2 leads, 0 SQL\+, CPL 2,380 MXN; "buying a home in tulum mexico" \(grupo Tulum land US\) — gasto 4,080 MXN, 1 lead, 0 SQL\+, CPL 4,080 MXN/.test(lqx.recGoogleKw)
    && /Agregar palabras negativas desde los términos de búsqueda de "tulum real estate" \(grupo Tulum land US\) — gasto 2,720 MXN, 1 lead, 0 SQL\+, CPL 2,720 MXN\. El reporte no trae los términos de búsqueda/.test(lqx.recGoogleKw)
    && /^Agregar preguntas de presupuesto y de plazo en el formulario instantáneo del conjunto CONJ_A — gasto 3,000 MXN, 15 leads, 1 SQL\+, CPL 200 MXN, costo por SQL 3,000 MXN, tasa SQL 6\.7%\. Se edita en Meta Ads › conjunto › anuncio › Formulario instantáneo/.test(lqx.recMetaForm)
    && /\|\| Sin muestra suficiente para pausar; esperar\. Ningún conjunto sin SQL\+ llega a 800 MXN de gasto \(el de más gasto: CONJ_C, 500 MXN\)\. \|\| No tocar presupuesto ni puja\. Un cambio a la vez; reevaluar en 7 días\.$/.test(lqx.recMetaForm)
    && /^Pausar la campaña INVESTORS - GOOGLE SEARCH - US\+CAN — gasto 13,600 MXN, 5 leads, 0 SQL\+, CPL 2,720 MXN/.test(lqx.recPausar)
    && lqx.evidNA === 'gasto no disponible, 3 leads, 1 SQL+'
    && /^Pausar la campaña CAMP_Y — gasto 9,000 MXN/.test(lqx.naPausar) && !/conservar algo/.test(lqx.naPausar)
    && /\|\| Gasto no disponible en Windsor \(dato faltante, no gasto en cero; no se usa para conservar ni pausar\): conjunto CONJ_N — gasto no disponible, 5 leads, 1 SQL\+\. Revisar su gasto en Meta Ads › Campañas › CAMP_Y › Conjuntos de anuncios\.$/.test(lqx.naPausar)
    && /Lo que sostiene el resultado \(no tocarlo\): conjunto CONJ_S — gasto 4,000 MXN, 2 leads, 2 SQL\+, CPL 2,000 MXN, costo por SQL 2,000 MXN\./.test(lqx.naSostiene) && !/CONJ_N/.test(lqx.naSostiene)
    && /^Sin detalle de Meta en esta sincronización; revisar en Meta Ads: CAMP_X — gasto 5,500 MXN, 20 leads, 4 SQL\+/.test(lqx.sinDetalleMeta)
    && /Buscar el conjunto con más gasto y 0 SQL\+/.test(lqx.sinDetalleMeta) && /Buscar los anuncios activos con CPL arriba de 400 MXN/.test(lqx.sinDetalleMeta)
    && !/CONJ_|AD_/.test(lqx.sinDetalleMeta) && /\|\| $/.test(lqx.sinDetalleMeta)
    && /^[1-9]\d* · true · false · false · true · 0$/.test(lqx.sinA30)
    && lqx.reCuentan === 'Contacto viejo 2026-W40 INVESTORS_US/CA_ESCAPE_090926 aprox' && lqx.reFueraDeVentas
    && lqx.reCombo === '11,200 MXN ¦ 8 1 re-envío ¦ 1,400 MXN total 1,600 MXN nuevos'
    && /^Contacto viejo Re-envío · Contacto existente \(alta 22\/02\/2026\) que volvió a llenar un formulario el 30\/09\/2026 \(fecha aproximada/.test(lqx.reBadge)
    && lqx.reExacto === 'true exacta Fecha último formulario'
    && lqx.medicionSinRe === 'medicion' && lqx.medicionConRe === ''
    && /^Gasto detenido: 0 MXN ayer \(04 oct\) con la campaña activa; los 7 días previos gastó 900 MXN$/.test(lqx.gastoDetenido)
    && lqx.iaPayload === '2026-09-05 → 2026-10-04 · false · INVESTORS - GOOGLE SEARCH - US+CAN · true · ES_LLAMADA_NUEVO6-ESCAPE_CENOTES'
    && lqx.diagUnit === 'Optimizar calidad [tasa SQL 6.7% (< 10%): calidad] || Optimizar costo [CPL 667 MXN (> 400 MXN): costo] || Optimizar calidad y costo [tasa SQL 9.1% (< 10%): calidad · CPL 455 MXN (> 400 MXN): costo] || Mantener (muestra chica) []';
  console.log('\n[calidad de leads] rediseño', JSON.stringify(lqx));
  for (const sub of ['combinado', 'calidad', 'datos', 'conclusiones']) {
    await page.evaluate((sub) => { lqState.sub = sub; lqRender(); }, sub);
    await escanear('lq:' + sub);
  }
  // ✓ Hecho / ✗ Ignorar de las recomendaciones y bitácora con la foto diaria (Dirección General,
  // 15-oct-2026): ✓ registra en la bitácora y arranca la espera de 7 días; al día siguiente avisa si
  // la plataforma no refleja el cambio; deshacer el mismo día; ✗ oculta con motivo hasta 7 días;
  // los cambios que la foto detecta entran a la bitácora y solo los que cuentan reinician la espera.
  VISTA = 'lq:recomendaciones';
  const lqrec = await page.evaluate(async () => {
    const esperar = () => new Promise(res => setTimeout(res, 400));
    const prompt0 = window.prompt; window.prompt = () => 'temporada alta';
    window.LQ_HOY_FIJO = '2026-10-05';
    lqState.recsEst = {}; lqState.bitacora = []; lqState.cambiosAuto = []; lqState.sub = 'conclusiones'; lqRender();
    const fila = (n) => [...document.querySelectorAll('#lq-content table.lq-concl tr[data-dec-camp]')].find(tr => tr.dataset.decCamp === n);
    const celda = (n, i) => { const f = fila(n); return f ? f.querySelectorAll('td')[i].textContent.replace(/\s+/g, ' ').trim() : ''; };
    const VERDE = 'INVESTORS_MX_DYNAMIC-TOPLPS_150726', ESC = 'INVESTORS_US/CA_ESCAPE_100626';
    const r = {};
    r.botones = fila(VERDE).querySelectorAll('[data-rec-ok]').length + '/' + fila(VERDE).querySelectorAll('ol.lq-recs > li').length;   // solo el cambio, no el aviso del telemarketer
    fila(VERDE).querySelector('[data-rec-ok]').click(); await esperar();
    r.hecho = (fila(VERDE).querySelector('li.lq-rec-hecho') || {}).textContent || '';
    r.bit = lqBitacora().filter(e => e.rec).map(e => `${e.fecha} | ${e.camp} | ${e.cambio}`).join(' || ');
    r.espera = celda(VERDE, 2);
    window.LQ_HOY_FIJO = '2026-10-06'; lqRender();
    r.verif = ((fila(VERDE).querySelector('.lq-rec-verif') || {}).textContent || '').trim();
    r.sinDeshacer = !fila(VERDE).querySelector('[data-rec-undo]');
    window.LQ_HOY_FIJO = '2026-10-05'; lqRender();
    fila(VERDE).querySelector('[data-rec-undo]').click(); await esperar();
    r.deshecho = !!fila(VERDE).querySelector('[data-rec-ok]') && !lqBitacora().some(e => e.rec) && !/esperando 7 días tras el cambio del 05 oct/.test(celda(VERDE, 2));
    const antes = fila(ESC).querySelectorAll('ol.lq-recs > li').length;
    [...fila(ESC).querySelectorAll('[data-rec-ig]')].find(b => /^Pausar el conjunto/.test(b.closest('li').textContent.trim())).click(); await esperar();
    r.ignorada = fila(ESC).querySelectorAll('ol.lq-recs > li').length === antes - 1 && /Ignoradas \(1\)/.test(celda(ESC, 4)) && /temporada alta/.test(celda(ESC, 4)) && !lqBitacora().some(e => e.rec);
    window.LQ_HOY_FIJO = '2026-10-12'; lqRender();
    r.vence = !/Ignoradas/.test(celda(ESC, 4));
    window.LQ_HOY_FIJO = '2026-10-05'; lqRender();
    fila(ESC).querySelector('[data-rec-restore]').click(); await esperar();
    r.restaurada = !/Ignoradas/.test(celda(ESC, 4)) && fila(ESC).querySelectorAll('ol.lq-recs > li').length === antes;
    // La foto diaria: un presupuesto de Meta reinicia la espera; las keywords de Google no
    lqState.cambiosAuto = [
      { id: 'auto-1', fecha: '2026-10-04', desde: '2026-10-02', plat: 'Meta', cid: 'x', camp: 'INVESTORS_US/CA_ESCAPE_090926', que: 'presupuesto diario de la campaña de 300 MXN a 360 MXN', cuenta: true },
      { id: 'auto-2', fecha: '2026-10-04', desde: '2026-10-04', plat: 'Google', cid: 'y', camp: 'INVESTORS - GOOGLE SEARCH -- MX', que: 'keywords sin gasto en los últimos 7 días: "x" (g)', cuenta: false }];
    lqRender();
    r.auto090 = celda('INVESTORS_US/CA_ESCAPE_090926', 2);
    r.autoMX = celda('INVESTORS - GOOGLE SEARCH -- MX', 2);
    r.tabla = [...document.querySelectorAll('#lq-bitacora tbody tr.lq-bit-auto')].map(tr => [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim()).join(' | ')).join(' || ');
    lqState.cambiosAuto = []; lqState.recsEst = {}; lqState.bitacora = []; window.prompt = prompt0; lqRender();
    r.ok = r.botones === '1/2' && /^✓ Hecho el 05 oct · smoke · en la bitácora deshacer ?Subir el presupuesto diario 20%: INVESTORS_MX_DYNAMIC-TOPLPS_150726, de 360 MXN a 432 MXN al día$/.test(r.hecho.replace(/\s+/g, ' ').trim())
      && r.bit === '2026-10-05 | INVESTORS_MX_DYNAMIC-TOPLPS_150726 | Subir el presupuesto diario 20%: INVESTORS_MX_DYNAMIC-TOPLPS_150726, de 360 MXN a 432 MXN al día'
      && /esperando 7 días tras el cambio del 05 oct/.test(r.espera) && /Último cambio \(bitácora\): 05 oct · Subir el presupuesto diario 20%/.test(r.espera)
      && r.verif === '⚠ marcada como hecha, pero en Meta el presupuesto sigue en 360 MXN al día' && r.sinDeshacer
      && r.deshecho && r.ignorada && r.vence && r.restaurada
      && /Último cambio \(Meta · foto diaria\): 04 oct · presupuesto diario de la campaña de 300 MXN a 360 MXN/.test(r.auto090) && /esperando 7 días tras el cambio del 04 oct/.test(r.auto090)
      && !/foto diaria/.test(r.autoMX)
      && /^entre 02 oct y 04 oct 2026 \| INVESTORS_US\/CA_ESCAPE_090926 \| presupuesto diario de la campaña de 300 MXN a 360 MXN \|\s+\| Detectado en Meta \(foto diaria\) \|\| 04 oct 2026 \| INVESTORS - GOOGLE SEARCH -- MX \| keywords sin gasto/.test(r.tabla);
    return r;
  });
  console.log('[calidad de leads] ✓ / ✗ y foto diaria', JSON.stringify(lqrec).slice(0, 1500));
  console.log('[calidad de leads] bitácora con la foto:', lqrec.tabla);
  if (!lqrec.ok) hallazgos.push({ vista: 'lq:recomendaciones', lqrec });
  // OPP generadas y verificación de ventas (Dirección General, 15-oct-2026). Sobre el mismo
  // fixture: en MX_DYNAMIC_090926 el lead en "Zoom realizado" pasa a una OPP caída a Largo plazo
  // con la etiqueta del workflow, y el de "Contacto establecido" a una OPP caída a Descalificado
  // etiquetada a mano (otra grafía). El primero tiene Lead to Watch = Sí; el lead que sigue en
  // Seguimiento de OPP no lo tiene. OPP generadas nunca queda por debajo de OPP vigentes.
  VISTA = 'lq:oppGeneradas';
  const opg = await page.evaluate((fx0) => {
    const fx = JSON.parse(JSON.stringify(fx0));
    fx.boot.fields = fx.boot.fields.concat([{ id: 'f_ltw', name: 'Lead to Watch' }]);
    const st = (nombre) => Object.keys(fx.boot.stages).find(k => fx.boot.stages[k].s === nombre && fx.boot.stages[k].p === 'Seguimiento de ventas');
    const dyn = fx.rawLeads.filter(l => l.src === 'landing-seguridad');
    const porEtapa = (e) => dyn.find(l => fx.opps[l.id] && fx.boot.stages[fx.opps[l.id].s].s === e);
    const vig = porEtapa('Seguimiento de OPP'), zr = porEtapa('Zoom realizado'), ce = porEtapa('Contacto establecido');
    Object.assign(fx.opps[zr.id], { s: st('Largo Plazo'), o: 0 }); zr.tags = zr.tags.concat(['opp-generada']); zr.cf.f_ltw = 'Sí';
    Object.assign(fx.opps[ce.id], { s: st('Descalificado'), o: 0 }); ce.tags = ce.tags.concat(['OPP-Generada']); ce.cf.f_ltw = 'No';
    const agg = buildLqAgg(fx.boot, fx.rawLeads, fx.spendRows, fx.weeks, fx.opps, fx.adRows, fx.adExtra);
    agg.fallos = []; agg.monedas = ['MXN'];
    Object.assign(lqState, { agg, exp: {}, q: '', plat: 'all', level: 'camp', qual: 'auto' });
    document.getElementById('lq-sem-ini').value = '2026-W37'; document.getElementById('lq-sem-fin').value = '2026-W40';
    const r = {};
    r.flags = [vig, zr, ce].map(l => { const a = agg.leads.find(x => x.id === l.id); return (a.og ? 'og' : '-') + (a.vv ? 'vv' : '-') + (a.o ? 'o' : '-'); }).join(' ');
    r.campo = agg.verifField ? agg.verifField.name : '';
    const nombres = [zr.n, ce.n].join(' | ');
    lqState.sub = 'calidad'; lqRender();
    const H = [...document.querySelector('table.lq-tree tr').querySelectorAll('th')].map(th => th.textContent.trim());
    const iO = H.indexOf('OPP vigentes'), iG = H.indexOf('OPP generadas'), iS = H.indexOf('SQL+ → OPP generadas'), iV = H.indexOf('Verificado por ventas'), iQ = H.indexOf('SQL+');
    r.columnas = H.slice(iQ, iS + 1).join('|');
    const num = (td) => Number(td.textContent.trim().split(/\s/)[0].replace(/,/g, ''));
    const filas = [...document.querySelectorAll('table.lq-tree tr')].filter(tr => tr.querySelectorAll('td').length > iS);
    r.filas = filas.length;
    r.geVig = filas.every(tr => { const td = tr.querySelectorAll('td'); return num(td[iG]) >= num(td[iO]); });
    // Una OPP caída NO cuenta como Zoom (puede venir directo de un recorrido): en MX_DYNAMIC_090926
    // hay 3 OPP generadas y el Zoom solo cuenta la vigente.
    const iZ = H.indexOf('Zoom realizado');
    r.zoom090 = filas.find(tr => tr.querySelector('td').textContent.includes('INVESTORS_MX_DYNAMIC-TOPLPS_090926')).querySelectorAll('td')[iZ].textContent.trim();
    r.formato = filas.every(tr => /^\d[\d,]* de \d[\d,]* · (\d+\.\d%|—)$/.test(tr.querySelectorAll('td')[iS].textContent.trim()));
    const celdas = (tr) => [iQ, iV, iO, iG, iS].map(i => tr.querySelectorAll('td')[i].textContent.replace(/\s+/g, ' ').trim()).join(' ¦ ');
    r.fila090 = celdas(filas.find(tr => tr.querySelector('td').textContent.includes('INVESTORS_MX_DYNAMIC-TOPLPS_090926')));
    r.total = celdas(document.querySelector('table.lq-tree tr.lq-total2'));
    const tdG = filas.find(tr => tr.querySelector('td').textContent.includes('INVESTORS_MX_DYNAMIC-TOPLPS_090926')).querySelectorAll('td')[iG];
    const tip = document.createElement('div'); tip.innerHTML = tdG.dataset.lqTip || '';
    r.tipOg = tip.textContent.replace(/\s+/g, ' ').trim();
    const t = document.getElementById('lq-content').textContent.replace(/\s+/g, ' ');
    // Workflow activo desde LQ_OPP_REGISTRO_DESDE (15-oct-2026): W37–W40 empieza antes, así que
    // avisa con la fecha; un rango que empieza ese día o después no avisa.
    r.aviso = /Histórico incompleto antes del \d{2} [a-z]{3} \d{4}\. GoHighLevel no guarda el historial de etapas/.test(t)
      && /Antes del \d{2} [a-z]{3} \d{4}, una OPP que se cayó solo cuenta si ventas le puso la etiqueta a mano/.test(t)
      && lqAvisoOppGen(agg, [], ['2026-W42'], true) !== ''       // W42 empieza el 12-oct, antes del 15
      && lqAvisoOppGen(agg, [], ['2026-W43'], true) === '';
    r.caidas = (t.match(/(\d+) OPP caídas que sí cuentan como generadas: ([^.]*)\./) || []).slice(1).join(' : ');
    r.sinVerif = (t.match(/(\d+) OPP vigentes? sin verificación de ventas/) || [])[1] || '0';
    r.sinCausa = (t.match(/(\d+) OPP caídas? a Descalificado sin causa capturada \(cuentan? como SQL Selvadentro hasta que ventas la capture\): ([^.]*)\./) || []).slice(1).join(' : ');
    r.niveles = [zr, ce].map(l => agg.leads.find(x => x.id === l.id).alv).join(' ');
    const card = (k) => { const c = [...document.querySelectorAll('#lq-content .crm-kpi')].find(e => e.querySelector('.k-lbl').textContent.trim() === k); return c ? c.querySelector('.k-val').textContent.trim() : ''; };
    r.tarjetas = ['Verificados por ventas · Lead to Watch', 'OPP vigentes · hoy en OPP', 'OPP generadas · llegaron alguna vez', 'SQL+ → OPP generadas'].map(card).join(' | ');
    r.mes = [...document.querySelectorAll('#lq-content table.cons tr')].map(tr => (tr.querySelector('td.name') || {}).textContent || '').filter(x => /^OPP /.test(x)).join('|');
    r.mqlSinEsc = (document.querySelector('table.lq-tree').textContent.match(/(\d+) sin escalera/) || [])[1] || '';
    r.siglas = /OPP generadas leads del cohorte que llegaron ALGUNA VEZ/.test(t) && /Verificado por ventas el lead tiene Lead to Watch = Sí/.test(t);
    r.nombres = r.caidas.includes(zr.n) && r.caidas.includes(ce.n) ? 'ok' : nombres;
    lqState.sub = 'combinado'; lqRender();
    r.avisoCombo = /Histórico incompleto/.test(document.getElementById('lq-content').textContent) && !/OPP caídas que sí cuentan/.test(document.getElementById('lq-content').textContent);
    // Sin el campo Lead to Watch en GHL: se avisa y la columna sale en 0
    const fx2 = JSON.parse(JSON.stringify(fx0));
    const agg2 = buildLqAgg(fx2.boot, fx2.rawLeads, fx2.spendRows, fx2.weeks, fx2.opps, fx2.adRows, fx2.adExtra);
    agg2.fallos = []; agg2.monedas = ['MXN']; lqState.agg = agg2; lqState.sub = 'calidad'; lqRender();
    r.sinCampo = /No se encontró el campo Lead to Watch/.test(document.getElementById('lq-content').textContent);
    return r;
  }, fixture());
  opg.ok = opg.flags === 'og-o ogvv- og--' && opg.campo === 'Lead to Watch' && opg.geVig && opg.zoom090 === '1' && opg.formato && opg.filas > 5
    && opg.fila090 === '3 ¦ 1 ¦ 1 ¦ 32 caídas ¦ 3 de 3 · 100.0%' && opg.niveles === 'sql sqls' && /^1 : /.test(opg.sinCausa)
    && opg.columnas === 'SQL+|Verificado por ventas|Zoom realizado|OPP vigentes|OPP generadas|SQL+ → OPP generadas'
    && opg.aviso && opg.nombres === 'ok' && +opg.mqlSinEsc > 0 && opg.avisoCombo && opg.sinCampo && opg.siglas && opg.mes === 'OPP vigentes|OPP generadas';
  console.log('\n[calidad de leads] OPP generadas', JSON.stringify(opg));
  if (!opg.ok) hallazgos.push({ vista: 'lq:oppGeneradas', opg });
  await escanear('lq:oppGeneradas');

  // Sin campaña atribuida (Dirección General, 17-oct-2026), sobre el mismo fixture con leads
  // sintéticos en la W40: orgánico de Instagram/Facebook (utm_medium social o referrer, sin
  // FBCLID ni campaña), contactos que creó WhatsApp con "(ref: CAMPAÑA)" (dos duplicados de un
  // lead de formulario, uno nuevo, uno fuera de las 24 h) y uno que escribió "prueba".
  VISTA = 'lq:sinCampania';
  const sca = await page.evaluate((fx0) => {
    const base = JSON.parse(JSON.stringify(fx0));
    const fx = JSON.parse(JSON.stringify(fx0));
    fx.boot.fields = fx.boot.fields.concat([{ id: 'f_med', name: 'utm_medium' }, { id: 'f_src', name: 'utm_source' }, { id: 'f_fbc', name: 'fbclid' },
      { id: 'f_ses', name: 'Session source' }, { id: 'f_medio', name: 'Medium' }]);
    const T = (h, s) => new Date(Date.parse('2026-10-01T' + h + 'Z') + (s || 0) * 1000).toISOString();
    const L = (id, n, c, o) => Object.assign({ id, n, em: '', ph: '', c, src: '', u: 'u1', tags: [], cf: {}, attr: {} }, o);
    const DYN = 'INVESTORS_MX_DYNAMIC-TOPLPS_090926', ESC = 'INVESTORS_US/CA_ESCAPE_090926';
    const nuevos = [
      L('orgIG', 'Orgánico IG', T('16:03:00'), { em: 'o1@x.com', src: 'ig', tags: ['ig'], attr: { src: 'ig', med: 'social' } }),
      L('orgFB', 'Orgánico FB', T('16:10:00'), { em: 'o2@x.com', src: 'fb', cf: { f_med: 'social', f_src: 'fb' }, attr: { med: 'Manual', src: 'CRM Workflows' } }),
      L('orgRef', 'Orgánico referrer', T('16:20:00'), { em: 'o3@x.com', attr: { ref: 'l.instagram.com' } }),
      L('pagoFbc', 'Anuncio sin campaña', T('16:30:00'), { em: 'o4@x.com', src: 'fb', attr: { src: 'fb', med: 'social', fbc: true } }),
      L('formLeo', 'Leonardo Ruiz Mora', T('07:32:38'), { em: 'l@x.com', ph: '6610000001', src: 'fb', cf: { f_camp: DYN } }),
      L('waLeo', 'Leomx', T('07:33:03'), { ph: '6190000001', tags: ['wa: +5219840000000'], attr: { med: 'whatsapp', src: 'Social media' } }),
      L('formOsc', 'Oscar Demo', T('06:14:05'), { em: 'os@x.com', ph: '7020000001', src: 'fb', cf: { f_camp: ESC } }),
      L('waOsc', 'ShamanX', T('06:14:24'), { ph: '7750000001', cf: { f_ses: 'Social media', f_medio: 'whatsapp' } }),
      L('waNuevo', 'Marta WA', T('09:00:00'), { ph: '5550000001', tags: ['inbound whatsapp'] }),
      L('waTarde', 'Leo dos', T('08:00:00', 31 * 3600), { ph: '5550000002', attr: { med: 'whatsapp' } }),
      L('waPrueba', 'Botón landing', T('10:00:00'), { ph: '5550000003', attr: { med: 'whatsapp' } }),
      L('waSinRef', 'WhatsApp directo', T('11:00:00'), { ph: '5550000004', attr: { med: 'whatsapp', src: 'Social media' } }),
      L('waSinLeer', 'WhatsApp sin leer', T('12:00:00'), { ph: '5550000005', attr: { med: 'whatsapp', src: 'Social media' } }),
    ];
    const WA = {
      waLeo: { tx: '¡Hola! Soy Leonardo. Vi la página de Selvadentro y quiero saber más (ref: ' + DYN + ')' },
      waOsc: { tx: 'Hi! I am Oscar. I saw the website and want to know more (ref: ' + ESC + ')' },
      waNuevo: { tx: 'Hola, soy Marta, quiero información (ref: ' + DYN + ')' },
      waTarde: { tx: 'Hola, soy Leonardo (ref: ' + DYN + ')' },
      waPrueba: { tx: 'Hola esto es una prueba del botón (ref: ' + DYN + ')' },
      waSinRef: { tx: 'Hola, quiero información de los lotes' },
    };
    fx.rawLeads = fx.rawLeads.concat(nuevos);
    const r = {};
    const aggB = buildLqAgg(base.boot, base.rawLeads, base.spendRows, base.weeks, base.opps, base.adRows, base.adExtra);
    const agg = buildLqAgg(fx.boot, fx.rawLeads, fx.spendRows, fx.weeks, fx.opps, fx.adRows, fx.adExtra, [], null, WA);
    const de = (id) => agg.leads.find(l => l.id === id);
    r.camps = ['orgIG', 'orgFB', 'orgRef', 'pagoFbc', 'waNuevo', 'waTarde', 'waSinRef', 'waSinLeer'].map(id => { const l = de(id); return l ? l.fuente + ' · ' + l.camp : '(fuera)'; }).join(' | ');
    r.dup = (agg.dupWa || []).map(d => d.n + '→' + d.de.n + ' (' + d.camp + ')').join(' | ');
    r.fuera = ['waLeo', 'waOsc', 'waPrueba'].filter(id => !de(id)).length;
    r.prueba = agg.excl.prueba - aggB.excl.prueba;
    r.nLeads = agg.leads.length - aggB.leads.length;
    const sinC = (a) => a.leads.filter(l => l.camp === LQ_SIN_CAMP).length;
    r.sinCamp = sinC(agg) - sinC(aggB);
    r.wref = de('waNuevo') && de('waNuevo').wref === 1;
    r.metaOrg = agg.leads.filter(l => l.fuente === 'Meta' && /^org/.test(l.id)).length;
    // Unitarias: nombre del mensaje y mensajes de prueba
    r.soy = [lqNombreSoy('Soy de Monterrey').join(' '), lqNombreSoy('Hi, I am Oscar Roman and I want').slice(0, 2).join(' '), lqNombreSoy('Me llamo Ana').join(' ')].join(' | ');
    r.pruebas = ['esto es una prueba', 'Test', 'I saw the latest video', 'Testimonios de clientes', 'pruebas del botón'].map(tx => lqMensajePrueba({ tx }) ? 1 : 0).join('');
    // En pantalla: lista aparte de duplicados y la línea de excluidos
    agg.fallos = []; agg.monedas = ['MXN'];
    Object.assign(lqState, { agg, exp: {}, q: '', plat: 'all', level: 'camp', qual: 'auto', sub: 'calidad' });
    document.getElementById('lq-sem-ini').value = '2026-W37'; document.getElementById('lq-sem-fin').value = '2026-W40';
    lqRender();
    const t = document.getElementById('lq-content').textContent.replace(/\s+/g, ' ');
    r.lista = /Duplicados por WhatsApp en este rango \(2, no cuentan como lead nuevo; únelos en GoHighLevel\): Leomx → duplicado de Leonardo Ruiz Mora \(INVESTORS_MX_DYNAMIC-TOPLPS_090926\)/.test(t)
      && /ShamanX → duplicado de Oscar Demo \(INVESTORS_US\/CA_ESCAPE_090926\)/.test(t);
    r.excl = (t.match(/Excluidos de todos los cálculos en este rango: [^.]*?(\d+) registros? de prueba/) || [])[1] || '';
    r.filaOrg = [...document.querySelectorAll('table.lq-tree tr')].some(tr => (tr.querySelector('td') || {}).textContent && tr.querySelector('td').textContent.includes('Social orgánico · Instagram'));
    lqState.agg = aggB; lqRender();
    r.sinListaAntes = !/Duplicados por WhatsApp/.test(document.getElementById('lq-content').textContent);
    return r;
  }, fixture());
  sca.ok = sca.camps === 'Social orgánico / directo · Social orgánico · Instagram | Social orgánico / directo · Social orgánico · Facebook | Social orgánico / directo · Social orgánico · Instagram | Meta · (sin campaña atribuida) | Meta · INVESTORS_MX_DYNAMIC-TOPLPS_090926 | Meta · INVESTORS_MX_DYNAMIC-TOPLPS_090926 | Social orgánico / directo · Social orgánico · IG / WhatsApp | Otra fuente · (sin campaña atribuida)'
    && sca.dup === 'Leomx→Leonardo Ruiz Mora (INVESTORS_MX_DYNAMIC-TOPLPS_090926) | ShamanX→Oscar Demo (INVESTORS_US/CA_ESCAPE_090926)'
    && sca.fuera === 3 && sca.prueba === 1 && sca.nLeads === 10 && sca.sinCamp === 2 && sca.wref && sca.metaOrg === 0
    && sca.soy === ' | oscar roman | ana' && sca.pruebas === '11001' && sca.lista && sca.excl !== '' && sca.filaOrg && sca.sinListaAntes;
  console.log('\n[calidad de leads] sin campaña atribuida', JSON.stringify(sca));
  if (!sca.ok) hallazgos.push({ vista: 'lq:sinCampania', sca });
  await escanear('lq:sinCampania');

  // Telefonía por asesora (Dirección General, 7-oct-2026): canal del 1er toque, mediana del
  // 1er intento de llamada, intentos en 24 h y en total, sin marcar vs falla de línea,
  // duración conocida, y la actividad efectiva sin fallas de línea desde el 7-oct.
  const tel = await page.evaluate(() => {
    const Z = (local) => Date.parse(local + '-05:00'), M = 60e3, H = 3600e3, iso = (t) => new Date(t).toISOString();
    const c0 = Z('2026-10-06T10:00:00');
    const contactos = [1, 2, 3, 4].map(i => ({ id: 't' + i, n: 'Lead t' + i, c: iso(c0 + i * M), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} }));
    const base = (i) => c0 + i * M;
    const sw = (i, o) => Object.assign({ foM: base(i) + 2 * M, fi: null, fe: null, days: ['2026-10-06'], calls: 0, chans: [], deliv: { sent: 0, delivered: 0, read: 0, failed: 0, linea: 0 }, ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 },
      tel: { tot: 0, dExp: 0, d0: 0, dNo: 0, c90: 0, noSt: {}, llaves: [] } }, o);
    const sweeps = {
      t1: sw(1, { foMch: 'whatsapp', calls: 3, cl: { n: 3, ok: 1, na: 1, linea: 1, otro: 0, dn: 0, c90: 1, t: [base(1) + 10 * M, base(1) + 2 * H, base(1) + 30 * H] }, deliv: { sent: 0, delivered: 1, read: 1, failed: 1, linea: 1 },
        tel: { tot: 3, dExp: 1, d0: 2, dNo: 0, c90: 1, noSt: {}, llaves: [] } }),
      t2: sw(2, { foMch: 'call', calls: 2, cl: { n: 2, ok: 0, na: 0, linea: 2, otro: 0, dn: 0, t: [base(2) + 3 * M, base(2) + 5 * H] }, deliv: { sent: 0, delivered: 0, read: 0, failed: 0, linea: 2 },
        tel: { tot: 2, dExp: 0, d0: 2, dNo: 0, c90: 0, noSt: {}, llaves: [] } }),
      t3: sw(3, { foMch: 'email', cl: { n: 0, ok: 0, na: 0, linea: 0, otro: 0, dn: 0, t: [] }, deliv: { sent: 0, delivered: 1, read: 0, failed: 0, linea: 0 } }),
      t4: sw(4, { foMch: 'call', calls: 1, cl: { n: 1, ok: 1, na: 0, linea: 0, otro: 0, dn: 1, t: [base(4) + 4 * M] }, deliv: { sent: 0, delivered: 0, read: 1, failed: 0, linea: 0 },
        tel: { tot: 1, dExp: 0, d0: 0, dNo: 1, c90: 0, noSt: { completed: 1 }, llaves: ['meta.call.recordingUrl'],
          por: { manual: { tot: 6, ok: 2, na: 1, linea: 3, otro: 0, c90: 1, dNo: 1 }, auto: { tot: 4, ok: 0, na: 0, linea: 4, otro: 0, c90: 0, dNo: 0 }, entrante: { tot: 2, ok: 2, na: 0, linea: 0, otro: 0, c90: 2, dNo: 0 } } } }),
    };
    const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, [], { u1: 'Daniela Arana' }, [], [], { now: Z('2026-10-12T12:00:00') });
    const advPrev = ADVISOR_LIST, aggPrev = slaState.agg, selPrev = slaState.asesor;
    ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }]; slaState.agg = agg; slaState.asesor = 'u1'; agg.ts = Date.now();
    navIr('ventas', 'desempeno'); slaRender();
    const vista = document.getElementById('view-sla');
    const tablaCon = (txt) => [...vista.querySelectorAll('table')].find(t => t.querySelector('tr') && t.querySelector('tr').innerText.toUpperCase().includes(txt));
    // (la primera celda trae debajo el botón "ver leads": se compara la primera línea)
    const filaDe = (t) => t && [...t.querySelectorAll('tr')].find(tr => tr.querySelector('td') && tr.querySelector('td').innerText.split('\n')[0].trim() === 'Daniela Arana');
    const celdas = (tr) => tr ? [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null;
    const g = celdas(filaDe(tablaCon('CANAL DEL 1ER TOQUE'))), t = celdas(filaDe(tablaCon('INTENTOS 24 H')));
    const txt = vista.innerText;
    // Actividad efectiva: deliv {read 2, failed 1, linea 3} → 2 de 3 desde el 7-oct; 2 de 6 antes
    const leadsE = [{ sd: false, deliv: { read: 2, failed: 1, linea: 3 }, ap: { tot: 0, sh: 0 }, bucket: 'b5' }];
    const nuevo = slaScoreAsesor(leadsE, slaRubrica('2026-10-05', '2026-10-11'), { lineaFuera: true }).cnt.efec, viejo = slaScoreAsesor(leadsE, slaRubrica('2026-09-28', '2026-10-04'), { lineaFuera: false }).cnt.efec;
    // Medianas auditables (Dirección, 13-oct-2026): N en la tarjeta, "ver leads" con el porqué
    // de cada lead, y la campaña cruzada igual que en Calidad de Leads (por id de contacto).
    const kpiTxt = [...vista.querySelectorAll('.crm-kpi')].map(k => k.innerText.replace(/\s+/g, ' ')).find(x => /P80 1er toque · el 80%/i.test(x)) || '';
    const tCamp = tablaCon('CAMPAÑA DE ORIGEN');
    const btn = tCamp && tCamp.querySelector('[data-sla-det]');
    if (btn) btn.click();
    const det = btn && document.getElementById(btn.dataset.slaDet);
    const auditoria = { kpi: kpiTxt, abierto: !!det && !det.hidden && btn.textContent === 'ocultar ▾',
      cols: det ? [...det.querySelectorAll('thead th')].map(th => th.innerText.trim()).join('|') : '',
      filas: det ? [...det.querySelectorAll(':scope table.sla-det > tbody > tr')].map(tr => tr.cells[7].innerText.trim()).join('|') : '' };
    const lqPrev = slaState.lqAgg, lqA = lqState.agg;
    lqState.agg = null; slaState.lqAgg = { leads: [{ id: 't1', camp: 'CAMPANA_DE_LQ' }, { id: 't2', camp: LQ_SIN_CAMP }] }; slaState._lqMapDe = null; slaRender();
    const tCamp2 = tablaCon('CAMPAÑA DE ORIGEN');
    auditoria.campLq = tCamp2 ? [...tCamp2.querySelectorAll(':scope > tbody > tr')].slice(1).filter(tr => !tr.classList.contains('sla-det-row')).map(tr => tr.cells[0].innerText.split('\n')[0].trim() + '=' + tr.cells[1].innerText.trim()).join('|') : '';
    auditoria.notaLq = /Campaña cruzada igual que en Calidad de Leads/.test(vista.innerText);
    slaState.lqAgg = lqPrev; lqState.agg = lqA; slaState._lqMapDe = null;
    ADVISOR_LIST = advPrev; slaState.agg = aggPrev; slaState.asesor = selPrev;
    const r = { g, t, auditoria, efec: { nuevo, viejo }, sinGris: !/1er msj \(autom\.\)/i.test(txt) && !/Cualquier salida ≤60 s/i.test(txt),
      duracion: /conocida en 5 de 6 \(83%\)/.test(txt) && /1 conectaron sin duración legible/.test(txt) && /meta\.call\.recordingUrl/.test(txt),
      origen: /6 del asesor — 3 con falla de línea \(50%\), 2 conectadas, 1 sin duración · 4 automáticas \(workflow, campaña, envío masivo, API o sin usuario\) — 4 con falla de línea \(100%\)/.test(txt) && /2 entrantes del lead/.test(txt),
      kpi: !/P80 1er intento de llamada/i.test(txt) && /P80 1er llamada/i.test(txt) && /1 no medible: llamada conectada sin duración/i.test(txt), ficha: /Llamadas: 6 intentos \(5 en las primeras 24 h\)/.test(txt) && /falla de línea 3/.test(txt) };
    // groupTbl: [nombre, leads, en horario, 1er toque, canal, conectada, efectivos, P80 toque, P80 1er llamada, llamadas/lead, sin marcar, solo línea, ...]
    // (los P80 traen su N debajo y "chica" con menos de 5 leads; 1a llamada en 10, 3 y 4 min → P80 = 10 min)
    r.ok = !!g && g[0] === 'Daniela Arana ver leads ▸' && g[2] === '4 de 4 (100%)' && g[4] === 'Llamada 50% · WhatsApp 25% SMS 0% · Correo 25%' && g[7] === '2 min 4 leads · chica' && g[8] === '10 min 3 leads · chica'
      && g[9] === '1.3 / 1.5' && g[10] === '1 (25%)' && g[11] === '1'
      && /^2 min P80 1ER TOQUE .* 4 LEADS · MUESTRA CHICA, NO COMPARAR$/i.test(auditoria.kpi) && auditoria.abierto
      && auditoria.cols === 'LEAD|ENTRADA|HORARIO|ASESOR|1ER TOQUE|CANAL|TIEMPO|¿EN EL P80?|CONTACTO EFECTIVO' && auditoria.filas === 'sí|sí|sí|sí'
      && auditoria.campLq === '(sin campaña atribuida)=3|CAMPANA_DE_LQ=1' && auditoria.notaLq
      && !!t && t.slice(1).join('|') === '4|1|3|5|6|2 (33%)|1 (17%)|1 (17%)|3 (50%)|·|1|1|1'   // exitosas ≥90 s después de conectadas
      && nuevo[0] === 2 && nuevo[1] === 3 && viejo[1] === 6 && r.sinGris && r.duracion && r.kpi && r.ficha && r.origen;
    return r;
  });
  console.log('\n[telefonía] por asesora', JSON.stringify(tel));
  // Llamada automática con contacto (Dirección General, 7-oct-2026): el workflow marca a los
  // 40 s y conecta 2 min; el asesor escribe a mano a los 10 min. Con las reglas v1.1 cuenta
  // como contacto efectivo y como 1er toque a su hora real (60 s y 5 min); antes del 1-oct, no.
  const auto = await page.evaluate(() => {
    const iso = (t) => new Date(t).toISOString();
    const mk = (local) => { const c0 = Date.parse(local + '-05:00');
      return [[{ id: 'a1', n: 'Lead a1', c: iso(c0), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} }],
        { a1: { foM: c0 + 10 * 60e3, foA: c0 + 40e3, nA: 1, fe: c0 + 40e3, fi: null, days: [], calls: 0, chans: ['whatsapp'], deliv: {}, ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 }, cl: { n: 0, ok: 0, na: 0, linea: 0, otro: 0, dn: 0, t: [] } } }]; };
    const [c1, s1] = mk('2026-10-06T10:00:00'), [c0, s0] = mk('2026-09-22T10:00:00');
    const nuevo = buildSlaAgg(['2026-W41'], c1, s1, [], { u1: 'Daniela Arana' }, [], [], { now: Date.parse('2026-10-12T17:00:00Z') }).leads[0];
    const viejo = buildSlaAgg(['2026-W39'], c0, s0, [], { u1: 'Daniela Arana' }, [], [], { now: Date.parse('2026-10-12T17:00:00Z') }).leads[0];
    const r = { nuevo: { velOk: nuevo.velOk, slaAt: nuevo.slaAt, fi: !!nuevo.fi, tAuto: nuevo.tAuto, bucket: nuevo.bucket, foM: !!nuevo.foM },
                viejo: { velOk: viejo.velOk, slaAt: viejo.slaAt, fi: !!viejo.fi, tAuto: viejo.tAuto } };
    r.ok = nuevo.velOk === true && nuevo.slaAt === 40e3 && nuevo.slaAt <= 60e3 && !!nuevo.fi && nuevo.tAuto === true && nuevo.bucket === 'b5'
      && viejo.velOk === false && viejo.slaAt === 600e3 && !viejo.fi && viejo.tAuto === false;
    return r;
  });
  console.log('[telefonía] llamada automática con contacto', JSON.stringify(auto));
  // Show rate (7-oct-2026): "0 de 1" con citas que sí ocurrieron. Ahora: citas del periodo
  // por FECHA DE LA CITA, de cualquier lead, y asistencia por calendario o por etapa.
  const show = await page.evaluate(() => {
    const Z = (local) => Date.parse(local + '-05:00'), iso = (t) => new Date(t).toISOString();
    const pipes = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 'sCE', name: 'Contacto establecido' }, { id: 'sZR', name: 'Zoom realizado' }, { id: 'sNS', name: 'Zoom no show / re agendar' }, { id: 'sOPP', name: 'Seguimiento de OPP' }] }];
    // Un solo lead entró en la semana; los demás son de agosto (antes no contaban sus citas).
    const contactos = [{ id: 'n1', n: 'Lead nuevo', c: iso(Z('2026-10-06T10:00:00')), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} }];
    const sweeps = { n1: { foM: Z('2026-10-06T10:02:00'), days: [], calls: 0, chans: [], deliv: {}, ap: { tot: 1, sh: 0, ns: 1, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 } } };
    const opp = (ct, s) => ({ id: 'o' + ct, ct, u: 'u1', st: 'open', c: iso(Z('2026-08-10T10:00:00')), p: 'p1', s, sc: iso(Z('2026-10-07T12:00:00')), cf: {} });
    const opps = [opp('v1', 'sZR'), opp('v2', 'sOPP'), opp('v3', 'sNS'), opp('v4', 'sCE'), opp('n1', 'sCE'), opp('v8', 'sCE')];
    const cita = (ct, local, st, u) => ({ id: 'e' + ct + local, ct, u: u === undefined ? 'u1' : u, t: Z(local), st, cal: 'Zoom' });
    const citas = [cita('n1', '2026-10-06T16:00:00', 'noshow'),            // la única que contaba antes: 0 de 1
      cita('v0', '2026-10-06T12:00:00', 'showed'),                           // asistió · calendario
      cita('v1', '2026-10-07T11:00:00', 'confirmed'),                        // asistió · etapa Zoom realizado
      cita('v2', '2026-10-07T12:00:00', 'confirmed', ''),                    // asistió · etapa posterior; asesor = dueño del lead
      cita('v3', '2026-10-08T11:00:00', 'confirmed'),                        // no show · etapa
      cita('v4', '2026-10-08T12:00:00', 'confirmed'),                        // sin registrar: la etapa no dice nada
      cita('v5', '2026-10-09T12:00:00', 'cancelled'),                        // cancelada
      cita('v6', '2026-10-11T12:00:00', 'confirmed'),                        // por venir (después de "ahora", dentro de la semana)
      // Agendadas en la semana para fechas posteriores (antes no contaban): 2, más una cancelada que no cuenta
      Object.assign(cita('v7', '2026-10-20T12:00:00', 'confirmed'), { ag: Z('2026-10-07T09:00:00') }),
      Object.assign(cita('v8', '2026-10-27T12:00:00', 'new', ''), { ag: Z('2026-10-08T09:00:00') }),
      Object.assign(cita('v9', '2026-10-21T12:00:00', 'cancelled'), { ag: Z('2026-10-08T10:00:00') }),
      Object.assign(cita('vA', '2026-10-22T12:00:00', 'confirmed'), { ag: Z('2026-09-20T10:00:00') })];   // agendada antes del rango
    const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, opps, { u1: 'Daniela Arana' }, [], pipes, { now: Z('2026-10-10T09:00:00'), citas, citasOk: true });
    const R = slaCitasRes(agg.citasP.rows);
    const advPrev = ADVISOR_LIST, aggPrev = slaState.agg, selPrev = slaState.asesor;
    ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }]; slaState.agg = agg; slaState.asesor = ''; agg.ts = Date.now();
    navIr('ventas', 'desempeno'); slaRender();
    const vista = document.getElementById('view-sla'), txt = vista.innerText;
    const tabla = [...vista.querySelectorAll('table')].find(t => t.querySelector('tr') && /ASISTIÓ · CALENDARIO/.test(t.querySelector('tr').innerText.toUpperCase()));
    const fila = tabla && [...tabla.querySelectorAll('tr')].find(tr => tr.querySelector('td') && tr.querySelector('td').innerText.trim() === 'Daniela Arana');
    const celdas = fila ? [...fila.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null;
    ADVISOR_LIST = advPrev; slaState.agg = aggPrev; slaState.asesor = selPrev;
    const r = { R: { tot: R.tot, asC: R.asC, asE: R.asE, ns: R.ns, can: R.can, sinreg: R.sinreg, fut: R.fut }, celdas,
      kpi: /Show rate · citas del periodo por fecha de la cita · 3 por etapa del pipeline · 1 pasada sin registrar asistencia/i.test(txt) && /60%\s*\n?\s*SHOW RATE/i.test(txt.replace(/\n+/g, '\n')) };
    // 3 asistieron (1 calendario + 2 etapa), 2 no show (1 calendario + 1 etapa) → 60%
    r.agendadas = agg.citasP.agendadas.length;
    r.ok = R.tot === 8 && R.asC === 1 && R.asE === 2 && R.ns === 2 && R.can === 1 && R.sinreg === 1 && R.fut === 1
      && r.agendadas === 2 && !!celdas && celdas.slice(1).join('|') === '2|8|1|2|2|60% (3 de 5)|1|1|1' && /3 de 5/.test(txt)
      && !/CITAS AGENDADAS EN EL PERIODO/i.test(txt);   // al lado de la tasa va la tasa sobre leads, no el conteo (columna Agendadas)
    return r;
  });
  console.log('[show rate] citas del periodo', JSON.stringify(show));
  // Tasa de agendamiento: quien agenda por el link sin escribir también cuenta en la base.
  const agd = await page.evaluate(() => {
    const L = [{ fi: 1, ap: { tot: 1 } }, { fi: 1, ap: { tot: 0 } }, { fi: null, ap: { tot: 2 } }, { fi: null, ap: { tot: 0 } }, { fi: 1, ad: true, ap: { tot: 0 } }];
    const b = slaAgBase(L); return { base: b.length, con: b.filter(l => l.ap.tot > 0).length };
  });
  console.log('[agendamiento] base', JSON.stringify(agd));
  if (!(agd.base === 3 && agd.con === 2)) hallazgos.push({ vista: 'agendamiento', agd });
  if (!show.ok) hallazgos.push({ vista: 'showrate', show });
  if (!auto.ok) hallazgos.push({ vista: 'telefonia:auto', auto });
  if (!tel.ok) hallazgos.push({ vista: 'telefonia:asesora', tel });
  if (!lqx.ok) hallazgos.push({ vista: 'lq:rediseño', lqx });
  // Brokers por CUALQUIER etiqueta que empiece con "broker" (Dirección, 14-oct-2026): los seis
  // contactos de W42 que salían en "Otra fuente · (sin campaña atribuida)", dados de alta a mano.
  // Con ellos en el CRM, Calidad, Combinado y Conclusiones deben verse IGUAL que sin ellos (salvo
  // la nota de excluidos, que los nombra y dice cuántos leads tendría cada fila con ellos).
  VISTA = 'lq:brokers';
  const lqbk = await page.evaluate(async (fx0) => {
    window.LQ_HOY_FIJO = '2026-10-05';
    const copia = () => JSON.parse(JSON.stringify(fx0));
    const arma = (fx) => { const a = buildLqAgg(fx.boot, fx.rawLeads, fx.spendRows, fx.weeks, fx.opps, fx.adRows, fx.adExtra); a.fallos = []; a.monedas = ['MXN']; return a; };
    const NOM = ['Jorge Vega', 'Cristina Gómez Saucedo', 'Oswaldo Ortega', 'Sarah Rose', 'Marco Gamborino', 'Nicole Ponzos'];
    const TAGS = [['broker'], ['broker-signup-web'], ['Broker'], [' broker-client '], ['broker', 'cliente'], ['brokers-referido']];
    const fx1 = copia();
    NOM.forEach((n, i) => fx1.rawLeads.push({ id: 'bkw' + i, n, em: 'bkw' + i + '@ejemplo.com', ph: String(9980000000 + i), c: `2026-10-0${1 + (i % 3)}T16:00:00.000Z`,
      src: i === 4 ? 'fb' : '', u: 'u1', tags: TAGS[i], cf: {}, attr: i === 4 ? { src: 'facebook' } : i === 1 ? {} : { src: 'CRM UI' } }));
    const agg0 = arma(copia()), agg1 = arma(fx1);
    const r = { marcados: agg1.leads.filter(l => NOM.includes(l.n) && l.bk).length };
    Object.assign(lqState, { exp: {}, q: '', plat: 'all', level: 'camp', qual: 'auto', diagReglas: false, ia: null, bitacora: [] });
    const foto = (agg, sub) => {
      lqState.agg = agg; lqPopulateWeeks();
      document.getElementById('lq-sem-ini').value = '2026-W37'; document.getElementById('lq-sem-fin').value = '2026-W40';
      lqState.sub = sub; lqRender();
      const el = document.getElementById('lq-content'), nota = el.querySelector('.lq-excluidos [data-lq-tip]');
      const tips = [...el.querySelectorAll('[data-lq-tip]')].filter(x => !x.closest('.lq-excluidos')).map(x => x.dataset.lqTip).join(' ');
      const c = el.cloneNode(true); c.querySelectorAll('.lq-excluidos').forEach(x => x.remove());
      const d = document.createElement('div'); d.innerHTML = nota ? nota.dataset.lqTip : '';
      return { txt: c.textContent.replace(/\s+/g, ' '), tips, nota: d.textContent.replace(/\s+/g, ' '), excl: (el.querySelector('.lq-excluidos') || {}).textContent || '' };
    };
    r.iguales = {}; r.aparecen = [];
    for (const sub of ['calidad', 'combinado', 'conclusiones']) {
      const a = foto(agg0, sub), b = foto(agg1, sub);
      r.iguales[sub] = a.txt === b.txt;
      NOM.forEach(n => { if (b.txt.includes(n) || b.tips.includes(n)) r.aparecen.push(sub + ':' + n); });
      if (sub === 'calidad') { r.nota = b.nota; r.excl = b.excl.replace(/\s+/g, ' ').trim(); }
    }
    r.mesVsMes = /mes/i.test(foto(agg1, 'calidad').txt);
    lqState.agg = agg0;
    r.ok = r.marcados === 6 && Object.values(r.iguales).every(Boolean) && !r.aparecen.length
      && NOM.every(n => r.nota.includes(n)) && /Todos los leads del rango 78 → 69/.test(r.nota) && /Otra fuente · \(sin campaña atribuida\) (\d+) → \1|Otra fuente · \(sin campaña atribuida\) \d+ → \d+/.test(r.nota)
      && /9 leads de brokers/.test(r.excl) && /etiqueta que empieza con "broker"/.test(r.excl);
    return r;
  }, fixture());
  console.log('[calidad de leads] brokers por etiqueta', JSON.stringify(lqbk).slice(0, 1200));
  if (!lqbk.ok) hallazgos.push({ vista: 'lq:brokers', lqbk });
  console.log('\n[reglas v1.1] aceptación', JSON.stringify(v11));
  if (!v11.ok) hallazgos.push({ vista: 'reglas:v1.1', v11 });
  // Notas de las tarjetas de Desempeño (Dirección, 13-oct-2026): "28 leads y solo 4 en la
  // mediana de 1er toque". El reloj arranca siempre en el alta (14-oct-2026): el toque hecho
  // antes de crear la oportunidad entra con su tiempo real y crear la oportunidad tarde ya no
  // esconde el tiempo entre la entrada del lead y su primer toque.
  VISTA = 'desempeno:notas';
  const notas = await page.evaluate(() => {
    const Z = (local) => Date.parse(local + '-05:00'), iso = (t) => new Date(t).toISOString();
    const users = { u1: 'Daniela Arana' }, pipes = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }] }];
    const contactos = [], sweeps = {}, opps = [];
    const lead = (id, local, sw, oppLocal) => {
      contactos.push({ id, n: 'Lead ' + id, c: iso(Z(local)), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} });
      sweeps[id] = Object.assign({ foM: null, fi: null, fe: null, days: [], calls: 0, chans: [], deliv: { sent: 0, delivered: 0, read: 0, failed: 0 }, ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 } }, sw);
      opps.push({ id: 'o-' + id, ct: id, u: 'u1', st: 'open', c: iso(Z(oppLocal || local)), p: 'p1', s: 's1', sc: '', cf: {} });
    };
    lead('med', '2026-10-05T10:00:00', { foM: Z('2026-10-05T10:03:00'), foMch: 'whatsapp' });                                   // en la mediana: 3 min
    lead('antes', '2026-10-05T11:00:00', { foM: Z('2026-10-05T11:05:00'), foMch: 'call', calls: 1, chans: ['call'],
      cl: { n: 1, ok: 0, na: 1, linea: 0, otro: 0, dn: 0, t: [Z('2026-10-05T11:05:00')] } }, '2026-10-05T11:20:00');           // llamó y DESPUÉS se creó la OPP: 5 min desde el alta
    lead('tarde', '2026-10-05T13:00:00', { foM: Z('2026-10-05T15:02:00'), foMch: 'whatsapp' }, '2026-10-05T15:00:00');       // OPP creada 2 h después: cuenta 122 min, no 2
    lead('noche', '2026-10-05T22:00:00', { foM: Z('2026-10-06T09:30:00'), foMch: 'whatsapp' });                                 // fuera de horario
    lead('nada', '2026-10-05T12:00:00', {});                                                                                    // sin toque
    const now = Z('2026-10-12T12:00:00');
    const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, opps, users, [], pipes, { oppFields: [], oppFieldsOk: true, ncState: {}, tagged: [], taggedOk: true, now });
    const aggPrev = slaState.agg, selPrev = slaState.asesor, advPrev = ADVISOR_LIST;
    ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }]; slaState.asesor = 'u1'; slaState.agg = agg; agg.ts = now;
    navIr('ventas', 'desempeno'); slaRender();
    const tarjeta = (rx) => [...document.querySelectorAll('#view-sla .crm-kpi')].find(k => rx.test(k.querySelector('.k-lbl').textContent));
    const nota = (rx) => { const k = tarjeta(rx); if (!k || !k.dataset.lqTip) return ''; const d = document.createElement('div'); d.innerHTML = k.dataset.lqTip; return d.textContent.replace(/\s+/g, ' '); };
    const L = {}; agg.leads.forEach(l => { L[l.id] = l; });
    const r = {};
    r.antes = !!(L.antes && L.antes.slaAt === 5 * 60e3 && L.antes.slaCall === 5 * 60e3 && !slaAntesReloj(L.antes)
      && L.tarde && L.tarde.created === L.tarde.alta && L.tarde.slaAt === 122 * 60e3 && L.tarde.velOk === false && !slaAntesReloj(L.nada));
    r.tarjeta60 = tarjeta(/^1er toque ≤60 s/) ? tarjeta(/^1er toque ≤60 s/).querySelector('.k-lbl').textContent : '';
    r.valor = tarjeta(/^P80 1er toque/).querySelector('.k-val').textContent;
    r.sub = tarjeta(/^P80 1er toque/).querySelectorAll('.k-lbl')[1].textContent;
    r.sinNota = [...document.querySelectorAll('#view-sla .crm-kpis.k4 .crm-kpi')].filter(k => !k.dataset.lqTip).map(k => k.querySelector('.k-lbl').textContent);
    r.conNota = !r.sinNota.length;
    r.mediana = nota(/^P80 1er toque/);
    r.sla5 = nota(/^Velocidad · cumplieron su SLA/);
    // Tarjetas (14-oct-2026): 8, en este orden; sin la de 60 s ni la de 1a llamada; la tasa de agendamiento sobre contactados y sobre leads.
    r.grupos = [...document.querySelectorAll('#view-sla .crm-kpis.k4')].map(g => g.children.length).join('+');
    r.tarjetas = [...document.querySelectorAll('#view-sla .crm-kpis.k4 .crm-kpi')].map(k => k.querySelector('.k-lbl').textContent.split(' · ')[0]).join('|');
    r.det = slaDetalleLeads(agg.leads, agg.v11, (u) => users[u] || '');
    ADVISOR_LIST = advPrev; slaState.asesor = selPrev; slaState.agg = aggPrev;
    r.ok = r.antes && r.conNota
      // P80 (14-oct-2026): en horario, 3 · 5 · 122 min y uno sin toque → el 4º de 4 es "sin toque"
      && r.valor === 'sin toque' && /1 sin toque/.test(r.sub) && r.tarjeta60 === ''
      && r.grupos === '4+4' && r.tarjetas === 'Leads en el rango|Velocidad|P80 1er toque|Fuera de horario atendidos antes de las 11:00|Contactados efectivos|Tasa de agendamiento|Tasa de agendamiento sobre leads|Show rate de citas'
      && /Base: 4 de 5 leads\. Fuera de horario, 1: no entran .*Sin 1er toque, 1: entran como el peor tiempo/.test(r.mediana)
      && /Sale "sin toque"/.test(r.mediana) && /mismo 80% que pide el 5 de Velocidad/.test(r.mediana)
      && !/traspaso/.test(r.mediana)
      && /^Leads cuyo 1er toque llegó a tiempo/.test(r.sla5) && !/antes de que arrancara su reloj/.test(r.sla5)
      && !/traspaso/.test(r.det) && /sí, como sin toque: cuenta en contra/.test(r.det) && /no: entró fuera de horario/.test(r.det) && !/anterior a su alta/.test(r.det);
    delete r.det;
    return r;
  });
  console.log('[desempeño] notas de las tarjetas', JSON.stringify(notas).slice(0, 900));
  if (!notas.ok) hallazgos.push({ vista: 'desempeno:notas', notas });
  // "Estas dos son lo mismo" (Dirección General, 14-oct-2026): la tarjeta de 1er intento de llamada
  // salió de arriba; queda una sola de tiempo, el P80 de 1er toque (4, 7 y 20 min → 20 min), sea el
  // 1er toque una llamada o un WhatsApp. La 1a llamada sigue en la tabla por asesor.
  VISTA = 'desempeno:toque=llamada';
  const tll = await page.evaluate(() => {
    const Z = (local) => Date.parse(local + '-05:00'), iso = (t) => new Date(t).toISOString();
    const users = { u1: 'Daniela Arana' }, pipes = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }] }];
    const armar = (conWa) => {
      const contactos = [], sweeps = {}, opps = [];
      const lead = (id, local, mins, ch) => {
        const t = Z(local) + mins * 60e3;
        contactos.push({ id, n: 'Lead ' + id, c: iso(Z(local)), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} });
        sweeps[id] = { foM: t, foMch: ch, fi: null, fe: null, days: [], calls: ch === 'call' ? 1 : 0, chans: [ch], deliv: { sent: 0, delivered: 0, read: 0, failed: 0 },
          ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 },
          cl: { n: 1, ok: 0, na: 1, linea: 0, otro: 0, dn: 0, t: [ch === 'call' ? t : t + 90 * 60e3] } };
        opps.push({ id: 'o-' + id, ct: id, u: 'u1', st: 'open', c: iso(Z(local)), p: 'p1', s: 's1', sc: '', cf: {} });
      };
      lead('a', '2026-10-05T10:00:00', 4, 'call');
      lead('b', '2026-10-05T11:00:00', 20, 'call');
      lead('c', '2026-10-05T12:00:00', 7, conWa ? 'whatsapp' : 'call');
      const now = Z('2026-10-12T12:00:00');
      const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, opps, users, [], pipes, { oppFields: [], oppFieldsOk: true, ncState: {}, tagged: [], taggedOk: true, now });
      const aggPrev = slaState.agg, selPrev = slaState.asesor, advPrev = ADVISOR_LIST;
      ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }]; slaState.asesor = 'u1'; slaState.agg = agg; agg.ts = now;
      navIr('ventas', 'desempeno'); slaRender();
      const kpis = [...document.querySelectorAll('#view-sla .crm-kpis .crm-kpi')];
      const lbl = (k) => k.querySelector('.k-lbl').textContent;
      const de = (rx) => kpis.filter(k => rx.test(lbl(k)));
      const nota = (k) => { if (!k || !k.dataset.lqTip) return ''; const d = document.createElement('div'); d.innerHTML = k.dataset.lqTip; return d.textContent.replace(/\s+/g, ' '); };
      const toque = de(/^P80 1er toque/), llamada = de(/intento de llamada/);
      const r = { toque: toque.length, llamada: llamada.length, valor: toque[0] ? toque[0].querySelector('.k-val').textContent : '', nota: nota(toque[0]) };
      ADVISOR_LIST = advPrev; slaState.asesor = selPrev; slaState.agg = aggPrev;
      return r;
    };
    const igual = armar(false), distinto = armar(true);
    return { igual, distinto,
      ok: igual.toque === 1 && igual.llamada === 0 && igual.valor === '20 min' && /Base: 3 de 3 leads/.test(igual.nota)
        && distinto.toque === 1 && distinto.llamada === 0 && distinto.valor === '20 min' };
  });
  console.log('[desempeño] 1er toque = 1er llamada', JSON.stringify(tll).slice(0, 900));
  if (!tll.ok) hallazgos.push({ vista: 'desempeno:toque=llamada', tll });
  // Tres bloques (Dirección General, 14-oct-2026): Resumen, Qué corregir hoy (con los leads que bajaron
  // la Velocidad, por nombre) y Detalle plegado; reglas plegadas; el plegable recuerda si se abrió.
  VISTA = 'desempeno:bloques';
  const blq = await page.evaluate(async () => {
    const Z = (local) => Date.parse(local + '-05:00'), iso = (t) => new Date(t).toISOString(), M = 60e3;
    const users = { u1: 'Daniela Arana' }, pipes = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }] }];
    const contactos = [], sweeps = {}, opps = [];
    const lead = (id, local, foM, cl) => {
      contactos.push({ id, n: 'Lead ' + id, c: iso(Z(local)), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} });
      sweeps[id] = { foM, foMch: foM ? 'call' : null, fi: null, fe: null, days: [], calls: 0, chans: [], deliv: { sent: 0, delivered: 0, read: 0, failed: 0 },
        ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 }, cl: cl || { n: 0, ok: 0, na: 0, linea: 0, otro: 0, dn: 0, c90: 0, t: [] } };
      opps.push({ id: 'o-' + id, ct: id, u: 'u1', st: 'open', c: iso(Z(local)), p: 'p1', s: 's1', sc: '', cf: {} });
    };
    lead('ok', '2026-10-05T10:00:00', Z('2026-10-05T10:04:00'), { n: 2, ok: 2, na: 0, linea: 0, otro: 0, dn: 0, c90: 1, t: [Z('2026-10-05T10:04:00'), Z('2026-10-05T12:00:00')] });
    lead('tarde', '2026-10-05T11:00:00', Z('2026-10-05T11:20:00'));          // en horario, 20 min
    lead('nada', '2026-10-05T12:00:00', null);                                // sin toque
    lead('noche', '2026-10-05T22:00:00', Z('2026-10-06T12:00:00'));          // fuera de horario, después de las 11:00
    const now = Z('2026-10-12T12:00:00');
    const agg = buildSlaAgg(['2026-W41'], contactos, sweeps, opps, users, [], pipes, { oppFields: [], oppFieldsOk: true, ncState: {}, tagged: [], taggedOk: true, now });
    const aggPrev = slaState.agg, selPrev = slaState.asesor, advPrev = ADVISOR_LIST, abPrev = slaState.abierto;
    ADVISOR_LIST = [{ name: 'Daniela Arana', active: true }]; slaState.asesor = ''; slaState.agg = agg; agg.ts = now; slaState.abierto = {};
    navIr('ventas', 'desempeno'); slaRender();
    const C = document.getElementById('sla-content'), txt = C.innerText;
    const pleg = (k) => C.querySelector(`details[data-sla-pleg="${k}"]`);
    const r = { reglasCerrado: !!pleg('reglas') && !pleg('reglas').open, detalleCerrado: !!pleg('detalle') && !pleg('detalle').open };
    // Orden: tarjetas → ranking → "Qué corregir hoy" → Detalle
    const pos = (el) => el ? [...C.querySelectorAll('*')].indexOf(el) : -1;
    const h2 = [...C.querySelectorAll('h2.sla-bloque')].find(h => /Qué corregir hoy/.test(h.textContent));
    const rank = [...C.querySelectorAll('h3')].find(h => /Desempeño del asesor/.test(h.textContent));
    r.orden = pos(C.querySelector('.kpi-grupo')) < pos(rank) && pos(rank) < pos(h2) && pos(h2) < pos(pleg('detalle'));
    // "Qué corregir hoy" se lee sin abrir nada; el Detalle no
    r.fallas = (txt.match(/Leads que bajaron la Velocidad · \d+ de \d+/) || [''])[0];
    r.resumen = /Daniela Arana 3 de 4 · 1 sin toque · 2 tarde/.test(txt);
    r.sinToque = /Sin 1er toque · 1/.test(txt) && /Lead nada/.test(txt);
    r.tarde = /Llegaron tarde · 2/.test(txt) && /antes de las 11:00/.test(txt);
    // Tasa de agendamiento sobre leads: misma cifra que la de al lado, pero entre TODOS los leads (aquí 0 de 4; la de contactados no tiene base)
    const tl = [...C.querySelectorAll('.crm-kpi')].find(k => /^Tasa de agendamiento sobre leads/.test(k.querySelector('.k-lbl').textContent));
    r.tasaLeads = tl ? tl.querySelector('.k-val').textContent + ' ' + tl.querySelectorAll('.k-lbl')[1].textContent : '';
    r.detalleOculto = !/Telefonía por asesora/.test(txt) && !!C.querySelector('details[data-sla-pleg="detalle"] h3');
    // Secciones sin nada que corregir: una sola línea, sin su bloque vacío
    r.vacias = (txt.match(/✓ Sin pendientes en: ([^\n]*)/) || ['', ''])[1];
    // MQL sin escalera completa (16-oct-2026): un lead en 2do toque sin respuesta, con 2 llamadas y un WhatsApp
    {
      const c2 = [{ id: 'esc1', n: 'Lead esc1', c: iso(Z('2026-10-06T10:00:00')), src: 'facebook', u: 'u1', tags: [], attr: {}, cf: {} }];
      const sw2 = { esc1: { foM: Z('2026-10-06T10:03:00'), foMch: 'call', fi: null, fe: null, days: [], calls: 2, chans: ['call', 'whatsapp'], deliv: { sent: 0, delivered: 0, read: 0, failed: 0 },
        ap: { tot: 0, sh: 0, ns: 0, fut: 0 }, tk: { prog: 0, enFecha: 0, venc: 0 }, cl: { n: 2, ok: 0, na: 2, linea: 0, otro: 0, dn: 0, c90: 0, t: [] } } };
      const p2 = [{ id: 'p1', name: 'Seguimiento de ventas', stages: [{ id: 's2', name: '2do toque' }] }];
      const ag2 = buildSlaAgg(['2026-W41'], c2, sw2, [{ id: 'o-esc1', ct: 'esc1', u: 'u1', st: 'open', c: iso(Z('2026-10-06T10:00:00')), p: 'p1', s: 's2', sc: '', cf: {} }], users, [], p2,
        { oppFields: [], oppFieldsOk: true, ncState: {}, tagged: [], taggedOk: true, now });
      const l2 = ag2.leads.find(x => x.id === 'esc1');
      const div = document.createElement('div'); div.innerHTML = slaSeccionesV11(ag2, ag2.leads, []);
      r.escDesempeno = (l2 ? l2.lv + (l2.mse ? '·mse' : '') : '') + ' | ' + ((div.textContent.match(/MQL sin escalera completa · \d+/) || [''])[0])
        + ' | ' + ([...div.querySelectorAll('table.rep tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()).join(' ¦ ')).filter(Boolean)[0] || '');
    }
    r.sinBloquesVacios = !/Leads inválidos \(fuera de la nota\) · 0/.test(txt) && !/Error de asignación · 0/.test(txt) && /Más de 7 días sin toque · 4/.test(txt);
    // Telefonía (dentro del Detalle): exitosas ≥90 s justo después de conectadas
    const tt = [...C.querySelectorAll('table')].find(t => /Exitosas ≥90 s/.test(t.querySelector('tr').textContent));
    const ths = tt ? [...tt.querySelector('tr').children].map(th => th.textContent.trim()) : [];
    r.colExitosas = ths.indexOf('Exitosas ≥90 s') === ths.indexOf('Conectadas') + 1;
    const fila = tt && [...tt.querySelectorAll('tr')].find(tr => tr.querySelector('td') && tr.querySelector('td').textContent.trim() === 'Daniela Arana');
    r.exitosas = fila ? fila.children[ths.indexOf('Exitosas ≥90 s')].textContent.replace(/\s+/g, ' ').trim() : '';
    // Abrir el Detalle y volver a pintar: sigue abierto
    pleg('detalle').open = true; await new Promise(res => setTimeout(res, 50));
    slaRender(); r.recuerda = !!pleg('detalle') && pleg('detalle').open;
    ADVISOR_LIST = advPrev; slaState.asesor = selPrev; slaState.agg = aggPrev; slaState.abierto = abPrev;
    r.ok = r.reglasCerrado && r.detalleCerrado && r.orden && r.fallas === 'Leads que bajaron la Velocidad · 3 de 4' && r.resumen && r.sinToque && r.tarde
      && /^mql·mse \| MQL sin escalera completa · 1 \| Lead esc1 ¦ Daniela Arana ¦ .* ¦ 2 ¦ 3 llamadas · email$/.test(r.escDesempeno)
      && r.tasaLeads === '0% 0 de 4' && r.detalleOculto && r.sinBloquesVacios && /Leads inválidos \(fuera de la nota\) · MQL sin escalera completa · Error de asignación · Descalificaciones revertidas/.test(r.vacias) && /Integridad del pipeline/.test(r.vacias)
      && r.colExitosas && r.exitosas === '1 (50%)' && r.recuerda;
    return r;
  });
  console.log('[desempeño] tres bloques', JSON.stringify(blq));
  if (!blq.ok) hallazgos.push({ vista: 'desempeno:bloques', blq });
  // Metas → Rúbrica de desempeño: los dos juegos de Velocidad, con su fecha
  const rbm = await page.evaluate(async () => { navIrLateral('metas'); await new Promise(r => setTimeout(r, 400)); const h = document.getElementById('metas-rubrica'); const t = h ? h.innerText : '';
    return { existe: !!h, viejo: /10 · 20 · 30 · 45%/.test(t), nuevo: /20 · 40 · 60 · 80%/.test(t), fecha: /1-oct-2026/.test(t), form: !!document.getElementById('rb-save') }; });
  console.log('[rubrica v1.2] Metas', JSON.stringify(rbm));
  if (!Object.values(rbm).every(Boolean)) hallazgos.push({ vista: 'rubrica:metas', rbm });
  // Dirección General: encabezados nuevos y guiones de Brokers
  const dg = await page.evaluate(() => { navIr('direccion', 'general'); return new Promise(r => setTimeout(() => { const t = document.querySelector('#view-resultados table.cons'); const ths = [...t.querySelectorAll('thead th')].map(x => x.innerText.trim()); const filaB = [...t.querySelectorAll('tbody tr')].find(tr => /Brokers/.test(tr.innerText)); r({ ths, brokers: filaB ? [...filaB.querySelectorAll('td')].map(x => x.innerText.trim()).slice(0, 10) : null }); }, 500)); });
  console.log('\n[DG] encabezados:', dg.ths.join(' | ')); console.log('[DG] fila Brokers (10 primeras):', dg.brokers && dg.brokers.join(' | '));
  // Primer Contacto y Rescate (manual operativo, oct-2026): una semana sintética del puesto con
  // los casos del manual y el resultado de cada indicador calculado a mano (scripts/pc-fixture.js).
  VISTA = 'pc:modelo';
  const pcx = await page.evaluate(async (F) => {
    const A = pcBuild(F.D, pcCfgDe(F.cfg), F.now), E = F.esperado, r = {};
    const V = A.vel.filter(v => v.vent && !v.err);
    r.universo = A.nU === E.nU && A.excl.fuera === E.excl.fuera && A.excl.prueba === E.excl.prueba;
    r.velocidad = V.length === E.vel.den && V.filter(v => v.cumple).length === E.vel.ok
      && A.vel.find(v => v.id === 'lead00001').org === 'ejecutivo' && A.vel.find(v => v.id === 'lead00001').doble === true
      && A.vel.find(v => v.id === 'lead00010').org === 'automática contestada ≥90 s' && A.vel.find(v => v.id === 'lead00011').dt === 5 * 60e3;
    // Marcó en 60 s: la automática conectó ≥90 s, o remarcación manual en ≤2 min tras la automática fallida
    r.protocolo = Object.entries(E.t1).every(([id, [ok, via, rem]]) => { const v = A.vel.find(x => x.id === id); return v && v.cumple === ok && v.via === via && v.rem === rem; })
      && A.coh.some(x => x.id === 'lead00010') && A.coh.some(x => x.id === 'lead00009') && A.diag.autoSinU === 3 && A.diag.autoConU === 1;
    r.dbg = '';
    r.puntos = A.ptsCerrados === E.puntos && A.habiles.length === E.habiles && Object.entries(E.dia).every(([d, n]) => A.dias[d] && A.dias[d].pts === n)
      && A.dias['2026-10-26'].tope === 1 && A.dias['2026-10-30'].solas === 1 && A.dias['2026-10-30'].linea === 1 && A.fueraPts === E.fueraPts;
    r.conv60 = A.conv60 === E.conv60;
    // Cómo fue el contacto efectivo, citas sin conversación, lead de madrugada y el que regresa
    r.via = Object.entries(E.via).every(([k, n]) => A.coh.filter(x => x.via === k).length === n)
      && JSON.stringify(A.citaSinConv.map(c => c.id)) === JSON.stringify(E.citaSinConv)
      && (() => { const v = A.vel.find(x => x.id === E.noche.id); return v && !v.vent && v.dtAbre === E.noche.dtAbre && v.autoMsg === E.noche.autoMsg; })()
      && A.vel.find(x => x.id === 'lead00013').re === true && A.coh.find(x => x.id === 'cart00002').falta === 'intento 2 de 3'
      && A.diag.plant === 1 && !A.coh.some(x => x.id === 'lead00002') && A.cad.find(x => x.id === 'lead00002').est === 'silencio';
    const den = A.coh.filter(x => A.PC_DEN.includes(x.res));
    r.entrega = den.length === E.entrega.den && den.filter(x => x.res === 'entregado').length === E.entrega.ent
      && Object.entries(E.res).every(([k, n]) => A.coh.filter(x => x.res === k).length === n);
    const S = A.ses;
    r.asistencia = S.filter(s => s.est === 'asistio').length === E.asist.as && S.filter(s => ['asistio', 'noshow', 'cancelada'].includes(s.est)).length === E.asist.den
      && S.filter(s => s.calif === 'si').length === E.calif.si && S.filter(s => s.calif === 'no').length === E.calif.no;
    r.datos = A.datos.length === E.datos.n && A.datos.filter(d => d.completo).length === E.datos.ok && A.citas.porToque === 1;
    const C = A.cad.filter(c => c.est === 'silencio');
    r.cadencia = C.length === E.cad.silencio && C.filter(c => c.toques >= 6).length === E.cad.completos
      && (A.cad.find(c => c.id === 'lead00002') || {}).breakUp === true && (A.cad.find(c => c.id === 'lead00002') || {}).sinResp === true;
    r.cartera = Object.entries(E.cart).every(([k, [p, pts]]) => A.cart[k] && A.cart[k].pros === p && A.cart[k].pts === pts);
    r.recepcion = Object.entries(E.recep).every(([id, [est, conf]]) => { const x = A.recep.find(y => y.id === id); return x && x.est === est && x.conf === conf; });
    // Antes del arranque (modo real) el periodo no mide nada anterior al 26-oct
    const F2 = JSON.parse(JSON.stringify(F)); F2.D.per = { ...F2.D.per, ini: Date.parse('2026-10-19T05:00:00Z') };
    F2.D.leads.push({ id: 'leadAntes1', n: 'Lead Anterior', c: '2026-10-20T15:00:00Z', u: 'epc1', tags: [], cf: {} });
    const A2 = pcBuild(F2.D, pcCfgDe(F2.cfg), F2.now);
    r.arranque = A2.nU === E.nU && A2.per.iniYMD === '2026-10-26' && A2.per.recortado === true;
    // Sin marcador registrado: la velocidad es informativa (3.1)
    const A3 = pcBuild(F.D, pcCfgDe({ ...F.cfg, marcador: '' }), F.now);
    r.marcador = A3.vel.every(v => v.eval === false);
    // Pantalla
    navIr('ventas', 'primer');
    pcState.cfg = pcCfgDe(F.cfg); pcState.agg = A; pcRender();
    await new Promise(res => setTimeout(res, 200));
    const t = document.getElementById('pc-content').innerText;
    r.pantalla = /Indicadores del puesto/.test(t) && /5 de 10 leads en la ventana operativa: la automática conectó/.test(t) && /5\.2/.test(t) && /70%/.test(t) && /5 de 10 cumplieron/.test(t)
      && /por registro del ejecutivo 1/.test(t) && /1 cita sin conversación registrada/.test(t) && /marcados en ≤15 min desde la apertura: 1 de 1/.test(t) && /intento 2: 1/.test(t) && /en ≤2 min 1/.test(t) && /primer toque completo/i.test(t) && /Agenda de más|Problema de fondo|Correcto/.test(t)
      && !/undefined|NaN|\[object Object\]/.test(t);
    // Los desplegables abren y cierran
    const b = document.querySelector('#pc-content [data-pc-det]'); b.click();
    if (!r.pantalla) r.dbg = t.slice(t.indexOf('Llamada automática'), t.indexOf('Llamada automática') + 400);
    r.desplegable = !document.getElementById(b.dataset.pcDet).hidden;
    // Sincronización de punta a punta contra el CRM simulado: mismo resultado que el modelo.
    const ahora = Date.now; Date.now = () => F.now;
    try {
      pcState.cfg = pcCfgDe(F.cfg); pcState.quien = ''; pcState.tipo = 'semana'; pcState.clave = '2026-W44'; pcState.agg = null;
      await pcSync();
    } finally { Date.now = ahora; }
    const S2 = pcState.agg;
    r.sync = !!S2 && S2.ptsCerrados === E.puntos && S2.nU === E.nU && S2.coh.filter(x => x.res === 'entregado').length === E.entrega.ent
      && S2.ses.filter(s => s.est === 'asistio').length === E.asist.as && S2.recep.length === Object.keys(E.recep).length
      && S2.coh.filter(x => x.res === 'lpOk').length === 1 && S2.diag.cobN === S2.diag.cobOk && S2.diag.cobN > 0 && !(S2.fallos || []).length;
    r.ok = Object.entries(r).every(([k, v]) => k === 'dbg' || v);
    if (r.ok) delete r.dbg;
    return r;
  }, pcFixture());
  console.log('\n[primer contacto] modelo y pantalla', JSON.stringify(pcx));
  if (!pcx.ok) hallazgos.push({ vista: 'pc:modelo', pcx });
  await escanear('ventas/primer (con datos)');
  // Ventas → Reporte, Pipeline/OPP (Dirección General, 15-oct-2026): los saldos (OPP activas, con
  // next step, >14 días) son el corte de la última semana de cada asesor, no la suma; una parte
  // mayor que su total se bloquea al capturar y el reporte señala las semanas ya capturadas así.
  VISTA = 'reporte:saldosOpp';
  const saldos = await page.evaluate(async () => {
    navIr('ventas', 'reporte');
    const sel = document.getElementById('canal-select'); sel.value = 'paid_organico'; sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 400));
    const W = ['2026-W40', '2026-W41', '2026-W42'], A = 'Asesor Prueba A', B = 'Asesor Prueba B';
    const mk = (w, a, v) => { const k = `paid_organico:rec:${w}__${a}`; recSet(k, { semana: w, dimVals: [a], valores: v, notas: '' }); return k; };
    const claves = [
      mk(W[0], A, { opp_total: 1, opp_zooms: 1, opp_activas: 5, opp_next_step: 3, opp_14dias: 2 }),
      mk(W[1], A, { opp_total: 1, opp_zooms: 2, opp_activas: 6, opp_next_step: 4 }),          // zooms > total: mal capturada
      mk(W[2], A, { opp_total: 2, opp_zooms: 2, opp_activas: 7, opp_next_step: 5, opp_14dias: 1 }),
      mk(W[0], B, { opp_total: 0, opp_activas: 3 }),
      mk(W[1], B, { opp_total: 1, opp_zooms: 1, opp_activas: 4, opp_14dias: 3 }),              // B no capturó la W42
    ];
    const si = document.getElementById('rep-semana-ini'), sf = document.getElementById('rep-semana-fin');
    si.innerHTML = sf.innerHTML = W.map(w => `<option value="${w}">${w}</option>`).join(''); si.value = W[0]; sf.value = W[2];
    await generarReporte();
    const filas = {}; document.querySelectorAll('#rep-output table.rep tbody tr').forEach(tr => { const td = tr.querySelectorAll('td'); if (td.length > 1) filas[td[0].innerText.replace(/\s+/g, ' ').trim()] = td[1].innerText.replace(/\s+/g, ' ').trim(); });
    const t = document.getElementById('rep-output').innerText;
    const r = { activas: filas['OPP activas (saldo)'], nextStep: filas['OPP con next step + fecha (saldo)'], total: filas['OPP (total)'], zooms: filas['OPP de zooms'],
      aviso: /Captura incoherente en el rango/.test(t) && /2026-W41 · Asesor Prueba A: OPP de zooms \(2\) mayor que OPP \(total\) \(1\)/.test(t) };
    // Dirección: OPP >14 días = 1 (A, W42) + 3 (B, W41), no 6
    r.dir14 = channelMetrics('paid_organico', new Set(W)).opp_14;
    // Captura: parte > total bloquea; zooms + tours > total solo avisa
    const c1 = ingRevisarCoherencia({ valores: { opp_total: 1, opp_zooms: 2, opp_tours: 0 } });
    const c2 = ingRevisarCoherencia({ valores: { opp_activas: 3, opp_next_step: 4, opp_14dias: 1 } });
    const c3 = ingRevisarCoherencia({ valores: { opp_total: 2, opp_zooms: 2, opp_tours: 1 } });
    r.bloqueo = c1.bloqueo.some(x => /OPP de zooms/.test(x)) && c2.bloqueo.some(x => /next step/.test(x)) && !c2.bloqueo.some(x => />14/.test(x))
      && !c3.bloqueo.length && /cuéntala solo en una/.test(c3.mensaje);
    claves.forEach(k => recDel(k));
    r.ok = r.activas === '11 corte 2026-W41–2026-W42' && r.nextStep === '5 corte 2026-W42' && r.total === '5' && r.zooms === '6' && r.aviso && r.dir14 === 4 && r.bloqueo;
    return r;
  });
  console.log('\n[reporte] saldos de OPP y capturas incoherentes', JSON.stringify(saldos));
  if (!saldos.ok) hallazgos.push({ vista: 'reporte:saldosOpp', saldos });
  console.log('\n=== RESUMEN ===');
  console.log('errores de página:', errores.length); errores.slice(0, 15).forEach(e => console.log('  ✗', e.vista, '·', e.msg));
  console.log('errores de consola:', consola.length); [...new Set(consola.map(c => c.vista + ' · ' + c.msg))].slice(0, 15).forEach(c => console.log('  ·', c));
  console.log('recursos externos fallidos:', red.length); [...new Set(red)].slice(0, 6).forEach(u => console.log('  ·', u));
  console.log('vistas con texto sospechoso o tablas desalineadas:', hallazgos.length);
  await browser.close(); srv.kill();
  process.exit(errores.length || hallazgos.length ? 1 : 0);
})().catch(e => { console.error('FALLO DEL SMOKE:', e); process.exit(2); });
