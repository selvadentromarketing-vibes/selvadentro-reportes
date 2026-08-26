# Auditoría del Sistema de Reportes — redundancia y UI/UX

**Fecha:** 26 de agosto de 2026 · **Alcance:** `index.html` (5,973 líneas), `marketing.html` (1,242) y las 10 Netlify Functions (1,579).

**Resultado:** 46 hallazgos verificados — 18 de severidad alta, 25 media, 3 baja. ~406 líneas eliminables sin perder funcionalidad.


> Cada hallazgo cita líneas verificadas contra el archivo. Los hallazgos que no
> sobrevivieron una segunda revisión adversarial no están aquí.


## Severidades

| Nivel | Qué significa | Cuántos |
|---|---|---|
| **Alta** | La app muestra un dato equivocado, se rompe, o le bloquea el paso a alguien. | 18 |
| **Media** | Fricción real, o duplicación que ya produjo errores y volverá a producirlos. | 25 |
| **Baja** | Pulido. Nada se rompe si se queda así. | 3 |

## El patrón de fondo

Casi ningún hallazgo es un descuido aislado. Son la misma historia: alguien arregló
un problema real, bien, y el arreglo se quedó en la copia donde se descubrió.

| Arreglo | Dónde sí está | Dónde falta |
|---|---|---|
| Marcar la sincronización incompleta dentro del agregado | `lqSync` | `crmSync`, `slaSync` |
| Filtrar el recorrido del CRM por fecha | `lead-quality.js` | `ghl-report.js` |
| Reintentar cuando Windsor responde 429 | `windsorGet()` | `spend()` |
| Actuar cuando falla una lectura del backend | `marketing.html` | `index.html` |
| Cerrar sesión al recibir un 401 | `index.html · kvCall` | `marketing.html · kvCall` |
| Destruir las gráficas anteriores antes de dibujar | `lqState._charts` | `ANAL_STATE.charts` |
| Avisar cuando el guardado falló en vez de decir “✓ Guardado” | `index.html · saveWeek` | `marketing.html · saveRec` |
| Confirmar antes de vaciar el formulario | `marketing.html` | `index.html · clearForm` |

Por eso la recomendación de fondo no es *escribir mejor código*: es **dejar de tener copias**.


## Qué arreglar primero

1. **Ponerle nombre distinto a cada WON** _(≈½ sesión)_ — Antes que cualquier código: decidir y escribir en pantalla qué mide cada pestaña. “WON reportado”, “WON cerrado en la semana”, “WON del cohorte”, cada uno con una línea que diga con qué fecha se corta. Es media sesión de trabajo y es lo único de esta lista que cambia lo que el equipo cree de los números.
2. **Borrar lo que ya nadie puede abrir** _(≈1 sesión)_ — Los tres módulos retirados de marketing.html y el bloque de `window.fs` en index.html. Nada de esto cambia la app: solo deja de estorbar. Y corregir las dos afirmaciones del README que ya no son ciertas, en el mismo commit.
3. **Tapar los dos silencios** _(≈1 sesión)_ — Tres arreglos cortos donde hoy la app afirma algo que no puede sostener: que `saveRec` de marketing.html deje de decir “✓ Guardado” cuando el guardado falló; que `slaSync` y `crmSync` reporten sus lotes fallidos como ya lo hace `lqSync`; y sacar `lq_live` de los desplegables de Metas y Base de datos.
4. **Dejar la app usable en un celular** _(≈1–2 sesiones)_ — El `@media` de estructura que marketing.html ya tiene, aplicado a index.html, más `overflow-x` en las barras y en las 18 tablas que quedaron fuera del contenedor con scroll.
5. **Subir el contraste y devolver el foco** _(≈1 sesión)_ — Un cobre oscurecido solo donde lleva texto encima, pestañas convertidas en `&lt;button&gt;`, y una regla global de `:focus-visible`. Es CSS y un cambio de etiqueta.
6. **Unificar los motores repetidos** _(≈3–4 sesiones)_ — Los tres motores de sincronización, los seis envoltorios de red, los selectores de rango de semanas y el `json()` de las tres functions. Es el trabajo más grande y el que más previene los bugs de mañana; conviene hacerlo después de los anteriores, ya con el terreno despejado.

## Contraste medido (WCAG 2.1 AA)

| Combinación | Ratio | Tamaño | Mínimo | AA |
|---|---:|---:|---:|---|
| #fff sobre --cobre #CF8543 — .btn-primary y .side-btn.active | 2.96:1 | 13px | 4.5:1 | **falla** |
| --neutro #6F7468 sobre --crema-2 #F1ECE1 — .tab inactivo | 4.08:1 | 13px | 4.5:1 | **falla** |
| --arena #D9B37E sobre --verde-prof #465241 — subtitulo topbar | 4.21:1 | 10px | 4.5:1 | **falla** |
| --neutro sobre --crema — .hint | 4.52:1 | 11.5px | 4.5:1 | pasa (al filo) |
| --rojo-no-tx sobre --rojo-no-bg — pill NO | 4.75:1 | 12px | 4.5:1 | pasa |
| #fff sobre --olivo #65713F — .btn-olive | 5.27:1 | 13px | 4.5:1 | pasa |
| --texto sobre --crema — cuerpo | 12.18:1 | 14px | 4.5:1 | pasa |

## Lo que la app muestra mal (13)

### [ALTA] “WON” significa tres cosas distintas en tres pestañas, y ninguna pantalla lo advierte

`won-tres-definiciones` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:1743-1745`, `index.html:1829`, `index.html:1939`, `index.html:2413`, `index.html:1919`, `index.html:2114`

**Qué encontramos.** Las tres pestañas que reportan WON lo calculan de forma distinta, verificado en el código. (1) Ventas y Dirección: WON es un número que alguien teclea cada semana — METRIC_MAP lo mapea a un campo capturado a mano por canal (won_brokers, won…, index.html:1743-1745) y la tabla consolidada solo lo imprime (1829). (2) CRM en vivo: WON se cuenta en la semana del ÚLTIMO CAMBIO DE ESTATUS de la oportunidad — if(o.st==="won"){ const ww=crmWeekOf(o.stc)||wc; … b.won++ } (1939), donde o.stc es la fecha de cambio de estatus. (3) Calidad de Leads: el WON viaja pegado al LEAD, no a la venta — cada fila lleva w: op.w (2413) y la fila se ubica en la semana en que ENTRÓ el lead. O sea que una venta cerrada en la semana 34, de un lead que llegó en la 28, se cuenta en la 28. Y encima las dos lecturas del CRM ni siquiera usan el mismo reloj: crmWeekOf trabaja en UTC (1919) y lqWeekOf en hora Tulum (2114).

**Por qué importa.** Para una misma semana, Dirección Comercial puede decir 4 WON, CRM en vivo 6 y Calidad de Leads 2 — y las tres cifras son correctas bajo su propia definición. El problema es que las tres se llaman igual, se ven igual y viven en la misma app, sin una sola línea que explique la diferencia. En una junta de resultados eso no se lee como 'son métricas distintas': se lee como que el sistema está roto, o como que alguien infló un número. Es el hallazgo más caro de este reporte porque no cuesta un bug, cuesta la confianza en el producto — y una vez que el equipo deja de creerle a la app, vuelve al Excel.

**Cómo se arregla.** No hay que unificarlas: las tres miden cosas legítimamente distintas y las tres sirven. Hay que NOMBRARLAS distinto y decirlo en pantalla. Propuesta concreta: en Dirección, 'WON reportado' (capturado por el equipo); en CRM en vivo, 'WON cerrado en la semana'; en Calidad de Leads, 'WON del cohorte' o 'ventas de leads de esta semana'. Cada una con una nota al pie de una línea que diga con qué fecha se corta. Y de paso alinear crmWeekOf a hora Tulum, que es la convención que el README ya fija, para que al menos las dos lecturas del CRM usen el mismo calendario. La pestaña de Diagnóstico es el lugar natural para publicar las tres definiciones juntas.

### [ALTA] El botón ← deja la app en blanco después de visitar “Desempeño de Ventas”

`crash-atras-desempeno` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:1645`, `index.html:1648`, `index.html:5155-5160`, `index.html:1617-1629`, `index.html:5123`

**Qué encontramos.** Reproducción exacta, trazada en el código: (1) en Ventas se elige “Desempeño de Ventas” en el select Reporte; switchChannel detecta el canal sintético y mete en el historial propio la entrada navPush({ tab:"ventas", subtab:CANAL_DESEMP }) (5159), donde CANAL_DESEMP vale "__desempeno" (5123). (2) el usuario se mueve a otro tab. (3) pulsa ←. navGo restaura VENTAS_SUBTAB = "__desempeno" y hace click en el tab de Ventas (1624-1626). (4) el manejador del tab apaga TODAS las vistas —document.querySelectorAll(".view").forEach(v=>v.classList.remove("active")) (1645)— y a la línea siguiente hace document.getElementById("view-"+VENTAS_SUBTAB).classList.add("active") (1648), sin ninguna guarda. No existe ningún elemento con id view-__desempeno: verificado, cero apariciones en el archivo. getElementById devuelve null y .classList lanza TypeError.

**Por qué importa.** La excepción salta DESPUÉS de haber apagado todas las vistas, así que el manejador aborta y no enciende ninguna: el área de contenido queda completamente en blanco, con la barra de pestañas todavía visible. No hay mensaje de error. La única salida es recargar la página, y al recargar se pierde el rango de semanas que se estuviera revisando. Es una ruta corta y plausible: “Desempeño de Ventas” es uno de los reportes que más se consultan y la flecha ← está a la vista en la barra superior.

**Cómo se arregla.** Dos líneas. Poner la guarda en 1648: const v = document.getElementById("view-"+VENTAS_SUBTAB); if(v) v.classList.add("active"); else { VENTAS_SUBTAB="reporte"; document.getElementById("view-reporte").classList.add("active"); }. Y que navGo, al restaurar una entrada con subtab CANAL_DESEMP, llame a mostrarDesempeno(true) en vez de tratarlo como una sub-pestaña normal — que es lo que switchChannel ya hace bien cuando el cambio viene del select.

### [ALTA] Dos pestañas ponen el mismo lead en semanas distintas: CRM cuenta en UTC y Calidad de Leads en hora Tulum

`semana-utc-vs-tulum` · defecto-funcional · esfuerzo bajo · −4 líneas

**Dónde:** `index.html:1919`, `index.html:2114`, `index.html:2091`, `index.html:3559`, `index.html:1382`, `README.md:104`

**Qué encontramos.** Las dos funciones que asignan un registro a su semana ISO no usan el mismo reloj. crmWeekOf (1919) es isoWeekId(new Date(iso)) — lee el timestamp tal cual, o sea en UTC. lqWeekOf (2114) es isoWeekId(new Date(new Date(iso).getTime() - LQ_TZ_MS)) y LQ_TZ_MS = 5*3600e3 (2091), o sea que primero lo mueve a hora Tulum (UTC-5). slaWeeksAll hace lo mismo que lqWeekOf (3559). Las dos terminan llamando al mismo isoWeekId (1382), que trabaja en UTC: la diferencia está en lo que cada una le entrega. El README fija la convención del proyecto de forma explícita — 'contactos de GHL creados en las últimas 12 semanas ISO (hora Tulum, UTC-5)' — así que Calidad de Leads y SLA siguen la regla documentada y CRM en vivo es la que se salió.

**Por qué importa.** Cualquier registro creado entre las 00:00 y las 04:59 UTC del lunes es todavía domingo en Tulum. 'CRM en vivo' lo cuenta en la semana nueva; 'Calidad de Leads' y 'SLA y Seguimiento' lo cuentan en la semana anterior. Es decir: los leads que entran el domingo por la tarde-noche hora Tulum —franja real para quien navega propiedades el fin de semana— aparecen en semanas distintas según la pestaña que se abra. Dos pantallas de la misma app dan conteos semanales distintos de los mismos datos, y nada en la interfaz explica por qué. En un producto cuyo entregable es el reporte semanal, es el tipo de error que hace que el equipo deje de confiar en el número.

