# Selvadentro — Sistema de Reportes

App de reportes semanales de ventas y marketing para Selvadentro Tulum.
Producción: https://team.selvadentrotulum.com (Netlify site: `slvd-reportes`).

## Arquitectura

- **Frontend**: dos páginas estáticas ([index.html](index.html) ventas/dirección, [marketing.html](marketing.html) embebida en un **único** iframe que comparten las pantallas de Marketing, Metas y Base de datos). Sin build.
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
    oportunidades con sus campos personalizados, usuarios y catálogos de campos de
    contacto y de oportunidad, contactos por etiqueta) para **Desempeño de Ventas**
    (requiere canal `crm_live`, `direccion_comercial` o admin).
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

### Rediseño por costo por SQL (Dirección, 8-oct-2026)

La métrica que se usa para decidir ya no es el costo por "calificado" (MQL + SQL + SQL
Selvadentro) sino el **costo por SQL**. Una sola definición de lead bueno en toda la
sección: **SQL+ = SQL + SQL Selvadentro** (según el interruptor de calificación: reglas
automáticas por defecto o el campo del CRM). "Alto valor", "Costo/alto valor", "Calif." y
"% calificados" desaparecen; CQL y MQL quedan como columnas secundarias de volumen.

- **Costo por SQL** = inversión de la campaña en el rango ÷ SQL+ de esa campaña.
- **Semáforo por campaña** — parámetros en un solo lugar, `LQ_SEMAFORO` en `index.html`
  (la pantalla, la lectura automática y el prompt de la IA los leen de ahí):

  | Estado | Regla (valores por defecto) | Acción |
  |---|---|---|
  | VERDE | costo por SQL ≤ 4,000 MXN y al menos 2 SQL+ | Subir presupuesto 20% |
  | AMARILLO | costo por SQL entre 4,000 y 6,000 MXN | Optimizar, no subir |
  | AMARILLO | costo por SQL ≤ 4,000 MXN pero 1 solo SQL+ (con los valores actuales siempre cae en muestra chica) | Mantener, no subir |
  | ROJO | costo por SQL > 6,000 MXN, o inversión ≥ 8,000 MXN con 0 SQL+ | Pausar |
  | ROJO con < 50% de leads contactados (`minContactados`) | igual que ROJO, pero la mayoría de sus leads no se han trabajado | Revisar seguimiento antes de pausar (con la nota en la celda) |
  | EN EVALUACIÓN (gris) | inversión < 8,000 MXN y sin SQL+ | Mantener (muestra chica) |

  **Muestra chica** (inversión < 8,000 MXN): el color se calcula igual, pero la acción es
  siempre **"Mantener (muestra chica)"**: nunca "Subir presupuesto 20%" ni "Pausar"
  (Dirección, 8-oct-2026). La lectura automática agrupa por acción, no por color.
  Filas sin inversión (orgánico, "sin campaña") no tienen semáforo.
- **Columnas por campaña** (Calidad de Lead y Reporte Combinado): Inversión · Leads CRM ·
  CPL · % contactados · CQL · MQL · **SQL+ · Zoom realizado · OPP · WON** · Costo por SQL ·
  Semáforo, y dos totales: **Total pagado** (solo campañas con inversión, con su costo por
  SQL) y todos los leads del rango.
- **Embudo canónico** Lead → CQL → MQL → SQL → Zoom realizado → OPP → WON, del cohorte de
  leads del rango y por lead (no por oportunidad). **Zoom realizado** = etapa "Zoom
  realizado" o una posterior del embudo (OPP y WON incluidos); las etapas de tour/visita y
  las cubetas que no son embudo no cuentan. Es la etapa actual: el CRM no da historial.
