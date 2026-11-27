// Cachés comprimidos (nov-2026): el agregado de Calidad de Leads pasó de 512KB y dejó de
// guardarse desde v36. Esta prueba carga index.html con un kv simulado que aplica el MISMO
// límite que netlify/functions/kv.js (512KB por valor) y verifica:
//   1. un agregado de ~1MB se guarda comprimido (< 500KB) y se lee idéntico;
//   2. un valor viejo sin comprimir se sigue leyendo igual;
//   3. un comprimido corrupto se trata como caché ausente (sin franja roja de lectura);
//   4. si ni comprimido cabe, no truena: avisa y no guarda;
//   5. sin CompressionStream se guarda sin comprimir si cabe (navegadores viejos);
//   6. Desempeño (sla:agg) también se guarda comprimido.
// Uso: NODE_PATH=$(npm root -g) CHROME_PATH=/usr/bin/google-chrome node scripts/test-cache-comprimido.js
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path');
const PORT = String(process.env.PORT || 8782);
const MAX_VAL = 512 * 1024;   // igual que netlify/functions/kv.js
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', PORT, '--bind', '127.0.0.1', '--directory', path.resolve(__dirname, '..')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('slvd-token-v1', 't'); } catch (e) {} });
  const page = await ctx.newPage(); const errores = [];
  page.on('pageerror', e => errores.push(String(e.message || e)));
  await page.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript',
    body: 'window.Chart=class{constructor(){this.data={datasets:[]}}destroy(){}update(){}resize(){}};Chart.register=()=>{};Chart.defaults={font:{},plugins:{}};' }));
  await page.route(/fonts\.|filesafe|\.(png|jpg|svg|woff2?)(\?|$)/, r => r.fulfill({ status: 204, body: '' }));
  const KV = {};   // kv simulado: guarda el string tal cual, como la tabla
  await page.route('**/.netlify/functions/**', async r => {
    const fn = r.request().url().split('/functions/')[1].split('?')[0]; let body = {};
    try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    const ok = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (fn === 'auth') return ok(body.action === 'status' ? { hasUsers: true } : { token: 't', email: 'prueba@selvadentrotulum.com', role: 'admin', channels: [] });
    if (fn === 'kv') {
      if (body.op === 'set') {
        if (typeof body.v !== 'string' || body.v.length > MAX_VAL) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"v inválida (máx 512KB)"}' });
        KV[body.k] = body.v; return ok({ ok: true });
      }
      if (body.op === 'get') return ok({ v: KV[body.k] ?? null });
      if (body.op === 'dump') return ok({ rows: [] });
      return ok({ ok: true });
    }
    return r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"sin backend en la prueba"}' });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForTimeout(4000);

  let fallos = 0;
  const ok = (cond, msg, extra) => { if (!cond) fallos++; console.log(`  ${cond ? '✓' : '✗'} ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
  // Agregado sintético con la forma del real (leads con campos repetidos, semanas, campañas)
  const aggGrande = await page.evaluate(() => {
    const camp = ['INVESTORS_MX_DYNAMIC-TOPLPS_090926', 'INVESTORS_US/CA_ESCAPE_100626', 'INVESTORS - GOOGLE SEARCH -- MX', 'INVESTORS_EN_FORMULARIOMETA_TULUM_100626'];
    const leads = []; for (let i = 0; i < 4200; i++) leads.push({ id: 'ct' + (100000 + i * 7919 % 99991), n: 'Lead ' + i, c: new Date(Date.UTC(2026, 7, 1) + i * 3.6e6).toISOString(),
      wk: '2026-W' + (32 + (i % 18)), src: i % 3 ? 'facebook' : 'google', camp: camp[i % 4], u: 'u' + (i % 6), tags: 'squeeze, form-meta' + (i % 5 ? '' : ', opp-generada'),
      pres: ['$50,000 USD', '2-3 MDP', ''][i % 3], hor: ['6 meses', '12 meses', ''][i % 3], lv: ['CQL', 'MQL', 'SQL'][i % 3], st: 'Contacto establecido', o: i % 9 === 0 ? 1 : 0, attr: { src: 'fb', camp: camp[i % 4], fbc: i % 2 ? 'fb.1.' + (1700000000000 + i) : '' } });
    return { v: 38, ts: Date.now(), leads, adw: [], dec: { ventana: { hoy: '2026-11-27' } } };
  });
  const r1 = await page.evaluate(async (agg) => {
    const crudo = JSON.stringify(agg).length;
    await lqPersist(agg); const guardado = await (await fetch('/.netlify/functions/kv', { method: 'POST', body: JSON.stringify({ op: 'get', k: LQ_AGG_KEY }) })).json();
    const leido = await sGet(LQ_AGG_KEY);
    return { crudoKB: Math.round(crudo / 1024), guardadoKB: guardado.v ? Math.round(guardado.v.length / 1024) : null, gz: !!(guardado.v && JSON.parse(guardado.v).__gz === 1),
      identico: JSON.stringify(leido) === JSON.stringify(agg), lecturaFallida: sReadFailed() };
  }, aggGrande);
  ok(r1.crudoKB > 512 && r1.gz && r1.guardadoKB <= 500 && r1.identico && !r1.lecturaFallida, 'agregado de Calidad de Leads > 512KB: se guarda comprimido y se lee idéntico', r1);

  const r2 = await page.evaluate(async () => {
    await STORE.set('prueba:viejo', JSON.stringify({ a: 1, lista: [1, 2, 3] }));
    const v = await sGet('prueba:viejo'); const v2 = await sGetRetry('prueba:viejo');
    return { v, v2, lecturaFallida: sReadFailed() };
  });
  ok(r2.v && r2.v.a === 1 && r2.v2 && r2.v2.lista.length === 3 && !r2.lecturaFallida, 'valor viejo sin comprimir: se lee igual (sGet y sGetRetry)', r2);

  const r3 = await page.evaluate(async () => {
    await STORE.set('prueba:corrupto', JSON.stringify({ __gz: 1, d: 'esto-no-es-gzip' }));
    return { v: await sGet('prueba:corrupto'), lecturaFallida: sReadFailed() };
  });
  ok(r3.v === null && !r3.lecturaFallida, 'comprimido corrupto: caché ausente, sin franja de lectura fallida', r3);

  const r4 = await page.evaluate(async () => {
    // Datos aleatorios (no se comprimen) de ~900KB: no caben ni comprimidos
    const rnd = () => { const b = new Uint8Array(48); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)); };
    const agg = { v: 38, leads: Array.from({ length: 9000 }, () => ({ id: rnd(), n: rnd(), tags: '', pres: '', hor: '' })), dec: null };
    const antes = (await (await fetch('/.netlify/functions/kv', { method: 'POST', body: JSON.stringify({ op: 'get', k: 'lq:no-cabe' }) })).json()).v;
    let error = null; const avisos = []; const t0 = window.toast; window.toast = (m) => avisos.push(m);
    const k0 = LQ_AGG_KEY; let tras;
    try { const cabe = await sSetCabe('lq:no-cabe', agg, 500 * 1024); tras = cabe; await lqPersist(agg); } catch (e) { error = e.message; }
    window.toast = t0;
    return { cabe: tras, error, avisos, antes };
  });
  ok(r4.cabe === false && !r4.error && r4.avisos.some(a => /demasiado grande/.test(a)), 'ni comprimido cabe: no truena, avisa y no guarda', r4);

  const r5 = await page.evaluate(async () => {
    const CS = window.CompressionStream; window.CompressionStream = undefined;
    const ok1 = await sSetCabe('prueba:sin-gz', { x: 'hola', n: [1, 2] }, 500 * 1024);
    window.CompressionStream = CS;
    const crudo = (await (await fetch('/.netlify/functions/kv', { method: 'POST', body: JSON.stringify({ op: 'get', k: 'prueba:sin-gz' }) })).json()).v;
    return { ok1, crudo, leido: await sGet('prueba:sin-gz') };
  });
  ok(r5.ok1 && r5.crudo === JSON.stringify({ x: 'hola', n: [1, 2] }) && r5.leido.x === 'hola', 'navegador sin CompressionStream: se guarda sin comprimir', r5);

  const r6 = await page.evaluate(async (agg) => {
    const ok1 = await sSetCabe(SLA_AGG_KEY, agg, 500 * 1024);
    const crudo = (await (await fetch('/.netlify/functions/kv', { method: 'POST', body: JSON.stringify({ op: 'get', k: SLA_AGG_KEY }) })).json()).v;
    return { ok1, gz: JSON.parse(crudo).__gz === 1, identico: JSON.stringify(await sGet(SLA_AGG_KEY)) === JSON.stringify(agg) };
  }, { leads: aggGrande.leads.slice(0, 1500), v: 25 });
  ok(r6.ok1 && r6.gz && r6.identico, 'Desempeño (sla:agg): se guarda comprimido y se lee idéntico', r6);

  ok(!errores.length, 'sin errores de página', errores);
  await browser.close(); srv.kill();
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas de caché comprimido pasaron');
  process.exit(fallos ? 1 : 0);
})();