**Cómo se arregla.** Alinear crmWeekOf con la convención documentada: function crmWeekOf(iso){ const d = iso ? new Date(new Date(iso).getTime() - LQ_TZ_MS) : null; ... }. Mejor todavía, borrar las dos y dejar una sola función de semana con el desplazamiento de zona adentro, para que no puedan volver a separarse. Ojo: el cambio mueve registros de una semana a otra, así que hay que invalidar el cache crm:agg:v1 y volver a sincronizar, y conviene avisarle al equipo que algunos conteos históricos de CRM en vivo se van a mover un lugar.

### [ALTA] En Metas y en Base de datos, elegir 'Calidad de Leads' muestra en silencio los datos de Redes Sociales

`metas-lq-muestra-rrss` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:4524`, `index.html:4530`, `index.html:5048`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:1228`, `marketing.html:738-745`

**Qué encontramos.** El desplegable 'Marketing' de Metas (index.html:4530) y el de Base de datos (index.html:5048) se construyen ambos con MKT_MODULES = [ {id:'rrss'}, {id:MKT_LQ_LIVE} ] (4524). Al elegir 'Calidad de Leads' se llama metasShowFrame(true,'lq_live') / dbShowFrame(true,'lq_live'), que cargan el iframe y ejecutan w.mktSetActive('lq_live'). Pero del otro lado: window.mktSetActive=function(id){ if(MODS[id]) setActive(id); } (marketing.html:1228) y MODS solo tiene rrss. La guarda hace que la llamada sea un no-op SILENCIOSO. Acto seguido w.mktShowView('metas') renderiza con state.active intacto = 'rrss'.

**Por qué importa.** El usuario cree que esta editando las metas de Calidad de Leads y en realidad esta editando y guardando las de Redes Sociales. No hay ningun aviso: ni error, ni titulo distinto, ni pantalla vacia. Las metas son el criterio con el que la app pinta verde o rojo cada KPI, asi que una meta mal puesta se propaga a todos los reportes. Lo mismo en Base de datos, donde ademas se pueden borrar registros.

**Cómo se arregla.** MKT_LQ_LIVE existe para el selector de la pestana Marketing, donde la vista en vivo si vive en index.html; no debe aparecer en Metas ni en Base de datos porque no tiene modulo del lado del iframe. Filtrarlo en ambos: MKT_MODULES.filter(m=>m.id!==MKT_LQ_LIVE). Si Calidad de Leads en vivo debe tener metas propias, hay que construirlas en index.html, no delegarlas al iframe.

### [ALTA] El reporte de SLA califica asesores con datos que pueden faltar, y no lo dice

`sla-lotes-silenciosos` · estados · esfuerzo medio

**Dónde:** `index.html:4030-4037`, `index.html:4050`, `index.html:3451-3523`

**Qué encontramos.** slaSync recorre los leads en lotes de 8 y cada lote falla en silencio: catch(e){ /* lote fallido: los leads quedan sin datos de conversacion */ } (index.html:4036). La resolucion de asesores tambien: catch(e){} (4050). El propio comentario admite la consecuencia. En cambio lqSync SI resolvio este problema — acumula un array 'fallos' y lo guarda DENTRO del agregado (index.html:3520-3521) con un comentario que explica exactamente por que: 'Antes el error era solo un toast pasajero que veia quien pulso Sincronizar, y el resto del equipo leia los ceros como si fueran datos'. Ese arreglo nunca se llevo ni a slaSync ni a crmSync.

**Por qué importa.** La pestana de SLA produce la nota del asesor (velocidad de primer contacto, cadencia, cierre de ciclo, seguimiento, actividad efectiva) con la que se evalua a personas. Si un lote de 8 leads falla, esos leads aparecen sin conversaciones: se leen como 'nunca los toco'. El asesor baja de nota por un error de red. Y como el agregado se cachea en el kv, todo el equipo ve la nota mala sin saber que la sincronizacion vino incompleta.

**Cómo se arregla.** Portar el patron de lqSync a slaSync y a crmSync: acumular los lotes fallidos en agg.fallos, guardarlo en el agregado, y pintarlo en el encabezado del reporte ('reporte generado con N de M leads — vuelve a generarlo'). Mientras haya lotes fallidos, no mostrar la nota del asesor como definitiva.

### [ALTA] El formulario de captura semanal no tiene autoguardado, ni aviso al salir, ni marca de campo invalido

`ingreso-sin-red-de-seguridad` · formularios · esfuerzo medio

**Dónde:** `index.html:1428`, `index.html:1413-1427`, `index.html:4384`, `index.html:1288`

**Qué encontramos.** Cero coincidencias de beforeunload en los dos archivos. El formulario de Ingreso no marca estado sucio: el patron dirty existe en la app pero solo para Asesores (setAdvDirty, index.html:4384) — Ingreso no lo usa. No hay clases .error / .invalid / aria-invalid en el CSS, asi que un valor mal capturado no se senala en su campo. Y si el token de 30 dias vence mientras se captura, kvCall llama a handleAuthExpired (1288) y devuelve al login. Y hay una vía de pérdida más directa que ni siquiera necesita un fallo: switchChannel ejecuta renderIngresoForm(); clearForm(); (index.html:5182) sin comprobar nada, y clearForm (1427) vacía todos los campos sin preguntar. Basta con cambiar el canal en el desplegable «Reporte» para borrar un formulario a medio llenar, en silencio.

**Por qué importa.** Capturar una semana son decenas de campos numericos. Cambiar de pestana, cerrar la pestana por accidente o que venza la sesion borra todo sin preguntar, y no hay copia local de lo escrito. Es la tarea que el equipo hace cada semana, o sea la que mas veces se puede perder.

**Cómo se arregla.** Lo minimo y barato: (1) guardar el borrador en localStorage con cada cambio, con la llave semana+canal, y ofrecer recuperarlo al volver a entrar; (2) marcar el formulario como sucio y anadir beforeunload mientras lo este; (3) al detectar 401, no descartar lo escrito — dejarlo en el borrador para que al reingresar siga ahi. Y lo más urgente de todo: que switchChannel pregunte antes de limpiar si hay algo escrito — es una condición y un confirm, y cierra la vía de pérdida más fácil de encontrar.

### [ALTA] La pantalla de Base de datos explica cómo exportar, y no hay ningún botón para exportar

`export-fantasma` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:797`, `index.html:5023-5032`, `index.html:5033-5039`, `index.html:4969`

**Qué encontramos.** El texto de ayuda de la vista Base de datos (index.html:797) termina así: 'El CSV exporta el canal actual; el backup JSON incluye todos los canales más asesores y metas.' Las dos funciones existen y están completas: dbExportCSV (5023) arma el CSV con BOM UTF-8 y escapado de comillas, y dbExportJSON (5033) junta todos los canales más asesores y metas. Pero ninguna se llama desde ningún lado: verificado con conteo de referencias, dbExportCSV y dbExportJSON aparecen exactamente una vez cada una en las 5,973 líneas — su propia declaración. El helper download (4969) solo se usa desde dentro de esas dos funciones muertas. Y la palabra 'Exportar' no aparece en ninguna parte del archivo, ni en el markup ni en los template strings.

**Por qué importa.** La app le explica al usuario una función que no puede usar. Alguien que necesite el respaldo —o que quiera llevarse los números a Excel para una junta— va a buscar el botón, no lo va a encontrar, y va a concluir que se le rompió algo o que no tiene permisos. Además el backup JSON es la única salida de datos que tiene el proyecto: sin él, no hay forma de sacar la información del kv desde la interfaz.

**Cómo se arregla.** Es el arreglo más barato de toda esta auditoría: dos botones en la barra de acciones de la vista, conectados a funciones que ya están escritas y probadas. En renderDB, junto a 'Buscar': document.getElementById('db-csv').onclick=()=>dbExportCSV(sel.value); y otro para dbExportJSON. Si por alguna razón la exportación no debe existir, entonces hay que quitar la frase del texto de ayuda y borrar las tres funciones.

### [ALTA] index.html detecta cuando falla una lectura del backend, guarda la señal, y nadie la lee nunca

`lectura-fallida-sin-lector` · estados · esfuerzo bajo

**Dónde:** `index.html:1332-1334`, `index.html:1337`, `index.html:1342`, `index.html:5243`, `index.html:5220-5230`, `marketing.html:775-779`

**Qué encontramos.** index.html declara let LECTURA_FALLIDA = false (1332) y dos accesores para consultarla: sReadFailed y sReadReset (1333-1334). La bandera se levanta correctamente en los dos puntos donde puede fallar una lectura del kv (1337 y 1342). Y ahí se acaba: verificado por conteo, sReadFailed y sReadReset aparecen una sola vez cada uno en las 5,973 líneas — su propia declaración. Nadie pregunta jamás si la lectura falló. El otro lado del iframe sí aprendió la lección: marketing.html levanta _lecturaFallida (777) y actúa, avisando al usuario que no se pudo leer y que no se escribió nada para no pisar los datos reales. Se suma que el arranque de index.html pinta primero las semillas del archivo y después, en segundo plano, carga los datos guardados — dentro de un bloque que termina en catch(e){} (5243).

**Por qué importa.** Si el backend no responde al arrancar, la app no se ve rota: se ve normal, con el histórico que viene incrustado en el archivo, y sin nada de lo capturado después. El usuario lee números viejos creyendo que son los de hoy. Es la peor forma de fallar de un sistema de reportes, y el mecanismo para evitarlo ya está escrito — solo le falta quien lo consulte.

**Cómo se arregla.** Consultar sReadFailed() al terminar el arranque y, si dio true, mostrar una franja fija arriba: 'No se pudieron cargar los datos guardados. Lo que ves puede estar incompleto.' con botón de reintentar. Y cambiar el catch(e){} de 5243 por uno que levante la misma bandera. Es el mismo aviso que marketing.html ya da, movido al lado de Ventas.

### [ALTA] La pantalla “Sin acceso” deja la barra lateral viva, y cualquier clic en ella rompe la app

`crash-sin-acceso` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:5313-5322`, `index.html:507-508`, `index.html:530`, `index.html:1632`, `index.html:1657`, `index.html:1660`

**Qué encontramos.** showNoAccessScreen reemplaza el contenido de .main (5314): document.querySelector(".main").innerHTML = `…Sin acceso…`. Pero .main (línea 530) y .sidebar (508) son hermanos dentro de .shell (507), así que la barra lateral sobrevive intacta — con sus manejadores incluidos, porque se enlazan una sola vez al arrancar sobre todos los [data-tab] (1632). Al pulsar cualquiera de sus botones, el manejador ejecuta document.getElementById("view-"+tab).classList.add("active") (1657) sobre un elemento que acaba de ser borrado, y acto seguido document.querySelector(".canal-wrap").style.display (1660) sobre otro que tampoco existe. Las dos líneas lanzan TypeError. Y los botones son alcanzables: “Base datos” no lleva la clase admin-only, así que se ve siempre.

**Por qué importa.** Es el primer minuto de un usuario nuevo. Le acaban de dar de alta, abre su liga, define su contraseña, entra — y la app le dice “Sin acceso: pídele al admin que te asigne acceso”, con una columna de botones a la izquierda que se ven perfectamente clicables. Pulsa uno, no pasa nada visible, pulsa otro, tampoco. Su primera impresión del sistema es que está roto. Y el único botón que sí funciona —Cerrar sesión— está dentro del mensaje, no en la barra.

**Cómo se arregla.** Que showNoAccessScreen reemplace .shell completo, no solo .main, de modo que la barra lateral desaparezca con el resto. Como red de seguridad general, guardar las dos líneas del manejador (1657 y 1660) contra null, que además cubre cualquier otra vista que se retire en el futuro.

### [ALTA] La app dice “no recargues, se pierde” y acto seguido se recarga sola

`sesion-expira-borra-captura` · defecto-funcional · esfuerzo medio

**Dónde:** `index.html:1437`, `index.html:1288-1291`, `index.html:1298`, `index.html:1428-1441`

