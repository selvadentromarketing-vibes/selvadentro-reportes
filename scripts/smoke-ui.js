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
