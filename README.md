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
  - `pc-report` — proxy a GoHighLevel para **Primer contacto** (Ejecutivo de Primer Contacto y
    Rescate): conversaciones con actividad manual, eventos compactos por conversación, contactos
    y oportunidades por id, citas con su creador. Importa de `sla-report` la definición de acción
    manual, canal, desenlace y duración de llamada (no la copia). Requiere canal `pc_view`,
    `sla_view`, `crm_live`, `direccion_comercial` o admin.
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
  | VERDE | costo por SQL ≤ 4,000 MXN y al menos 2 SQL+ | Subir presupuesto diario 20%, con la nota: máx. 1 vez por semana y solo si sigue en verde; que el volumen de leads no rebase la capacidad del telemarketer (~140/mes, `capacidadTelemarketer`) |
  | AMARILLO | costo por SQL entre 4,000 y 6,000 MXN | Diagnóstico con los datos de la campaña en el rango (ver abajo) |
  | AMARILLO | costo por SQL ≤ 4,000 MXN pero 1 solo SQL+ (con los valores actuales siempre cae en muestra chica) | Mantener, no subir |
  | ROJO | costo por SQL > 6,000 MXN, o inversión ≥ 8,000 MXN con 0 SQL+ | Pausar |
  | ROJO con < 50% de leads **trabajados** (`minTrabajados`) | igual que ROJO, pero la mayoría de sus leads siguen en "Nuevo lead" | Revisar seguimiento antes de pausar (con la nota en la celda). Si están trabajados y no contestan, sigue siendo Pausar: el problema es la calidad del lead |
  | EN EVALUACIÓN (gris) | inversión < 8,000 MXN y sin SQL+ | Mantener (muestra chica) |

  **Diagnóstico del AMARILLO** (Dirección, 9-oct-2026; `lqDiagAmarillo`): tasa SQL = SQL+ ÷
  leads y CPL = inversión ÷ leads de la campaña en el rango.
  · tasa SQL < 10% (`tasaSqlMin`) → **Optimizar calidad**.
  · CPL > 400 MXN (`cplMax`) → **Optimizar costo**.
  · Si pasan las dos, "Optimizar calidad y costo". Siempre: "No tocar presupuesto ni puja.
    Un cambio a la vez; reevaluar en 7 días."
  Como costo por SQL = CPL ÷ tasa SQL, con 4,000 = 400 ÷ 10% todo amarillo cae en al menos
  una causa. Qué hacer en cada caso lo arma `lqRecomendar` (abajo). Todos los umbrales viven
  en `LQ_SEMAFORO`.

  **Recomendaciones concretas** (Dirección, 9-oct-2026; `lqRecomendar`). Regla general para
  todo lo que el reporte recomienda: nunca una instrucción genérica.
  1. **Objeto exacto**: plataforma › campaña › conjunto › anuncio, o la keyword en Google
     (ej. "Pausar el conjunto EN_LLAMADA_ESCAPE", con su ruta debajo).
  2. **Evidencia en la misma línea**: gasto, leads, SQL+ y CPL / costo por SQL del rango
     ("— gasto 4,000 MXN, 8 leads, 0 SQL+, CPL 500 MXN"). Los leads del CRM se cuelgan del
     conjunto (los anuncios mandan `utm_content={{adset.name}}`): por anuncio se usan los
     leads que reporta la plataforma y se dice ("SQL+ sin dato por anuncio", o "0 SQL+ (todo
     su conjunto)").
  3. **Muestra mínima para pausar**: gasto ≥ `muestraPausa` × `cplMax` = 2 × 400 = **800 MXN**
     en el rango. Si nada llega: "Sin muestra suficiente para pausar; esperar." + cuál es el
     de más gasto.
  4. **Datos que el reporte no tiene** (frecuencia, términos de búsqueda, calidad del
     creativo, preguntas del formulario, velocidad de la landing): lo dice y dónde verlo
     ("revisar en Meta Ads › Anuncios › columna Frecuencia").
  5. **Creativos / landing**: nombra el anuncio a reemplazar y la URL a la que lleva hoy
     (`website_destination_url`; "http://fb.me/" = formulario instantáneo).
  6. **CBO**: al pausar un conjunto (o el único anuncio de un conjunto) en Meta, nota de que
     con presupuesto de campaña Meta reasigna ese dinero y el gasto total no baja.
  7. **Máximo 3 acciones** (`maxAcciones`) por campaña, de mayor a menor impacto (MXN en
     juego), y el pie "Un cambio a la vez; reevaluar en 7 días."

  | Acción | Qué recomienda, con objeto y evidencia |
  |---|---|
  | Subir presupuesto diario 20% | Presupuesto diario de la campaña **de X a Y MXN** (CBO de Meta o presupuesto de Google, de Windsor) y la ruta para cambiarlo; leads/mes de hoy vs. con +20% contra la capacidad del telemarketer (~140/mes) |
  | Optimizar calidad · Meta | Pausar el conjunto activo con 0 SQL+ y más gasto (≥ 800 MXN, si la campaña tiene más de uno) + nota CBO; preguntas de presupuesto y plazo en la landing (URL) o el formulario instantáneo del conjunto con peor tasa SQL; quitar Audience Network de los conjuntos que gastaron ≥ 800 MXN ahí |
  | Optimizar calidad · Google | Pausar las keywords con > 2,000 MXN y 0 SQL+ (leads por `utm_term`; si el CRM no trae la keyword, revisar sus conversiones antes de pausar); negativas desde los términos de búsqueda de la keyword con más gasto (ruta en Google Ads) |
  | Optimizar costo | Pausar los 2 anuncios activos con peor CPL (> 400 MXN, gasto ≥ 800, con SQL+ que se sabe en 0 —si su conjunto trae SQL+ y el CRM no dice de qué anuncio, no se pausa—, nunca el último activo de la campaña); 2 creativos nuevos para reemplazar el peor (o junto a él), con su URL; revisar la landing cuyo CPL pasa de 400 MXN y peor convierte clics en leads |
  | Pausar (ROJO) | Pausar la campaña con su evidencia y ruta; si algo adentro está dentro de la meta, decirlo como alternativa |
  | Revisar seguimiento | Cuántos leads sin trabajar tiene cada asesor (y desde cuándo) y en qué etapa; reevaluar en 7 días y, si sigue en rojo, pausar |
  | ⚠ CPL al alza | El conjunto (Meta) o la keyword (Google) que más subió el CPL en las semanas que tocan los últimos 7 días contra las previas de los 30 (sin el conjunto que ya se recomienda pausar), y dónde ver la causa (Frecuencia en Meta, términos de búsqueda en Google; si es la misma keyword de las negativas, se vuelven una sola acción). Siempre entra entre las 3 |

  Solo salen en **Conclusiones** (desde el 9-oct-2026 la exploración ya no muestra
  acciones) y la IA las recibe ya calculadas. Muestra chica sin alerta: sin acciones. Las
  reglas de todas: ruta exacta del objeto, evidencia en la misma línea (de la ventana de
  decisión), cálculo por anuncio **dentro de su conjunto** (el mismo creativo en dos
  conjuntos son dos anuncios), 800 MXN mínimo por anuncio para recomendar pausarlo (si no,
  "Sin muestra suficiente para pausar; esperar."), máximo 3 acciones y "Un cambio a la vez;
  reevaluar en 7 días." "Subir 20%" dice además qué anuncio/conjunto sostiene el resultado.
  Frecuencia > 3 en un anuncio activo → renovar ese creativo (nombrado).