**Qué encontramos.** Son dos piezas bien intencionadas que se contradicen. Cuando falla el guardado, saveWeek avisa con un mensaje que alguien escribió con cuidado (1437): «NO se guardó en el servidor. […] Lo capturado sigue en pantalla: revisa tu conexión y vuelve a pulsar Guardar. Si recargas la página ahora, se pierde.» El comentario de arriba explica que ese aviso se añadió justamente porque antes el toast decía «Guardado ✓» sin que se hubiera guardado. Pero handleAuthExpired hace exactamente lo que el mensaje pide no hacer (1290): setAuthToken(null); writeSession(null); location.reload(). Y se dispara desde kvCall (1298), que es la puerta por la que pasa el reintento. O sea: si el guardado falló porque el token de 30 días venció, el usuario lee «no recargues», pulsa Guardar otra vez como se le indica, el 401 llega, y la app se recarga sola y borra todo lo capturado. Verificado además: cero AbortController y cero beforeunload en los dos archivos.

**Por qué importa.** Es la peor combinación posible: el usuario hace exactamente lo que la app le pide y pierde el trabajo por hacerlo. Y ocurre en el momento más costoso — con el formulario semanal lleno— y en el escenario más probable, porque un token de 30 días vence sin aviso previo y lo primero que revela el vencimiento es justo el intento de guardar.

**Cómo se arregla.** Antes de recargar, guardar en localStorage lo que haya en el formulario y restaurarlo después del login: handleAuthExpired ya es el único punto por donde pasa el cierre de sesión, así que es una sola modificación. Y mejor todavía, no recargar: mostrar la pantalla de login encima, sin destruir el DOM, para que al reingresar el formulario siga tal cual. Si se conserva la recarga, el mensaje de 1437 tiene que dejar de prometer algo que la app no cumple.

### [ALTA] Marketing sigue diciendo “✓ Guardado” cuando el guardado falló — el bug que ya se arregló en Ventas

`mkt-guardado-mentiroso` · defecto-funcional · esfuerzo bajo

**Dónde:** `marketing.html:786`, `marketing.html:787`, `marketing.html:928`, `index.html:1434-1440`

**Qué encontramos.** marketing.html:786: async function saveRec(M){ try{ await window.storage.set(M.key, JSON.stringify(M.records)); }catch(e){console.error(e);} }. El error se traga en la consola y la promesa resuelve como si todo hubiera ido bien. Quien la llama celebra sin comprobar nada (928): M.records[M.pval]=M.read(); await saveRec(M); updatePill(); showToast('✓ Guardado'). saveMeta (787) hace exactamente lo mismo. Y este es el bug que index.html YA arregló, con el comentario que lo documenta (1434): «El toast decía "Guardado ✓" aunque el backend hubiera fallado. Ahora se dice» — seguido de un alert que explica al usuario que lo capturado sigue en pantalla. Ese arreglo nunca cruzó al iframe.

**Por qué importa.** Es pérdida de datos silenciosa, no una molestia. Alguien captura el reporte mensual de Redes Sociales, ve el ✓ verde, cierra la pestaña — y no se guardó nada. No hay forma de que lo note hasta que vuelva a entrar y encuentre el periodo vacío, probablemente semanas después. De todos los hallazgos de este reporte, es el que puede destruir trabajo sin dejar rastro.

**Cómo se arregla.** Que saveRec y saveMeta dejen propagar el error (quitar el catch o volver a lanzarlo) y que bindSave solo muestre el ✓ si la promesa resolvió, con el mismo aviso que ya usa index.html cuando falla. Son tres líneas y es el arreglo más urgente de esta auditoría junto con el de SLA.

### [ALTA] Elegir una semana que ya tiene datos abre el formulario en blanco, y guardar la sobrescribe sin avisar

`semana-en-blanco-sobrescribe` · defecto-funcional · esfuerzo bajo

**Dónde:** `index.html:5201`, `index.html:5180`, `index.html:1428-1433`, `index.html:1449`, `index.html:1444-1452`

**Qué encontramos.** El único manejador del campo de fecha ajusta el rango a lunes-domingo y actualiza la etiqueta de semana; no carga nada (5201). Y los desplegables de dimensión —asesor, ciudad— se generan sin ningún manejador de cambio (5180). Verificado: fillForm solo se llama desde cuatro sitios (1449, 4976, 4985 y 5189), ninguno de ellos ligado a la fecha ni al asesor. Del otro lado, saveWeek arma la llave y escribe sin preguntar si ya existe: const k=recKey(w,dv); … recSet(k, form) (1431-1432), y el mensaje de éxito es el mismo se trate de un registro nuevo o de uno que acaba de pisar. Hay que decir que la app SÍ ofrece una salida: la fila «Registros guardados (clic para cargar)» carga el registro al pulsarlo (1449). El problema es que no es el camino natural.

**Por qué importa.** El camino que cualquiera seguiría —elegir la semana, elegir el asesor, capturar— entrega un formulario vacío aunque esa combinación ya tenga datos. Si la persona no repara en la fila de chips de abajo, teclea lo que recuerda y guarda: el registro completo queda reemplazado por uno parcial, sin una sola advertencia. Es especialmente probable al corregir un dato de una semana ya capturada, que es justamente cuando se vuelve a abrir el formulario.

**Cómo se arregla.** Que cambiar la fecha o cualquier desplegable de dimensión intente cargar el registro de esa combinación: const rec=recGet(recKey(currentWeekId(), curDimVals())); if(rec) fillForm(rec); — la función ya existe y ya se usa desde los chips. Y que saveWeek avise cuando la llave ya existe: «Ya hay datos guardados para esta semana y este asesor. ¿Reemplazarlos?».

### [MEDIA] El reintento que protege a Windsor de los 429 no cubre justamente la llamada de inversión

`windsor-sin-reintento` · defecto-funcional · esfuerzo bajo · −8 líneas

**Dónde:** `netlify/functions/lead-quality.js:233-234`, `netlify/functions/lead-quality.js:235-251`, `netlify/functions/lead-quality.js:198-231`

**Qué encontramos.** El comentario de lead-quality.js:233-234 dice: 'Windsor limita a 600 peticiones/min y 10k/día. Un 429 sin reintento apagaba la inversión de toda la pestaña; ahora se espera y se reintenta una vez, igual que GHL.' Y windsorGet (235-251) efectivamente lo hace: if (resp.status === 429) { await esperar(1500); resp = await fetch(url...) }. Pero spend() (198-231) —la función que trae exactamente la inversión de la que habla el comentario— no usa windsorGet: hace su propio fetch, con un reintento distinto (si da 400, repite sin el campo currency) y sin ninguna rama para el 429.

**Por qué importa.** El arreglo está escrito y no cubre el caso que dice cubrir. Si Windsor responde 429 durante una sincronización de Calidad de Leads, la columna Inversión se apaga igual que antes — que es el síntoma exacto que el comentario asegura haber resuelto. Y como el comentario afirma lo contrario, la próxima persona que investigue el problema va a descartar esa hipótesis por escrito.

**Cómo se arregla.** Que spend() pase por windsorGet, conservando su fallback de currency: intentar con currency, y si da 400 reintentar sin él, pero ambas llamadas a través de windsorGet para que hereden el manejo del 429.


## Redundancia (12)

### [ALTA] CRM en vivo se baja el histórico completo del CRM cada 30 minutos, por usuario

`crm-crawl-completo` · red · esfuerzo bajo

**Dónde:** `netlify/functions/ghl-report.js:83-100`, `netlify/functions/lead-quality.js:145-152`, `index.html:2079`, `index.html:2046-2052`

**Qué encontramos.** La consulta que alimenta CRM en vivo no lleva ningún filtro de fecha: qs = `location_id=${LOCATION_ID}&limit=100` y nada más (ghl-report.js:89-90), así que recorre TODAS las oportunidades del CRM, sin importar de qué año sean. Y showCRM la dispara sola: if(!crmState.syncing && (!crmState.agg || Date.now()-crmState.agg.ts > CRM_STALE_MIN*60000)) crmSync() (index.html:2079). Lo revelador es que este bug YA SE ARREGLÓ, pero en otro archivo: el comentario de lead-quality.js:145-147 lo describe palabra por palabra — 'Antes se recorría TODO el histórico del CRM en cada sincronización — con auto-refresco cada 30 min por usuario — solo para descartarlo al filtrar por semana' — y ahí sí se agregó el parámetro since, con reintento sin filtro por si el API lo rechaza. A ghl-report nunca se le llevó.

**Por qué importa.** Basta con que alguien abra la pestaña CRM en vivo para que la app se descargue el CRM entero. Con varias personas del equipo entrando durante el día, son varios recorridos completos diarios contra la cuenta de GoHighLevel — que tiene límite de peticiones— para después tirar casi todo al filtrar por semana. Y como el freno de 'ya estoy sincronizando' solo existe dentro de cada pestaña del navegador, dos personas que entren a la vez lanzan dos recorridos completos.

**Cómo se arregla.** Portar a ghl-report.js el mismo filtro que ya tiene lead-quality.js: aceptar un parámetro since, pasarlo a la consulta y reintentar sin él si el API lo rechaza. El cliente ya sabe qué rango de semanas necesita. Es copiar unas 10 líneas de un archivo al otro.

### [MEDIA] 22.8% de marketing.html es codigo de tres modulos que ya nadie puede abrir

`mkt-modulos-muertos` · codigo-muerto · esfuerzo bajo · −117 líneas

**Dónde:** `marketing.html:620-736`, `marketing.html:737-745`, `marketing.html:11`

**Qué encontramos.** El 2026-08-26 se retiraron PPC Ads, CRM Manager y el modulo manual de Calidad de Leads: MODS solo registra rrss y ORDER=['rrss'] (marketing.html:738-745). Pero el codigo se quedo. Verificado por conteo de referencias: ppcIngreso, ppcFill, ppcRead, ppcMetas, ppcReporte, crmIngreso, crmFill, crmRead, crmMetas, crmReporte, lqIngreso, lqFill, lqRead, lqMetas y lqReporte aparecen UNA sola vez cada una en todo el archivo — su propia declaracion. Con ellas quedan colgadas PPC_CF, PPC_SEED_METAS, PPC_MF, CRM_SRC, CRM_SEG, CRM_WEB, CRM_EM, CRM_MS, CRM_SEED, CRM_SEED_METAS, CRM_MF, LQ_SRC, LQ_SEG, LQ_SEED, LQ_SEED_METAS, LQ_MF, FUNNEL, y las auxiliares lqCalc/chipH/chipL/ppcPlatCard (referenciadas solo desde funciones ya muertas). Medido: lineas 620-736 = 27,523 bytes = 22.8% del archivo. El comentario de cabecera (linea 11) todavia anuncia 'Reportes: Redes Sociales (mensual) · PPC Ads · CRM Manager · Calidad de Leads (semanales)'.

**Por qué importa.** Cada visita a Marketing descarga 27 KB de codigo inalcanzable, y multiplicado por los tres iframes que montan marketing.html son ~82 KB por sesion. Peor: quien abra el archivo manana no puede distinguir que esta vivo y que no, y las semillas de EJEMPLO (CRM_SEED, LQ_SEED con datos inventados de 2026-W15) siguen ahi listas para reaparecer si alguien vuelve a meter el modulo en ORDER.

**Cómo se arregla.** Borrar el bloque 620-736 completo y las clases CSS que solo lo estilaban (.camp, .camp-top, .cn, .ci, .badge). Los registros historicos siguen a salvo en el kv bajo mkt_ppc_rec / mkt_crm_rec / mkt_lq_rec: borrar el codigo no borra los datos. Actualizar el comentario de la linea 11.

### [MEDIA] Tres functions reimplementan mal el helper que ya importan de shared.js

`cors-json-duplicado` · duplicacion · esfuerzo bajo · −50 líneas

**Dónde:** `netlify/functions/lib/shared.js:29-46`, `netlify/functions/ghl-report.js:22-28`, `netlify/functions/ghl-report.js:105-112`, `netlify/functions/kpi-analyze.js:24-40`, `netlify/functions/notes-analyze.js:26-42`

