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
  - `lead-quality` — proxy a GoHighLevel (contactos + oportunidades) y Windsor.ai
    (inversión y detalle por anuncio) para **Calidad de Leads** y **Paid Media en
    vivo** (requiere canal `mkt_lq`, `marketing` o admin).
  - `lq-analyze` — conclusiones y acciones recomendadas de Calidad de Leads con
    Claude (`claude-opus-5`, esfuerzo bajo para caber en el timeout de Netlify).
  - `sla-report` — proxy a GoHighLevel (contactos, conversaciones, citas,
    oportunidades, usuarios) para **SLA y Seguimiento** (requiere canal
    `crm_live`, `direccion_comercial` o admin).
  - `kpi-analyze` / `notes-analyze` — conclusiones ejecutivas con Claude (requieren sesión).
  - `invite` — alta de usuarios por **liga mágica**: `create` / `relink` (admin, con su token de sesión)
    y `peek` / `claim` (públicas, para que la persona invitada defina su contraseña). No usa
    ningún proveedor de correo: la liga se manda por WhatsApp.
  - `lib/shared.js` — acceso al kv, firma/verificación de tokens, helpers compartidos.

## Variables de entorno (Netlify → Site settings → Environment variables)

| Variable | Usada por | Descripción |
|---|---|---|
| `SUPABASE_URL` | kv, auth, invite | URL del proyecto Supabase del backend (`https://vsnggxcuznleuvoyoenn.supabase.co` — cuenta de Selvadentro) |
| `SUPABASE_ANON_KEY` | kv, auth, invite | Anon key de ese proyecto (solo transporta la llamada al RPC) |
| `KV_API_SECRET` | kv, auth, invite | Secreto que exige el RPC `slvd_kv_op` — **nunca en el cliente** |
| `SESSION_SECRET` | todas | Llave HMAC de los tokens de sesión |
| `GHL_API_KEY` | ghl-report, lead-quality | Private Integration Token de GoHighLevel (`pit-…`). Para Calidad de Leads necesita además el scope **contacts.readonly** |
| `GHL_LOCATION_ID` | ghl-report, lead-quality | Location ID de la subcuenta GHL |
| `WINDSOR_API_KEY` | lead-quality | Opcional; API key de Windsor.ai para inversión Meta/Google (sin ella la sección de inversión se apaga con aviso) |
| `ANTHROPIC_API_KEY` | kpi-analyze, notes-analyze, lq-analyze | API key de console.anthropic.com (sin ella, la pestaña Conclusiones avisa y el resto funciona) |
| `SITE_URL` | invite | Opcional; default `https://team.selvadentrotulum.com`. Es el dominio con el que se arman las ligas de invitación |

Para desarrollo local, crea un `.env` en la raíz (está en `.gitignore`) con las mismas
variables; `netlify dev` las inyecta automáticamente. Los valores actuales de
`SUPABASE_*`, `KV_API_SECRET` y `SESSION_SECRET` están en el `.env` local de esta máquina.


## Alta de usuarios (liga mágica)

No hay proveedor de correo. El flujo es:

1. Un admin abre **Usuarios → + Nuevo usuario**, pone el email, el rol y los canales.
2. La app crea al usuario **sin contraseña** y devuelve una liga firmada
   (`https://team.selvadentrotulum.com/#invite=…`), que además se copia al portapapeles.
3. El admin la manda por WhatsApp. La persona la abre, define su propia contraseña y
   entra directo.

Propiedades de la liga:

- Firmada con HMAC usando `SESSION_SECRET`, con **dominio separado** (`inv:`) para que
  una invitación nunca pueda usarse como sesión ni al revés.
- **Caduca a los 7 días** y es de **un solo uso**: lleva un `nonce` que también vive en el
  usuario y se borra al consumirla, así una liga vieja reenviada por WhatsApp ya no sirve.
- Va en el **hash** de la URL (`#invite=`), no en el query string, para que el token no
  llegue al servidor ni quede en logs o en el `Referer`.
