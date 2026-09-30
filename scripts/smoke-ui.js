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
    const casos = [[3, 20, 1], [4, 20, 2], [399, 1000, 2], [8, 20, 3], [12, 20, 4], [799, 1000, 4], [16, 20, 5], [20, 20, 5], [8, 9, 'insuficiente']]
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
    const hCruza = pinta(['2026-W40'], 399, 1000), hAntes = pinta(['2026-W39'], 16, 20), hDespues = pinta(['2026-W41'], 16, 20), hChica = pinta(['2026-W41'], 8, 9);
    ADVISOR_LIST = advPrev; slaState.asesor = selPrev;
    const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText || d.textContent; };
    r.ui = {
      leyendaNueva: /Velocidad de primer contacto: 20 · 40 · 60 · 80%/.test(txt(hDespues)),
      tooltipNuevo: /title="Velocidad de primer contacto \(≤5 min\) · umbrales 20 · 40 · 60 · 80%/.test(hDespues),
      notaCruza: /Rúbrica cambió el 1-oct-2026/.test(hCruza), sinNotaDespues: !/Rúbrica cambió/.test(hDespues), sinNotaAntes: !/Rúbrica cambió/.test(hAntes),
      unDecimal: /2 · 39\.9%/.test(txt(hCruza)),                                   // 399/1000 → nota 2, % a un decimal
      antesConserva: /Velocidad de primer contacto: 10 · 20 · 30 · 45%/.test(txt(hAntes)) && /conserva su nota/.test(txt(hAntes)) && /5 · 80\.0%/.test(txt(hAntes)),
      despues5: /5 · 80\.0%/.test(txt(hDespues)),
      chica: /sin muestra suficiente · 88\.9%/.test(txt(hChica)) && !/sla-pill s\d/.test(hChica),
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
