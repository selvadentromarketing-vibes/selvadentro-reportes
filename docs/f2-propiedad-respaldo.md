# Propiedad, exportación y respaldo del sistema de reportes (spec F2)

**Para:** Dirección General — Selvadentro (Juan Cámara)
**Objeto:** Sales Performance Report y sistema de reportes (team.selvadentrotulum.com)
**Fecha:** 5 de septiembre de 2026 · **Responde a:** spec v1.0, punto F2

## 1 · Quién es dueño de qué

Todo el sistema vive en cuentas propiedad de Selvadentro. Ningún dato del
cliente vive en cuentas de la agencia.

| Pieza | Dónde vive | Cuenta dueña |
|---|---|---|
| Código de la app | GitHub, repo `selvadentromarketing-vibes/selvadentro-reportes` | Org de Selvadentro (la agencia es solo colaboradora) |
| Sitio y backend (functions) | Netlify, site `slvd-reportes` → team.selvadentrotulum.com | Cuenta de Selvadentro |
| Base de datos (capturas, cachés, usuarios) | Supabase, proyecto `selvadentro-reportes` | Org de Selvadentro |
| CRM (la fuente de los datos en vivo) | GoHighLevel, subcuenta de Selvadentro | Selvadentro |
| Llaves y secretos | Variables de entorno del site de Netlify + `.env` local | Selvadentro (nunca en el repo ni en el navegador) |

Consecuencia práctica: si mañana se termina la relación con cualquier
proveedor o persona, Selvadentro conserva el código, el sitio, los datos y
los accesos. Nadie externo puede llevárselos ni dejarlos inaccesibles.

## 2 · Cómo exportar, sin pedirle permiso a nadie

- **El reporte como página**: cualquier usuario con sesión puede abrir el
  reporte y guardarlo (Imprimir → Guardar como PDF, o Archivo → Guardar
  página). No depende de ninguna cuenta ajena.
- **Los datos capturados**: la pestaña **Base de datos** exporta CSV y JSON
  por canal, con los botones que ya están en pantalla.
- **El código completo**: `git clone` del repo por cualquier miembro de la
  org de GitHub de Selvadentro.
- **La base de datos completa**: desde el panel de Supabase del proyecto
  (sección Database → Backups o un export SQL), con la cuenta de Selvadentro.

## 3 · Rutina de respaldo

| Qué | Cómo | Frecuencia | Quién |
|---|---|---|---|
| Código | Git: cada cambio queda versionado en GitHub automáticamente | Continuo | Automático |
| Datos (kv: capturas, usuarios, cachés) | Respaldo diario automático de Supabase (incluido en el proyecto) + export manual CSV/JSON desde Base de datos antes de cambios grandes | Diario / antes de cambios | Automático / Ty |
| Reporte semanal entregado | Guardar el PDF del lunes en la carpeta compartida del equipo | Semanal | Quien lo entrega |
| Configuración de Netlify (env vars) | Lista de variables documentada en el README del repo; los valores viven en Netlify y en el `.env` local | Al cambiar | Ty |

## 4 · Qué haría falta para restaurar todo desde cero

1. Clonar el repo de GitHub.
2. Crear un site en Netlify apuntando al repo y cargar las variables de
   entorno (la lista está en el README; los valores, en Netlify y el `.env`).
3. Apuntar el dominio team.selvadentrotulum.com al site.
4. Restaurar la base desde el respaldo de Supabase (o seguir usando el
   proyecto existente, que no depende del site).

Tiempo estimado de restauración completa: menos de una hora.

## 5 · Verificación pendiente (una sola vez)

Para dar F2 por cerrado, una persona con las contraseñas confirma que puede
entrar a las tres cuentas (GitHub, Netlify, Supabase) y hacer un export de
prueba sin pedirle nada a nadie. Con ese checklist marcado, este documento
se entrega a Dirección General y F2 queda aceptado.