- **% contactados** = leads que salieron de Nuevo / Sin respuesta (etapa de "Contacto
  establecido" o posterior, respuesta por tag, cita, OPP o WON). Tooltip: *si es bajo, el
  problema puede ser de seguimiento, no de la campaña*.
- **Alerta de CPL** ⚠ (solo visual, no cambia el semáforo): CPL de los últimos 7 días más
  de 30% arriba del promedio de 30 días de la misma campaña, anclado al final del rango.
- **Cruce por ID de campaña**: `lead-quality` ahora devuelve `attr.cid` (el `campaignId`
  de la atribución de GHL, o `hsa_cam` / `utm_id` de la URL de la landing) y `attr.host`
  (dominio de la landing). En Meta, GHL guarda el ID real aunque el nombre que lo acompaña
  sea el del formulario ("Intelligent Investors"); con el ID manda el nombre de la cuenta y
  el nombre del UTM queda de respaldo. Los IDs de campaña salen del detalle por anuncio **y
  de la inversión diaria** (`spend()` pide `campaign_id` a `/all`): así un lead de Google con
  `utm_campaign=23710551755` se pega a "INVESTORS - GOOGLE SEARCH -- MX" aunque el detalle
  por anuncio no llegue (regresión del 9-oct-2026: salían filas sueltas "GOOGLE 23710551755").
  La tabla también cuelga los leads por ID y une una campaña renombrada en una sola fila. Si
  un lead trae un ID que Windsor no conoce, un aviso lo dice en pantalla. `LQ_CAMP_ALIAS` traduce
  `INVESTORS-GOOGLE-SEARCH-MX` / `-USCAN` a "INVESTORS - GOOGLE SEARCH -- MX" /
  "INVESTORS - GOOGLE SEARCH - US+CAN".
- **Atribución inferida** (`LQ_INFERIDA`): leads con origen `landing-seguridad`
  (seguridad.selvadentrotulum.com) **sin utm_campaign y creados antes del 08-oct-2026**
  se asignan a `INVESTORS_MX_DYNAMIC-TOPLPS_090926`, conjunto SEGURIDAD_PATRIMONIO, con la
  marca "N con atribución inferida". Desde el 08-oct llegan con UTMs reales y manda el UTM.
- **Aviso de leads sin campaña**: cuenta exactamente los leads de las filas
  "(sin campaña atribuida)" de la tabla (antes contaba aparte los de Meta/Google con
  utm_campaign vacío y no cuadraba: decía 1 de 60 con 10 en la tabla).
- **Limpieza**: la matriz "Reglas automáticas vs. captura del equipo" queda detrás del
  botón **Ver diagnóstico de reglas**; la tabla de inversión por campaña de Calidad de Lead
  se volvió **Inversión por plataforma** (el detalle por campaña ya está en la tabla del
  semáforo, con la misma cuenta que el Combinado).
- **Conclusiones IA**: el prompt recibe el semáforo ya calculado y devuelve una acción por
  campaña (subir 20% / mantener / optimizar / pausar) con la regla que la justifica; la
  tabla de acciones se arma con el semáforo aunque no se haya corrido la IA, y si la IA
  propone otra acción manda el semáforo. Cache `lq:ia:v6:`.
- Pruebas: `node scripts/test-lq.js` (backend con GHL y Anthropic simulados) y el bloque
  `lq:rediseño` de `scripts/smoke-ui.js` con los datos sintéticos de
  `scripts/lq-fixture.js` (W37–W40, los cinco estados del semáforo).

### Prueba de humo de la interfaz (`scripts/smoke-ui.js`)

La app no tiene build ni pruebas automáticas y todo lo que se rompía en pantalla lo veía
primero el cliente (la última vez, seis tarjetas tituladas "undefined" en la Analítica de
Dirección). `scripts/smoke-ui.js` arranca la app en Chromium sin cabeza con una sesión de
admin simulada y los Netlify Functions sustituidos por stubs —kv vacío, sin CRM, sin
Windsor: **no toca nada real**—, recorre las 14 vistas y falla si hay un error de
JavaScript, si alguna vista imprime `undefined`, `NaN` o `[object Object]`, o si una tabla
tiene distinto número de encabezados que de celdas. También ejerce en vivo la validación
"seguimiento > total" del formulario de captura.

```bash
npm i -g playwright            # una vez (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 si ya hay Chromium)
node scripts/smoke-ui.js       # CHROME_PATH=… para usar otro binario · PORT=… para otro puerto
```

Sale con código 1 si encuentra algo. Los tres "502" en consola son los stubs del backend
y son esperados. Correrla antes de cada `push` a `main`.

`node scripts/test-sla-report.js` prueba el backend de Desempeño con GoHighLevel
**simulado** (sin llaves ni red): el corte de actividad en la fecha de descalificación, la
evidencia de las etiquetas "sin llamada", el contacto efectivo por llamada de ≥90 s y la
lectura de campos de oportunidad (spec v1.1).

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

## Canal de negocio: de dónde sale cada lead

Los siete canales de Ventas (Brokers, Paid Orgánico, Seminarios…) se capturaban a mano
porque la app no sabía deducirlos. Ahora sí: `lqCanalDeNegocio` lee el campo personalizado
**"Fuente del lead"** de GoHighLevel y lo traduce al canal; si viene vacío, lo intenta por
tags; si tampoco, devuelve `null` (nunca inventa un canal, porque ese número acabaría en
Dirección pareciendo un hecho).

Hoy eso cubre bien un canal de siete: el campo viene lleno en el 47% de los contactos y en
los canales que no son publicidad casi nunca. **Diagnóstico → "Captura manual contra CRM,
por canal"** compara semana a semana lo capturado contra lo que el CRM atribuye solo, con un
veredicto por canal, para poder retirar la captura de un canal cuando de verdad sobre.
Lo que falta hacer en el CRM está en [docs/ghl-canales-spec-2026-08.md](docs/ghl-canales-spec-2026-08.md).

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
  (Meta + Google) y se muestra inversión, CPL y **costo por SQL** por campaña (cruce por
  ID de campaña y, de respaldo, por nombre) y por plataforma (siempre calculable). Todo
  en **MXN** ("12,345 MXN", nunca "$").
- **Cache compartido**: agregado en el kv (`lq:agg:v17`), staleness de 30 min, igual
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
  Selvadentro (oportunidad real de cierre o WON en el pipeline, **o** cita asistida /
  etapa avanzada + perfil ≥100,000 USD y ≤6 meses) → SQL (señal fuerte sin perfil, o
  perfil del formulario sin etapa que lo respalde) → MQL (respondió / mostró interés) →
  CQL (capturado). **La etapa del pipeline manda sobre el formulario** (Dirección
  General, 15-sep-2026): una OPP o una venta cerrada es el veredicto del asesor tras
  hablar con el prospecto, mientras que presupuesto y horizonte son lo que el prospecto
  tecleó antes de que nadie lo atendiera y la mitad los deja vacíos. Con la regla
  anterior, 12 de los 26 SQL del reporte estaban en etapa de OPP —uno con venta
  cerrada— y no subían a SQL Selvadentro solo por el formulario. Cada lead muestra en
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
- **Cuatro sub-pestañas**: (1) **Datos de Campañas** — por campaña solo Inversión ·
  Leads plataforma · Leads CRM · CPL; impresiones, clics, CTR, CPC, plataformas y
  anuncios quedan plegados dentro de cada campaña; (2) **Calidad de Lead** — tabla por
  campaña desplegable a conjunto → anuncio con el semáforo; (3) **Reporte Combinado** —
  tarjetas Inversión total · Leads CRM · SQL+ · Costo por SQL · WON, lectura automática
  del semáforo, gráfica de inversión vs. SQL+ por campaña, dona de distribución y la
  tabla por **campaña** (antes por familia: el semáforo mueve presupuesto y el
  presupuesto vive en la campaña); (4) **Conclusiones** — una acción por campaña según el
  semáforo, con su regla, y el detalle y la lectura de la IA (`lq-analyze`, requiere
  `ANTHROPIC_API_KEY`; envía solo agregados, nunca datos personales de leads).
- **Desglose con toggles**: **nivel** (campaña · conjunto/grupo · anuncio) y
  **plataforma** (todas · Meta · Google · otras fuentes), más tendencia semana a semana
  (leads / SQL+) al nivel elegido.
- **Atribución de anuncio y conjunto**: del `adName`/`utm_content` y
  `adGroupName`/`utm_term` del contacto en GHL; si el conjunto no viene, se deriva
  cruzando el nombre del anuncio contra el catálogo de Windsor (anuncio → conjunto).
- **Google manda ids, no nombres**: el sufijo de URL final de la cuenta de Google Ads es
  `utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}`, así que el lead
  llega a GHL con `utm_campaign=23715389989`. ValueTrack no tiene un token con el nombre
  de la campaña, así que no se arregla en Google: `ads()` pide `campaign_id` y
  `ad_group_id`, y `lqIdIndex` / `lqNombreDeId` traducen el id al nombre antes de cruzar.
  Sin eso las campañas de Google salían como números (familia "237") y sus columnas de
  leads y costo en guion. Por lo mismo `utm_term` de Google es la **palabra clave**, no
  el conjunto: solo se acepta como conjunto si empata con un grupo real de la cuenta.
- **La plataforma sale de la cuenta, no de los tags**: si la campaña del lead existe en
  una cuenta de anuncios, la fuente es esa cuenta. De ahí que los **registros a webinar
  cuenten como Meta** (confirmado con el cliente el 2026-09-02): el formulario de registro
  no manda UTM y el tag `webinar-registered` los mandaba a una campaña sintética
  ("Registro a webinar · funnel MKT"), así que `INVESTORS_US/CA_WEBINAR_210726` gastaba
  $4,681.85 con **cero** leads y sin costo por lead, mientras 17 leads colgaban de una
  campaña que no existe en ninguna cuenta. Ahora se pegan a la campaña de webinar de la
  cuenta **solo si hay una sola candidata con inversión**, marcados como deducidos —es una
  inferencia por nombre, no atribución— y si no hay candidata clara se quedan en su propio
  embudo en vez de inventarles plataforma. El tag sigue visible como nota del lead.
- **Campos canónicos de presupuesto y horizonte**: el framework del cliente (*Primera
  Conexión*, 21-jul-2026, §6) los nombra: **Budget Range** y **Horizonte de inversión**.
  `lqDetectFields` busca primero ese nombre exacto y solo de respaldo el campo más poblado
  (el CRM tiene tres de presupuesto y dos de horizonte). Budget Range **mezcla MXN y USD
  sin decirlo**: "$1M–$2M" (la opción más común, 28 leads en julio) son pesos y
  "$75K–$100K" dólares. `lqParseMoney` trata como pesos cualquier cifra ≥ 400,000 sin
  moneda explícita —nadie declara USD 400K+ para un lote de USD 70–150K— y la convierte a
  USD (÷18) antes de compararla contra el umbral de $100K. Antes un millón de pesos pasaba
  el umbral e inflaba SQL Selvadentro. En el horizonte, "6 meses **o más**", "12+ meses" y
  "más de N" **exceden** el número (n+1): la regla del CRM manager es "6 meses o más = MQL",
  y antes "6 meses o más" se leía como 6 exactos y entraba al perfil de ≤6. **Diagnóstico →
  "Cómo se leen presupuesto y horizonte"** muestra cada opción real de los dos campos y en
  qué la convierte el reporte, para verificar la lectura sin leer código (`lq:agg:v13`).
- **Auditoría de etiquetado UTM** (`lqAuditUtm`, se ve en **Diagnóstico**): lee lo que
  manda cada anuncio —`url_tags` en Meta, sufijo de URL final y plantilla de tracking en
  Google— lo cruza contra los `utm_campaign` que llegan al CRM y dice qué campaña está
  mal etiquetada y por qué (sin parámetros, valor fijo, `utm_content` con dos
  significados, plantilla de cuenta que pelea con el sufijo del anuncio, o campaña que
  gasta sin un solo lead atribuido).
- **Extras del tab**: OPPs/WONs que produjo cada campaña (join de oportunidades por
  contactId), comparativa **mes contra mes anclada al final del rango que se está leyendo**
  (no a la fecha de hoy: abriendo un reporte de agosto comparaba agosto contra septiembre,
  y el día 2 del mes restaba dos días de datos contra un mes completo; cuando el mes ancla
  no ha cerrado, los dos meses se cortan al mismo día), monitor de integridad
  (% con fuente/asesor/calificación + posibles duplicados por teléfono/email) y
  sección **Paid Media en vivo** (estado activo/pausado por anuncio, link de
  preview, inversión y resultados vía Windsor `/facebook` y `/google_ads`).

## Metas del negocio

Pantalla **Metas** de la barra lateral. Todo se guarda en la clave `selvadentro:metas`
del kv y aplica para todo el equipo, salvo el bloque **Rúbrica de desempeño** (umbrales de
las sub-notas del asesor con fecha de vigencia), que vive en `selvadentro:rubrica` y solo
lo cambia Dirección General — ver *Desempeño de Ventas*.

- **Metas por KPI de cada canal** (meta mensual de cada campo, más KPIs personalizados y
  el orden de las secciones): ya existía.
- **Metas globales** (`__global`): meta de **WON al mes** y meta del **mix de leads** por
  canal, más las cuatro **conversiones objetivo** (Zooms → OPP, Tours → OPP,
  OPP → Apartados, Apartados → WON). Eran las constantes `CHANNEL_META` y `CONV_T`
  escritas en el código —el comentario decía "editables" desde el primer día pero no
  tenían pantalla— y cambiar una meta era un cambio de código y un deploy. Ahora las
  constantes son solo el **valor por defecto**: lo guardado las sobrescribe campo por
  campo y el botón *Restaurar valores originales* borra el override. Salen en Dirección
  General, Dirección Comercial y el reporte de cada canal.
- **Quién puede cambiarlas**: la pantalla estaba condicionada a `isAdmin()`, así que
  Dirección Comercial no veía el botón —de ahí "no puedo cambiar las metas"—. Ahora la
  ven `admin`, `direccion_general` y `direccion_comercial`, y `kv.js` aplica la misma
  regla del lado del servidor: la **lectura** de `selvadentro:metas` queda abierta
  (las metas salen en casi toda la app y negarla dejaría las pantallas en blanco), la
  **escritura** solo para esos tres.
- **Una sola fuente para las conversiones objetivo** (reporte de bug de Dirección
  General, 11-sep-2026). Ventas → Reporte de cada canal imprimía las metas escritas en el
  código (Zooms→OPP 15%, Tours→OPP 20%, Zoom/Tour→OPP 40%…) mientras Dirección General y
  Comercial leían las de Metas (30%/35%…): el mismo ratio salía verde en una pantalla y
  rojo en otra. Ahora `metaConv()` resuelve la meta de cada conversión con esta
  precedencia: **meta propia del canal** (nuevo bloque *Conversiones objetivo del canal*
  en Metas, guardado en `__conv` del canal) → **meta global de Metas** (`CONV_T`, la
  misma que Dirección) → valor del código, solo para conversiones sin equivalente global
  (webinars, brokers, presentaciones). *Zoom/Tour → OPP* dejó de ser una constante: se
  **deriva** como promedio de Zooms→OPP y Tours→OPP ponderado por la mezcla real de
  zooms y tours del periodo, así siempre cae entre sus dos partes. Cada meta impresa lleva
  una marca de origen (`·Metas`, `·canal`, `·derivada`, `·fija`) con tooltip.
  Efecto colateral anunciado: las metas no guardan historial, por lo que un reporte de
  semanas pasadas se colorea contra la meta **vigente hoy**, no contra la que regía
  entonces (el reporte lo dice en una nota). La prueba de humo cubre el criterio de
  aceptación (Paid Orgánico imprime `meta 30.00%`, nunca `15.00%`, y la combinada queda
  entre 30 y 35).

## Solicitudes de cambio de Dirección General (septiembre 2026)

Dos solicitudes formales de Juan Cámara, ambas implementadas el 2026-09-11:

**OPP por asesor (7-sep).** La columna "Opp. creadas" del embudo D2 contaba TODO registro
del pipeline creado en el rango: 72 "oportunidades" contra 67 leads en W26–W37, un sinónimo
de "leads recibidos". Ahora `OPP` = registros creados en el rango cuya etapa **actual** es
una de cuatro, con la grafía literal del CRM (`SLA_ETAPAS_OPP`): *Seguimiento de OPP*,
*Carta oferta*, *Apartado*, *WON*. Cohorte (opción a de la solicitud); la entrada a etapa
(opción b) espera el historial del CRM (spec B2-1). El total de registros creados se
conserva como número chico de contexto. *Registro de cliente* quedó fuera también en
Calidad de Leads (`LQ_RX_MUERTA`). Verificación que pide la solicitud: el mismo rango
22/06→13/09 debe bajar de 72 a 0 o 1.

La definición oficial de OPP es esta. El Anexo 2 del documento de onboarding (ago 2026)
todavía dice "OPP means quote sent": quedó **superado** por la decisión escrita de
Dirección General del 26-ago y del 7-sep. El campo manual `opp_total` de los siete
canales lleva ahora texto de ayuda con la misma definición para que las dos cifras
(CRM y captura) midan lo mismo.

**Zooms y tours: cliente nuevo vs seguimiento (10-sep).** El sistema contaba eventos, no
personas: un cliente con tres zooms eran tres zooms, y Zooms→OPP dividía un numerador por
cliente entre un denominador por evento. Fase 1, captura manual:

- Cuatro campos nuevos en los seis canales con zooms/tours (Brokers queda para un ticket
  aparte): `zooms_agendados_seg`, `zooms_realizados_seg`, `tours_agendados_seg`,
  `tours_realizados_seg`. Los cuatro totales conservan su significado: **nada del
  histórico se recaptura**. *Nuevos* se **deriva** (total − seguimiento) y nunca se
  captura, así las partes siempre suman el total.
- `seguimiento > total` **bloquea** el guardado (no es un aviso de "guardar así") y se
  marca en rojo en el momento, al salir del campo. Los campos vacíos guardan 0.
- Denominadores (§05 de la solicitud): las conversiones del **embudo** usan clientes
  únicos —Zooms nuevos→OPP, Tours nuevos→OPP, Lead→agendado (nuevos)—; las de
  **ejecución** usan eventos totales —show rate, carga por asesor. Las dos cifras se
  muestran lado a lado, rotuladas `(tot.)` y `nuevos`. En las conversiones por canal una
  clave con `-` delante se resta: `den:["zooms_realizados","-zooms_realizados_seg"]`.
- Dirección General y Dirección Comercial muestran ahora *Zooms/Tours agendados*, *nuevos*
  y el **show rate** (meta 75%), que antes no llegaban a Dirección. Show rate y
  Lead→agendado son metas editables (`CONV_T.zr`, `CONV_T.lz`).
- Registros capturados **antes** de la separación no traen las claves `_seg`: se cuentan
  (`sinSeg`) y las tres vistas avisan que ahí *nuevos = total* y la tendencia no es
  comparable. No se marcan uno a uno ni se editan.
- **Alias de KPIs personalizados**: Juan había creado los cuatro campos como KPIs
  personalizados en Paid Orgánico (`custom_*_de_seguimiento_*`) dos días antes de que
  existieran en el código. Un KPI personalizado con el mismo nombre que un campo nativo se
  convierte en alias (`KPI_ALIAS`, en `applyMetas`): desaparece del formulario y lo que se
  capturó bajo su clave se lee en el campo nativo (`normalizarAlias`, al cargar el kv).
  Nada se pierde y no hay campos duplicados.
- **Fase 3 anticipada**: Desempeño de Ventas trae ya "Citas nuevas vs de seguimiento ·
  leídas del CRM": la primera cita de cada contacto es nueva, las siguientes seguimiento,
  sin criterio del asesor. GoHighLevel no distingue Zoom de Tour en las citas, así que van
  juntas. Cuando esta cifra y la captura manual coincidan unas semanas, los cuatro campos
  del formulario se pueden retirar.

Metas: la solicitud cita 15%/20% para Zooms→OPP y Tours→OPP. Son las metas de la hoja
*Reporte Detallado de Resultados* de marzo–agosto 2026 (el origen de los valores por
defecto del código). En el kv hay 30%/35%, fijados desde la pantalla de Metas después del
2-sep: **manda lo que está en la app**, y conviene revisarlo cuando el denominador cambie
a clientes únicos, porque la solicitud misma advierte que Zooms→OPP va a subir.

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

## Desempeño de Ventas (Anexo 1 del proceso comercial)

Pestaña **Desempeño de Ventas** en la barra principal (antes "SLA y Seguimiento", y
un tiempo escondida como canal sintético dentro del desplegable de Ventas) — el
reporte semanal de disciplina comercial, directo del CRM y con nombres:

- **SLA de primera respuesta** por asesor y por canal, con la definición del Anexo 1:
  se mide del alta del lead hasta el **contacto efectivo** (el lead respondió), no
  hasta el intento. La mediana del primer intento se reporta aparte para separar
  rapidez de conectividad. Umbrales: **15 min** (transferencia en caliente) y
  **60 min** (handoff por WhatsApp).
- **Agendamiento**: % de leads con una cita dentro de **48 horas**, contra la meta
  del 40% (verde si se cumple, rojo si no).
- **La nota del asesor se califica sobre acciones manuales** (confirmado con el cliente el
  2026-09-02): la sub-nota de velocidad mide del alta del lead a su primer toque manual
  (`foM`), en cualquier canal. La llamada conectada (`foC`) se reporta como columna, pero
  no es la base de la calificación.
- **Primer toque = acción MANUAL del asesor**, nunca la automatización. La columna
  contaba cualquier mensaje saliente y marcaba **100% en todos los asesores** — la
  secuencia de bienvenida le escribe a todos los leads, así que medía el workflow, no al
  equipo. Ahora hay dos columnas separadas: **1er toque manual** (`foM`: su llamada, su
  WhatsApp, su SMS o su email escrito a mano) y **llamada conectada** (`foC`: llamada con
  estatus `connected` o `answered` — un intento a buzón es trabajo, no contacto). La
  columna gris "1er msj (autom.)" y el KPI "Cualquier salida ≤60 s, automatización
  incluida", que estaban solo como referencia, se quitaron el 7-oct-2026 a pedido de
  Dirección General. La mediana del primer intento también pasó a medirse contra el
  toque manual.
- **Telefonía por asesora** (Dirección General, 7-oct-2026). Tres columnas nuevas en la
  tabla por asesor y dos arreglos sin los cuales mentirían:
  - **Canal del 1er toque** (`foMch`): % llamada · WhatsApp · SMS · correo. La mediana de
    1er toque mezcla canales que no se comparan; se lee con este mix.
  - **Med. 1er llamada** (`slaCall`): hasta el primer *intento* de llamada, conecte o no.
    Siempre columna aparte de la mediana de 1er toque (con las reglas v1.1, solo leads en
    horario, igual que esa).
  - **Llamadas por lead · 24 h / total** (`cl.h24`, `cl.n`): el volumen de marcación por
    persona, que antes solo existía agregado.
  - **Duración**: el backend descartaba toda duración igual a 0, así que una llamada que no
    conectó salía "sin duración legible" (238 de 594, 40%). Ahora una llamada sin respuesta
    o con falla de línea dura 0 s por definición; solo es **desconocida** la de una llamada
    conectada que no la trae, y la pantalla dice cuántas son, con qué status y qué llaves
    sí traen (para encontrar dónde la escribe GHL). Se acepta también `mm:ss`. Los leads
    sin respuesta escrita cuyo contacto efectivo depende de una de esas llamadas salen
    como "contacto efectivo no medible".
  - **Sin marcar vs falla de línea**: cada intento trae su desenlace —conectada, sin
    respuesta (no-answer/buzón), **falla de línea** (failed/busy/canceled: 153 de 594, 26%)
    o sin estatus—. Columnas "Sin marcar" y "Solo falla de línea" y el bloque "Telefonía por
    asesora". Desde el 7-oct-2026 (`SLA_LINEA_DESDE`, mismo criterio de periodo que la
    v1.1/v1.2) las fallas de línea salen del denominador de la **actividad efectiva**: son
    telefonía, no desempeño. `sla:agg:v12`.
  - **Manual vs automática**: todas las columnas por asesora cuentan solo llamadas del
    asesor (`isManual`: con usuario, y sin `source` workflow/campaign/bulk_actions/api ni
    `TYPE_CAMPAIGN_*`). El diagnóstico agregado de telefonía (las 594 llamadas) mezclaba
    las del asesor con las automáticas y las entrantes; ahora las separa (`tel.por`) con
    su falla de línea y duración desconocida, para saber de quién es cada falla.
  - **Llamada automática con contacto** (spec v1.2 §3; Dirección General, 7-oct-2026): si
    el CRM marcó solo (workflow, campaña, marcador, API) y la llamada duró **≥90 s**, cuenta
    como **contacto efectivo** y como **1er toque a su hora real** —SLA de 60 s, umbral de 5
    minutos (u 11:00 fuera de horario) y mediana de 1er toque— con las reglas v1.1 (periodos
    desde el 1-oct). El barrido devuelve `foA`/`nA`; el front toma lo primero entre `foM` y
    `foA` (`tAuto` marca a quién se le acreditó así). La columna "1er toque manual", los
    intentos y el canal del 1er toque siguen contando solo lo que hizo el asesor.