**Qué encontramos.** shared.js ya exporta json() y corsPreflight() (29-46). Cuatro functions los usan bien (invite, lead-quality, lq-analyze, sla-report: const json = S.json). Pero ghl-report, kpi-analyze y notes-analyze — que TAMBIEN hacen require('./lib/shared.js') y usan S.authFromEvent — se definen su propio json() y su propio preflight. Y las copias divergieron: (1) el preflight local de las tres declara Access-Control-Allow-Headers: 'Content-Type' mientras shared.js declara 'Content-Type, Authorization'; las nueve functions exigen Authorization: Bearer, asi que el preflight local rechaza justo la cabecera que la function necesita. (2) el json() de kpi-analyze (linea 26) omite Access-Control-Allow-Origin, que si esta en shared.js y en notes-analyze; su ruta de exito si lo agrega (121-124), o sea que exito y error responden distinto. Un diff de las lineas 20-55 de kpi-analyze contra 22-57 de notes-analyze devuelve UNA sola diferencia real: esa cabecera. Son copias literales.

**Por qué importa.** Hoy no se nota porque el frontend es del mismo origen que las functions en Netlify. En cuanto algo llame desde otro origen — una prueba local en otro puerto, un dashboard embebido, un dominio nuevo — esas tres functions fallan el preflight y el navegador no llega ni a mandar la peticion. El error se vera como 'CORS' y no como lo que es. Ademas son ~50 lineas copiadas que ya tienen tres versiones distintas de la verdad.

**Cómo se arregla.** En las tres: borrar el json() local y el bloque OPTIONS, y usar const json = S.json; y if (event.httpMethod === 'OPTIONS') return S.corsPreflight();. Es el mismo cambio en tres archivos y deja una sola definicion.

### [MEDIA] Dos botones Guardar y dos Limpiar en la misma pantalla, con etiquetas distintas y la misma funcion

`guardar-duplicado` · redundancia-funcional · esfuerzo bajo · −4 líneas

**Dónde:** `index.html:564-565`, `index.html:581-582`, `index.html:5203-5206`

**Qué encontramos.** El formulario de Ingreso tiene 'Limpiar' + 'Guardar' arriba (564-565) y 'Limpiar' + 'Guardar semana' abajo (581-582). Los cuatro handlers estan en el mismo bloque: btn-guardar.onclick=saveWeek; btn-guardar2.onclick=saveWeek; btn-limpiar.onclick=clearForm; btn-limpiar2.onclick=clearForm (5203-5206). Son la misma funcion — pero las etiquetas no coinciden: 'Guardar' arriba y 'Guardar semana' abajo. Sobre «Limpiar» hay además una divergencia entre los dos lados de la app: en index.html clearForm (1427) borra los campos sin preguntar nada, mientras que marketing.html sí confirma antes — confirm('¿Limpiar el formulario? (no borra lo guardado)') en marketing.html:928. El botón con el mismo nombre se comporta distinto según la pestaña.

**Por qué importa.** Dos etiquetas distintas para la misma accion le dicen al usuario que hacen cosas distintas, en una pantalla donde la duda es cara: quien no este seguro guarda con las dos, o guarda con la de arriba pensando que la de abajo hace algo mas. Y 'Limpiar' esta pegado a 'Guardar' sin confirmacion: clearForm borra todo lo capturado de un clic, y la unica separacion es el orden de los botones.

**Cómo se arregla.** Dejar una sola barra de acciones (la de abajo, al final del formulario, que es donde se termina de capturar) con la etiqueta 'Guardar semana'. Y pedir confirmacion en Limpiar cuando el formulario tenga algo escrito — el patron ya existe en la app: Asesores usa advDirty + confirm antes de borrar (index.html:4384, 4396).

### [MEDIA] Tres funciones de escape identicas con tres nombres, dos de ellas en el mismo archivo

`escape-triple` · duplicacion · esfuerzo bajo · −2 líneas

**Dónde:** `index.html:4375`, `marketing.html:338`, `marketing.html:1042`

**Qué encontramos.** escAttr (index.html:4375), escHtmlSafe (marketing.html:338) y escHtml (marketing.html:1042) tienen el mismo cuerpo carácter por carácter salvo el manejo de null: reemplazan &, comilla doble, < y >. Las dos ultimas conviven en el mismo archivo. Se usan mucho — 123 llamadas a escAttr y 38 entre las dos de marketing — sobre 82 asignaciones de innerHTML entre los dos archivos.

**Por qué importa.** Tres definiciones de la misma proteccion es la garantia de que el dia que haya que endurecerla (hoy ninguna escapa el apostrofo) se arregle una y las otras dos queden atras. Los nombres distintos esconden que son la misma cosa: quien busque 'escHtml' en index.html no encuentra nada y escribe una cuarta.

**Cómo se arregla.** Un solo nombre en los dos archivos, con el mismo cuerpo y el manejo de null de las versiones de marketing. Mientras no haya build compartido, que sea literalmente el mismo texto en ambos, con un comentario que diga que son copias que deben moverse juntas.

### [MEDIA] Tres iframes cargan el mismo documento de 120 KB, cada uno con su propia copia de Chart.js y su propio estado

`iframes-triples` · red · esfuerzo medio · −40 líneas

**Dónde:** `index.html:715`, `index.html:744`, `index.html:799`, `index.html:1738`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:1237`

**Qué encontramos.** index.html monta marketing.html en tres iframes distintos: mkt-frame para la pestana Marketing (715, cargado en showMarketing 1738), mkt-metas-frame para Metas (744, metasShowFrame 4546) y mkt-db-frame para Base de datos (799, dbShowFrame 5065). Cada uno carga el documento completo: 120 KB de HTML, su propio <script> de Chart.js desde el CDN, su propia hoja de Google Fonts y su propio arranque. Y ese arranque es secuencial: init() hace for(const id of ORDER){ await loadMod(...) } (marketing.html:1237) y cada loadMod son dos lecturas al kv encadenadas.

**Por qué importa.** Un usuario que pase por Marketing, luego por Metas y luego por Base de datos deja tres copias vivas del mismo documento, con tres estados independientes que no se hablan: guardar una meta en una no actualiza lo que muestran las otras dos. Y son tres arranques completos con sus lecturas al kv.

**Cómo se arregla.** Un solo iframe reutilizado. Ya existe la API para hacerlo: mktSetEmbedMode / mktSetActive / mktShowView (marketing.html:1226-1229) permiten mover el mismo documento entre las vistas metas / basedatos / reporte. Mover el iframe en el DOM o, mas simple, dejarlo en un contenedor fijo y cambiar que vista muestra.

### [MEDIA] El README documenta dos cosas que ya no son ciertas

`readme-desfasado` · documentacion · esfuerzo bajo

**Dónde:** `README.md:116`, `README.md:220`, `marketing.html:740-744`, `marketing.html:11`

**Qué encontramos.** (1) README.md:116 dice 'El modulo manual de Calidad de Leads dentro de Marketing sigue existiendo tal cual'. Falso desde el 2026-08-26: marketing.html:740-744 documenta su retiro y ORDER quedo en ['rrss']. (2) README.md:220 dice que 'scripts/migrate-kv.mjs quedo obsoleto tras el cutover; se conserva como referencia'. El directorio scripts/ no existe en el repo. (3) marketing.html:11 sigue anunciando en su cabecera 'Reportes: Redes Sociales (mensual) · PPC Ads · CRM Manager · Calidad de Leads (semanales)'.

**Por qué importa.** El README es lo primero que lee quien entra al proyecto —persona o modelo— y hoy describe una app que ya no existe. En un repo sin pruebas, la documentacion es la unica especificacion que hay: cuando miente, las decisiones se toman sobre datos falsos.

**Cómo se arregla.** Corregir los tres puntos en el mismo commit que limpie el codigo muerto, para que la documentacion y el codigo se muevan juntos. Anadir al README la nota de que los registros historicos de los modulos retirados siguen en el kv bajo mkt_ppc_rec / mkt_crm_rec / mkt_lq_rec.

### [MEDIA] El cliente de GoHighLevel está escrito tres veces; dos copias son idénticas byte a byte

`ghl-cliente-triplicado` · duplicacion · esfuerzo medio · −100 líneas

**Dónde:** `netlify/functions/lead-quality.js:39-53`, `netlify/functions/sla-report.js:29-43`, `netlify/functions/ghl-report.js:32-50`, `netlify/functions/ghl-report.js:83-101`, `netlify/functions/sla-report.js:255-290`, `netlify/functions/lead-quality.js:148-194`

**Qué encontramos.** Las tres functions que hablan con GoHighLevel se construyen cada una su propio cliente HTTP: misma URL base, mismo header Version: 2021-07-28, mismo Authorization, mismo manejo de error. Verificado con diff: las líneas 39-53 de lead-quality.js y las 29-43 de sla-report.js son IDÉNTICAS byte a byte — la salida del diff es vacía. Encima de eso, la paginación por cursor de /opportunities/search está copiada tres veces (ghl-report.js:83-101, sla-report.js:255-290, lead-quality.js:148-194), con las mismas cuatro líneas de cierre en las tres.

**Por qué importa.** Cuando GoHighLevel cambie algo —la versión del API, un límite de tasa, la forma del cursor— hay que arreglarlo en tres archivos, y basta olvidar uno para que una pestaña deje de traer datos mientras las otras dos siguen bien. Ese patrón ya se cumplió en este mismo repo: attrOf existe en dos de los tres archivos y la copia de sla-report.js se quedó atrás sin el campo del anuncio.

**Cómo se arregla.** Mover el cliente ghl() y el paginador de oportunidades a lib/shared.js, que es donde ya viven el kv y los tokens y que las tres functions ya importan. Son unas 100 líneas que pasan a existir una sola vez, y el cambio es mecánico porque dos de las copias ya son idénticas.

### [MEDIA] Seis funciones y constantes en index.html declaradas y nunca usadas, más la cadena 'list' completa

`muertos-index` · codigo-muerto · esfuerzo bajo · −45 líneas

**Dónde:** `index.html:1340-1345`, `index.html:1308`, `index.html:1333-1334`, `index.html:2657-2671`, `index.html:3646`, `index.html:5358-5361`, `netlify/functions/kv.js:59`, `netlify/functions/kv.js:80-83`

**Qué encontramos.** Verificado por conteo de referencias sobre el token completo: sList, readSession, lqHierarchy, sReadFailed, sReadReset y dimThr aparecen exactamente UNA vez cada una en index.html — solo su declaración. Tres casos valen la pena por separado. (1) sList (1340) es el único llamador de STORE.list (1308), que a su vez es el único cliente de la operación 'list' de la function kv (kv.js:59 y 80-83) y del kvList de shared.js: la cadena está muerta de punta a punta, desde el navegador hasta Supabase. (2) lqHierarchy (2657) quedó huérfana cuando lqUnionTree la sustituyó. (3) readSession (5358) nunca se llama, pero writeSession sí sigue escribiendo la sesión en localStorage: se guarda algo que nadie lee.

**Por qué importa.** Nada de esto se rompe, pero cada símbolo muerto es una pista falsa. La cadena 'list' es la peor: alguien que quiera saber qué operaciones soporta el backend va a encontrar 'list' documentada y funcionando en el servidor, y va a asumir que la app la usa. Y la sesión escrita en localStorage y nunca leída es una copia de datos de usuario que existe sin ningún propósito.

**Cómo se arregla.** Borrar las seis declaraciones. La operación 'list' del backend puede quedarse (no estorba y puede servir para depurar), pero conviene anotarlo en el README para que quede claro que hoy no la usa nadie. Y decidir sobre writeSession: o se lee al arrancar, o se deja de escribir.

### [MEDIA] Un solo botón “Metas” y un solo “Base de datos” abren dos sistemas distintos según de qué lado del iframe caiga el usuario

`seam-metas-db-iframe` · redundancia-funcional · esfuerzo medio

**Dónde:** `index.html:736-745`, `index.html:789-800`, `index.html:797`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:993`, `marketing.html:121`

