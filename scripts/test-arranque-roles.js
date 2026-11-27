// Arranque por rol: ningún usuario debe ver la franja roja "No se pudieron cargar los datos
// guardados" cuando el backend responde bien. Regresión del 27-nov-2026: un usuario sin
// ningún canal de ventas (solo Marketing, solo Desempeño…) tronaba en dimsList al arrancar.
// Uso: NODE_PATH=$(npm root -g) CHROME_PATH=/usr/bin/google-chrome node scripts/test-arranque-roles.js
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path');
const PORT = String(process.env.PORT || 8781);
const ALL = ["brokers","paid_organico","seminarios","referidos","pd_leads","pd_brokers","rp_vip","direccion_general","direccion_comercial","crm_live","sla_view","marketing","mkt_rrss","mkt_lq"];
const CASOS = [
  { rol: 'admin', canales: ALL, nombre: 'admin' },
  { rol: 'user', canales: ['mkt_lq', 'marketing'], nombre: 'solo Marketing / Calidad de Leads' },
  { rol: 'user', canales: ['mkt_rrss'], nombre: 'solo Redes' },
  { rol: 'user', canales: ['sla_view'], nombre: 'solo Desempeño' },
  { rol: 'user', canales: ['direccion_general'], nombre: 'solo Dirección General' },
  { rol: 'user', canales: ['paid_organico'], nombre: 'un canal de ventas' },
];
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', PORT, '--bind', '127.0.0.1', '--directory', path.resolve(__dirname, '..')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  let fallos = 0;
  for (const c of CASOS) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { try { localStorage.setItem('slvd-token-v1', 't'); } catch (e) {} });
    const page = await ctx.newPage(); const errores = [];
    page.on('pageerror', e => errores.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error' && /Fallo al cargar/.test(m.text())) errores.push(m.text().slice(0, 200)); });
    await page.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'window.Chart=class{constructor(){this.data={datasets:[]}}destroy(){}update(){}resize(){}};Chart.register=()=>{};Chart.defaults={font:{},plugins:{}};' }));
    await page.route(/fonts\.|filesafe|\.(png|jpg|svg|woff2?)(\?|$)/, r => r.fulfill({ status: 204, body: '' }));
    await page.route('**/.netlify/functions/**', async r => {
      const fn = r.request().url().split('/functions/')[1].split('?')[0]; let body = {};
      try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
      const ok = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (fn === 'auth') return ok(body.action === 'status' ? { hasUsers: true } : { token: 't', email: 'prueba@selvadentrotulum.com', role: c.rol, channels: c.canales });
      if (fn === 'kv') return ok(body.op === 'get' ? { v: null } : body.op === 'dump' ? { rows: [] } : body.op === 'list' ? { keys: [] } : { ok: true });
      return r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"sin backend en la prueba"}' });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForTimeout(5000);
    const franja = await page.evaluate(() => !!document.getElementById('aviso-lectura'));
    const ok = !franja && !errores.length;
    if (!ok) fallos++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.nombre}: franja=${franja}${errores.length ? ' · ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }
  await browser.close(); srv.kill();
  console.log(fallos ? `\n${fallos} caso(s) con la franja o errores al arrancar` : '\nNingún rol ve la franja al arrancar');
  process.exit(fallos ? 1 : 0);
})();