- **Los tres parámetros del Anexo 1 que faltaban** (2026-09-11), derivados de lo que el
  barrido ya lee por contacto: **SLA de 60 segundos** del Ejecutivo de Primer Contacto
  (contra el primer toque manual); **integridad del pipeline** (spec B2-2:
  toda OPP abierta —Seguimiento de OPP, Carta oferta, Apartado— debe tener un *next step
  con fecha* = tarea abierta con fecha límite hoy o después, o cita futura; se lista con
  nombres, por asesor, y los leads cuyas tareas o citas no se pudieron leer salen del
  denominador en vez de contarse como "sin paso"); y **confirmación de Zoom el mismo día**,
  que es una **aproximación** declarada en pantalla: GHL no guarda la hora de confirmación,
  se usa la última actualización y solo mientras la cita sigue en `confirmed` (una cita ya
  marcada showed/noshow pisó ese dato). El backend devuelve `tk.abiertasFut`, `ap.conf` y
  `ap.confDia` por contacto (`sla:agg:v8`).
- **Descalificados · razón de descarte** (2026-09-11): por asesor, cuántos leads
  descalificados del rango (por etapa "Descalificado" o por la calificación del CRM) traen
  el campo *Razón de descarte* y la distribución de razones. La retro de Talía (3-jul) y
  el reporte de Primera Conexión (21-jul) lo señalan igual: sin la razón, "cierre de ciclo"
  no distingue mala calidad (marketing) de mala gestión (asesor), y el campo estaba vacío
  en el 100% de los casos. La pantalla repite la recomendación: hacerlo obligatorio en GHL
  al mover a "Descalificado". `sla:agg:v9`.
