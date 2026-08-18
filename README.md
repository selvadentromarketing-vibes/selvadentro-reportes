# Selvadentro — Sistema de Reportes

App de reportes semanales de ventas y marketing para Selvadentro Tulum.
Producción: https://team.selvadentrotulum.com (Netlify site: `slvd-reportes`).

## Arquitectura

- **Frontend**: dos páginas estáticas ([index.html](index.html) ventas/dirección, [marketing.html](marketing.html) embebida como iframe). Sin build.
- **Datos**: tabla `kv` en Supabase (key/value JSON) compartida por todo el equipo, accedida con el anon key desde el cliente.
- **Netlify Functions** ([netlify/functions/](netlify/functions/)):
  - `kpi-analyze` / `notes-analyze` — conclusiones ejecutivas con Claude (Anthropic API).
  - `send-invite` — alta de usuarios + email de invitación vía Resend.
  - `ghl-report` — proxy seguro hacia GoHighLevel para el módulo **CRM en vivo**.

## Variables de entorno (Netlify → Site settings → Environment variables)

| Variable | Usada por | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | kpi-analyze, notes-analyze | API key de console.anthropic.com |
| `SUPABASE_URL` | send-invite | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | send-invite | Anon key público |
| `RESEND_API_KEY` | send-invite | API key de Resend (emails) |
| `GHL_API_KEY` | ghl-report | **Private Integration Token** de GoHighLevel (`pit-…`) |
| `GHL_LOCATION_ID` | ghl-report | Location ID de la subcuenta GHL |

Para desarrollo local, crea un `.env` en la raíz (está en `.gitignore`) con las mismas
variables; `netlify dev` las inyecta automáticamente.

## Desarrollo local

```bash
netlify dev --port 8888
```

Sirve la app + functions en http://localhost:8888.

## CRM en vivo (GoHighLevel)

Pestaña **CRM en vivo** en la barra principal:

- **Sincronización**: el frontend llama a `ghl-report` en bloques (`action: "crawl"`, ~600
  oportunidades por llamada con cursor) hasta recorrer todo el CRM, y agrega los datos en el
  navegador (por pipeline, etapa, semana ISO, fuente y asesor). El token de GHL nunca llega
  al cliente.
- **Cache compartido**: el resumen agregado se guarda en Supabase kv (`crm:agg:v1`); las
  visitas siguientes cargan al instante y se re-sincroniza solo si el resumen tiene más de
  30 minutos (o al pulsar *Sincronizar CRM*).
- **Rango de semanas**: los KPIs, fuentes y asesores se filtran por rango de semanas ISO sin
  volver a consultar el CRM. Las barras por etapa muestran las oportunidades abiertas hoy.
- **WON por semana**: se aproxima con `lastStatusChangeAt` (fecha en que la oportunidad se
  marcó como ganada).
- **Permisos**: canal `crm_live` en el panel de administración (grupo Ventas). Los admin lo
  ven siempre; a los usuarios se les asigna con la pastilla "CRM en vivo".

## Nota de seguridad (deuda conocida)

La autenticación es 100% del lado del cliente y la tabla `kv` (incluidos los registros de
usuarios con sus hashes) es legible y escribible públicamente con el anon key. Cualquiera
con el anon key puede leer/alterar los reportes. Mitigación recomendada a futuro: activar
RLS en Supabase + Supabase Auth, o mover la lectura/escritura de kv a una Netlify Function
con sesión firmada. El módulo CRM en vivo mantiene al menos el token de GHL fuera del
cliente.
