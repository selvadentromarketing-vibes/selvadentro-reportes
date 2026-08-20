# Selvadentro — Sistema de Reportes

App de reportes semanales de ventas y marketing para Selvadentro Tulum.
Producción: https://team.selvadentrotulum.com (Netlify site: `slvd-reportes`).

## Arquitectura

- **Frontend**: dos páginas estáticas ([index.html](index.html) ventas/dirección, [marketing.html](marketing.html) embebida como iframe). Sin build.
- **Datos**: tabla `slvd_kv` (key/value JSON) en Supabase **con RLS activado y sin policies**:
  el anon key público no puede leer ni escribir nada. Todo el acceso pasa por la function
  `kv` con sesión firmada; la function llama al RPC `slvd_kv_op`, protegido por un secreto
  que solo vive en el entorno del servidor (`KV_API_SECRET`).
- **Auth**: server-side en la function `auth` (login / me / setup). El cliente nunca
  descarga la lista de usuarios ni los hashes; recibe un token HMAC firmado (30 días,
  `SESSION_SECRET`) que todas las functions exigen. El registro de usuarios
  (`selvadentro:users`) solo es accesible con rol admin.
- **Netlify Functions** ([netlify/functions/](netlify/functions/)):
  - `auth` — login/sesión server-side (emite y valida tokens).
  - `kv` — proxy autenticado al almacenamiento (get/set/del/list/dump).
  - `ghl-report` — proxy a GoHighLevel para **CRM en vivo** (requiere canal `crm_live` o admin).
  - `kpi-analyze` / `notes-analyze` — conclusiones ejecutivas con Claude (requieren sesión).
  - `send-invite` — alta de usuarios + email vía Resend (re-verifica la contraseña del admin).
  - `lib/shared.js` — acceso al kv, firma/verificación de tokens, helpers compartidos.

## Variables de entorno (Netlify → Site settings → Environment variables)

| Variable | Usada por | Descripción |
|---|---|---|
| `SUPABASE_URL` | kv, auth, send-invite | URL del proyecto Supabase del backend (`https://vsnggxcuznleuvoyoenn.supabase.co` — cuenta de Selvadentro) |
| `SUPABASE_ANON_KEY` | kv, auth, send-invite | Anon key de ese proyecto (solo transporta la llamada al RPC) |
| `KV_API_SECRET` | kv, auth, send-invite | Secreto que exige el RPC `slvd_kv_op` — **nunca en el cliente** |
| `SESSION_SECRET` | todas | Llave HMAC de los tokens de sesión |
| `GHL_API_KEY` | ghl-report | Private Integration Token de GoHighLevel (`pit-…`) |
| `GHL_LOCATION_ID` | ghl-report | Location ID de la subcuenta GHL |
| `ANTHROPIC_API_KEY` | kpi-analyze, notes-analyze | API key de console.anthropic.com |
| `RESEND_API_KEY` | send-invite | API key de Resend (emails) |
| `FROM_EMAIL` | send-invite | Remitente verificado en Resend |
| `SITE_URL` | send-invite | Opcional; default `https://team.selvadentrotulum.com` |

Para desarrollo local, crea un `.env` en la raíz (está en `.gitignore`) con las mismas
variables; `netlify dev` las inyecta automáticamente. Los valores actuales de
`SUPABASE_*`, `KV_API_SECRET` y `SESSION_SECRET` están en el `.env` local de esta máquina.

## Desarrollo local

```bash
netlify dev --port 8888
```

Sirve la app + functions en http://localhost:8888.

## CRM en vivo (GoHighLevel)

Pestaña **CRM en vivo** en la barra principal:

- **Sincronización**: el frontend llama a `ghl-report` en bloques (~600 oportunidades por
  llamada con cursor) hasta recorrer todo el CRM y agrega los datos en el navegador (por
  pipeline, etapa, semana ISO, fuente y asesor). El token de GHL nunca llega al cliente.
- **Cache compartido**: el resumen agregado se guarda en el kv (`crm:agg:v1`); las visitas
  siguientes cargan al instante y se re-sincroniza solo si tiene más de 30 minutos (o al
  pulsar *Sincronizar CRM*).
- **Rango de semanas**: KPIs, fuentes y asesores se filtran por rango de semanas ISO sin
  volver a consultar el CRM. Las barras por etapa muestran las oportunidades abiertas hoy.
- **Permisos**: canal `crm_live` en el panel de administración (grupo Ventas).

## Historial de la migración de seguridad (ago 2026)

La tabla original `kv` de este mismo proyecto quedaba **pública** con el anon key
(existía una policy `kv_anon_all` que permitía todo a `anon`): cualquiera podía leer
y escribir reportes y usuarios. Se construyó el backend seguro (`slvd_kv` + RPC con
secreto), se migraron los datos, y se eliminó la policy abierta de la tabla legacy —
que conserva los datos históricos pero ya no es accesible desde fuera.

El backend vive en el proyecto Supabase de Selvadentro (`vsnggxcuznleuvoyoenn`),
el mismo que usaba la app original. `scripts/migrate-kv.mjs` quedó obsoleto tras el
cutover (la tabla legacy ya no es legible por REST); se conserva como referencia.

## Notas de seguridad restantes

- El esquema de contraseñas sigue siendo SHA-256(salt:pass) para no invalidar las
  contraseñas existentes; la verificación ahora es server-side. Mejora futura: migrar a
  bcrypt/scrypt en el próximo cambio de contraseña.
- El panel admin conserva el campo `password` en texto plano de algunos usuarios
  (funcionalidad "revelar" del creador original). Ahora solo un admin autenticado puede
  verlo, pero la mejora futura es eliminarlo.
- Los tokens duran 30 días y se refrescan al abrir la app. Cambiar `SESSION_SECRET`
  invalida todas las sesiones activas.