**Qué encontramos.** El sidebar tiene un botón 'Metas' y uno 'Base de datos'. Pero cada una de esas dos vistas contiene DOS mundos: un desplegable 'Ventas' que renderiza la versión nativa de index.html, y un desplegable 'Marketing' que oculta lo nativo y muestra el iframe con marketing.html (metasShowFrame 4546, dbShowFrame 5065). Son dos editores de metas distintos, con dos almacenamientos distintos (selvadentro:metas frente a mkt_rrss_meta) y dos tablas de base de datos distintas. La diferencia más visible: del lado de Marketing SÍ hay un botón 'Exportar JSON' (marketing.html:993), y del lado de Ventas no hay ninguno — aunque el texto de ayuda de esa misma pantalla promete CSV y backup JSON (index.html:797).

**Por qué importa.** 'Entra a Metas y ponle 15' no es una instrucción que se pueda seguir sin ambigüedad: dos personas la siguen y acaban escribiendo en llaves distintas del kv, según cuál de los dos desplegables tocaron por último. Y el mismo botón del sidebar ofrece o niega la exportación según por dónde se entró, sin que nada explique por qué. Es la costura del iframe asomándose a la interfaz: un detalle de implementación que el usuario termina teniendo que entender.

**Cómo se arregla.** Que la vista deje claro en todo momento qué sistema se está editando: un encabezado que diga 'Metas · Marketing · Redes Sociales' en vez de dejarlo implícito en un desplegable. Y homologar lo que sí es una diferencia injustificada — la exportación debe existir en los dos lados o en ninguno.

### [BAJA] index.html descarga una familia tipografica entera que nunca usa

`fuentes-de-mas` · red · esfuerzo bajo

**Dónde:** `index.html:13`, `index.html:20`, `marketing.html:15`, `marketing.html:36`

**Qué encontramos.** index.html:13 pide a Google Fonts Cardo (3 cortes), Lexend (5 pesos: 300, 400, 500, 600, 700) y Yellowtail. Pero --script:'Yellowtail' (linea 20) no se usa como font-family en ninguna parte de index.html: la unica regla que lo aplica esta del otro lado, en marketing.html:36 (.brand .name). Y de Lexend, el CSS de index solo usa los pesos 400, 500, 600 y 700 — el 300 se descarga y no se pinta. marketing.html pide exactamente la misma hoja, asi que en la pestana Marketing todo se pide dos veces, en dos contextos de navegacion distintos.

**Por qué importa.** Peso de arranque que no rinde nada. En un celular con red lenta —el caso real del equipo en campo— cada familia extra retrasa el primer texto legible.

**Cómo se arregla.** Quitar Yellowtail y el peso 300 de la hoja de index.html; dejar Yellowtail solo en marketing.html, que si lo usa. Y anadir &display=swap ya esta; falta un preload del corte principal de Lexend.

### [BAJA] Las dos vistas de Dirección comparten un chasis copiado y recorren los mismos datos dos veces

`direccion-chasis-compartido` · duplicacion · esfuerzo bajo · −8 líneas

**Dónde:** `index.html:1807-1836`, `index.html:1837-1902`, `index.html:1813`, `index.html:1817`, `index.html:1843`, `index.html:1847`, `index.html:631`, `index.html:646`, `index.html:1761-1766`

**Qué encontramos.** Conviene decirlo primero: 'Dirección General' y 'Dirección Comercial' NO son la misma pantalla. Comercial añade una columna de conversión junto a cada métrica, la columna opp_14, el mix objetivo, una fila de totales y la comparación contra meta; General es la versión condensada. Son dos productos distintos y ambos se justifican. Lo que sí está duplicado es el andamiaje: las dos leen su rango con weekSetFromRange, pintan los mismos chips de canales, usan el mismo estadoDot/fmtMoney/pctTxt y llevan el MISMO texto de ayuda palabra por palabra (631 y 646). Y las dos repiten el mismo trabajo: primero recorren channelMetrics sobre los canales seleccionados (1813 y 1843) y después sobre los siete (1817 y 1847), así que los canales marcados se calculan dos veces por render. channelMetrics (1761) no cachea nada: cada llamada vuelve a recorrer todos los registros del canal. De paso, es una función síncrona a la que se le hace await en las cuatro llamadas.

**Por qué importa.** Es el hallazgo más leve del reporte y se incluye por completitud: hoy el costo es imperceptible porque los registros ya están en memoria. Importa por lo otro: el texto de ayuda repetido literalmente es señal de que las dos vistas se clonaron, y ahí es donde empiezan a separarse. Si mañana cambia la explicación de los chips, hay que acordarse de las dos.

**Cómo se arregla.** Calcular perCh una sola vez sobre los siete canales y derivar de ahí el subtotal de los seleccionados, en vez de recorrer dos veces. Quitar el await de channelMetrics o volverla async de verdad. Y el texto de ayuda, que salga de una constante compartida.


## Interfaz y experiencia (21)

### [ALTA] La navegación principal son <div>: no se puede llegar a las pestañas con el teclado

`foco-invisible` · a11y · esfuerzo medio

**Dónde:** `index.html:114`, `index.html:189`, `index.html:198`, `index.html:224`, `index.html:266`, `index.html:268`, `index.html:290`, `index.html:385`, `marketing.html:70`, `marketing.html:134`, `marketing.html:205`, `index.html:505-510`, `index.html:38-44`

**Qué encontramos.** Las 5 pestañas principales y las 4 sub-pestañas de Ventas no son botones sino <div class="tab" data-tab="…"> (index.html:531-536 y 546-549), sin tabindex, sin role y sin manejador de teclado — el clic se enlaza sobre el div (1632). Un div sin tabindex no recibe foco, así que con el teclado simplemente no hay forma de cambiar de pestaña. El mismo patrón se repite en los controles internos: las filas desplegables del árbol de Calidad de Leads son <tr> con onclick (2688, 2788, 3406), y las 4 sub-pestañas de Calidad de Leads son divs (.lq-subtab) y las tarjetas de Analítica son divs clicables. Verificado en los dos archivos: cero atributos aria-, cero role semánticos, cero tabindex. Conviene ser preciso sobre lo que sí funciona: los 5 botones de la barra lateral son <button> de verdad, igual que los 56 <button> de index.html y los 14 de marketing.html y no hay ningún outline:none global, así que conservan el anillo de foco por defecto del navegador. El problema del foco está acotado a los campos: las 11 reglas de outline:none (index.html 114, 189, 198, 224, 266, 268, 290, 385; marketing.html 70, 134, 205) lo sustituyen por un cambio de border-color a var(--cobre), y no existe ni una regla :focus-visible en todo el proyecto.

**Por qué importa.** Quien navegue con teclado —por preferencia o por necesidad— puede entrar al login, llenar el formulario de captura y usar los botones, pero no puede cambiar de pestaña: la navegación principal de la app es inalcanzable. Para un lector de pantalla la barra de pestañas tampoco existe como navegación; son divs con texto. Y al tabular por un formulario de cuarenta campos, el único indicador de dónde estás parado es un borde que apenas se distingue del fondo.

**Cómo se arregla.** (1) Convertir .tab y .subtab en <button type="button">: heredan foco y teclado sin tocar el JS, y el CSS casi no cambia. (2) Añadir role="tablist"/"tab"/"tabpanel" a la barra y las vistas. (3) Una regla global :focus-visible{ outline:2px solid var(--verde-prof); outline-offset:2px } y quitar los outline:none, o al menos acompañarlos siempre de ella. (4) Para las filas desplegables, un <button> dentro de la primera celda en vez del onclick sobre el <tr>.

### [ALTA] El boton principal de toda la app no pasa el minimo de contraste: 2.96:1

`contraste-boton-primario` · a11y · esfuerzo bajo

**Dónde:** `index.html:17`, `index.html:85`, `index.html:102`, `index.html:234`, `index.html:403`, `index.html:5647`, `index.html:28`, `index.html:36`

**Qué encontramos.** Ratios calculados con la formula WCAG 2.1 sobre los tokens reales del :root (index.html:16-21). Blanco sobre --cobre #CF8543 = 2.96:1, contra el minimo de 4.5:1 para texto normal. Ese par es .btn-primary (linea 102) — Guardar, Entrar, Crear y copiar liga — y .side-btn.active (85), donde ademas la letra es de 8.5px. Tambien falla --neutro #6F7468 sobre --crema-2 #F1ECE1 = 4.08:1, que es la pestana inactiva a 13px (38-40), y --arena #D9B37E sobre --verde-prof #465241 = 4.21:1 a 10px (28, 36). En el mismo sistema, --olivo si pasa: blanco sobre #65713F = 5.27:1.

**Por qué importa.** El cobre es la firma de la marca y el color de la accion principal, asi que el problema esta justo donde mas importa: el boton que hay que encontrar. Se nota en la pantalla de un celular al sol, que es exactamente donde un asesor revisa el reporte. No es un problema de gusto: es la diferencia entre leer y adivinar.

**Cómo se arregla.** No hay que cambiar la marca, solo el uso: oscurecer el cobre unicamente cuando lleve texto encima. #A65F22 sobre blanco da 4.6:1 y sigue leyendose como el mismo color; conviene como --cobre-texto, dejando --cobre tal cual para bordes, puntos y barras donde no hay texto. Para la pestana inactiva basta bajar --neutro a #5F6459 (5.1:1). El subtitulo de 10px en arena: subirlo a 11px y usar --logo #EFE7D6, que ya da 6.71:1 sobre el verde.

### [ALTA] La app no tiene layout movil: cuatro media queries en 7,200 lineas, todas retoques

`sin-mobile` · responsive · esfuerzo medio

**Dónde:** `index.html:150`, `index.html:342`, `index.html:380`, `marketing.html:142`, `index.html:38`, `index.html:77`, `index.html:106`, `index.html:170-171`, `marketing.html:59`, `marketing.html:122`, `index.html:399`, `index.html:384`, `index.html:315`

**Qué encontramos.** index.html tiene 3 @media y marketing.html 1. Las tres de index son ajustes puntuales a 680px (ancho de un input, tamano de un nombre, columnas de una barra); ninguna toca la estructura. La estructura no cede: .tabs es display:flex sin overflow-x ni flex-wrap y sin white-space en .tab (index.html:38), con 5 pestanas de padding 14px 22px mas dos selects; .sidebar es flex:0 0 70px con height:100vh y position:sticky (77) y nunca colapsa; .wrap lleva padding lateral de 28px por lado (72). En un telefono de 390px quedan 390 - 70 (sidebar) - 56 (padding) = 264px utiles, y dentro hay minimos que no caben: .lq-subtab min-width:190px x4 sub-pestanas = 760px (399), .lq-search min-width:280px (384), usr-table td.ch-col min-width:300px (315). Sobre las tablas, el patron correcto SI existe y esta bien aplicado donde mas importa: .table-scroll lleva overflow-x:auto (170) y envuelve las 19 tablas .cons, que son las anchas (table.cons lleva white-space:nowrap, 171). El hueco esta en el resto: 8 de las 30 tablas de index.html quedan fuera (lineas 1515, 1825, 1879, 2030, 3163, 3965, 4614, 4641 — .rep, .fnl y .metas-table) y en marketing.html quedan fuera 10 de 12. Y ahi el sintoma es peor que el scroll: esas tablas viven dentro de .section (index.html:106), .card (marketing.html:59) y .meta-section-mkt (marketing.html:122), y las tres declaran overflow:hidden por el borde redondeado. Cuando una tabla excede el ancho, las columnas de la derecha se RECORTAN sin barra de scroll: no hay nada que indique que faltan. A eso se suma la topbar: es un grid de 1fr auto 1fr con padding lateral de 32px y el logotipo a 38px (index.html:24 y 32), así que su ancho mínimo supera los 390px y empuja el botón “Salir” fuera de la pantalla. La barra de pestañas ya desborda en tablet, no solo en celular.

**Por qué importa.** El equipo comercial revisa numeros desde el celular. Ahi la barra de pestanas —la navegacion principal— se comprime y los rotulos se parten en varios renglones mientras los dos selects mantienen su ancho, asi que la barra se deforma en vez de poder desplazarse. Y en las tablas que quedaron fuera de .table-scroll el dano es silencioso: el contenedor recorta las columnas sobrantes sin dejar barra, o sea que el usuario no ve el dato y tampoco ve que falta un dato.