- **Contactados efectivos** (el lead respondió) vs trabajados; **>7 días sin toque**
  con lista nominal — se mide contra el último toque **real** (acción manual del asesor o
  respuesta del lead), porque con el último mensaje de cualquier origen un lead abandonado
  con drip activo nunca aparecía en la lista; **citas y show rate**; **OPPs y WONs por
  asesor** en el rango.
- **Show rate por fecha de la cita** (7-oct-2026). Salía "0 de 1" con citas que sí
  ocurrieron, por dos razones: solo contaba citas de leads que **entraron** en el rango (una
  cita de esta semana de un lead de agosto no existía) y solo las marcadas `showed`/`noshow`
  en el calendario (el equipo registra la asistencia moviendo la oportunidad y deja la cita
  en `confirmed`). Ahora la acción `citas` del backend trae las citas de **todos los
  calendarios** con fecha en el rango, de cualquier lead; la asistencia sale del calendario
  y, si la cita ya pasó sin estatus final, de la etapa del lead (Zoom/Tour realizado o
  posterior = asistió; no show / re agendar = no asistió). Lo que no dice ninguna de las dos
  queda **sin registrar**, visible y fuera del %. KPI, columna Show de la tabla por asesor,
  ficha y bloque "Citas del periodo · agendadas y asistencia". Si los calendarios no se
  pueden leer, vuelve al cálculo por cohorte y lo dice. `sla:agg:v13`.