- **Ninguna contraseña viaja por chat** y el kv solo guarda `salt` + `hash`.

El botón **Nueva liga** de cada usuario sirve tanto para reinvitar como para restablecer
contraseña, e invalida cualquier liga anterior.

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

## Calidad de Leads (GoHighLevel + Windsor.ai)

Pestaña **Calidad de Leads** en la barra principal — versión en vivo del reporte
semanal de calificación (SQL Selvadentro / SQL / MQL / CQL / Descalificado):

- **Fuente de verdad**: contactos de GHL creados en las últimas 12 semanas ISO
  (hora Tulum, UTC-5). La calificación se lee del campo personalizado
  **"Calificación del lead"** (autodetectado por nombre); la etapa se deriva de los
  tags (`d1-no-answer`, `webinar-registered`, …) con la misma lógica del reporte PDF.
- **Fuente/campaña**: primero la atribución UTM del contacto; si falta, heurística
  por tags (`seguridad` → Meta MX · `premium`/`escape` → Meta US/CA ·
  `accesibilidad`/`google` → Google · `webinar-registered` → Webinar).
- **Inversión**: si `WINDSOR_API_KEY` está configurada, se consulta Windsor.ai
  (Meta + Google) y se muestra inversión y costo por lead / por lead de alto valor,
  por campaña (empate por nombre) y por plataforma (siempre calculable).
- **Cache compartido**: agregado en el kv (`lq:agg:v1`), staleness de 30 min, igual
  que CRM en vivo.
- **Permisos**: canal `mkt_lq` (o `marketing`, o admin). El módulo manual de
  Calidad de Leads dentro de Marketing **se retiró el 2026-08-26** junto con PPC Ads
  y CRM Manager: los sustituye este motor en vivo. Sus registros históricos siguen
  guardados en el kv bajo `mkt_lq_rec`, `mkt_ppc_rec` y `mkt_crm_rec`.
- **Requisito GHL**: el Private Integration Token necesita el scope
  `contacts.readonly` (Settings → Private Integrations → editar → scopes). Sin él,
  la sincronización falla con el detalle del error de GHL visible en pantalla.
- **Calificación automática por reglas** (default) o el campo manual del CRM,
  con interruptor. Las reglas usan solo señales objetivas del CRM — etapa real del
  pipeline, estatus y valor de la oportunidad, citas asistidas/agendadas, campos de
  presupuesto y horizonte, tags — y se evalúan en orden: descalificado → SQL
  Selvadentro (señal fuerte + perfil ≥$100K USD y ≤6 meses) → SQL (señal fuerte sin
  perfil) → MQL (respondió / mostró interés) → CQL (capturado). Cada lead muestra en
  la columna **Por qué** la evidencia que disparó su regla, y una matriz compara
  reglas vs. captura del equipo para auditar discrepancias. **Solo lectura**: nunca
  escribe en GoHighLevel.
- **Punto de estado activo/pausado** (verde/rojo/gris) en campaña, conjunto y
  anuncio, tomado del último estado que reporta Windsor; un conjunto o campaña
  cuenta como activo si al menos uno de sus anuncios lo está.
- **OPP = oportunidad real de cierre**, no cualquier registro del pipeline. En el
  pipeline de Selvadentro arranca en **"Seguimiento de OPP"** y cuentan también
  "Carta oferta", "Apartado" y las etapas posteriores. **"Cotización enviada" NO
  cuenta** (confirmado con el cliente el 2026-08-26): una cotización entregada
  todavía no es una oportunidad de cierre. Las etapas terminales negativas
  ("Perdido", "Descalificado") quedan fuera aunque estén al final del tablero. Los
  registros del pipeline se guardan aparte (`pr`) y alimentan las reglas de
  calificación. **WON = venta cerrada.** La pestaña de Diagnóstico lista las etapas
  que hoy cuentan como OPP, leídas del CRM.