**Cómo se arregla.** Tres reglas cubren casi todo sin rediseno: (1) un @media(max-width:900px) que pase .shell a column y la .sidebar a barra horizontal con overflow-x:auto — marketing.html:142 ya hace exactamente eso, es copiar el patron que el propio repo ya resolvio; (2) overflow-x:auto en .tabs y .subtabs; (3) envolver en .table-scroll las 18 tablas que faltan, o —mas barato— cambiar overflow:hidden por overflow:clip solo en el eje vertical en .section, .card y .meta-section-mkt, para que el borde redondeado se conserve y el eje horizontal pueda desplazarse. Los min-width de .lq-subtab y .lq-search deben ceder a min-width:0 en movil.

### [ALTA] Cinco mecanismos de navegación compiten por el mismo espacio, y dos reportes grandes están escondidos dentro de un select

`nav-cinco-mecanismos` · navegacion · esfuerzo medio

**Dónde:** `index.html:508-528`, `index.html:531-536`, `index.html:546-550`, `index.html:537-544`, `marketing.html:184-189`, `marketing.html:31-33`, `index.html:1738`, `index.html:5123-5128`

**Qué encontramos.** La app navega por cinco vías a la vez: barra lateral (Metas, Asesores, Base datos, Diagnóstico, Admin), barra de pestañas (Dirección General, Dirección Comercial, Ventas, CRM en vivo, Marketing), sub-pestañas de Ventas (Ingreso de datos · Reporte · Analítica), DOS selects distintos que llevan la misma etiqueta “Reporte” en el mismo hueco de la barra (537-544), y la navegación propia del iframe de Marketing. Esa última se suma porque showMarketing (1738) solo asigna el src y nunca llama a mktSetEmbedMode(true) — a diferencia de metasShowFrame y dbShowFrame, que sí lo hacen. Y body.embed es justo lo que oculta el .tabrow y la .periodbar del iframe (marketing.html:31-32). Resultado: en la pestaña Marketing aparecen otra fila de pestañas con los rótulos “Ingreso de datos · Reporte · Analítica” —los mismos tres de Ventas— y otra barra de periodo. Encima, dos reportes de peso completo no tienen pestaña propia y viven dentro del select de canal: “Desempeño de Ventas” (que según el comentario de 5121-5122 antes SÍ era una pestaña) y “Calidad de Leads”, que es una vista con cuatro sub-pestañas y un árbol de tres niveles.

**Por qué importa.** No hay regla que permita adivinar dónde está algo. Diagnóstico es un reporte del CRM pero vive con los ajustes; Metas es configuración pero cambia de sistema según la pestaña en la que estés; y los mismos tres rótulos “Ingreso de datos / Reporte / Analítica” describen dos árboles distintos en dos alturas de la pantalla. “Entra a Ingreso de datos y captura la semana” es una instrucción ambigua. Lo más costoso es que los dos reportes escondidos en el select son de los más consultados: nadie encuentra un reporte dentro de un desplegable que dice “Reporte” pero que en realidad elige el canal.

**Cómo se arregla.** Tres decisiones, ninguna cara: (1) sacar “Desempeño de Ventas” y “Calidad de Leads” a pestañas propias, que es lo que son; (2) renombrar los dos selects para que digan qué eligen —“Canal” y “Módulo”— en vez de los dos “Reporte”; (3) llamar a mktSetEmbedMode(true) también desde showMarketing y dar la sub-navegación de Marketing en la barra de sub-pestañas del padre, para que exista una sola fila de sub-pestañas en toda la app.

### [ALTA] En iPhone, la pantalla se acerca sola en cada campo y no se vuelve a alejar

`ios-zoom-captura` · responsive · esfuerzo bajo

**Dónde:** `index.html:96`, `index.html:113`, `index.html:198`, `index.html:224`, `index.html:308`, `index.html:311`, `marketing.html:66`

**Qué encontramos.** Safari en iOS acerca la página automáticamente cuando se enfoca un campo cuya letra mide menos de 16px, y no la vuelve a alejar al salir del campo. Verificado: en index.html prácticamente ningún campo llega a 16px. .periodo input[type=date] y .periodo select van a 13px (96); .frow input —los cuarenta campos numéricos del formulario de captura— a 14px (113); .login-field input a 14px (224); los campos de la tabla de usuarios a 13px (308-311). De todas las reglas de campo del archivo, una sola llega a 16px. El viewport sí permite el zoom (no hay user-scalable=no), que es lo correcto, pero eso es justo lo que deja actuar al auto-zoom.

**Por qué importa.** La pestaña principal de la app se llama “Ingreso de datos” y consiste en teclear decenas de números. En un iPhone, cada vez que se toca un campo la pantalla se acerca, y como no se aleja sola hay que hacer pellizco para volver a ver el formulario completo — campo por campo, cuarenta veces. Es la clase de fricción que hace que la gente deje de capturar desde el celular y lo posponga hasta llegar a una computadora, que es exactamente lo que un reporte semanal no puede permitirse.

**Cómo se arregla.** Subir a 16px la letra de los campos, al menos en pantallas chicas: @media(max-width:700px){ input,select,textarea{ font-size:16px } }. Es una regla y resuelve el problema completo sin tocar el diseño de escritorio.

### [MEDIA] Cada toggle de Calidad de Leads reconstruye la pantalla entera; el codigo ya trae el parche que lo delata

`lqrender-rerender-total` · rendimiento-ux · esfuerzo medio

**Dónde:** `index.html:3396`, `index.html:3399-3403`, `index.html:3405-3411`, `index.html:3418-3419`, `index.html:3119-3427`

**Qué encontramos.** lqRender (3119-3427, ~300 lineas) termina en document.getElementById('lq-content').innerHTML = out (3396). Y TODA interaccion del tab vuelve a llamarla entera: cambiar de sub-pestana (3400), cambiar el nivel campana/conjunto/anuncio (3401), cambiar de plataforma (3402), cambiar el filtro de calificacion (3403), desplegar o plegar una fila del arbol (3405-3411) y teclear en el buscador (3418). La prueba de que duele esta en el propio codigo: el handler del buscador tiene que re-enfocar el input y reponer el cursor a mano despues de cada render — el.focus(); el.setSelectionRange(el.value.length, el.value.length) (3419) — porque el input que el usuario esta usando se destruye y se vuelve a crear con cada tecla. Y hay un desperdicio adicional: todo el contenido de la sub-pestaña 'Calidad de Lead' se construye SIEMPRE, sin condición —los bloques html += de las líneas 3128 a 3378, que incluyen la tabla por nivel, los duplicados por teléfono y email, reglas automáticas contra captura del equipo, etapa del pipeline, inversión por campaña y metodología— y recién en la línea 3380 se decide si se usa: const calidadHtml = html; … if(SUB==="calidad"){ out += calidadHtml; }. Es decir que en tres de las cuatro sub-pestañas ese trabajo se hace entero y se tira.

**Por qué importa.** Tres sintomas para quien usa el tab: (1) el cursor del buscador siempre salta al final, asi que no se puede corregir una letra en medio de lo escrito; (2) al desplegar una campana en un arbol largo la pagina pierde el scroll y hay que volver a bajar; (3) con 12 semanas de leads el arbol de campana>conjunto>anuncio se reconstruye completo en cada clic. Es la pantalla mas usada del modulo de marketing.

**Cómo se arregla.** Separar lqRender en 'armar la cabecera y los controles' (una vez) y 'armar la tabla' (por cambio). Para desplegar/plegar basta con alternar una clase en la fila en vez de reconstruir: el estado ya vive en lqState.exp. Para el buscador, filtrar filas ya pintadas con display:none en vez de re-renderizar — eso ademas borra la necesidad del parche de foco. Y mover la construcción de calidadHtml adentro de su rama: hoy se paga en las cuatro sub-pestañas y solo sirve en una.

### [MEDIA] Cuatro bucles que reintentan para siempre: si algo no carga, la pantalla se queda esperando sin decirlo

`polling-sin-fin` · estados · esfuerzo bajo · −12 líneas

**Dónde:** `index.html:4552-4557`, `index.html:5084-5089`, `index.html:4099`, `index.html:4282`

**Qué encontramos.** Cuatro sitios reintentan con setTimeout sin contador, sin tope de tiempo y sin salida de error. Dos son el puente con el iframe de marketing: metasShowFrame (4552-4557) y dbShowFrame (5084-5089) esperan a que el iframe exponga su API con const apply = ()=>{ ... else { setTimeout(apply, 150); } }. Los otros dos esperan a que cargue Chart.js desde el CDN: renderDirAnalitica (4099) y renderAnalitica (4282), ambos con if(!window.Chart){ ...'Cargando librería de gráficas…'; setTimeout(..., 300); return; }. En los cuatro casos, si el recurso no llega nunca —red caída, CDN bloqueado por una red corporativa, un 404 tras un deploy a medias— el temporizador sigue disparando indefinidamente.

**Por qué importa.** Un fallo permanente se ve exactamente igual que 'está cargando'. En las gráficas el usuario ve 'Cargando librería de gráficas…' para siempre; en Metas y Base de datos ve una pantalla en blanco para siempre. En ninguno de los cuatro casos la app llega a decir que algo falló, así que el usuario no sabe si esperar más o recargar. Y como Chart.js viene de un CDN externo, basta una red que lo bloquee para que dos vistas completas queden en ese estado.

**Cómo se arregla.** Un solo helper compartido por los cuatro: reintentar con tope (40 intentos, unos 6-12 segundos) y al agotarse mostrar un mensaje concreto con botón de reintento — 'No se pudo cargar la librería de gráficas' o 'No se pudo cargar el módulo de Marketing'. Para Chart.js conviene además servirlo desde el propio sitio en vez del CDN: es un archivo, elimina la dependencia externa y quita el modo de falla.

### [MEDIA] El sistema de diseno se erosiono: 25 tamanos de letra, 15 radios y 214 estilos en linea

`sistema-diseno-erosionado` · consistencia · esfuerzo medio

**Dónde:** `index.html:15-426`, `index.html:16-21`, `marketing.html:17-219`

**Qué encontramos.** Medido sobre el CSS de index.html: 25 valores distintos de font-size (8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 15.5, 16, 17, 18, 19, 20, 22, 23, 26, 28, 36, 38 px) — una escala sana tiene 6 a 8 pasos — y 50 declaraciones por debajo de 12px. 15 valores distintos de border-radius (2,3,4,6,7,8,9,10,11,12,14,16,20,30,999). 214 atributos style= en index.html y 96 en marketing.html, muchos dentro de template strings, o sea fuera del alcance de la hoja de estilos. Y colores fuera del sistema: #a94436 (rojo de error) aparece 21 veces sin ser variable, mas #bb7536 y #566034, que son los hover de --cobre y --olivo escritos a mano. El :root define 15 tokens (16-21); el resto del archivo los contradice a mano. El desglose exacto de los estilos en línea explica por qué la hoja de estilos perdió el control: de los 214 atributos style= de index.html, 0 están dentro del bloque <style>, 23 en el markup y 191 dentro de template literals de JavaScript — es decir, el 89% del estilo en línea se genera en tiempo de ejecución, fuera del alcance de cualquier hoja. A eso se suman 99 asignaciones directas de .style.propiedad desde el JS.

**Por qué importa.** Nada de esto se ve roto en una pantalla, pero se acumula: cada cambio de aspecto hay que hacerlo en la hoja y luego cazarlo en 214 estilos en linea. Y los 50 tamanos por debajo de 12px son la razon de fondo de que la app se lea con esfuerzo en pantallas chicas.

**Cómo se arregla.** No es un rediseno: es fijar una escala y bajar a ella. (1) Reducir a 7 pasos de font-size (11, 12, 13, 14, 16, 20, 28) y a 4 radios (6, 10, 14, 999). (2) Promover a token los tres colores que ya se repiten: --rojo #a94436, --cobre-hover #bb7536, --olivo-hover #566034. (3) Los estilos en linea de los template strings que se repiten (margin-bottom:18px sobre .table-scroll aparece 8 veces) valen una clase.

