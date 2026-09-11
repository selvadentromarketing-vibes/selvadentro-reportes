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
    if (fn === 'kv') { const op = body.op; return ok(op === 'get' ? { v: null } : op === 'list' ? { keys: [] } : op === 'dump' ? { rows: [] } : { ok: true }); }
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
