# Selvadentro Reportes — contexto para Claude

Este repo es TRABAJO DE CLIENTE para **Selvadentro Tulum** (cliente de la agencia
To The Max). La arquitectura, variables de entorno e historia de la migración de
seguridad están documentadas en [README.md](README.md) — mantenerlo al día.

## Regla dura: ubicación de datos
**Todos los datos, backends y servicios de Selvadentro DEBEN vivir en cuentas
propiedad de Selvadentro.** Nunca aprovisionar, almacenar ni migrar datos del
cliente a cuentas de To The Max (agencia) — ni siquiera temporalmente — sin
aprobación explícita en la conversación. Si la cuenta correcta no es accesible,
DETENERSE y pedir acceso; no sustituir la cuenta correcta por una disponible.

## Cuentas de Selvadentro (cliente)
- **GitHub**: org `selvadentromarketing-vibes` (este repo). La cuenta
  `tothemax-media` es solo colaboradora.
- **Netlify**: site `slvd-reportes` → https://team.selvadentrotulum.com. NO es
  visible desde el Netlify de la agencia; acceso solo vía el perfil de navegador
  autorizado por el cliente. Los pushes a `main` disparan builds (los minutos de
  build son limitados).
- **Supabase**: proyecto `vsnggxcuznleuvoyoenn` ("selvadentro-reportes", org
  `gilwalvexegyavkvcryj`) — aloja el backend `slvd_kv` (RLS + RPC). La tabla
  legacy `kv` del mismo proyecto está sellada (RLS, sin policies) y conserva los
  datos históricos pre-agosto-2026.
- **GoHighLevel**: location `crN2IhAuOBAl7D8324yI`.

## Cuentas de To The Max (agencia — NUNCA alojar datos del cliente aquí)
- **Netlify** team (tothemaxmedia.com, portal.tothemaxmedia.com, etc.).
- **Supabase** org `mqkmbhiexcbqvknukipu`:
  - "TTM Reporting App" (`ybydyeafnjduypzatpse`) — **base de datos de PRODUCCIÓN
    del portal de la agencia** (46+ tablas: clientes, sync de Facebook/GHL,
    leads). No crear, alterar ni borrar nada aquí por trabajo de cliente.
  - "Ads Studo", "bolt-native-database" (inactivas).

## Nota histórica
Ago 2026: durante el fix de seguridad, el backend `slvd_kv` vivió brevemente en
el proyecto "TTM Reporting App" de la agencia. El 2026-08-20 se migró al
proyecto del cliente y se eliminó todo objeto `slvd_*` (tablas, función, schema
`private`, filas del historial de migraciones) del proyecto de la agencia —
verificado limpio.

## Antes de cualquier acción de infraestructura (deploy, migración, env var, DNS, API key)
Declarar qué cuenta/proyecto es el objetivo y confirmarlo contra este mapa. Si
la acción crearía algo en una cuenta que no es del dueño de los datos, preguntar
primero.

## Convenciones de trabajo
- Responder con un TLDR primero; cuando el trabajo sea visible para el cliente,
  incluir un mensaje copiable en español (formato WhatsApp).
- Commits locales libremente; **NUNCA hacer `git push` a `main`** (= minutos de
  build de Netlify) hasta que el usuario diga push/deploy/ship. Ramas de trabajo
  que no disparan builds sí pueden pushearse para no perder trabajo.
- Mensajes de commit en español, descriptivos.
- Secretos solo en el `.env` local (gitignoreado) y en las env vars del site de
  Netlify del cliente — nunca en el repo ni en el cliente (navegador).
- Snippets de email/HTML van en el chat como bloques copiables, no como archivos.