- **Decisión de hoy (Conclusiones)** — Dirección, 9-oct-2026. Conclusiones ya **no depende
  del filtro de fechas**:
  - **Ventanas fijas** (hora de Tulum): semáforo y acciones = últimos 30 días cerrados
    (hoy−30 a ayer); tendencia y alerta ⚠ = últimos 7 días cerrados contra los 7 anteriores.
    Etiqueta fija: "Decisión de hoy — basada en <inicio> a <fin> (últimos 30 días). No
    cambia con el filtro de fechas."
  - **Solo campañas activas** llevan semáforo, acción y fecha de decisión. Las que dejaron de
    gastar dentro de los 30 días (o están pausadas en la plataforma) van en **Pausadas
    recientemente**: una línea con gasto, leads, SQL+, costo por SQL y fecha de pausa (último
    día con gasto), sin acción. Pausadas hace más de 30 días no salen.
  - **Fecha de decisión** = la más tardía de: último cambio + 7 días; la fecha estimada en
    que el gasto de los últimos 30 días llega a 8,000 MXN al ritmo del promedio diario de los
    últimos 7 (simulada día por día porque la ventana es móvil: si a ese ritmo no llega en 30
    días, no hay fecha y lo dice, con el presupuesto diario si tampoco alcanza); inicio + 7
    días. Si ya pasó: "<Acción> — Decidir hoy"; si no: "<Acción> (preliminar) — Decisión el
    <fecha> (faltan N días): <motivo>".
  - **Último cambio**: Meta no expone "última edición significativa" en Windsor
    (`adset_learning_stage_info` solo trae LEARNING/SUCCESS/FAIL), así que se usa lo más
    reciente de `ad_created_time`, `adset_created_time` y `adset_updated_time`. Google no da
    fecha de inicio ni historial de cambios (inicio = primer día con gasto). Para los dos
    manda también la **bitácora** (fecha, campaña, cambio, motivo; kv `lq:bitacora:v1`,
    formulario al pie de Conclusiones; quien registra queda guardado) y se toma lo más
    reciente de ambas fuentes.
  - **✓ Hecho / ✗ Ignorar** (Dirección General, 15-oct-2026). Cada recomendación que es un
    cambio de campaña (subir presupuesto, pausar conjunto/anuncio/keyword/campaña, preguntas en
    el formulario, quitar Audience Network, negativas, creativos nuevos o renovados) trae dos
    botones; los avisos (capacidad del telemarketer, revisar, trabajar leads, "en 7 días…") no.
    **✓** la registra sola en la bitácora (fecha de hoy, cambio = la recomendación, motivo = su
    evidencia, quién) y con eso la campaña entra en "esperando 7 días"; se puede **deshacer** el
    mismo día (quita la entrada). Desde el día siguiente se **verifica** contra Windsor: si se
    marcó subir el presupuesto y sigue igual, o pausar algo que sigue activo, sale "⚠ marcada
    como hecha, pero en Meta…". **✗** pide un motivo opcional y la oculta 7 días o hasta que
    cambie el semáforo de la campaña (las recomendaciones salen de 30 días: sin cambio, mañana
    saldría igual); van en "Ignoradas (N)" con "volver a mostrar". Clave = plataforma + campaña +
    tipo de recomendación sin números, así que la misma recomendación con montos nuevos (tras
    subir el presupuesto) sigue siendo la misma. Estado compartido en kv `lq:recs:v1`.
  - **Foto diaria de Meta y Google** (`netlify/functions/lq-foto.js`, función programada de
    Netlify a las 12:00 UTC = 7:00 hora Tulum, `netlify.toml`). Windsor no trae historial de
    cambios, así que cada mañana se guarda el estado de los últimos 7 días (`lq:foto:v1`:
    campañas con estado y presupuesto; conjuntos con presupuesto; anuncios con estado, URL y, en
    Google, aprobación; keywords de Google con gasto) y se compara con la foto anterior. Lo que
    cambió va a `lq:cambios:v1` y la bitácora lo muestra como "Detectado en Meta/Google (foto
    diaria)", con fecha = el día anterior a la foto ("entre el X y el Y" si faltó alguna).
    Cuenta para la fecha de decisión salvo las keywords que empiezan o dejan de gastar
    (`cuenta:false`: puede ser solo volumen). Pausar una campaña o un conjunto no se anota
    anuncio por anuncio (CAMPAIGN_PAUSED / ADSET_PAUSED); el conjunto pausado se anota una vez.
    Lo que dejó de salir en Windsor no se da por pausado. No detecta textos o creativos editados
    dentro de un anuncio que ya existía. Sin env vars nuevas (usa `WINDSOR_API_KEY` y el kv);
    la corre el programador de Netlify (`next_run`) o un admin con su sesión. Prueba:
    `node scripts/test-lq-foto.js`.
  - **Atender hoy** (arriba de todo, ignora la fecha): anuncio rechazado (Meta
    DISAPPROVED/WITH_ISSUES, Google DISAPPROVED), gasto detenido (0 MXN ayer con gasto los 7
    días previos) y medición rota (la plataforma reporta 2+ leads en 3 días y al CRM no llegó
    ninguno). Windsor solo trae anuncios con entrega: uno rechazado que nunca se publicó no se
    ve. Orden: Atender hoy → Decidir hoy → Preliminares (fecha más cercana primero) →
    Pausadas recientemente.
  - **Exploración** (selector de semanas): solo explora; el color por campaña dice
    "histórico", no hay acciones y un aviso discreto dice "Estás viendo <rango>. La decisión
    de hoy está en Conclusiones."
  - Datos: acción **`decision`** de `lead-quality` (reemplazó a `adsExtra`), con la ventana
    calculada en el navegador. Meta: estado, inicio, presupuesto (CBO = `campaign_daily_budget`
    en centavos o `campaign_lifetime_budget` en unidades > 0; si no, `adset_daily_budget` /
    `adset_lifetime_budget`), último cambio, por anuncio gasto/resultados/clics/impresiones,
    `frequency`, `website_destination_url` y 7 vs 7, Audience Network por conjunto
    (`publisher_platform`) y gasto/resultados diarios. Google: estado y motivos, aprobación
    del anuncio, `ad_final_urls`, presupuesto (`budget_amount`, MXN), keywords 30 días y 7 vs
    7, diarios. Cada consulta con tope de 7.5 s; lo que no llegue se lista en `faltan` y la
    acción dice dónde verlo. **No pedir estos campos en `ads`**: el 9-oct-2026 se agregaron a
    la consulta del detalle por anuncio, se volvió lenta y la sincronización se quedó sin
    anuncios ("Sin datos de anuncios en el rango"). Agregado `lq:agg:v22`, IA `lq:ia:v12:`.
  - **Gasto no disponible** (Dirección, 10-oct-2026): un conjunto o anuncio con leads y gasto
    0 o nulo en Windsor es un dato faltante, no gasto real. Sale como "gasto no disponible",
    sin CPL ni costo por SQL, en una nota aparte de las acciones, y no entra en ninguna decisión
    (qué conservar, qué pausar, qué sostiene el resultado, landing). Si no llegó la consulta de
    30 días de Meta (`decision` devuelve `detalle30: false`; antes solo quedaban los anuncios de
    ayer y hoy, con gasto 0, y se les colgaban todos los leads), las recomendaciones de conjunto
    o anuncio dicen "Sin detalle de Meta en esta sincronización; revisar en Meta Ads" con qué
    buscar ahí, y la IA no recibe anuncios de Meta. Una campaña de un solo conjunto solo le
    cuelga sus leads a ese conjunto si tiene gasto.

  **Muestra chica** (inversión < 8,000 MXN): el color se calcula igual, pero la acción es
  siempre **"Mantener (muestra chica)"**: nunca "Subir presupuesto 20%" ni "Pausar"
  (Dirección, 8-oct-2026). La lectura automática agrupa por acción, no por color.
  Filas sin inversión (orgánico, "sin campaña") no tienen semáforo.