- **Cuatro sub-pestañas**: (1) **Datos de Campañas** — inversión y desempeño por
  campaña desde Windsor, desplegable a anuncios por plataforma; (2) **Calidad de
  Lead** — mezcla de calificación desplegable de campaña → conjunto → anuncio;
  (3) **Reporte Combinado** — cruce de inversión y calidad por *familia* de campaña
  (nombres normalizados porque difieren entre plataforma y CRM), con KPIs, lectura
  automática, gráfica de inversión vs. calificados y dona de distribución;
  (4) **Conclusiones** — diagnóstico y acciones priorizadas con IA
  (`lq-analyze`, requiere `ANTHROPIC_API_KEY`; envía solo agregados, nunca datos
  personales de leads).
- **Desglose con toggles**: la mezcla completa de calificación (SQL Selvadentro,
  SQL, MQL, CQL, descalificados, sin calificar) más % alto valor, % SQL+,
  % descalificación, OPPs, WONs, inversión y costo por lead / por lead de alto
  valor, con dos interruptores: **nivel** (campaña · conjunto/grupo · anuncio) y
  **plataforma** (todas · Meta · Google · otras fuentes). Incluye tendencia
  semana a semana al nivel elegido.
- **Atribución de anuncio y conjunto**: del `adName`/`utm_content` y
  `adGroupName`/`utm_term` del contacto en GHL; si el conjunto no viene, se deriva
  cruzando el nombre del anuncio contra el catálogo de Windsor (anuncio → conjunto).
- **Extras del tab**: OPPs/WONs que produjo cada campaña (join de oportunidades por
  contactId), comparativa mes anterior vs mes actual, monitor de integridad
  (% con fuente/asesor/calificación + posibles duplicados por teléfono/email) y
  sección **Paid Media en vivo** (estado activo/pausado por anuncio, link de
  preview, inversión y resultados vía Windsor `/facebook` y `/google_ads`).

## Las tres cifras de ventas cerradas

La app reporta ventas cerradas en tres pantallas y **cada una mide algo distinto**. Las
tres son correctas; lo que no puede pasar es que se llamen igual. Desde el 2026-08-26 se
llaman distinto y el glosario completo vive en la pestaña **Diagnóstico**:

| Cifra | Dónde sale | Qué cuenta |
|---|---|---|
| **WON reportado** | Dirección General y Comercial | Lo que el equipo captura a mano cada semana en Ingreso de datos. Corta por la semana del reporte. |
| **WON cerrado** | CRM en vivo | Oportunidades que pasaron a ganada dentro del rango, por su fecha de cambio de estatus. |
| **WON del cohorte** | Calidad de Leads | Ventas de los leads que **entraron** en la semana, sin importar cuándo se cerraron. |

**Todas las semanas se cuentan en hora Tulum (UTC−5)**, vía `semanaISOTulum`. Antes
`crmWeekOf` leía en UTC y `lqWeekOf` en hora Tulum, así que los leads del domingo por la
noche caían en semanas distintas según la pestaña. El agregado del CRM subió a
`crm:agg:v2` para forzar la reconstrucción del cache que quedó agrupado con el reloj viejo.

## SLA y Seguimiento (Anexo 1 del proceso comercial)

Pestaña **SLA y Seguimiento** — el reporte semanal de disciplina comercial, directo
del CRM y con nombres:

- **SLA de primera respuesta** por asesor y por canal, con la definición del Anexo 1:
  se mide del alta del lead hasta el **contacto efectivo** (el lead respondió), no
  hasta el intento. La mediana del primer intento se reporta aparte para separar
  rapidez de conectividad. Umbrales: **15 min** (transferencia en caliente) y
  **60 min** (handoff por WhatsApp).
- **Agendamiento**: % de leads con una cita dentro de **48 horas**, contra la meta
  del 40% (verde si se cumple, rojo si no).