- **Citas agendadas en el periodo y tasa de agendamiento** (7-oct-2026). En W40 salían "2
  citas" con muchas más agendadas esa semana: la tasa solo veía citas de leads que entraron
  en el rango, y su base solo incluía leads con contacto efectivo, así que quien agenda por
  el link del calendario sin escribir no contaba ni arriba ni abajo. Ahora: la acción
  `citas` trae también la fecha en que se **agendó** cada cita (`ag`) y el front la pide
  hasta 120 días después del rango; **"Citas agendadas en el periodo"** cuenta las que se
  agendaron en el rango, de cualquier lead y para cualquier fecha, sin canceladas (KPI y
  columna por asesora). La **tasa de agendamiento** sigue siendo por los leads del rango,
  pero su base es "contacto efectivo **o** cita" (`slaAgBase`). `sla:agg:v14`.
- **Generación bajo demanda** (botón, 1–3 min): recorre conversaciones y citas de
  cada lead del rango en lotes de 8 vía `sla-report`; el resultado se cachea en el
  kv (`sla:agg:v1`) para todo el equipo. Acumulable dentro del mes eligiendo el
  rango de semanas.
- **Desempeño del asesor** — rúbrica del prototipo "Sistema de Calificación"
  (ago 2026), verificada con paridad exacta contra sus fórmulas: cinco sub-notas
  independientes en escala 1-5 (velocidad de primer contacto · cadencia 10 días ·
  cierre de ciclo/break-up · cumplimiento de tareas · actividad efectiva), cada una
  con sus umbrales de % (hoy: 20/40/60/80 · 20/40/60/80 · 10/20/35/50 · 50/70/85/95 ·
  50/70/85/95). La nota global es el promedio simple de las sub-notas disponibles,
  todas con el mismo peso, y nunca se muestra sola; una sub-nota sin dato queda N/A y
  no la baja. Con menos de **5 leads** no hay nota —ni sub-notas ni global, tampoco en
  la ficha ni en el selector de asesor—: "sin muestra suficiente", nunca un 1; con 5 o
  más se califica. La spec v1.0/v1.2 pedía 10; Dirección General la bajó a 5 el
  30-sep-2026 (`SLA_MIN_N`), para todos los periodos.
  - **Umbrales con fecha de vigencia** (Change Spec v1.2 de Dirección General,
    25-sep-2026). Velocidad de primer contacto pasa de 10·20·30·45 (la recalibración de
    la spec v1.0 al cambiar la ventana a 5 min, rechazada por laxa) a **20·40·60·80**,
    con 80% para un 5, **desde el 1-oct-2026**. Sin recálculo retroactivo: cada periodo
    se califica con el juego vigente en su **último día**, así que una semana que terminó
    antes del 1-oct conserva su nota y cualquier periodo que toque el 1-oct o después
    —incluida la semana del 28-sep— usa los nuevos. Si el rango tiene días de antes y de
    después, la sub-nota lleva la nota "Rúbrica cambió el 1-oct-2026" (encabezado de la
    tabla, ficha y leyenda). Límite inferior inclusivo (20.0% = 2, 80.0% = 5, 79.9% = 4);
    se califica sobre el % sin redondear —calculado como `x·100/N` para que un % que cae
    justo en un umbral salga exacto— y se muestra a un decimal.
  - **Los umbrales son un parámetro, no código**: `SLA_RUBRICA_DEF` es solo el valor por
    defecto; **Metas → Rúbrica de desempeño** muestra los juegos de las cinco sub-notas con
    su vigencia y permite programar uno nuevo con fecha (hoy o después; nunca se edita ni
    se quita un juego que ya rige, porque eso recalcularía notas emitidas). Se guarda en
    `selvadentro:rubrica`: lectura abierta, escritura solo `direccion_general` (o admin),
    aplicado también en `kv.js`. El reporte nunca mueve un umbral por su cuenta. La prueba
    de humo corre los nueve casos de aceptación de la spec.
  - **Filtros de medición** (Change Spec v1.1 "Lead Filters" de Dirección General, desde
    el **1-oct-2026**, mismo criterio de periodo que la v1.2: rigen en todo periodo cuyo
    último día es el 1-oct o después; lo anterior no se recalcula). Principio: **una
    exclusión funciona en los dos sentidos** — un lead que no cuenta en contra del asesor
    tampoco cuenta a favor y sale de numerador y denominador de toda métrica desde su alta.
    En pantalla: banner "Reglas de medición vigentes desde el 1 de octubre de 2026" con el
    chequeo de las entradas del CRM (§2) y los rótulos literales de la §5.
    - **R-01**: la oportunidad en Descalificado trae *Causa de descalificación* y *Evidencia*.
      Causa del grupo **inválido** (Dejó datos por error, Pruebas de marketing, Sin datos
      válidos, Número equivocado, Contacto inapropiado / broma) → fuera de todo, bloque
      "Leads inválidos (fuera de la nota)" por asesor y causa, y en **Calidad de Leads** por
      fuente y campaña. **Real descartado** (No alineado, Ya no interesado, Malinterpretó la
      campaña) → se mide hasta *Fecha de entrada a Descalificado*: el barrido corta ahí
      mensajes, tareas y citas (`opts.cut`). Sin causa o evidencia y <24 h → se mide como
      activo. Sin la fecha de la automatización: el `lastStageChangeAt` si sigue en
      Descalificado; si no, sin corte (= última actividad).
    - **R-02**: etiqueta `descalificacion injustificada` → "Descalificaciones revertidas" en
      la ficha del asesor (*Asesor que descalificó*, por id o nombre) con la lista; el
      periodo lo fija la fecha de descalificación, así que se buscan también contactos
      etiquetados de antes del rango (acción `tagged`). Lo que el asesor hizo antes cuenta
      en su nota (`uNota`); como volumen el lead aparece con su dueño actual (Rescate) en
      "Fuera del equipo de ventas".
    - **R-03**: etiqueta `broker` o **cualquier** oportunidad en Brokers — Expansión y
      activación (antes: solo si TODAS vivían ahí) → "Error de asignación", fuera de todo.
    - **R-04**: horario de atención 09:00:00–18:59:59 hora Tulum; SLA 5 min en horario,
      antes de las 11:00 del siguiente día de servicio fuera de horario. Los días de
      servicio son un parámetro en Metas → Rúbrica de desempeño (`selvadentro:rubrica`,
      `horario`; por defecto lunes a viernes, **pendiente de confirmar** con Dirección
      Comercial). La mediana de 1er toque cuenta solo leads en horario; nueva cifra en la
      ficha "Fuera de horario atendidos antes de las 11:00".
    - **R-05**: `sin llamada - numero invalido` (≥2 intentos no conectados en ≥2 días) y
      `sin llamada - solo mensaje` (un entrante del lead o una llamada ≥90 s), siempre antes
      de *Sin llamada - fecha de inicio*. Válida → la escalera del break-up no exige llamadas
      y "sin respuesta" cuenta desde la fecha de la etiqueta; sin evidencia → "Etiquetas sin
      evidencia". El retiro de una etiqueta no tiene fecha en el CRM: se guarda la primera
      sincronización donde ya no estaba (`sla:nocall:v1`). Tasa por asesor vs. equipo con
      alerta roja a más de 2× (sin alerta con menos de `SLA_MIN_N` leads — hoy 5, no los 10
      de la spec, por la decisión del 30-sep). Mientras la telefonía siga en 0% conectadas
      (C-20, `SLA_C20_CERRADO = false`), número inválido con evidencia completa queda
      "Pendiente de validación" y la excepción se aplica provisionalmente.
    - **R-06**: contacto efectivo = respuesta del lead **o llamada de ≥90 s** (`fe` del
      barrido); una acción manual sola nunca lo es. **R-07**: sin exención por Zoom o tour.
    - La prueba de humo corre los diez casos de aceptación de la §6; `sla:agg:v11` y
      `lq:agg:v15` fuerzan a reconstruir los agregados.
  - **Contacto manual**: se excluyen automatizaciones (`workflow`, `campaign`,
    `bulk_actions`) y actividad sin usuario asignado, por `source` y `userId`.
  - **Reloj del SLA**: en periodos que terminaron antes del 1-oct-2026 corre **24/7**
    desde que entra el lead (confirmado con el cliente el 2026-08-26): noches y fines de
    semana cuentan. Desde el 1-oct-2026 rige el horario de atención de la spec v1.1 (R-04,
    arriba). `SLA_HORARIO` queda solo para las reglas anteriores.
  - **Break-up** detectado del feed: ≥5 intentos de llamada + SMS/WhatsApp + email
    sin respuesta del lead. Denominador: descalificados del asesor, o el total si
    no tiene.
  - **Índice de calidad** (SQLS×4 + SQL×3 + MQL×2 + CQL×1) ÷ (4×total) y **resultado
    ajustado** por percentiles (tasa de OPPs vs. calidad recibida) para separar
    mérito del proceso de suerte en la asignación. Muestra pequeña: <5 leads.
    Desde el 23-sep-2026 la calificación de cada lead sale de las **reglas de Calidad
    de Leads** (`lqAutoQualify`, la etapa del pipeline manda), no del campo manual
    "Calificación del lead": el equipo dejó de llenarlo en la semana 33 (0 de 51
    leads del último rango lo traían) y el índice, y con él el cierre de ciclo y el
    resultado ajustado, salían en blanco para todos los asesores. El campo manual se
    conserva como `lvCrm` y el reporte declara cuántos leads lo traen.
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