- **Columnas por campaña** (Calidad de Lead y Reporte Combinado): Inversión · Leads CRM ·
  CPL · % trabajados · % contactados · CQL · MQL · **SQL+ · Zoom realizado · OPP · WON** · Costo por SQL ·
  Semáforo, y dos totales: **Total pagado** (solo campañas con inversión, con su costo por
  SQL) y todos los leads del rango.
- **Nombres de los SQL+** (Dirección, 13-oct-2026): al pasar el mouse sobre la cifra de SQL+
  (subrayado punteado) sale una nota con los nombres de esos leads, SQL Selvadentro primero;
  en celular se abre al tocar la cifra. Vale en cualquier fila (campaña, conjunto, anuncio,
  totales) y en la columna SQL+ por conjunto de Datos de campañas. Los nombres solo se
  pintan en el navegador (`lqSqlpTip` / `lqTip`); no van al análisis con IA.
- **Embudo canónico** Lead → CQL → MQL → SQL → Zoom realizado → OPP → WON, del cohorte de
  leads del rango y por lead (no por oportunidad). **Zoom realizado** = etapa "Zoom
  realizado" o una posterior del embudo (OPP y WON incluidos); las etapas de tour/visita y
  las cubetas que no son embudo no cuentan. Es la etapa actual: el CRM no da historial.
- **% trabajados** = leads que ya salieron de "Nuevo lead (no contactado)": cualquier etapa
  posterior, también "Sin respuesta", toques, Ultimátum, Rescate o Descalificado. Si es
  bajo, el problema es de seguimiento, no de la campaña.
