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
  await escanear('boot');
  const grupos = [['direccion', 'general'], ['direccion', 'comercial'], ['ventas', 'ingreso'], ['ventas', 'reporte'], ['ventas', 'analitica'], ['ventas', 'desempeno'], ['ventas', 'crm'], ['marketing', 'calidad'], ['marketing', 'ingreso']];
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
      oppPerdida: q({ o: 1, ost: 'lost', pstage: 'Seguimiento de OPP' }).lv,           // desc: perdida sigue mandando
      fuerteSinForm: q({ pstage: 'Interés identificado' }).lv,                         // sql
      fuerteConPerfil: q({ pstage: 'Tour realizado', pres: '$150,000 USD', hor: '3 meses' }).lv, // sqls
      soloFormulario: q({ tags: 'replied', pres: '$150,000 USD', hor: '3 meses' }).lv, // sql (antes sqls)
      soloRespondio: q({ tags: 'replied' }).lv,                                        // mql
      why: q({ o: 1, pstage: 'Carta oferta', pres: '$50,000 USD' }).why.join(' · '),
    };
    r.ok = r.oppSinForm === 'sqls' && r.wonFormBajo === 'sqls' && r.oppPerdida === 'desc' && r.fuerteSinForm === 'sql' && r.fuerteConPerfil === 'sqls' && r.soloFormulario === 'sql' && r.soloRespondio === 'mql' && /etapa del pipeline manda/.test(r.why);
    return r;
  });
  console.log('\n[lqAutoQualify] etapa > formulario', JSON.stringify(lq));
  if (!lq.ok) hallazgos.push({ vista: 'lqAutoQualify:etapa', lq });
  // Desempeño: el Índice de calidad sale de las reglas, no del campo manual vacío (2026-09-23).
  VISTA = 'sla:indiceCalidad';
  const sla = await page.evaluate(() => {
    const c = (id, n, u, cf) => ({ id, n, c: '2026-09-15T15:00:00.000Z', src: 'facebook', u, tags: ['replied'], attr: {}, cf: cf || {} });
    const contactos = [c('c1', 'Ana Gómez', 'u1'), c('c2', 'Luis Pérez', 'u1'), c('c3', 'Marta Ruiz', 'u1', { fcal: 'MQL' })];
    const sweeps = { c1: { fi: Date.parse('2026-09-15T16:00:00Z') }, c2: {}, c3: {} };
    const opps = [{ ct: 'c1', u: 'u1', st: 'open', c: '2026-09-16T10:00:00.000Z', stc: '', v: 0, p: 'p1', s: 's2', sc: '2026-09-17T10:00:00.000Z' }];
    const pipes = [{ id: 'p1', name: 'Pipeline de ventas', stages: [{ id: 's1', name: 'Contacto establecido' }, { id: 's2', name: 'Seguimiento de OPP' }] }];
    const campos = [{ id: 'fcal', name: 'Calificación del lead' }];
    const agg = buildSlaAgg([lqWeekOf('2026-09-15T15:00:00.000Z')], contactos, sweeps, opps, { u1: 'Asesor Uno' }, campos, pipes);
    const by = {}; agg.leads.forEach(l => by[l.id] = { lv: l.lv, lvCrm: l.lvCrm, o: l.o });
    const score = slaScoreAsesor(agg.leads);
    return { by, califCrm: agg.califCrm, q5: score.q5, qTot: score.qTot };
  });
  console.log('\n[sla] índice de calidad por reglas', JSON.stringify(sla));
  // c1: OPP real → sqls aunque el CRM no traiga calificación; c2: solo respondió → mql; c3: campo manual MQL, reglas mql.
  if (!(sla.by.c1 && sla.by.c1.lv === 'sqls' && sla.by.c1.lvCrm === 'nc' && sla.by.c1.o === 1 && sla.by.c2.lv === 'mql' && sla.by.c3.lvCrm === 'mql' && sla.califCrm === 1 && sla.qTot === 3 && sla.q5 != null && sla.q5 > 1)) hallazgos.push({ vista: 'sla:indiceCalidad', sla });
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
    r.c4 = !L.brk && !L.brk2 && V.brokers.map(x => x.id).sort().join() === 'brk,brk2';
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
  // Calidad de Leads rediseñada (Dirección, 8-oct-2026): costo por SQL y semáforo, atribución
  // inferida de la landing de seguridad, cruce por ID de campaña, alias de Google, aviso de
  // "sin campaña" = filas de la tabla, embudo Zoom/OPP/WON, % contactados, alerta de CPL,
  // todo en MXN, matriz de reglas detrás de un botón y Datos de campañas plegado.
  VISTA = 'lq:rediseño';
  await page.evaluate(() => navIr('marketing', 'calidad'));
  await page.waitForTimeout(1500);
  const lqx = await page.evaluate((fx0) => {
    const copia = () => JSON.parse(JSON.stringify(fx0));          // buildLqAgg modifica los leads
    const fx = copia();
    const agg = buildLqAgg(fx.boot, fx.rawLeads, fx.spendRows, fx.weeks, fx.opps, fx.adRows);
    agg.fallos = []; agg.monedas = ['MXN'];
    Object.assign(lqState, { agg, exp: {}, q: '', plat: 'all', level: 'camp', qual: 'auto', diagReglas: false, ia: null });
    lqPopulateWeeks();
    document.getElementById('lq-sem-ini').value = '2026-W37'; document.getElementById('lq-sem-fin').value = '2026-W40';
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
    r.alertas = Object.keys(lqAlertasCpl(agg, ['2026-W37', '2026-W38', '2026-W39', '2026-W40'])).join('|');
    // ROJO con menos de 50% contactados → revisar seguimiento antes de pausar (no con muestra chica)
    const S2 = (inv, n, c) => { const x = lqSemaforo(inv, n, c); return x.c + ':' + x.k; };
    r.semSeg = [S2(12000, 0, { n: 10, tr: 4 }), S2(12000, 0, { n: 10, tr: 5 }), S2(30000, 3, { n: 10, tr: 1 }), S2(7000, 1, { n: 10, tr: 1 }), S2(12000, 0, { n: 0, tr: 0 })].join(' ');
    const txt = () => document.getElementById('lq-content').textContent;
    const filas = (sel) => [...document.querySelectorAll(sel + ' tr')].filter(tr => tr.querySelector('td.name'));
    const hdr = (sel) => [...document.querySelector(sel + ' tr').querySelectorAll('th')].map(th => th.textContent.trim());
    // Reporte Combinado
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
      sem[nombre] = sc ? sc.textContent + '|' + tr.querySelector('.lq-sem-acc').textContent : '—';
      celda[nombre] = Object.fromEntries(H.map((h, i) => [h, td[i] ? td[i].textContent.trim() : '']));
    });
    r.semaforos = sem;
    const d090 = celda['INVESTORS_MX_DYNAMIC-TOPLPS_090926'] || {};
    r.embudo090 = [d090['SQL+'], d090['Zoom realizado'], d090['OPP'], d090['WON'], d090['% contactados'], d090['Costo por SQL']].join(' ');
    r.alertaFila = Object.entries(celda).filter(([k, v]) => /⚠/.test(v['CPL'] || '')).map(([k]) => k).join('|');
    const tot = [...document.querySelectorAll('table.lq-combo tr.total')][0];
    r.totalPagado = tot ? tot.textContent.replace(/\s+/g, ' ') : '';
    r.inferidaBadge = /8 con atribución inferida/.test(t);
    // Leads de brokers fuera de todo (Dirección, 9-oct-2026): ni en tablas ni en tarjetas
    const card = (k) => { const c = [...document.querySelectorAll('#lq-content .crm-kpi')].find(e => e.querySelector('.k-lbl').textContent.trim() === k); return c ? c.querySelector('.k-val').textContent.trim() : ''; };
    r.tarjetasBk = [card('Leads CRM'), card('SQL+'), card('WON')].join(' ');
    r.notaBkCombo = /Excluidos de todos los cálculos en este rango: 3 leads de brokers/.test(t);
    r.sinJenniferCombo = !/Jennifer/.test(t);
    // Muestra chica: la lectura nunca pone en "subir" una campaña con menos de 8,000 MXN
    const lect = [...document.querySelectorAll('#lq-content .lq-lectura p')].map(p => p.textContent);
    const lSubir = lect.find(x => /Subir presupuesto 20%:/.test(x)) || '', lChica = lect.find(x => /Mantener \(muestra chica\)/.test(x)) || '';
    r.lecturaChica = /MX_DYNAMIC-TOPLPS_150726/.test(lSubir) && !/FORMULARIOMETA/.test(lSubir) && /FORMULARIOMETA/.test(lChica) && /GOOGLE SEARCH -- MX/.test(lChica) && !/US\+CAN/.test(lChica);
    const lPausa = lect.find(x => /Pausar:/.test(x)) || '', lRev = lect.find(x => /Revisar seguimiento antes de pausar:/.test(x)) || '';
    r.lecturaSeg = /ESCAPE_100626/.test(lPausa) && /GOOGLE SEARCH - US\+CAN/.test(lPausa) && !/ESCAPE_090926/.test(lPausa) && /ESCAPE_090926/.test(lRev) && /no se han trabajado/.test(lRev);
    const fUS = celda['INVESTORS - GOOGLE SEARCH - US+CAN'] || {};
    r.filaUS = [fUS['Leads CRM'], fUS['% trabajados'], fUS['% contactados'], fUS['SQL+'], (sem['INVESTORS - GOOGLE SEARCH - US+CAN'] || '')].join(' ');
    const nota = [...document.querySelectorAll('table.lq-combo tr')].find(tr => /ESCAPE_090926/.test(tr.textContent));
    r.notaSeg = nota ? (nota.querySelector('.lq-sem-nota') || {}).textContent || '' : '';
    const fMX = celda['INVESTORS - GOOGLE SEARCH -- MX'] || {};
    r.filaMX = [fMX['Leads CRM'], fMX['SQL+']].join(' ');
    r.sinFilasNumericas = !Object.keys(celda).some(k => /^\d{5,}$/.test(k)) && !/Windsor no reconoce/.test(t);
    r.sinPesos = !/\$/.test(t);
    // Calidad de Lead
    lqState.sub = 'calidad'; lqRender();
    t = txt();
    const av = t.match(/(\d+) de (\d+) leads del rango llegaron sin campaña/);
    const sinFilas = filas('table.lq-tree').filter(tr => /\(sin campaña atribuida\)/.test(tr.querySelector('td.name').textContent));
    const hT = hdr('table.lq-tree'), iN = hT.indexOf('Leads CRM');
    r.sinCampania = (av ? av[1] + ' de ' + av[2] : 'sin aviso') + ' · filas ' + sinFilas.reduce((a, tr) => a + Number(tr.querySelectorAll('td')[iN].textContent.replace(/\D/g, '') || 0), 0);
    r.semEnCalidad = hT.includes('SQL+') && hT.includes('Costo por SQL') && hT.includes('Semáforo') && hT.includes('Zoom realizado') && hT.includes('% contactados');
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
    // Datos de campañas
    lqState.sub = 'datos'; lqState.exp = { [lqExpKey('ads|Meta · INVESTORS_MX_DYNAMIC-TOPLPS_090926')]: true }; lqRender();
    r.datosFila = hdr('table.lq-datos').join('|');
    const pl = document.querySelector('#lq-content .lq-pliegue');
    r.datosPliegue = !!pl && ['Impresiones', 'Clics', 'CTR', 'CPC', 'Plataformas'].every(k => pl.textContent.includes(k));
    lqState.exp = {};
    // Conclusiones: una acción por campaña con su regla, aun sin IA
    lqState.sub = 'conclusiones'; lqRender();
    const acc = [...document.querySelectorAll('#lq-content table.cons tr')].filter(tr => tr.querySelector('td.name')).map(tr => tr.querySelectorAll('td')[2].textContent.trim());
    r.conclusiones = acc.join('|');
    // Regresión del 9-oct-2026: si el detalle por anuncio de Google no llega, los leads con
    // utm_campaign = ID siguen pegándose a su campaña con el ID de la inversión diaria.
    const fila = (nombre) => { const tr = [...document.querySelectorAll('table.lq-combo tr')].find(x => x.querySelector('td.name') && x.querySelector('td.name').textContent.replace(/^(META|GOOGLE)\s*/, '').trim() === nombre);
      if (!tr) return null; const td = [...tr.querySelectorAll('td')]; return [td[H.indexOf('Inversión')].textContent.trim(), td[H.indexOf('Leads CRM')].textContent.trim(), td[H.indexOf('SQL+')].textContent.trim()].join(' '); };
    const fx2 = copia(); fx2.adRows = fx2.adRows.filter(a => a.plat !== 'Google');
    const agg2 = buildLqAgg(fx2.boot, fx2.rawLeads, fx2.spendRows, fx2.weeks, fx2.opps, fx2.adRows); agg2.fallos = []; agg2.monedas = ['MXN'];
    lqState.agg = agg2; lqState.sub = 'combinado'; lqRender();
    r.sinDetalleGoogle = [fila('INVESTORS - GOOGLE SEARCH -- MX'), fila('INVESTORS - GOOGLE SEARCH - US+CAN'), fila('23710551755'), /Windsor no reconoce/.test(txt())].join(' | ');
    // Y si Windsor no trae el ID en ningún lado, el reporte lo dice en vez de dejar la fila suelta.
    const fx3 = copia(); fx3.adRows = fx3.adRows.filter(a => a.plat !== 'Google'); fx3.spendRows.forEach(x => { delete x.cid; });
    const agg3 = buildLqAgg(fx3.boot, fx3.rawLeads, fx3.spendRows, fx3.weeks, fx3.opps, fx3.adRows); agg3.fallos = []; agg3.monedas = ['MXN'];
    lqState.agg = agg3; lqRender();
    r.sinIds = /7 leads<\/b> traen como campaña un ID que Windsor no reconoce/.test(document.getElementById('lq-content').innerHTML) && /Google 23710551755 \(2\)/.test(txt()) && /Google 23715389989 \(5\)/.test(txt());
    lqState.agg = agg; lqState.sub = 'combinado'; lqRender();
    return r;
  }, fixture());
  const semEsp = {
    'INVESTORS_US/CA_ESCAPE_090926': 'ROJO|Revisar seguimiento antes de pausar',
    'INVESTORS_US/CA_ESCAPE_100626': 'ROJO|Pausar',
    'INVESTORS_MX_DYNAMIC-TOPLPS_150726': 'VERDE|Subir presupuesto 20%',
    'INVESTORS_MX_DYNAMIC-TOPLPS_090926': 'AMARILLO|Optimizar, no subir',
    'INVESTORS_EN_FORMULARIOMETA_TULUM_100626': 'VERDE|Mantener (muestra chica)',
    'INVESTORS - GOOGLE SEARCH - US+CAN': 'ROJO|Pausar',
    'INVESTORS - GOOGLE SEARCH -- MX': 'AMARILLO|Mantener (muestra chica)',
    '(sin campaña atribuida)': '—', 'Social orgánico · IG / WhatsApp': '—',
  };
  lqx.ok = lqx.inferidos === '8 INVESTORS_MX_DYNAMIC-TOPLPS_090926 / ES_LLAMADA_NUEVO6-SEGURIDAD_PATRIMONIO' && lqx.tardeNoInferido
    && lqx.porId === 9 && lqx.googleMX === 3 && lqx.numerico === 5 && lqx.filaUS === '5 100% 60% 0 ROJO|Pausar' && lqx.filaMX === '3 1' && lqx.sinFilasNumericas
    && lqx.sinDetalleGoogle === '3,600 MXN 3 1 | 13,600 MXN 5 0 |  | false' && lqx.sinIds
    && lqx.semSeg === 'rojo:revisar rojo:pausar rojo:revisar rojo:mantener rojo:pausar'
    && lqx.lecturaSeg && /La mayoría de sus leads no se han trabajado: solo 3 de 7 \(43%\) salieron de Nuevo lead/.test(lqx.notaSeg)
    && lqx.sem === 'null gris*:mantener rojo:pausar verde:subir verde:subir amarillo:optimizar amarillo:optimizar rojo:pausar amarillo*:mantener verde*:mantener verde*:mantener rojo*:mantener'
    && lqx.lecturaChica
    && lqx.alertas === 'INVESTORSENFORMULARIOMETATULUM100626' && lqx.alertaFila === 'INVESTORS_EN_FORMULARIOMETA_TULUM_100626'
    && lqx.tarjetas && lqx.columnas === 'Campaña|Inversión|Leads CRM|CPL|% trabajados|% contactados|CQL|MQL|SQL+|Zoom realizado|OPP|WON|Costo por SQL|Semáforo'
    && Object.entries(semEsp).every(([k, v]) => lqx.semaforos[k] === v)
    && lqx.embudo090 === '2 2 1 · 40% 4,600 MXN' && /Total pagado.*65,000 MXN.*8,125 MXN/.test(lqx.totalPagado)
    && lqx.inferidaBadge && lqx.sinPesos && lqx.sinCampania === '4 de 51 · filas 4'
    && lqx.tarjetasBk === '51 9 1' && lqx.notaBkCombo && lqx.sinJenniferCombo && lqx.notaBkCalidad && lqx.sinJenniferCalidad
    && /^Jennifer Guillaume\|Lead \d+\|Lead \d+ · vista 0 · canal 2$/.test(lqx.brokers) && lqx.sumarOppBk === '101' && lqx.semEnCalidad && lqx.sinMetricasViejas
    && lqx.matrizOculta && lqx.matrizConBoton && lqx.datosFila === 'Campaña|Inversión|Leads plataforma|Leads CRM|CPL' && lqx.datosPliegue
    && lqx.conclusiones === 'Pausar|Revisar seguimiento antes de pausar|Subir presupuesto 20%|Pausar|Optimizar, no subir|Mantener (muestra chica)|Mantener (muestra chica)';
  console.log('\n[calidad de leads] rediseño', JSON.stringify(lqx));
  for (const sub of ['combinado', 'calidad', 'datos', 'conclusiones']) {
    await page.evaluate((sub) => { lqState.sub = sub; lqRender(); }, sub);
    await escanear('lq:' + sub);
  }
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
      t1: sw(1, { foMch: 'whatsapp', calls: 3, cl: { n: 3, ok: 1, na: 1, linea: 1, otro: 0, dn: 0, t: [base(1) + 10 * M, base(1) + 2 * H, base(1) + 30 * H] }, deliv: { sent: 0, delivered: 1, read: 1, failed: 1, linea: 1 },
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
    const filaDe = (t) => t && [...t.querySelectorAll('tr')].find(tr => tr.querySelector('td') && tr.querySelector('td').innerText.trim() === 'Daniela Arana');
    const celdas = (tr) => tr ? [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null;
    const g = celdas(filaDe(tablaCon('CANAL DEL 1ER TOQUE'))), t = celdas(filaDe(tablaCon('INTENTOS 24 H')));
    const txt = vista.innerText;
    // Actividad efectiva: deliv {read 2, failed 1, linea 3} → 2 de 3 desde el 7-oct; 2 de 6 antes
    const leadsE = [{ sd: false, deliv: { read: 2, failed: 1, linea: 3 }, ap: { tot: 0, sh: 0 }, bucket: 'b5' }];
    const nuevo = slaScoreAsesor(leadsE, slaRubrica('2026-10-05', '2026-10-11'), { lineaFuera: true }).cnt.efec, viejo = slaScoreAsesor(leadsE, slaRubrica('2026-09-28', '2026-10-04'), { lineaFuera: false }).cnt.efec;
    ADVISOR_LIST = advPrev; slaState.agg = aggPrev; slaState.asesor = selPrev;
    const r = { g, t, efec: { nuevo, viejo }, sinGris: !/1er msj \(autom\.\)/i.test(txt) && !/Cualquier salida ≤60 s/i.test(txt),
      duracion: /conocida en 5 de 6 \(83%\)/.test(txt) && /1 conectaron sin duración legible/.test(txt) && /meta\.call\.recordingUrl/.test(txt),
      origen: /6 del asesor — 3 con falla de línea \(50%\), 2 conectadas, 1 sin duración · 4 automáticas \(workflow, campaña, envío masivo, API o sin usuario\) — 4 con falla de línea \(100%\)/.test(txt) && /2 entrantes del lead/.test(txt),
      kpi: /Med\. 1er intento de llamada/i.test(txt) && /1 no medible: llamada conectada sin duración/i.test(txt), ficha: /Llamadas: 6 intentos \(5 en las primeras 24 h\)/.test(txt) && /falla de línea 3/.test(txt) };
    // groupTbl: [nombre, leads, 1er toque, canal, conectada, efectivos, med toque, med 1er llamada, llamadas/lead, sin marcar, solo línea, ...]
    r.ok = !!g && g[3] === 'Llamada 50% · WhatsApp 25% SMS 0% · Correo 25%' && g[7] === '4 min' && g[8] === '1.3 / 1.5' && g[9] === '1 (25%)' && g[10] === '1'
      && !!t && t.slice(1).join('|') === '4|1|3|5|6|2 (33%)|1 (17%)|3 (50%)|·|1|1|1'
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
      && /2\s*\n?\s*CITAS AGENDADAS EN EL PERIODO/i.test(txt.replace(/\n+/g, '\n'));
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
  console.log('\n[reglas v1.1] aceptación', JSON.stringify(v11));
  if (!v11.ok) hallazgos.push({ vista: 'reglas:v1.1', v11 });
  // Metas → Rúbrica de desempeño: los dos juegos de Velocidad, con su fecha
  const rbm = await page.evaluate(async () => { navIrLateral('metas'); await new Promise(r => setTimeout(r, 400)); const h = document.getElementById('metas-rubrica'); const t = h ? h.innerText : '';
    return { existe: !!h, viejo: /10 · 20 · 30 · 45%/.test(t), nuevo: /20 · 40 · 60 · 80%/.test(t), fecha: /1-oct-2026/.test(t), form: !!document.getElementById('rb-save') }; });
  console.log('[rubrica v1.2] Metas', JSON.stringify(rbm));
  if (!Object.values(rbm).every(Boolean)) hallazgos.push({ vista: 'rubrica:metas', rbm });
  // Dirección General: encabezados nuevos y guiones de Brokers
  const dg = await page.evaluate(() => { navIr('direccion', 'general'); return new Promise(r => setTimeout(() => { const t = document.querySelector('#view-resultados table.cons'); const ths = [...t.querySelectorAll('thead th')].map(x => x.innerText.trim()); const filaB = [...t.querySelectorAll('tbody tr')].find(tr => /Brokers/.test(tr.innerText)); r({ ths, brokers: filaB ? [...filaB.querySelectorAll('td')].map(x => x.innerText.trim()).slice(0, 10) : null }); }, 500)); });
  console.log('\n[DG] encabezados:', dg.ths.join(' | ')); console.log('[DG] fila Brokers (10 primeras):', dg.brokers && dg.brokers.join(' | '));
  console.log('\n=== RESUMEN ===');
  console.log('errores de página:', errores.length); errores.slice(0, 15).forEach(e => console.log('  ✗', e.vista, '·', e.msg));
  console.log('errores de consola:', consola.length); [...new Set(consola.map(c => c.vista + ' · ' + c.msg))].slice(0, 15).forEach(c => console.log('  ·', c));
  console.log('recursos externos fallidos:', red.length); [...new Set(red)].slice(0, 6).forEach(u => console.log('  ·', u));
  console.log('vistas con texto sospechoso o tablas desalineadas:', hallazgos.length);
  await browser.close(); srv.kill();
  process.exit(errores.length || hallazgos.length ? 1 : 0);
})().catch(e => { console.error('FALLO DEL SMOKE:', e); process.exit(2); });