### [MEDIA] 39 diálogos nativos del navegador dentro de una app con diseño propio, incluido un prompt() para entregar el acceso

`alert-confirm-nativos` · consistencia · esfuerzo medio

**Dónde:** `index.html:1437`, `index.html:5019`, `index.html:5343`, `index.html:5912`, `index.html:4395`, `marketing.html:778`, `marketing.html:928`, `index.html:1600`, `index.html:148`

**Qué encontramos.** Contados: index.html tiene 14 alert(, 10 confirm( y 1 prompt(; marketing.html suma 8 alert y 6 confirm. Conviven con el sistema propio de avisos —toast en index.html:1600 con su CSS en 148, y showToast en marketing.html:255. Los confirm están bien escritos y son útiles: el de borrar un asesor sugiere marcarlo Inactivo en vez de eliminarlo (4395) y el de borrar un registro advierte que no se puede deshacer (5019). El problema no es que existan sino cómo se ven y dónde aparecen. Dos casos destacan: loadMod lanza un alert de tres renglones con saltos de línea escritos a mano cuando falla una lectura (marketing.html:778), y la entrega de la liga mágica de acceso a un usuario nuevo pasa por un prompt() (index.html:5343) — un cuadro de texto del navegador es el mecanismo con el que un admin le pasa a alguien su acceso al sistema.

**Por qué importa.** Un alert() del navegador bloquea toda la pagina, se ve como un error del sistema y no como parte de la app, y en el movil aparece con el estilo del navegador encima de un diseno cuidado. Rompe la sensacion de producto terminado justo en los momentos de error, que son cuando mas importa que la app parezca confiable.

**Cómo se arregla.** El toast ya existe para los avisos. Falta un dialogo de confirmacion propio —unas 20 lineas— para los 16 confirm(: los tres botones de borrar (registro, usuario, asesor) son los que mas se notan. Los alert() de error deberian ser un bloque de error dentro de la vista, no un dialogo modal.

### [MEDIA] Ninguna vista tiene URL: no se puede compartir un reporte ni recargar sin perder el sitio

`sin-url-por-vista` · navegacion · esfuerzo medio · −10 líneas

**Dónde:** `index.html:1603-1629`, `index.html:5507`

**Qué encontramos.** La unica aparicion de history en index.html es history.replaceState en bootAuth (5507), y sirve para limpiar el token de invitacion de la barra de direcciones — no para navegar. No hay pushState, ni hashchange, ni popstate. En su lugar la app tiene un historial propio: navPush / navUpdateButtons / navGo (1603-1629) con los botones flecha de la barra superior (index.html:497-500).

**Por qué importa.** Tres consecuencias diarias: (1) no se puede mandar por WhatsApp un enlace a 'SLA, semanas 30 a 34' — hay que explicar la ruta de clics; (2) al recargar se vuelve siempre al inicio, y en las pestanas que sincronizan eso puede disparar otra sincronizacion completa; (3) el boton Atras REAL del navegador no navega dentro de la app: saca de la app. Los botones flecha propios ensenan al usuario que hay historial, y luego el del navegador se comporta distinto — dos historiales que no coinciden.

**Cómo se arregla.** Reflejar la vista en el hash (#/sla?ini=2026-W30&fin=2026-W34) y escuchar hashchange. navPush ya centraliza los cambios de vista, asi que es un solo punto donde escribir el hash. Con eso los botones flecha propios se pueden borrar: el del navegador hace el trabajo y ya no hay dos historiales.

### [MEDIA] Las sincronizaciones largas no se pueden cancelar y no se coordinan entre usuarios

`sync-sin-cancelar` · estados · esfuerzo medio

**Dónde:** `index.html:2037-2065`, `index.html:3451-3523`, `index.html:4012-4062`, `index.html:2079`, `index.html:3537`

**Qué encontramos.** Los tres motores (crmSync 2037, lqSync 3451, slaSync 4012) se protegen con un flag local — if(crmState.syncing) return — que solo existe dentro de la pestana del navegador que lo abrio. No hay AbortController, ni boton de cancelar, ni marca de 'sincronizando' compartida en el kv. Ademas dos de los tres arrancan solos al entrar a la vista si el cache tiene mas de 30 minutos (2079 y 3537), mientras que SLA es siempre manual. Y cuando no se conoce el total, la barra de progreso muestra un porcentaje inventado: 50 en crmSync (2050) y 45 en lqSync (3469).

**Por qué importa.** El reporte de SLA tarda de 1 a 3 minutos segun el propio texto de la pantalla (index.html:699) y no hay forma de detenerlo ni de saber cuanto falta de verdad. Si dos personas abren Calidad de Leads al mismo tiempo, se lanzan dos recorridos completos del CRM contra la misma cuenta de GoHighLevel. Y quien solo pasaba por la pestana dispara un recorrido completo sin haberlo pedido.

**Cómo se arregla.** (1) Un boton Cancelar con AbortController en los tres. (2) Una marca de 'en curso' en el kv con su hora, para que la segunda persona vea 'Diana esta sincronizando, empezo hace 40 s' en vez de lanzar otro. (3) Cuando no se conozca el total, mostrar una barra indeterminada en vez de un porcentaje inventado. (4) Preguntar antes de auto-sincronizar al entrar, o al menos avisarlo.

### [MEDIA] Solo 3 de las 9 functions validan su configuración; las otras 6 revientan sin decir por qué

`env-sin-validar` · estados · esfuerzo bajo

**Dónde:** `netlify/functions/lib/shared.js:20-27`, `netlify/functions/auth.js:41`, `netlify/functions/invite.js:120`, `netlify/functions/kv.js:48`

**Qué encontramos.** shared.js exporta missingEnv() (20-27), que revisa SUPABASE_URL, SUPABASE_ANON_KEY, KV_API_SECRET y SESSION_SECRET y devuelve las que falten. Verificado con grep: solo la llaman tres handlers — auth.js:41, invite.js:120 y kv.js:48. Las otras seis (ghl-report, lead-quality, sla-report, kpi-analyze, notes-analyze, lq-analyze) no la llaman nunca, aunque las seis usan S.authFromEvent, que necesita SESSION_SECRET para verificar el HMAC. Si esa variable falta, crypto.createHmac('sha256', undefined) lanza y la function responde 502 sin pasar por el json() que pone las cabeceras.

**Por qué importa.** Es un modo de falla que solo aparece el día que alguien toca las variables del site o levanta un entorno nuevo, y ese día el síntoma es engañoso: el navegador reporta un error de CORS —porque la respuesta de error no trae las cabeceras— en vez de decir que falta una variable. Se puede perder una tarde buscando en el lugar equivocado.

**Cómo se arregla.** Una línea al inicio de cada handler, igual que ya hacen auth, invite y kv: const miss = S.missingEnv(); if (miss.length) return json(500, { error: 'Faltan variables: ' + miss.join(', ') }); y extender missingEnv para que reciba las variables extra de cada function (GHL_API_KEY, WINDSOR_API_KEY, ANTHROPIC_API_KEY) en vez de que cada una las revise a su manera.

### [MEDIA] Las gráficas de Analítica se acumulan en memoria al cambiar de canal

`chart-fuga` · rendimiento-ux · esfuerzo bajo

**Dónde:** `index.html:4167`, `index.html:4264-4266`, `index.html:4277`, `index.html:4321`

**Qué encontramos.** El id de cada canvas incluye el canal: const canvasId = `anal-c-${chKey}-${f.k}` (4321). analDrawChart solo destruye la instancia anterior si se vuelve a dibujar EXACTAMENTE ese mismo id: if(ANAL_STATE.charts[canvasId]){ ANAL_STATE.charts[canvasId].destroy(); } (4266). Y ANAL_STATE.charts (4167) no se purga nunca al cambiar de canal — no hay ninguna otra referencia que lo vacíe. Así que al pasar de Brokers a Paid Orgánico, las instancias de Chart.js del canal anterior siguen vivas, apuntando a canvas que ya se desprendieron del DOM.

**Por qué importa.** Cada canal visitado deja atrás sus gráficas. En una sesión larga —que es lo normal en una junta de revisión semanal, saltando entre los siete canales— la pestaña acumula instancias y se va poniendo lenta, sin una causa visible. Chart.js registra manejadores de resize por instancia, así que cada redimensionamiento de la ventana también recorre las muertas.

**Cómo se arregla.** Vaciar el registro al cambiar de canal: en switchChannel, Object.values(ANAL_STATE.charts).forEach(c=>{try{c.destroy()}catch(e){}}); ANAL_STATE.charts={}. El módulo de Calidad de Leads ya hace exactamente eso con lqState._charts (index.html:2983) — es el mismo patrón, aplicado en un sitio y no en el otro.

### [MEDIA] Reordenar KPIs en Metas solo funciona con ratón: no hay ningún manejador táctil

`drag-sin-tactil` · responsive · esfuerzo medio

**Dónde:** `index.html:4853`, `index.html:4866`, `index.html:4880`, `index.html:4897`

**Qué encontramos.** El reordenamiento de KPIs y secciones en el editor de Metas está construido sobre la API de arrastre de escritorio de HTML5: ondragstart (4853 y 4866), ondragover (4880) y ondrop (4897). Verificado por conteo: cuatro manejadores de arrastre y CERO de touchstart, touchmove o pointerdown en todo index.html. Los eventos de drag de HTML5 no se disparan con el dedo en iOS ni en Android.

**Por qué importa.** Desde un celular o una tablet, el orden de los KPIs simplemente no se puede cambiar: el usuario arrastra y no pasa nada, sin ningún mensaje que explique por qué. Y como no hay alternativa —no hay flechas de subir/bajar ni un campo de posición— la función queda reservada a quien esté en una computadora.

**Cómo se arregla.** Lo más barato y lo más robusto es no depender del arrastre: añadir dos botones ↑ ↓ en cada fila, que además hacen la función accesible por teclado y por lector de pantalla. El arrastre puede quedarse como atajo para quien use ratón.

### [MEDIA] La tarjeta de login se puede quedar sin salida cuando el teclado está abierto

`login-sin-scroll` · responsive · esfuerzo bajo

**Dónde:** `index.html:213`, `index.html:215`, `index.html:224`

**Qué encontramos.** #login-screen es position:fixed con inset:0, display:flex y align-items:center (213), y no declara overflow-y. En un contenedor fijo y centrado, si el contenido es más alto que el área visible, el excedente se recorta por arriba y por abajo y no hay forma de desplazarlo. La tarjeta mide padding:38px 42px con max-width:400px (215) y, en el paso de invitación, contiene título, subtítulo y DOS campos de contraseña más el botón — el formulario más alto de los tres.

**Por qué importa.** Se manifiesta en dos situaciones normales: un celular en horizontal, y un celular en vertical con el teclado abierto, que reduce el alto visible a menos de la mitad. En ambos casos el botón de entrar puede quedar fuera de la pantalla sin manera de bajar hasta él. El caso más delicado es justo el paso de invitación: es el primer contacto de la persona con el sistema y llega por WhatsApp, o sea desde el celular.

**Cómo se arregla.** Añadir overflow-y:auto a #login-screen y cambiar align-items:center por align-items:safe center, que centra cuando cabe y alinea arriba cuando no, en vez de recortar por los dos lados.

### [MEDIA] El significado de varias columnas vive solo en un tooltip, y en celular no hay tooltips

`title-unico-canal` · consistencia · esfuerzo bajo

**Dónde:** `index.html:2751-2752`, `index.html:487`, `index.html:498-499`

**Qué encontramos.** La tabla de Calidad de Leads imprime encabezados abreviados y guarda el nombre real en el atributo title: ${LQ_COLS.map(L=>`<th title="${L.name}">${L.short}</th>`)} (2751). En la misma fila, la definición de negocio de OPP —“oportunidad real de cierre: Seguimiento de OPP, Carta oferta, Apartado o posterior; la cotización enviada aún no cuenta”, que es una regla acordada con el cliente— existe únicamente dentro de un title. En total hay 42 atributos title en index.html. En una pantalla táctil no hay hover: el tooltip no aparece nunca.

**Por qué importa.** Desde el celular, varias columnas de la tabla más importante del módulo de marketing son abreviaturas sin significado disponible. Y la definición de OPP —el concepto que más confusión ha causado, al punto de que hubo que confirmarlo con el cliente— es invisible justo para quien consulta desde el teléfono.

**Cómo se arregla.** Sacar del tooltip lo que es contenido: una fila de leyenda arriba de la tabla, o una nota al pie desplegable con las definiciones de OPP, WON y las abreviaturas de columna. El title puede quedarse como refuerzo para quien use ratón, pero no puede ser el único lugar donde vive la información.

### [MEDIA] El formulario no valida nada: lo pegado desde Excel se guarda como 0 y no hay estado de error por campo

`captura-sin-validacion` · formularios · esfuerzo medio

**Dónde:** `index.html:1395`, `index.html:1414`, `marketing.html:251`, `marketing.html:335`, `index.html:113-114`

**Qué encontramos.** Los campos se generan como <input type="number" step="…"> sin min, sin max y sin required (1395), y el valor se lee con data[f.k] = el && el.value!=="" ? Number(el.value) : 0 (1414). Con type=number, el navegador rechaza el contenido que no es un número puro y deja value en cadena vacía: pegar «1,200» o «$1,200» desde Excel —que es como salen los números de una hoja de cálculo— produce un 0, sin aviso y sin diferencia visible frente a un campo que de verdad vale 0. Tampoco hay reglas de consistencia (nada impide que los OPP superen a los leads) ni ningún estilo de error: el CSS del formulario solo conoce reposo y foco (113-114), no existen clases .error ni aria-invalid. Y los dos formularios de la app usan convenciones opuestas: marketing.html captura con type=text y una función num() que limpia el texto (251, 335), así que el mismo «1,200» da 0 en Ventas y 1200 en Marketing.

**Por qué importa.** Un 0 que debía ser 1,200 no se distingue a simple vista de un 0 legítimo, y arrastra todo lo que se calcula encima: conversiones, costo por lead, cumplimiento de metas y el semáforo verde/rojo del reporte de Dirección. Como no hay validación de rango ni de consistencia, tampoco hay nada que detecte después que el número es imposible.

**Cómo se arregla.** (1) Homologar la captura a la convención de marketing.html, que es la más tolerante: type=text con inputmode=numeric y una función que limpie comas, espacios y símbolo de moneda antes de convertir. (2) Añadir min=0 a los conteos. (3) Un aviso —no un bloqueo— cuando el embudo sea imposible (OPP > leads), con el campo marcado en rojo en vez de un toast genérico.

### [MEDIA] Los botones deshabilitados se ven exactamente igual que los activos

`disabled-sin-diseno` · estados · esfuerzo bajo

**Dónde:** `index.html:101-104`, `index.html:80-81`, `index.html:201`, `index.html:2042`, `index.html:4016`, `index.html:3055`

**Qué encontramos.** El JS deshabilita botones en 14 sitios distintos (.disabled = true), sobre todo durante las sincronizaciones largas y las llamadas a IA. Pero el sistema de botones no tiene estado deshabilitado: verificado, no existe ninguna regla .btn:disabled, .btn-primary:disabled ni .btn-olive:disabled. Las tres únicas reglas :disabled del archivo son para otros elementos: las flechas de navegación (80-81, opacity .3) y el botón de guardar de Asesores (201, solo cambia el cursor). Justo es reconocer que sí hay una señal: el código cambia el texto del botón mientras trabaja —«Sincronizando…», «Generando…», «Analizando…»— así que el usuario no queda del todo a ciegas.

**Por qué importa.** Durante el reporte de SLA, que tarda de 1 a 3 minutos, el botón sigue viéndose idéntico a un botón pulsable: mismo color, mismo cursor de mano, mismo efecto al pasar el ratón. Lo único que cambió es la palabra. Quien no la lea vuelve a pulsar, no pasa nada, y la conclusión natural es que la app se trabó —justo cuando lo que hay que hacer es esperar.

**Cómo se arregla.** Una regla para todo el sistema: .btn:disabled{ opacity:.55; cursor:progress; pointer-events:none } — y usar cursor:progress en vez de not-allowed en las esperas, porque comunica «está trabajando» en lugar de «no puedes». Con el cambio de texto que ya existe, queda resuelto.

### [MEDIA] “Reporte” nombra cuatro cosas distintas y hay ocho verbos para la misma acción

`vocabulario-sin-normalizar` · consistencia · esfuerzo bajo

**Dónde:** `index.html:538`, `index.html:542`, `index.html:548`, `index.html:602`, `index.html:628`, `index.html:643`, `index.html:677`, `index.html:693`, `index.html:707`, `index.html:502`

**Qué encontramos.** La palabra «Reporte» aparece con cuatro sentidos, tres de ellos visibles al mismo tiempo en la barra superior: la etiqueta del selector de canal (538), la etiqueta del selector de módulo de marketing (542, misma palabra y mismo aspecto para otra cosa), la sub-pestaña «Reporte» de Ventas (548), y el documento que produce el botón «Generar reporte». En paralelo, los botones que ocupan la misma posición —extremo derecho de la barra de periodo— y hacen conceptualmente lo mismo (pedir datos y pintarlos) usan ocho verbos distintos: «Generar reporte» (602, 628, 643, 693), «Sincronizar CRM» (677), «Sincronizar leads», «Probar conexiones», «Buscar», «Recargar», «Analizar con IA» y «Generar conclusión con IA». Y el rol del usuario se imprime con el identificador interno en inglés: <span class="role">user</span> (502). Hay que decir que el español del resto de la app está bien escrito y bien acentuado — no es un problema de redacción sino de vocabulario sin normalizar.

**Por qué importa.** Obliga a aprender la app en vez de deducirla. Alguien nuevo no puede saber si «Sincronizar leads» y «Generar reporte» hacen cosas parecidas o muy distintas, ni por qué el mismo desplegable en el mismo lugar se llama «Reporte» en dos pestañas y elige cosas diferentes. Y en un equipo comercial mexicano, ver «user» como descripción del propio rol es simplemente el sistema hablando en su idioma y no en el del usuario.

**Cómo se arregla.** Una tabla de vocabulario y bajar a ella: «Reporte» solo para el documento; los selectores pasan a llamarse «Canal» y «Módulo»; los botones que traen datos del CRM dicen todos «Actualizar desde el CRM» y los que arman un documento, «Generar reporte». Los roles se muestran como «Administrador» y «Usuario», dejando los slugs para el código.

### [MEDIA] SQL, MQL, CQL y OPP se usan como encabezados en varias pantallas y solo se explican en una

`jerga-sin-glosario` · consistencia · esfuerzo bajo

**Dónde:** `index.html:2101-2107`, `index.html:2752`, `index.html:2841`, `index.html:3374-3375`, `index.html:1829`

**Qué encontramos.** Las siglas de calificación se declaran como nombres de nivel sin ninguna glosa (2101-2107: «SQL Selvadentro» con abreviatura «SQL SD», «SQL», «MQL», «CQL») y se usan como encabezados de columna en las tablas de Calidad de Leads, en el desglose por nivel y en el reporte combinado. «OPP» y «WON» aparecen en la tabla consolidada de Dirección (1829). La única explicación de OPP que existe en la interfaz vive dentro de un atributo title —o sea, invisible en cualquier pantalla táctil— y de MQL, CQL y SQL no hay definición en ninguna parte de la app: están en el README, que el equipo comercial no lee.

**Por qué importa.** Son las siglas sobre las que gira la conversación de resultados, y la app las da por sabidas. Quien entra nuevo al equipo tiene que preguntar qué distingue un MQL de un CQL, y como cada quien recibe la respuesta de una persona distinta, las definiciones se van separando — que es exactamente el problema que la calificación automática por reglas vino a resolver.

**Cómo se arregla.** La pestaña de Diagnóstico ya existe para responder este tipo de preguntas con datos del sistema: es el sitio natural para publicar el glosario —las cinco calificaciones, OPP, WON— junto a las etapas reales del pipeline que ya lista. Y una leyenda plegable encima de las tablas que usan las siglas, para no obligar a cambiar de pantalla.

### [BAJA] La marca dice 'Clic para cambiar el logo' y no hay forma de cambiar el logo

`logo-promesa-falsa` · consistencia · esfuerzo bajo · −6 líneas

**Dónde:** `index.html:487`, `index.html:1575-1583`, `index.html:1542-1552`, `marketing.html:1234`, `marketing.html:746`

**Qué encontramos.** index.html:487 declara <div class='brand' id='brand' title='Clic para cambiar el logo'>. El unico handler que se le conecta es setupBrandPhrase (1575), que ademas le sobreescribe el title a 'Click para una dosis de energia' y muestra una frase motivacional al azar. En index.html no hay ningun input de archivo, ningun FileReader y ningun escritor de la llave selvadentro:logo: loadLogo (1542) solo la LEE, asi que siempre cae al PNG del CDN de GoHighLevel. El unico cargador de logo real vive del otro lado del iframe (marketing.html:1234) y escribe en otra llave, mkt_logo (746). Ademas el bloque de loadLogo que lee window.fs.readFile (1546-1549) es herencia del prototipo en Claude: window.fs no existe en un navegador, asi que esas cuatro lineas y su lista de ocho nombres de archivo nunca se ejecutan.

**Por qué importa.** Poco dano, pero es exactamente el tipo de detalle que hace que la gente deje de confiar en los tooltips de una app: prometen algo que no pasa. Y dos sistemas de logo con dos llaves distintas garantizan que el logo del iframe y el de la app puedan verse diferentes.

**Cómo se arregla.** Decidir cual gana. Si el logo se cambia, subir el cargador de marketing.html a index.html y usar una sola llave. Si no se cambia, quitar el title enganoso, quitar el bloque de window.fs y dejar el easter egg de la frase con un title honesto.


## Lo que ya está bien

- **El backend está bien cerrado** — La tabla `slvd_kv` tiene RLS sin policies y todo pasa por un RPC con secreto que solo vive en el servidor. El cliente nunca ve la lista de usuarios ni los hashes. La migración de agosto quedó bien hecha.
- **Las ligas mágicas están bien pensadas** — Firmadas con dominio HMAC separado (`inv:`) para que una invitación jamás sirva como sesión, de un solo uso con nonce, caducidad de 7 días, y el token viaja en el hash para que no llegue al servidor ni a los logs. `bootAuth` hasta limpia la barra de direcciones con `replaceState`.
- **Los comentarios explican el porqué, no el qué** — Varios bloques documentan la decisión de negocio y la fecha en que se tomó — por qué “Cotización enviada” no cuenta como OPP, por qué el reloj del SLA corre 24/7, por qué una lectura fallida ya no sobrescribe con la semilla. Eso es lo que hace mantenible un archivo de 380 KB sin pruebas.
- **Asesores ya resuelve bien lo que Ingreso no** — Marca cambios sin guardar, deshabilita el botón cuando no hay nada que guardar, avisa “Tienes cambios sin guardar” y confirma antes de borrar sugiriendo marcar Inactivo en su lugar. El patrón correcto ya existe en la casa: falta llevarlo al formulario de captura.

## Método

Diez revisiones independientes recorrieron el código en paralelo por dimensión —duplicación
de lógica, código muerto, red y caché, navegación, accesibilidad, responsive, estados de carga
y error— y cada hallazgo se verificó uno por uno contra el archivo antes de entrar aquí.

Esa verificación descartó cosas: contenedores señalados como vacíos que sí se llenan (los ids
se arman con plantillas, así que una búsqueda literal no los encuentra); un doble render de
arranque que resultó ser una optimización deliberada y comentada; y una afirmación propia de
que ningún control tenía estado de foco, cuando los botones sí son `<button>` reales.

Las cifras duras —ratios de contraste, conteos de reglas CSS, bytes de código muerto,
referencias por símbolo— se calcularon sobre los archivos, no se estimaron.

No se propone migrar a React ni introducir un build step: la restricción de *sin build*
es una decisión del proyecto.