- **% contactados** = hubo conversación: Contacto establecido, Interés identificado,
  Nurturing, Zoom agendado / no show / realizado, Largo plazo, OPP, Carta oferta, WON o
  cualquier etapa posterior al contacto. "Sin respuesta" y los toques sin respuesta NO
  cuentan. Trabajados altos con contactados bajos = los leads no contestan (calidad del
  lead). Las dos salen de la etapa del pipeline (9-oct-2026; antes era una sola columna que
  mezclaba las dos y contaba citas y tags de respuesta aunque el lead siguiera en "Sin
  respuesta"). Un lead sin oportunidad usa los tags: toque sin respuesta = trabajado,
  respuesta = contactado.
- **Alerta de CPL** ⚠ (solo visual, no cambia el semáforo; solo en Conclusiones): CPL de los
  últimos 7 días cerrados más de 30% arriba del de los 7 anteriores, con el conjunto (Meta) o
  la keyword (Google) que más lo subió.
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
- **Re-envíos de formulario** (Dirección, 13-oct-2026): un contacto que YA existía y vuelve a
  llenar un formulario no es contacto nuevo: el webhook de la landing lo actualiza (utm_campaign,
  utm_content, tags) y el reporte, que contaba por fecha de alta, no lo veía (dos re-envíos del 9 y el
  11-oct a INVESTORS_US/CA_ESCAPE_090926 salían como 0 leads CRM). Acción **`reenvios`**:
  contactos actualizados en la ventana y dados de alta antes de ella (`dateUpdated` + `dateAdded`;
  si GHL rechaza el rango abierto de alta, filtra el backend). Todos los contactos traen `up`
  (dateUpdated). `opps` acepta `contactIds` (sus oportunidades son anteriores a la ventana).
  - **Fecha**: el campo del contacto "Fecha último formulario" / `submitted_at` si existe
    (`LQ_RX_ULT_FORM`). La landing de seguridad YA manda `submitted_at` en el webhook, pero el
    flujo de GHL no lo guarda; hasta mapearlo se usa `dateUpdated`, marcada como aproximada.
  - **Cuándo cuenta**: con fecha exacta, si cae en otra semana que el alta. Con fecha
    aproximada, solo si el contacto se dio de alta ANTES del inicio de la campaña que hoy trae
    (esa utm_campaign solo pudo llegar con un formulario nuevo) y la campaña empezó dentro de la
    ventana (inicio = `campaign_start_time` de Meta o primer día de gasto). Sin utm_campaign en
    el contacto no cuenta. Atribución: los utm_* del contacto (los del último formulario), no la
    attributionSource de su primera visita.
  - **Dónde**: `agg.reenvios` (fuera de `agg.leads`: Ventas, Dirección y Diagnóstico no los
    ven); `lqVista` los suma a Calidad de Leads. Leads CRM muestra "N re-envíos" debajo; CPL
    muestra total y nuevos; la lista de leads los marca "Re-envío" (con alta y fecha del
    re-envío); Conclusiones dice "(N re-envíos)" y "CPL … (nuevos …)"; la IA los recibe.
    "Medición rota" cuenta los re-envíos: solo salta si después del cruce el CRM sigue sin
    leads de la campaña. Agregado `lq:agg:v23`.
- **Atribución inferida** (`LQ_INFERIDA`): leads con origen `landing-seguridad`
  (seguridad.selvadentrotulum.com) **sin utm_campaign y creados antes del 08-oct-2026**
  se asignan a `INVESTORS_MX_DYNAMIC-TOPLPS_090926`, conjunto SEGURIDAD_PATRIMONIO, con la
  marca "N con atribución inferida". Desde el 08-oct llegan con UTMs reales y manda el UTM.
- **Leads de brokers fuera de Calidad de Leads** (Dirección, 9-oct-2026): el contacto con
  una oportunidad en el pipeline **"Brokers - Producción (B2B2C)"** (cualquiera de sus
  oportunidades) o con **cualquier etiqueta que empiece con "broker"** (`broker`,
  `broker-client`, `broker-signup-web`…, sin importar mayúsculas; antes solo `broker-client`,
  y los contactos dados de alta a mano con la etiqueta `broker` caían en "Otra fuente ·
  (sin campaña atribuida)" — Dirección, 14-oct-2026; `lq:agg:v24`) lo sube el equipo comercial y no viene de
  marketing, así que sale de TODOS los cálculos de la sección: leads, SQL+, Zoom, OPP, WON,
  CPL, costo por SQL, semáforo, totales, lectura automática, alertas y la IA (`LQ_BROKER`,
  `lqVista`). El pipeline "Brokers - Expansión y activación" (reclutamiento) no cuenta como
  broker. Siguen en el agregado marcados `bk`, así que **Ventas, Dirección y Diagnóstico los
  siguen contando**. La nota "Excluidos de todos los cálculos en este rango" (Calidad de Lead
  y Reporte Combinado) dice cuántos hay, junto a los registros de prueba y los sin email ni
  teléfono, ahora contados en el rango que se lee y no en las 12 semanas sincronizadas. Al
  pasar el mouse sobre "N leads de brokers" salen sus nombres y cuántos leads tendría cada
  fila con ellos → sin ellos, y "Todos los leads del rango" (`lqNotaBrokers`), para auditar.
  Desempeño de Ventas usa la misma regla de etiqueta (R-03, abajo) con su propio pipeline.
- **OPP vigentes, OPP generadas y Verificado por ventas** (Dirección General, 15-oct-2026;
  `lq:agg:v25`). La columna OPP leía solo la etapa **de hoy**: una OPP que se caía a Largo
  plazo, Rescate o Descalificado dejaba de contar y la campaña aparecía con menos OPP de las
  que generó (W32–W41: 5 en Calidad de Leads contra 9 en el reporte de Ventas de Paid
  Orgánico).
  - **No hay historial de etapas**: GoHighLevel (API v2) y Windsor solo dan la etapa actual de
    cada oportunidad y la fecha de su último cambio (`lastStageChangeAt`); el sistema no tenía
    tabla, webhook ni fotos de etapas por oportunidad. Orden real del pipeline "Seguimiento
    de ventas" (leído de GHL el 15-oct-2026): 0 Nuevo lead … 15 Cotización enviada, **16
    Seguimiento de OPP, 17 Carta oferta, 18 Apartado, 19 WON**, 20 Largo plazo, 21 Rescate,
    22 Corretaje, 23 Nurturing, 24 Descalificado, 25 Redes sociales. No existe "Venta
    cerrada": el cierre es WON. La regla de OPP de siempre (`lqOppThresholds`) da justo 16–19.
  - **Lo más simple**: la marca la pone el CRM. Un workflow de GHL agrega la etiqueta
    **`opp-generada`** al contacto cuando su oportunidad entra (o se crea) en Seguimiento de
    OPP, Carta oferta, Apartado o WON, y nadie la quita. Backfill de una vez en el CRM: las
    OPP vigentes se etiquetan en bloque y las caídas anteriores a mano, desde las notas de
    ventas. Workflow activo desde el **15-oct-2026** (`LQ_OPP_REGISTRO_DESDE`): ese día se
    etiquetaron 8 OPP vigentes, 11 WON y 11 OPP caídas a mano (3 del rango W32–W41).
  - **OPP vigentes** (`l.o`) = etapa de hoy, igual que antes. **OPP generadas** (`lqEsOppGen`)
    = vigente, venta (`l.w`) o etiqueta `opp-generada` (`LQ_TAG_OPP_GEN`, sin importar
    mayúsculas); por construcción nunca es menor que las vigentes. Debajo de la cifra, "N
    caídas"; al pasar el mouse, quiénes y en qué etapa están hoy (`lqOgTip`).
  - **SQL+ → OPP generadas** = de los SQL+ de la fila, cuántos generaron OPP: "7 de 11 ·
    63.6%" (`lqDeDen`), siempre con conteo y denominador; con 0 SQL+ dice "0 de 0 · —". Las
    OPP generadas que no son SQL+ (causa inválida, o el campo del CRM las califica distinto)
    quedan fuera del numerador y la celda lo dice.
  - **Nivel de una OPP generada** (Dirección General, 15-oct-2026; `lq:agg:v27`,
    `lqNivelOppCaida`). La pregunta es si el lead era bueno, no si ventas lo cerró:
    vigente o WON → SQL Selvadentro; caída a **Rescate**, **Nurturing**, perdida u otra etapa
    viva → **SQL Selvadentro** (tenía perfil y no se cerró; Nurturing solo dice que pasó a
    seguimiento automático); caída a **Largo plazo** → **SQL** (el horizonte ya no es el del
    perfil); **Descalificado** según la causa capturada: "Ya no
    interesado" o sin causa → SQL Selvadentro (sin causa sale en el aviso para que ventas la
    capture), "No alineado" → SQL, "Malinterpretó la campaña" → MQL, causa del grupo inválido
    (`l.inv`) o tag inválido (`LQ_TAGS_INVALIDO`: número equivocado, spam, duplicado) →
    Descalificado. Cuenta también como
    contactado y trabajado, pero **no como Zoom realizado**: el cliente puede llegar a OPP
    directo de un recorrido sin Zoom, así que puede haber más OPP generadas que Zooms.
  - **Respuesta real del lead** (Dirección General, 16-oct-2026; `LQ_RESP_V2 = true`,
    `lq:agg:v29`, `sla:agg:v19`, caché `lq:resp:v2`). La etiqueta `another-device-replied-whatsapp` la pone la integración de
    WhatsApp cuando **nosotros** mandamos un mensaje desde el celular de la línea (confirmado con
    un lead: se agregó el mismo minuto que salió nuestro audio "Sent from another device"), y
    `LQ_TAGS_RESP` la contaba como respuesta del prospecto. Ahora:
    1. "Respondió" = un **mensaje entrante** del contacto en la conversación (WhatsApp, SMS,
       email o redes; sin el texto predeterminado de nuestros botones ni respuestas
       automáticas, `esPlantillaEntrante`), una **llamada contestada de más de 30 s**, una cita
       asistida o una **etapa que ya dice que contestó** (Contacto establecido, Interés
       identificado, Zoom, Tour, Cotización…: el registro del asesor). Las etiquetas ya no
       cuentan. La evidencia de la conversación la lee la acción `respuestas` de
       `lead-quality` en cada sincronización (10 contactos por llamada, del mensaje más nuevo al
       más viejo, para en la primera evidencia) y se guarda en el kv `lq:resp:v2`: una
       respuesta encontrada no se vuelve a pedir; sin respuesta se revisa de nuevo a las 6 h.
       También cuenta una **nota del asesor** que dice que sí habló con el lead por otro lado
       ("hablé con él", "platicamos", "me dijo que…"; "no contestó" o "buzón" no cuentan, ni las
       notas de un workflow sin usuario): se lee de `/contacts/{id}/notes` cuando la
       conversación no trae respuesta.
    3. **CQL solo con escalera completa** (16-oct-2026): un lead que no contestó es CQL solo si
       ventas completó la escalera de Desempeño (5 llamadas manuales + WhatsApp o SMS + email;
       con "sin llamada", 1 mensaje + 1 email). La acción `respuestas` cuenta esos intentos en
       la conversación (los WhatsApp "Sent from another device" del celular de la línea cuentan;
       los automáticos no). Si la escalera no está completa, el lead se queda en **MQL** (no
       sabemos si es malo) con la marca `mse`: la celda de MQL dice "N sin escalera" y Desempeño
       lista por asesor los **MQL sin escalera completa** con lo que le falta a cada uno.
       "Oportunidad creada y movida del arranque" ya no hace MQL por sí sola. Nuevo (nadie lo ha
       tocado) sigue igual.
    2. **Regla hacia abajo**: en Nurturing, Largo plazo, Rescate o Sin respuesta, un lead que
       nunca llegó a OPP no sube a SQL por el formulario; queda en MQL si respondió y en CQL si
       no. Una cita asistida o agendada lo sigue haciendo SQL (no es el formulario).
    - **Desempeño** (índice de calidad 1–5) usa la misma regla con la evidencia de su propio
      barrido: primer entrante real o contacto efectivo (`fi`), último entrante (`li`) o una
      llamada de 90 s o más (`c90`), y su escalera (`breakup`).
  - **Verificado por ventas** = el campo del contacto **"Lead to Watch"** en Sí: la
    verificación de ventas de que el lead está calificado. Es informativo, no cambia la
    calificación. Si el campo no existe en GHL, el reporte lo avisa.
  - Columnas en todas las tablas de calidad (campaña, conjunto, anuncio, plataforma, Reporte
    Combinado y totales), tarjetas de Calidad de Lead, Mes contra mes, leyenda de siglas,
    metodología, glosario de Diagnóstico y prompt de la IA (`oppGen`).
  - **Aviso "Histórico incompleto"** (`lqAvisoOppGen`): mientras `LQ_OPP_REGISTRO_DESDE`
    esté vacío dice que el workflow aún no está activo; con la fecha de activación, sale solo
    si el rango empieza antes ("Histórico incompleto antes del …"), porque antes de esa fecha
    una OPP caída solo cuenta si ventas la etiquetó a mano. En Calidad de Lead además nombra
    las OPP caídas que sí cuentan y las OPP vigentes sin Lead to Watch, para que ventas las
    verifique.
- **Aviso de leads sin campaña**: cuenta exactamente los leads de las filas
  "(sin campaña atribuida)" de la tabla (antes contaba aparte los de Meta/Google con
  utm_campaign vacío y no cuadraba: decía 1 de 60 con 10 en la tabla).
- **Leads que sí sabemos de dónde vinieron** (Dirección General, 17-oct-2026; `lq:agg:v30`→`v31`,
  caché `lq:wa1:v1`). Tres reglas para que no caigan en "(sin campaña atribuida)":
  1. **Social orgánico · Instagram / · Facebook** (`lqRedOrganica`): utm_medium `social` (del
     campo del contacto o de la atribución) o referrer `l.instagram.com` / `l.facebook.com`, sin
     FBCLID ni utm_campaign ni ID de campaña. La red sale de utm_source (`ig` / `fb`) o del
     referrer. Fuente "Social orgánico / directo": no entra al costo por lead ni al costo por
     SQL de ninguna campaña ni de Meta. El backend guarda ahora `attr.ref` (host del
     referrer) y `attr.fbc` (FBCLID en la atribución o en la URL).
  2. **WhatsApp después del formulario**: a los contactos que creó WhatsApp sin origen
     (`lqWaSinOrigen`: atribución o campo Medium `whatsapp`, o etiqueta "inbound whatsapp", sin
     campaña, ID, utm_source ni fuente; "Social media" en Session source es la categoría que GHL
     pone sola y no cuenta como origen) se les lee el **primer mensaje entrante** (acción `primerMensaje`,
     caché en el kv `lq:wa1:v1`: uno encontrado no se vuelve a pedir; sin mensaje, se reintenta
     a las 6 h). Sin ref (con el mensaje ya leído) es WhatsApp directo: "Social orgánico · IG /
     WhatsApp" (`wa0`); si el mensaje no se pudo leer, sigue sin campaña hasta la próxima
     sincronización. Si trae `(ref: CAMPAÑA)`, esa es su campaña (`wref`). Si además el "Soy X" /
     "I am X" (`lqNombreSoy`) está en el nombre de un lead de formulario de esa campaña creado
     en las 24 h anteriores (`lqDuplicadoWa`; si hay varios, el más cercano), es un
     **duplicado por WhatsApp**: sale de todos los totales (`agg.dupWa`) y se lista aparte,
     debajo de la línea de excluidos, para unirlo en GoHighLevel.
  3. **Pruebas e internos**: fuera de todos los cálculos el contacto cuyo nombre, email o primer
     mensaje diga "prueba(s)" o "test(s)" como palabra (no "latest" ni "testimonios"), y el que
     tiene correo **@selvadentrotulum.com** (equipo interno); cuentan en "registros de prueba o
     internos" de la línea de excluidos. El primer mensaje solo se lee de los
     contactos de WhatsApp sin origen.
- **Limpieza**: la matriz "Reglas automáticas vs. captura del equipo" queda detrás del
  botón **Ver diagnóstico de reglas**; la tabla de inversión por campaña de Calidad de Lead
  se volvió **Inversión por plataforma** (el detalle por campaña ya está en la tabla del
  semáforo, con la misma cuenta que el Combinado).
- **Conclusiones IA**: el prompt recibe el semáforo ya calculado y devuelve una acción por
  campaña (subir 20% / mantener / optimizar / pausar) con la regla que la justifica; la
  tabla de acciones se arma con el semáforo aunque no se haya corrido la IA, y si la IA
  propone otra acción manda el semáforo. Cada campaña llega con sus acciones concretas
  (`recomendaciones`, `esperar`) y el prompt exige el objeto exacto, no inventar objetos,
  la muestra mínima, dónde revisar lo que falta y la nota CBO. Desde el 9-oct-2026 recibe la
  decisión de hoy (ventana fija, fecha de decisión, Atender hoy) y las pausadas aparte, sin
  acción. Gasto no disponible y "sin detalle de Meta" llegan marcados. Cache `lq:ia:v12:`.
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
- **Cache compartido**: agregado en el kv (`lq:agg:v33`), staleness de 30 min, igual
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
  anuncios quedan plegados dentro de cada campaña. El pliegue va por **conjunto → anuncio**
  con el CRM al lado de la plataforma (Dirección, 12-oct-2026): **Leads CRM · SQL+**
  ("calificados" = SQL + SQL Selvadentro, la definición del semáforo) **· Zoom** (realizado)
  **· CPL CRM** (inversión ÷ leads CRM). El `utm_content` del lead se cruza SOLO contra su
  campaña: ID del anuncio (`{{ad.id}}` en Meta, `{creative}` en Google; se guarda como
  `adId` antes de traducirlo a nombre) → conjunto (hoy los 29 anuncios con gasto de Meta
  mandan `{{adset.name}}` y Google `{adgroupid}`) → nombre de anuncio que solo existe en un
  conjunto. Mientras el lead traiga el conjunto, el CRM va por conjunto y las celdas del
  anuncio salen en "—" (con el porqué); se llenan solas cuando llegue el ID. Lo que no cruza
  (sin `utm_content`, nombre de anuncio repetido en varios conjuntos o valor que no existe en
  la campaña) va en la fila **"Sin anuncio identificado"**, con el motivo; conjuntos + esa
  fila = Leads CRM de la campaña (lo dice la nota al pie). Antes el cruce era contra toda la
  cuenta y un valor que es nombre de conjunto y de anuncio a la vez
  (ES_LLAMADA_NUEVO6-ESCAPE_CENOTES) caía en el primer conjunto donde corría ese anuncio;
  Conclusiones tampoco le acredita al anuncio un lead cuyo `utm_content` es el conjunto;
  (2) **Calidad de Lead** — tabla por
  campaña desplegable a conjunto → anuncio con el semáforo; (3) **Reporte Combinado** —
  tarjetas Inversión total · Leads CRM · SQL+ · Costo por SQL · WON, lectura automática
  del semáforo, barras horizontales de inversión por campaña (un solo eje en MXN, nombre
  completo, SQL+ y costo por SQL escritos y la barra del color del semáforo; antes era una
  gráfica de dos ejes cuyas etiquetas se encimaban), dona de distribución y la
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
  (el CRM tiene tres de presupuesto y dos de horizonte). **Respaldo** (23-oct-2026): si el
  canónico viene vacío se leen "Presupuesto / Budget" y "Horizonte de inversión / Investment
  timeline" (grupo "NO USAR – duplicados de Discovery"), porque el formulario de la landing
  de Google ("lotes-main-form") los guarda ahí; lo mismo en Desempeño (`lq:agg:v33`,
  `sla:agg:v20`). El arreglo de fondo es que su workflow en GHL escriba en los canónicos.
  Budget Range **mezcla MXN y USD
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

## Ventas → Reporte: saldos del pipeline y partes de un total (15-oct-2026)

- **Saldos** (`CAMPOS_SALDO`: OPP activas, OPP con next step + fecha, OPP >14 días): son una
  foto del pipeline, no algo que pasó en la semana; una OPP vive varias semanas y se reporta en
  cada una. En un rango ya no se suman: vale el **corte más reciente** de cada asesor/ciudad
  (su última semana capturada dentro del rango), y esos cortes sí se suman entre asesores. La
  celda dice de qué semana es el corte. Igual en Dirección (OPP >14 días) y en las Analíticas
  ("Última semana" en vez de "Total").
- **Partes de un total** (`paresParteTotal`): OPP de zooms / de tours / de 1:1 / externas no
  pueden superar a OPP (total) del canal, ni OPP con next step u OPP >14 días a OPP activas. La
  captura lo bloquea (como seguimiento > total) y el reporte lista las semanas ya capturadas que
  no cumplen, para corregirlas en Ingreso de datos. Zooms + tours por encima del total solo avisa
  (una OPP con zoom y tour debe contarse en una sola).

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
    horario, igual que esa). Ya no tiene tarjeta arriba (Dirección General, 14-oct-2026: salía
    con la misma cifra que la de 1er toque cuando todos los leads empezaban por llamada).
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
  - **Medianas auditables** (Dirección, 13-oct-2026): el análisis semanal comparó "5 min"
    de Escape US/CA (la mediana de UN solo lead: 11 de 12 entraron fuera de horario) contra
    "74 min" de MX Dynamic como si fuera una tendencia. Ahora cada mediana trae su **N**
    debajo (tarjetas y tablas) y con menos de `SLA_N_MIN` (5) sale en gris como "muestra
    chica, no comparar". Las tablas por grupo suman la columna **En horario** (cuántos
    leads entraron en horario —los únicos que entran en la mediana de 1er toque— y, de los
    de fuera, cuántos se atendieron antes de las 11:00), los **asesores** que atienden cada
    campaña/canal/pipeline y un **"ver leads"** con, por lead: entrada, horario, asesor,
    hora y canal del 1er toque, tiempo, si entra en la mediana (y por qué no) y contacto
    efectivo. "≤15m/≤60m" dicen en su ayuda sobre cuántos leads se calculan.
  - **P80 en vez de mediana para el 1er toque** (Dirección General, 14-oct-2026: "no lo
    quiero maquillar, lo quiero exigir"). La mediana garantizaba a la mitad de los leads: un
    rango salía con "2 min" de mediana y 52% de Velocidad (un 3), porque 6 de 11 leads rápidos
    bastaban y el resto podía tardar horas. Tarjetas y tabla por asesor muestran ahora el
    **P80** (`slaPctl`, rango más cercano): el tiempo en que se tocó al 80% de los leads, el
    mismo 80% que pide el 5 de Velocidad — P80 ≤ 5 min ⇔ al menos el 80% en ≤5 min. Respeta el
    horario igual que la mediana (con v1.1, solo leads que entraron en horario; fuera de horario
    sigue su meta de las 11:00 en su propia tarjeta). Diferencia clave: un lead **sin toque ya no
    sale de la base**, entra como el peor tiempo (`slaTToque` → `Infinity`; si son más del 20%
    el P80 dice "sin toque"); tocado antes de su alta = 0 min, cumplido como en Velocidad. El P80
    de 1ª llamada cuenta solo leads marcados (los demás van en "Sin marcar"). La mediana se queda
    solo en contacto efectivo (depende de que el lead responda) y en días a la cita. No cambia
    ninguna nota: Velocidad sigue siendo el % que cumplió.
  - **Tarjetas: de 16 a 8** (Dirección General, 14-oct-2026: "son muchas y algunas son
    irrelevantes"; "la meta de velocidad es 5 min, olvida lo de los 60 s"). Dos grupos de 4
    columnas (`.crm-kpis.k4`, 2 en celular): **Leads y velocidad** — Leads en el rango ·
    Velocidad (% que cumplió su SLA) · P80 1er toque · Fuera de horario antes de las 11:00 — y
    **Resultado** — Contactados efectivos · Tasa de agendamiento (con cita ÷ contactados efectivos
    o que agendaron) · Tasa de agendamiento sobre leads (con cita ÷ todos los leads del rango, con
    "1 de cada N leads"; pedida al lado de la tasa) · Show rate. Salieron: 1er
    toque ≤60 s (meta retirada), con 1er toque manual, con llamada conectada, contacto efectivo
    ≤15/≤60 min, mediana de contacto efectivo, P80 de 1ª llamada (siguen como columnas de la
    tabla por asesor), citas agendadas (columna "Agendadas" de Citas del periodo) y días a la
    cita (ya no se muestra en ninguna parte). La ficha de cada asesora no cambió.
  - **Tres bloques** (Dirección General, 14-oct-2026). La pantalla era una lista de ~20 secciones
    que mezclaba evaluar, actuar y auditar. Ahora: **Resumen** (tarjetas, ranking y ficha, sin
    cambios), **Qué corregir hoy** (solo listas con nombre) y **Detalle** plegado (tablas por
    asesor, canal, pipeline y campaña, citas, telefonía, embudo, etapas, diagnóstico de datos,
    definiciones). Las reglas v1.1 y el alcance van en una línea plegable que avisa "⚠ hay
    entradas del CRM por revisar" si falta alguna; el aviso de periodo anterior a la v1.1 queda a
    la vista. Los plegables recuerdan si se abrieron (`slaState.abierto`) aunque se vuelva a
    pintar. En "Qué corregir hoy", una sección sin nada que corregir no se pinta: su rótulo va a
    la línea "✓ Sin pendientes en: …" (`vacias`).
  - **Leads que bajaron la Velocidad** (`slaFallasVel`, primera lista de "Qué corregir hoy"):
    mismo criterio que la sub-nota, con un resumen por asesora ("3 de 7 · 1 sin toque · 2 tarde")
    y dos tablas: **Sin 1er toque** (con etapa y cuánto lleva sin toque: todavía se pueden tocar)
    y **Llegaron tarde** (hora del 1er toque, cuánto tardó y su meta: 5 min o antes de las 11:00).
  - **Exitosas ≥90 s** en Telefonía por asesora, después de Conectadas: llamadas manuales del
    asesor de 90 s o más (`cl.c90`, nuevo en el backend), con su % sobre los intentos y, al pasar
    el mouse, sobre las conectadas. `sla:agg:v18` fuerza a regenerar el agregado.
  - **Notas en las tarjetas** (Dirección, 13-oct-2026): al pasar el mouse sobre cada
    tarjeta de Desempeño (o tocarla en celular) sale qué cuenta exactamente, sobre qué base,
    qué queda fuera y por qué, con los números del rango (`lqNota`, misma nota flotante que
    los nombres de los SQL+). La de "Med. contacto efectivo" ahora también trae su N.
  - **Reloj desde el alta, siempre** (Dirección General, 14-oct-2026): el reloj del asesor
    arranca en el alta del lead en el CRM. Desde el 26-ago-2026 arrancaba en el "traspaso a
    ventas" (la creación de su primera oportunidad), pensado para leads que esperaban en
    marketing; hoy (hasta el 26-oct-2026) no hay Ejecutivo de Primer Contacto y el CRM asigna el
    lead al asesor desde que entra, así que no hay traspaso. Desde que arranca el puesto, el lead
    que él trabajó y entregó se mide desde la entrega (ver "Con el Ejecutivo de Primer Contacto"). Medir desde la oportunidad tenía dos fallas: el toque
    hecho antes de crearla quedaba "antes del reloj" y cada tarjeta lo contaba distinto (fuera
    de la mediana de 1er toque y del SLA de 60 s, cumplido en el de 5 min, 0 min en la de 1ª
    llamada: por eso un rango salía con 28 leads y 4 en la mediana), y crearla tarde escondía
    el tiempo entre la entrada y el primer toque. `sla:agg:v16` fuerza a regenerar el agregado.
    `slaAntesReloj` queda solo para un toque anterior al alta (contacto fusionado o importado);
    "ver leads" ya no lo llama "sin 1er toque".
  - **Campaña de origen = la de Calidad de Leads**: se toma por id de contacto del agregado
    de Calidad de Leads (ID de campaña, alias de UTM, atribución inferida), que ahora guarda
    el `id` de cada lead; si no está en memoria se lee del kv una vez. Sin él, la
    utm_campaign tal cual y la pantalla lo dice.
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
  barrido ya lee por contacto: **SLA de 60 segundos** de 1er toque desde la entrada del lead (la tarjeta decía "del Ejecutivo de Primer Contacto", puesto que hoy no existe —arranca el 26-oct-2026 con su propio reporte—: renombrada el 14-oct-2026)
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
    - **R-03**: **cualquier etiqueta que empiece con "broker"** (`broker`, `broker-client`,
      `broker-signup-web`…; hasta el 14-oct-2026 solo `broker` exacta, `sla:agg:v17`) o
      **cualquier** oportunidad en Brokers — Expansión y activación (antes: solo si TODAS
      vivían ahí) → "Error de asignación", fuera de todo. La lista dice qué etiqueta lo sacó.
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
- **Con el Ejecutivo de Primer Contacto** (desde su inicio, 26-oct-2026; Dirección, 13-oct-2026):
  el barrido recibe `excluir` = sus usuarios (de `pc:config:v1`) y sus toques **no cuentan como del
  asesor**. Los leads que siguen asignados al ejecutivo salen del ranking (se miden en Primer
  contacto) y se declaran en el alcance. A los que entregó se les mide **desde la entrega** —su
  contacto efectivo (`ex.fe`: llamada suya ≥90 s o respuesta del lead a su toque) o, si no hay, su
  último toque—, con el contacto efectivo del asesor como el primero que no es del ejecutivo
  (`efT`), y la llamada automática ya no cuenta como 1er toque del asesor (es del marcador del ejecutivo).
- **Permisos**: canal `crm_live` o `direccion_comercial` (o admin) — mismo gate en
  servidor y en el tab.
- Requiere scopes de conversaciones y calendarios en el token (el token actual los
  tiene todos); si faltan, esas columnas degradan a "—" sin romper el reporte.

## Primer contacto — Ejecutivo de Primer Contacto y Rescate (desde el 26-oct-2026)

Ventas → **Primer contacto** (`#/ventas/primer`). Mide el puesto contra la sección 10.1 del
**Manual Operativo de Primer Contacto y Rescate** (Dirección General, oct-2026); el número de
sección va junto a cada constante `PC_*` en `index.html` para saber qué tocar cuando el manual
cambie (se revisa cada trimestre). Backend: `netlify/functions/pc-report.js`.

**Antes de arrancar (lo que configura Dirección en el pliegue "Configuración del reporte",
clave `pc:config:v1`; solo `direccion_general` / `direccion_comercial` / admin la guardan):**
- **Ejecutivo**: el usuario de GoHighLevel con el que marca y escribe (hay que crearlo en GHL).
- **Inicio del puesto**: 26-oct-2026. El reporte real no mide nada anterior.
- **Marcador automático operando desde**: mientras esté vacío, la velocidad de 60 s es
  **informativa** (3.1: "no se evalúa ni se castiga mientras el marcador no esté operando").
- **Ventana operativa**: todos los días de 6:00 a 24:00 (Dirección, 13-oct-2026); de 0:00 a
  6:00 sale un mensaje automático y se marca a la apertura. Los leads de madrugada no entran al
  primer toque completo: se reporta si les llegó el mensaje automático en ≤10 min y si se les
  marcó en ≤15 min desde la apertura. **Días hábiles** (denominador de los puntos) aparte: lunes
  a viernes sin **festivos** (precargados los de ley 2026-27).
- **Cinco datos** (6.1), **motivo y fecha estimada de Largo plazo** (10.3) y **marca de cita
  calificada** (12.1, campo o etiqueta): se detectan por nombre y se marcan "detectado" hasta
  que alguien los guarda. Sin la marca de cita calificada la tasa de calificación sale "—".
- **Etiquetas de cartera** que ponga Sistemas (vencida / fría); sin etiqueta, la etapa.

**Ensayo**: el selector *Ejecutivo* permite correr el reporte con cualquier usuario actual
sobre semanas pasadas, para validar la medición con datos reales antes del 26. En ensayo la
entrega cuenta por etapa (el usuario es dueño de sus leads) y la recepción del asesor no aplica.

**Cómo se mide** (cada regla, con su sección):
- **Universo de lead nuevo** (1.1, 3.3): contactos creados en el periodo, sin referidos,
  brokers, prospección directa, alianzas ni legal (por pipeline) y sin registros de prueba.
- **Primer toque completo** — la "velocidad de primer contacto" del manual (3.1, 10.1), con el
  protocolo de Dirección (13-oct-2026). Se mide el trabajo de la **persona**, no del CRM, y se
  cumple de dos formas: la llamada automática del CRM conectó y hubo una llamada de ≥90 s, o la
  automática no fue exitosa (no conectó o duró menos) y el ejecutivo remarcó a mano en ≤2 min
  desde que terminó (`PC_REMARCA_MS`). Si la automática no entró, cuenta la llamada manual del
  ejecutivo en ≤60 s desde el registro. A qué tiempo entra la automática es de Sistemas y se
  reporta aparte. La automática de un lead nuevo es del puesto aunque el CRM la registre sin usuario.
- **Puntos de contacto (7.3)**: por prospecto y día, doble llamada (dos marcaciones ≤10 min,
  conectadas o no; la automática más la remarcación manual = 1) = 1; una llamada contestada = 1
  (la automática, solo si duró ≥90 s); una llamada sola sin contestar = 0; las que
  la línea no completó (failed, busy, canceled) no cuentan; mensaje manual por WhatsApp,
  Instagram, Facebook (y SMS, configurable) = 1 y correo propio = 1, con ráfagas de ≤10 min del
  mismo canal contadas una vez; tope 3 por prospecto al día. Promedio sobre días hábiles
  **cerrados** (el día en curso no entra). Fuera de los leads nuevos, solo suman las llamadas
  registradas con el usuario del ejecutivo; el diagnóstico dice cuántas automáticas llegan sin usuario.
- **Conversaciones ≥60 s** (candado del bono, 120/mes; en una semana, prorrateado por días hábiles).
- **Contacto efectivo** (Dirección, 13-oct-2026): llamada de ≥90 s —del ejecutivo o la automática
  del CRM—, igual que en Desempeño (`PC_EFECTIVO_SEG`); respuesta escrita del prospecto a un toque
  suyo **sin plazo**, mientras el lead siga siendo suyo (deja de contar si otro usuario tomó la
  conversación); o una sesión que él agendó. **Por registro del ejecutivo**, en línea aparte
  porque lo declara él y se audita con las grabaciones: la tarjeta movida después de su toque a
  Contacto establecido o más adelante, a Largo plazo con motivo o a Descalificado por "no
  alineado", o los cinco datos capturados. Las conversaciones del candado siguen en ≥60 s (7.3).
- **Lo que NO es respuesta del prospecto** (14-oct-2026), en Primer contacto y en Desempeño: el
  texto predeterminado de los botones de WhatsApp de nuestras páginas (landings, páginas de
  gracias, sitio, JJF, evento de Madrid) y las respuestas automáticas de su WhatsApp Business o
  correo. El prospecto da clic, manda el mensaje ya escrito y muchas veces nunca contesta; el de la
  página de gracias puede llegar después de la llamada automática. Se reconocen por frase
  (`PLANTILLAS_ENTRANTES` y `RX_AUTORRESPUESTA` en `sla-report.js`): si una página o un anuncio de
  Meta que abre WhatsApp cambia su texto, hay que agregarlo ahí. El diagnóstico dice cuántos se descartaron.
- **Cita sin conversación registrada**: cita del ejecutivo sin llamada de ≥90 s ni respuesta
  escrita en las 72 h previas. Cuenta igual, pero se lista: el manual exige confirmación verbal (6.1).
- **Pidió otro momento** (4.4): etiqueta `recontacto 1`, `recontacto 2` o `recontacto 3` (el
  intento en curso). Queda fuera del denominador de la conversión mientras tenga la etiqueta; al
  tercero sin agendar pasa a Largo plazo con su motivo y se le quita.
- **Leads que regresan** (10.4): contactos que ya existían y cuya **"Fecha último formulario"**
  (con hora) cae en el periodo; cuentan como lead nuevo desde esa hora, salvo que el formulario
  anterior ("Fecha formulario anterior", o el alta) sea de hace menos de 90 días.
- **Conversión a entrega (10.1, 10.3)**: la tarjeta en Contacto establecido o más adelante,
  movida **después** del contacto y asignada a un asesor. Largo plazo con motivo, fecha y tarea
  abierta con fecha sale del denominador; sin ellos, es fallo. Contactos de <7 días sin cierre
  quedan "en curso"; los que ya estaban con asesor (reconfirmación, 4.1) no cuentan.
- **Sesiones**: del ejecutivo si el CRM dice que él creó la cita (`createdBy`); si no lo dice,
  si él tocó al prospecto en las 72 h previas al agendamiento. Asistencia por prospecto (calendario
  o, sin estatus, la etapa); calificación con la marca configurada, "sin marca" después de 48 h
  se paga igual; cinco datos sobre las sesiones agendadas en el periodo. Matriz 10.2 con ≥5 casos.
- **Cadencia 6 toques en 7 días (3.4)** para el lead en silencio, break up y paso a Sin respuesta.
- **Cartera (cap. 7)**: prospectos tocados que no son lead nuevo (más de 8 días desde su alta),
  por segmento; orden de ataque vencida → fría.
- **Recepción del asesor (8.2)**: primer contacto manual ≤60 min tras la entrega y, si hubo
  sesión, contacto del asesor el mismo día del agendamiento. Con nombre del asesor.

**De dónde sale la cartera**: el CRM no dice qué conversaciones tocó un usuario, así que se
listan las conversaciones con **actividad manual** desde 3 días antes del periodo (orden por
último mensaje manual; si el API no lo acepta, por último mensaje) y se leen solo sus mensajes
de la ventana. El diagnóstico compara contra los leads del periodo (leídos aparte, por contacto)
cuántos aparecen en ese listado: si alguno falta, la cartera puede estar subcontada y lo dice.

**Caché**: `pc:agg:v1:<periodo>:<real|e-usuario>`; se regenera solo una vez al día (semana en
curso, modo real) al abrir la pestaña, o con *Generar reporte*. Permiso del canal: `pc_view`
("Primer contacto" en Admin) para dárselo al ejecutivo o a Gerencia sin abrir Desempeño.

**No mide todavía** (declarado): la transferencia en caliente de 15 min (el CRM no la distingue),
la confirmación de seminarios y el monto del bono (es de Contabilidad). Los leads que regresan
se miden en cuanto exista el campo "Fecha último formulario" con hora.

Pruebas: `node scripts/test-pc-report.js` (backend con GHL simulado) y el bloque
`pc:modelo` de `scripts/smoke-ui.js`, con la semana sintética de `scripts/pc-fixture.js`
y el resultado de cada indicador calculado a mano, incluida la sincronización completa.

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