- **Contactados efectivos** (el lead respondió) vs trabajados; **>7 días sin toque**
  con lista nominal; **citas y show rate** (`showed` ÷ `showed`+`noshow`);
  **OPPs y WONs por asesor** en el rango.
- **Generación bajo demanda** (botón, 1–3 min): recorre conversaciones y citas de
  cada lead del rango en lotes de 8 vía `sla-report`; el resultado se cachea en el
  kv (`sla:agg:v1`) para todo el equipo. Acumulable dentro del mes eligiendo el
  rango de semanas.
- **Desempeño del asesor** — rúbrica del prototipo "Sistema de Calificación"
  (ago 2026), verificada con paridad exacta contra sus fórmulas: cinco sub-notas
  independientes en escala 1-5 (velocidad de primer contacto · cadencia 10 días ·
  cierre de ciclo/break-up · seguimiento a futuro · actividad efectiva), cada una
  con sus umbrales de % (20/40/60/80 · 20/40/60/80 · 10/20/35/50 · 10/25/40/60 ·
  50/70/85/95). La nota global es el promedio de las sub-notas disponibles y nunca
  se muestra sola; una sub-nota sin dato queda N/A y no la baja.
  - **Contacto manual**: se excluyen automatizaciones (`workflow`, `campaign`,
    `bulk_actions`) y actividad sin usuario asignado, por `source` y `userId`.
  - **Reloj del SLA**: corre **24/7** desde que entra el lead (confirmado con el
    cliente el 2026-08-26). No hay ventana laboral: noches y fines de semana cuentan.
    Si algún día se quiere volver a una jornada, `SLA_HORARIO.activo = true` reactiva
    el desplazamiento a la apertura del siguiente día hábil.
  - **Break-up** detectado del feed: ≥5 intentos de llamada + SMS/WhatsApp + email
    sin respuesta del lead. Denominador: descalificados del asesor, o el total si
    no tiene.
  - **Índice de calidad** (SQLS×4 + SQL×3 + CQL×1) ÷ (4×total) y **resultado
    ajustado** por percentiles (tasa de OPPs vs. calidad recibida) para separar
    mérito del proceso de suerte en la asignación. Muestra pequeña: <10 leads.
  - **Actividad efectiva** del estado de entrega de cada mensaje (entregados +
    leídos ÷ enviados).
- **Permisos**: canal `crm_live` o `direccion_comercial` (o admin) — mismo gate en
  servidor y en el tab.
- Requiere scopes de conversaciones y calendarios en el token (el token actual los
  tiene todos); si faltan, esas columnas degradan a "—" sin romper el reporte.

## Historial de la migración de seguridad (ago 2026)

La tabla original `kv` de este mismo proyecto quedaba **pública** con el anon key
(existía una policy `kv_anon_all` que permitía todo a `anon`): cualquiera podía leer
y escribir reportes y usuarios. Se construyó el backend seguro (`slvd_kv` + RPC con
secreto), se migraron los datos, y se eliminó la policy abierta de la tabla legacy —
que conserva los datos históricos pero ya no es accesible desde fuera.

El backend vive en el proyecto Supabase de Selvadentro (`vsnggxcuznleuvoyoenn`),
el mismo que usaba la app original. El script de migración (`scripts/migrate-kv.mjs`)
quedó obsoleto tras el cutover —la tabla legacy ya no es legible por REST— y se eliminó
del repo.

## Notas de seguridad restantes

- El esquema de contraseñas sigue siendo SHA-256(salt:pass) para no invalidar las
  contraseñas existentes; la verificación ahora es server-side. Mejora futura: migrar a
  bcrypt/scrypt en el próximo cambio de contraseña.
- El panel admin conserva el campo `password` en texto plano de algunos usuarios
  (funcionalidad "revelar" del creador original). Ahora solo un admin autenticado puede
  verlo, pero la mejora futura es eliminarlo.
- Los tokens duran 30 días y se refrescan al abrir la app. Cambiar `SESSION_SECRET`
  invalida todas las sesiones activas.
