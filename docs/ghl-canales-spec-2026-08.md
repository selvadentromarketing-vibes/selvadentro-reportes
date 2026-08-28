# GoHighLevel: qué falta etiquetar para dejar de capturar a mano

**Fecha:** 27 de agosto de 2026 · **Location:** `crN2IhAuOBAl7D8324yI` (Selvadentro Tulum)
· **Medido sobre:** 2,849 contactos creados en los últimos 90 días.

## En una frase

El Sistema de Reportes puede dejar de pedir captura manual de casi todos los canales, pero
hoy solo puede hacerlo con uno. **No falta programación: falta que el campo "Fuente del
lead" venga lleno.** Viene lleno en el 47% de los contactos, y en los canales que no son
publicidad viene lleno casi nunca.

---

## El campo correcto ya existe

`Fuente del lead` es un campo personalizado de contacto que ya está creado, y su lista de
opciones usa casi el mismo vocabulario que los canales del sistema. Estos son sus valores
reales en los últimos 90 días:

| Valor en GoHighLevel | Contactos | Canal del sistema |
|---|---:|---|
| Meta Ads | 1,049 | Paid Orgánico |
| RRSS Orgánicas | 98 | Paid Orgánico |
| Google Ads | 92 | Paid Orgánico |
| Seminarios de inversión | 48 | Seminarios de inversión |
| Prospección propia | 27 | Prospección directa leads |
| Otro | 10 | *(ninguno)* |
| Llamada entrante | 4 | *(ninguno)* |
| Importación | 4 | *(ninguno)* |
| Website | 3 | Paid Orgánico |
| **Programa de referidos** | **1** | Programa de referidos |
| **Broker** | **1** | Brokers |
| *(vacío)* | **1,512** | — |

El sistema ya lee este campo y lo traduce al canal. Lo que no puede hacer es adivinar los
1,512 contactos donde viene vacío.

## Los campos dedicados están vacíos

Existen campos personalizados hechos a propósito para varios de estos canales. Casi ninguno
se llena:

| Campo | Lleno en |
|---|---:|
| `Referred By Code` (Programa de referidos) | **0.1%** |
| `Puntos Del Embajador` (RP VIP) | **0.1%** |
| `Webinar Start At` (Seminarios) | **0.0%** |
| `Número de asistentes` (Seminarios) | **0.1%** |
| `¿Cómo te enteraste de Selvadentro?` | **1.0%** |
| `¿Eres broker independiente?` (Brokers) | **2.3%** |

## Los tags sí traen señal, pero sin norma

De 145 tags distintos, estos identifican canal. El sistema ya los usa como segundo intento
cuando `Fuente del lead` viene vacío:

| Canal | Tags encontrados | Contactos |
|---|---|---:|
| Seminarios | `webinar-registered`, `webinar confirmed`, `seminario-registrado`, `seminario-confirmado-lp`, `seminario-evento-asistido`, `seminario-interes-remoto`, `seminario-confirmado-por-asesor`, `seminario-zoom-privado-asistido`, `seminario-1-1-asistido` | ~380 |
| Brokers | `broker`, `broker-madrid`, `broker-client`, `broker-signup-web`, `broker-booked-daytrip`, `zoom-con-broker` | ~115 |
| Programa de referidos | `referidos`, `referral-lead` | 12 |
| Prospección directa | `prospeccion-directa` | 4 |
| RP VIP | `vip` | 1 |

Nueve variantes distintas para "seminario" y seis para "broker" es la señal de que se
etiqueta a mano, cada quien a su manera, sin una lista acordada.

---

## Lo que pedimos

### 1. Hacer obligatorio `Fuente del lead` (esto es lo único indispensable)

En **cada formulario de captación, cada workflow de alta y cada importación**, que el
contacto no pueda quedar sin `Fuente del lead`. Es un campo que ya existe, con las opciones
correctas ya definidas. Con esto solo, el sistema deduce el canal de todos los leads nuevos
sin que nadie capture nada.

Dos ajustes a su lista de opciones:

- **Separar `Prospección propia`** en `Prospección directa leads` y `Prospección directa
  brokers`. Hoy son un solo valor y el sistema tiene dos canales distintos.
- **Agregar `RP VIP`**, que no está en la lista y sí es un canal del reporte.

### 2. Una sola lista de tags por canal

Como respaldo para lo que entra fuera de formulario. Un tag por canal, exactamente estos:

```
canal-brokers
canal-paid-organico
canal-seminarios
canal-referidos
canal-pd-leads
canal-pd-brokers
canal-rp-vip
```

Los tags actuales pueden seguir existiendo para lo suyo (`webinar-registered` para las
automatizaciones del webinar, por ejemplo). Lo que pedimos es que **además** lleven el tag
de canal, que es el único que el reporte necesita leer.

### 3. Llenar los campos que ya existen, cuando apliquen

`Referred By Code` en los leads del programa de referidos y `Puntos Del Embajador` en los de
RP VIP. Son los dos canales con menos señal de todos y hoy no hay forma de contarlos salvo
la captura manual.

---

## Qué pasa cuando esto esté hecho

| Canal | Hoy | Con `Fuente del lead` obligatorio |
|---|---|---|
| Paid Orgánico | **Ya automatizado** | igual |
| Seminarios de inversión | Señal parcial | automatizado |
| Brokers | Señal parcial | automatizado |
| Prospección directa leads | Casi nada | automatizado |
| Prospección directa brokers | Nada | automatizado |
| Programa de referidos | Casi nada | automatizado |
| RP VIP | Nada | automatizado |

La pantalla **Diagnóstico → "Captura manual contra CRM, por canal"** compara semana a semana
lo capturado contra lo que el CRM atribuye solo, con un veredicto por canal. Ahí se ve
cuándo un canal ya se puede dejar de capturar, sin adivinar.

**Importante:** hasta que un canal aparezca en verde en esa tabla, su captura manual sigue
siendo el único registro que existe. Si se retira antes, ese canal sale en cero en Dirección
General y Dirección Comercial — y un cero por falta de dato se ve exactamente igual que un
cero por no haber vendido.

## Lo que el sistema captura y el CRM nunca va a saber

Aparte de los 10 números que alimentan Dirección, cada canal captura entre 20 y 30 campos
operativos que no existen en GoHighLevel: webinars registrados / confirmados / asistidos,
seguimientos post seminario, brokers contactados / presentados / firmados. **Esa parte de la
captura no se va con nada de lo anterior**, y probablemente deba quedarse.

---

*Medición hecha el 2026-08-27 leyendo la location del cliente a través de Windsor.ai, solo
lectura. Ver `docs/audit-redundancy-uiux-2026-08.md` para el resto de la auditoría.*
