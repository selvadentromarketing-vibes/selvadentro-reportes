# Selvadentro Reporting System — redundancy and UI/UX audit

**Date:** 26 August 2026 · **Scope:** `index.html` (5,973 lines), `marketing.html` (1,242) and the 10 Netlify Functions (1,579).

**Result:** 46 verified findings — 18 high severity, 25 medium, 3 low. ~406 lines removable without losing functionality.


**Update:** 6 findings are already fixed and 2 partly fixed — the five most urgent ones, implemented and verified in a browser against the pre-fix code. Each carries a **Status** line below saying what changed.


> Every finding cites line references verified against the file. Findings that did not
> survive verification are not included.


## Severities

| Level | What it means | Count |
|---|---|---|
| **High** | The app shows a wrong number, breaks, or blocks somebody. | 18 |
| **Medium** | Real friction, or duplication that has already caused errors and will again. | 25 |
| **Low** | Polish. Nothing breaks if left as is. | 3 |

## The underlying pattern

Almost no finding is an isolated slip. They're the same story: somebody fixed a real
problem, properly, and the fix stayed in the copy where it was found.

| Fix | Where it exists | Where it's missing |
|---|---|---|
| Flag an incomplete sync inside the aggregate so the whole team sees it | `lqSync` | `crmSync, slaSync` |
| Filter the CRM crawl by date instead of pulling all history | `lead-quality.js` | `ghl-report.js` |
| Retry when Windsor answers 429 | `windsorGet()` | `spend()` |
| Act on a failed read instead of showing stale data as current | `marketing.html` | `index.html` |
| Sign out and return to login when the token expires (401) | `index.html · kvCall` | `marketing.html · kvCall` |
| Destroy the previous charts before drawing new ones | `lqState._charts` | `ANAL_STATE.charts` |
| Warn when a save failed instead of showing “✓ Saved” | `index.html · saveWeek` | `marketing.html · saveRec` |
| Confirm before wiping the form | `marketing.html` | `index.html · clearForm` |

Which is why the underlying recommendation isn't *write better code*: it's **stop having copies**.


## What to fix first

1. **Give each WON a different name** _(≈½ session)_ — Before any code: decide and write on screen what each tab measures. “Reported WON”, “WON closed this week”, “Cohort WON”, each with a line saying which date it cuts on. It's half a session of work and it's the only item on this list that changes what the team believes about the numbers.
2. **Delete what nobody can open** _(≈1 session)_ — The three retired modules in marketing.html and the `window.fs` block in index.html. None of this changes the app: it just stops getting in the way. And fix the two README claims that are no longer true, in the same commit.
3. **Close the silent failures** _(≈1 session)_ — Three short fixes where the app currently asserts something it can't support: stop `saveRec` in marketing.html from saying “✓ Guardado” when the save failed; have `slaSync` and `crmSync` report their failed batches the way `lqSync` already does; and drop `lq_live` from the Metas and Base de datos dropdowns.
4. **Make the app usable on a phone** _(≈1–2 sessions)_ — The structural `@media` marketing.html already has, applied to index.html, plus `overflow-x` on the bars and on the 18 tables left outside the scroll container — and 16px type on fields so iOS stops zooming in on every one.
5. **Raise contrast and give focus back** _(≈1 session)_ — A darkened copper only where it carries text, tabs turned into `<button>`, and one global `:focus-visible` rule. It's CSS and a tag change.
6. **Unify the repeated engines** _(≈3–4 sessions)_ — The three sync engines, the six network wrappers, the week-range selectors and the `json()` in the three functions. It's the largest piece of work and the one that prevents the most future bugs; best done after the others, with the ground already cleared.

## Contrast, measured (WCAG 2.1 AA)

| Combination | Ratio | Size | Minimum | AA |
|---|---:|---:|---:|---|
| #fff on --cobre #CF8543 — .btn-primary and .side-btn.active | 2.96:1 | 13px | 4.5:1 | **fails** |
| --neutro #6F7468 on --crema-2 #F1ECE1 — inactive tab | 4.08:1 | 13px | 4.5:1 | **fails** |
| --arena #D9B37E on --verde-prof #465241 — topbar subtitle | 4.21:1 | 10px | 4.5:1 | **fails** |
| --neutro on --crema — .hint | 4.52:1 | 11.5px | 4.5:1 | borderline |
| --rojo-no-tx on --rojo-no-bg — “no” pill | 4.75:1 | 12px | 4.5:1 | passes |
| #fff on --olivo #65713F — .btn-olive | 5.27:1 | 13px | 4.5:1 | passes |
| --texto on --crema — body copy | 12.18:1 | 14px | 4.5:1 | passes |

## What the app gets wrong (13)

### [HIGH] “WON” means three different things in three tabs, and no screen says so

`won-tres-definiciones` · correctness · low effort

**Where:** `index.html:1743-1745`, `index.html:1829`, `index.html:1939`, `index.html:2413`, `index.html:1919`, `index.html:2114`

**What we found.** The three tabs that report WON each compute it differently, verified in the code. (1) Sales and Dirección: WON is a number somebody types in each week — METRIC_MAP maps it to a hand-captured field per channel (won_brokers, won…, index.html:1743-1745) and the consolidated table just prints it (1829). (2) CRM en vivo: WON is counted in the week of the opportunity's LAST STATUS CHANGE — if(o.st==="won"){ const ww=crmWeekOf(o.stc)||wc; … b.won++ } (1939), where o.stc is the status-change date. (3) Calidad de Leads: the WON travels attached to the LEAD, not to the sale — each row carries w: op.w (2413) and the row sits in the week the lead ARRIVED. So a sale closed in week 34, from a lead that came in on week 28, counts in week 28. On top of that, the two CRM readings don't even use the same clock: crmWeekOf works in UTC (1919) and lqWeekOf in Tulum time (2114).

**Why it matters.** For the same week, Dirección Comercial can say 4 WON, CRM en vivo 6, and Calidad de Leads 2 — and all three are correct under their own definition. The problem is that all three are called the same thing, look the same, and live in the same app, without a single line explaining the difference. In a results meeting that doesn't read as “these are different metrics”: it reads as the system being broken, or as somebody inflating a number. It's the most expensive finding in this report because it doesn't cost a bug, it costs trust in the product — and once the team stops believing the app, they go back to the spreadsheet.

**How to fix it.** They don't need to be unified: the three measure legitimately different things and all three are useful. They need to be NAMED differently and said out loud on screen. Concrete proposal: in Dirección, “Reported WON” (captured by the team); in CRM en vivo, “WON closed this week”; in Calidad de Leads, “Cohort WON” or “sales from this week's leads”. Each with a one-line footnote saying which date it cuts on. And while you're there, align crmWeekOf to Tulum time, which is the convention the README already sets, so at least the two CRM readings share a calendar. The Diagnóstico tab is the natural place to publish all three definitions together.

**Status.** Fixed — the three are now “WON reportado”, “WON cerrado” and “WON del cohorte”, each with the cutoff date in its tooltip, and all three definitions are published in the Diagnóstico glossary.

### [HIGH] The ← button leaves the app blank after visiting “Desempeño de Ventas”

`crash-atras-desempeno` · correctness · low effort

**Where:** `index.html:1645`, `index.html:1648`, `index.html:5155-5160`, `index.html:1617-1629`, `index.html:5123`

**What we found.** Exact reproduction, traced through the code: (1) in Ventas you pick “Desempeño de Ventas” in the Reporte select; switchChannel detects the synthetic channel and pushes navPush({ tab:"ventas", subtab:CANAL_DESEMP }) onto the app's own history (5159), where CANAL_DESEMP is "__desempeno" (5123). (2) the user moves to another tab. (3) they press ←. navGo restores VENTAS_SUBTAB = "__desempeno" and clicks the Ventas tab (1624-1626). (4) the tab handler turns ALL views off — document.querySelectorAll(".view").forEach(v=>v.classList.remove("active")) (1645) — and on the very next line does document.getElementById("view-"+VENTAS_SUBTAB).classList.add("active") (1648), with no guard. No element with id view-__desempeno exists: verified, zero occurrences in the file. getElementById returns null and .classList throws a TypeError.

**Why it matters.** The exception fires AFTER every view has been switched off, so the handler aborts and turns none back on: the content area goes completely blank with the tab bar still showing. There's no error message. The only way out is reloading the page, and reloading loses whatever week range was being reviewed. It's a short, plausible path: “Desempeño de Ventas” is one of the most-consulted reports and the ← arrow sits right there in the top bar.

**How to fix it.** Two lines. Add the guard on 1648: const v = document.getElementById("view-"+VENTAS_SUBTAB); if(v) v.classList.add("active"); else { VENTAS_SUBTAB="reporte"; document.getElementById("view-reporte").classList.add("active"); }. And have navGo call mostrarDesempeno(true) when it restores an entry whose subtab is CANAL_DESEMP, instead of treating it as a normal sub-tab — which is exactly what switchChannel already does correctly when the change comes from the select.

**Status.** Fixed — navGo restores the synthetic channel through the select instead of as a sub-tab, and the view lookup in the tab handler is guarded.

### [HIGH] Two tabs file the same lead in different weeks: CRM counts in UTC, Calidad de Leads in Tulum time

`semana-utc-vs-tulum` · correctness · low effort · −4 lines

**Where:** `index.html:1919`, `index.html:2114`, `index.html:2091`, `index.html:3559`, `index.html:1382`, `README.md:104`

**What we found.** The two functions that assign a record to its ISO week don't use the same clock. crmWeekOf (1919) is isoWeekId(new Date(iso)) — it reads the timestamp as-is, i.e. in UTC. lqWeekOf (2114) is isoWeekId(new Date(new Date(iso).getTime() - LQ_TZ_MS)) with LQ_TZ_MS = 5*3600e3 (2091), so it shifts to Tulum time (UTC-5) first. slaWeeksAll does the same as lqWeekOf (3559). Both end up calling the same isoWeekId (1382), which works in UTC — the difference is in what each one hands it. The README states the project convention explicitly — “GHL contacts created in the last 12 ISO weeks (Tulum time, UTC-5)” — so Calidad de Leads and SLA follow the documented rule and CRM en vivo is the one that drifted.

**Why it matters.** Any record created between 00:00 and 04:59 UTC on a Monday is still Sunday in Tulum. “CRM en vivo” counts it in the new week; “Calidad de Leads” and “SLA y Seguimiento” count it in the previous one. In other words: leads arriving Sunday afternoon and evening Tulum time — a real window for people browsing property on a weekend — show up in different weeks depending on which tab you open. Two screens in the same app give different weekly counts of the same data, and nothing in the interface explains why. In a product whose deliverable is the weekly report, that's the kind of error that makes a team stop trusting the number.

**How to fix it.** Align crmWeekOf with the documented convention: function crmWeekOf(iso){ const d = iso ? new Date(new Date(iso).getTime() - LQ_TZ_MS) : null; … }. Better still, delete both and keep a single week function with the timezone shift inside, so they can't drift apart again. Note: the change moves records from one week to another, so the crm:agg:v1 cache has to be invalidated and re-synced, and it's worth telling the team that some historical CRM counts will shift by one slot.

**Status.** Fixed — crmWeekOf and lqWeekOf are now the same function, semanaISOTulum, and the CRM aggregate cache key moved to v2 so stale UTC-bucketed data gets rebuilt.

### [HIGH] In Metas and Base de datos, picking “Calidad de Leads” silently shows Redes Sociales data

`metas-lq-muestra-rrss` · correctness · low effort

**Where:** `index.html:4524`, `index.html:4530`, `index.html:5048`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:1228`, `marketing.html:738-745`

**What we found.** The “Marketing” dropdown in Metas (index.html:4530) and the one in Base de datos (index.html:5048) are both built from MKT_MODULES = [ {id:'rrss'}, {id:MKT_LQ_LIVE} ] (4524). Picking “Calidad de Leads” calls metasShowFrame(true,'lq_live') / dbShowFrame(true,'lq_live'), which load the iframe and run w.mktSetActive('lq_live'). But on the other side: window.mktSetActive=function(id){ if(MODS[id]) setActive(id); } (marketing.html:1228) and MODS only has rrss. The guard makes the call a SILENT no-op. Right after, w.mktShowView('metas') renders with state.active untouched at 'rrss'.

**Why it matters.** The user believes they're editing Calidad de Leads goals and they're actually editing and saving the Redes Sociales ones. There's no signal at all: no error, no different title, no empty screen. Goals are the criterion the app uses to paint every KPI green or red, so a goal set in the wrong place propagates into every report. Same thing in Base de datos, where records can also be deleted.

**How to fix it.** MKT_LQ_LIVE exists for the Marketing tab's selector, where the live view genuinely lives in index.html; it shouldn't appear in Metas or Base de datos because it has no module on the iframe side. Filter it out of both: MKT_MODULES.filter(m=>m.id!==MKT_LQ_LIVE). If live Calidad de Leads should have its own goals, they need to be built in index.html rather than delegated to the iframe.

**Status.** Fixed — Metas and Base de datos build their Marketing dropdown from MKT_MODULES_EMBED, which excludes lq_live.

### [HIGH] The SLA report grades advisors on data that may be missing, and doesn't say so

`sla-lotes-silenciosos` · states · medium effort

**Where:** `index.html:4030-4037`, `index.html:4050`, `index.html:3451-3523`

**What we found.** slaSync walks the leads in batches of 8 and every batch fails silently: catch(e){ /* failed batch: those leads end up with no conversation data */ } (index.html:4036). Advisor resolution too: catch(e){} (4050). The comment itself admits the consequence. lqSync, by contrast, DID solve this — it accumulates a 'fallos' array and stores it INSIDE the aggregate (index.html:3520-3521) with a comment spelling out why: “before, the error was just a passing toast seen by whoever pressed Sync, and the rest of the team read the zeros as if they were data”. That fix never made it to slaSync or crmSync.

**Why it matters.** The SLA tab produces the advisor's score (first-contact speed, cadence, cycle closure, follow-up, effective activity) — the score people are evaluated on. If a batch of 8 leads fails, those leads show up with no conversations: they read as “never touched”. The advisor's score drops because of a network error. And since the aggregate is cached in the kv, the whole team sees the bad score without knowing the sync came back incomplete.

**How to fix it.** Port lqSync's pattern to slaSync and crmSync: accumulate failed batches in agg.fallos, save it in the aggregate, and paint it in the report header (“report generated with N of M leads — run it again”). While there are failed batches, don't present the advisor's score as final.

### [HIGH] The weekly capture form has no autosave, no exit warning, and no invalid-field marking

`ingreso-sin-red-de-seguridad` · forms · medium effort

**Where:** `index.html:1428`, `index.html:1413-1427`, `index.html:4384`, `index.html:1288`

**What we found.** Zero matches for beforeunload in either file. The Ingreso form doesn't track a dirty state: the pattern exists in the app but only for Asesores (setAdvDirty, index.html:4384) — Ingreso doesn't use it. There are no .error / .invalid / aria-invalid classes in the CSS, so a badly captured value isn't flagged on its field. And if the 30-day token expires mid-capture, kvCall calls handleAuthExpired (1288) and sends the user back to login. There's an even more direct loss path that doesn't need anything to fail: switchChannel runs renderIngresoForm(); clearForm(); (index.html:5182) without checking anything, and clearForm (1427) empties every field without asking. Just changing the channel in the “Reporte” dropdown wipes a half-filled form, silently.

**Why it matters.** Capturing a week is dozens of numeric fields. Switching tabs, closing the tab by accident, or the session expiring erases all of it without asking, and there's no local copy of what was typed. It's the task the team does every week — which makes it the one that can be lost the most times.

**How to fix it.** The minimum, and cheap: (1) save the draft to localStorage on every change, keyed by week+channel, and offer to restore it on return; (2) mark the form dirty and add beforeunload while it is; (3) on a 401, don't discard what was typed — leave it in the draft so it's still there after signing back in. And most urgent of all: have switchChannel ask before clearing if anything has been typed — that's one condition and a confirm, and it closes the easiest loss path to stumble into.

### [HIGH] The Base de datos screen explains how to export, and there is no export button

`export-fantasma` · correctness · low effort

**Where:** `index.html:797`, `index.html:5023-5032`, `index.html:5033-5039`, `index.html:4969`

**What we found.** The help text on the Base de datos view (index.html:797) ends like this: “The CSV exports the current channel; the JSON backup includes every channel plus advisors and goals.” Both functions exist and are complete: dbExportCSV (5023) builds the CSV with a UTF-8 BOM and quote escaping, and dbExportJSON (5033) gathers every channel plus advisors and goals. But neither is called from anywhere: verified by reference count, dbExportCSV and dbExportJSON each appear exactly once across the 5,973 lines — their own declaration. The download helper (4969) is only used from inside those two dead functions. And the word “Exportar” doesn't appear anywhere in the file, in the markup or in the template strings.

**Why it matters.** The app explains a feature the user can't use. Someone who needs the backup — or who wants to take the numbers into Excel for a meeting — will look for the button, not find it, and conclude something is broken or that they lack permission. On top of that, the JSON backup is the project's only data egress: without it, there's no way to get the information out of the kv from the interface.

**How to fix it.** This is the cheapest fix in the audit: two buttons in the view's action bar, wired to functions that are already written and tested. In renderDB, next to “Buscar”: document.getElementById('db-csv').onclick=()=>dbExportCSV(sel.value); and another for dbExportJSON. If for some reason the export shouldn't exist, then remove the sentence from the help text and delete the three functions.

### [HIGH] index.html detects when a backend read fails, records the signal, and nobody ever reads it

`lectura-fallida-sin-lector` · states · low effort

**Where:** `index.html:1332-1334`, `index.html:1337`, `index.html:1342`, `index.html:5243`, `index.html:5220-5230`, `marketing.html:775-779`

**What we found.** index.html declares let LECTURA_FALLIDA = false (1332) and two accessors to check it: sReadFailed and sReadReset (1333-1334). The flag is raised correctly at both points where a kv read can fail (1337 and 1342). And that's where it ends: verified by count, sReadFailed and sReadReset each appear exactly once across the 5,973 lines — their own declaration. Nobody ever asks whether the read failed. The other side of the iframe did learn the lesson: marketing.html raises _lecturaFallida (777) and acts on it, telling the user the data couldn't be read and that nothing was written so as not to overwrite the real records. Compounding it, index.html's startup paints the file's embedded seeds first and then loads the saved data in the background — inside a block that ends in catch(e){} (5243).

**Why it matters.** If the backend doesn't answer at startup, the app doesn't look broken: it looks normal, showing the history baked into the file, and none of what was captured afterwards. The user reads old numbers believing they're today's. It's the worst way for a reporting system to fail, and the mechanism to prevent it is already written — it just has nobody consulting it.

**How to fix it.** Check sReadFailed() at the end of startup and, if it came back true, show a fixed strip at the top: “The saved data couldn't be loaded. What you're seeing may be incomplete.” with a retry button. And change the catch(e){} at 5243 to one that raises the same flag. It's the same warning marketing.html already gives, moved to the Ventas side.

### [HIGH] The “Sin acceso” screen leaves the sidebar alive, and any click on it breaks the app

`crash-sin-acceso` · correctness · low effort

**Where:** `index.html:5313-5322`, `index.html:507-508`, `index.html:530`, `index.html:1632`, `index.html:1657`, `index.html:1660`

**What we found.** showNoAccessScreen replaces the contents of .main (5314): document.querySelector(".main").innerHTML = `…Sin acceso…`. But .main (line 530) and .sidebar (508) are siblings inside .shell (507), so the sidebar survives intact — handlers included, because they're bound once at startup across every [data-tab] (1632). Pressing any of its buttons runs document.getElementById("view-"+tab).classList.add("active") (1657) on an element that was just deleted, and immediately after document.querySelector(".canal-wrap").style.display (1660) on another that doesn't exist either. Both lines throw a TypeError. And the buttons are reachable: “Base datos” doesn't carry the admin-only class, so it's always visible.

**Why it matters.** This is a new user's first minute. They've just been given an account, they open their link, set a password, sign in — and the app tells them “Sin acceso: ask the admin to assign you access”, with a column of perfectly clickable-looking buttons on the left. They press one, nothing visible happens, they press another, same. Their first impression of the system is that it's broken. And the one button that does work — sign out — is inside the message, not in the bar.

**How to fix it.** Have showNoAccessScreen replace the whole .shell rather than just .main, so the sidebar goes with the rest. As a general safety net, guard the handler's two lines (1657 and 1660) against null, which also covers any other view removed in future.

**Status.** Fixed — showNoAccessScreen now replaces .shell, so the sidebar goes with the content; the handler's lookups are guarded too.

### [HIGH] The app says “don't reload, you'll lose it” and then reloads itself

`sesion-expira-borra-captura` · correctness · medium effort

**Where:** `index.html:1437`, `index.html:1288-1291`, `index.html:1298`, `index.html:1428-1441`

**What we found.** Two well-intentioned pieces that contradict each other. When a save fails, saveWeek warns with a message somebody wrote carefully (1437): “NOT saved to the server. […] What you captured is still on screen: check your connection and press Guardar again. If you reload the page now, it's lost.” The comment above it explains that warning was added precisely because the toast used to say “Guardado ✓” when nothing had been saved. But handleAuthExpired does exactly what the message says not to do (1290): setAuthToken(null); writeSession(null); location.reload(). And it fires from kvCall (1298), which is the door the retry goes through. So: if the save failed because the 30-day token expired, the user reads “don't reload”, presses Guardar again as instructed, the 401 arrives, and the app reloads itself and wipes everything captured. Also verified: zero AbortController and zero beforeunload in either file.

**Why it matters.** It's the worst possible combination: the user does exactly what the app asks and loses the work for doing it. And it happens at the most expensive moment — with the weekly form full — and in the most likely scenario, because a 30-day token expires without warning and the first thing that reveals the expiry is precisely the attempt to save.

**How to fix it.** Before reloading, stash whatever is in the form in localStorage and restore it after login: handleAuthExpired is already the single point every sign-out goes through, so it's one change. Better still, don't reload: show the login screen on top without destroying the DOM, so the form is still there on re-entry. If the reload stays, the message at 1437 has to stop promising something the app doesn't honour.

### [HIGH] Marketing still says “✓ Guardado” when the save failed — the bug already fixed in Ventas

`mkt-guardado-mentiroso` · correctness · low effort

**Where:** `marketing.html:786`, `marketing.html:787`, `marketing.html:928`, `index.html:1434-1440`

**What we found.** marketing.html:786: async function saveRec(M){ try{ await window.storage.set(M.key, JSON.stringify(M.records)); }catch(e){console.error(e);} }. The error is swallowed into the console and the promise resolves as if all had gone well. The caller celebrates without checking anything (928): M.records[M.pval]=M.read(); await saveRec(M); updatePill(); showToast('✓ Guardado'). saveMeta (787) does exactly the same. And this is the bug index.html ALREADY fixed, with the comment documenting it (1434): “the toast used to say 'Guardado ✓' even when the backend had failed. Now it says so” — followed by an alert explaining to the user that what they captured is still on screen. That fix never crossed into the iframe.

**Why it matters.** This is silent data loss, not an annoyance. Someone captures the monthly Redes Sociales report, sees the green ✓, closes the tab — and nothing was saved. There's no way for them to notice until they come back and find the period empty, probably weeks later. Of every finding in this report, it's the one that can destroy work without leaving a trace.

**How to fix it.** Let saveRec and saveMeta propagate the error (drop the catch or rethrow) and have bindSave show the ✓ only if the promise resolved, with the same warning index.html already uses on failure. Three lines, and the most urgent fix in this audit alongside the SLA one.

**Status.** Fixed — saveRec and saveMeta report the failure themselves and return a boolean; all 10 call sites only show their success toast when the write actually resolved.

### [HIGH] Picking a week that already has data opens a blank form, and saving overwrites it without warning

`semana-en-blanco-sobrescribe` · correctness · low effort

**Where:** `index.html:5201`, `index.html:5180`, `index.html:1428-1433`, `index.html:1449`, `index.html:1444-1452`

**What we found.** The date field's only handler snaps the range to Monday-Sunday and updates the week badge; it loads nothing (5201). And the dimension dropdowns — advisor, city — are generated with no change handler at all (5180). Verified: fillForm is only called from four places (1449, 4976, 4985 and 5189), none of them tied to the date or the advisor. On the other side, saveWeek builds the key and writes without asking whether it already exists: const k=recKey(w,dv); … recSet(k, form) (1431-1432), and the success message is the same whether it's a new record or one it just overwrote. It should be said that the app DOES offer a way out: the “Registros guardados (clic para cargar)” row loads the record when pressed (1449). The problem is that it isn't the natural path.

**Why it matters.** The path anyone would follow — pick the week, pick the advisor, capture — hands back an empty form even when that combination already has data. If the person doesn't notice the chip row below, they type what they remember and save: the complete record is replaced by a partial one, with no warning at all. It's especially likely when correcting a figure in an already-captured week, which is exactly when the form gets reopened.

**How to fix it.** Have a change of date or of any dimension dropdown try to load that combination's record: const rec=recGet(recKey(currentWeekId(), curDimVals())); if(rec) fillForm(rec); — the function already exists and is already used from the chips. And have saveWeek warn when the key already exists: “There's already data saved for this week and this advisor. Replace it?”.

### [MEDIUM] The retry that protects Windsor from 429s doesn't cover the spend call it names

`windsor-sin-reintento` · correctness · low effort · −8 lines

**Where:** `netlify/functions/lead-quality.js:233-234`, `netlify/functions/lead-quality.js:235-251`, `netlify/functions/lead-quality.js:198-231`

**What we found.** The comment at lead-quality.js:233-234 says: “Windsor limits to 600 requests/min and 10k/day. A 429 with no retry used to switch off the whole tab's spend; now it waits and retries once, same as GHL.” And windsorGet (235-251) does exactly that: if (resp.status === 429) { await wait(1500); resp = await fetch(url…) }. But spend() (198-231) — the function that fetches precisely the spend the comment is about — doesn't use windsorGet: it does its own fetch, with a different retry (if it gets a 400, repeat without the currency field) and no branch at all for 429.

**Why it matters.** The fix is written and doesn't cover the case it claims to. If Windsor answers 429 during a Calidad de Leads sync, the Inversión column goes dark exactly as before — the very symptom the comment claims to have solved. And because the comment says otherwise, the next person investigating will rule that hypothesis out in writing.

**How to fix it.** Route spend() through windsorGet, keeping its currency fallback: try with currency, and if it 400s retry without it, but with both calls going through windsorGet so they inherit the 429 handling.


## Redundancy (12)

### [HIGH] CRM en vivo downloads the CRM's entire history every 30 minutes, per user

`crm-crawl-completo` · network · low effort

**Where:** `netlify/functions/ghl-report.js:83-100`, `netlify/functions/lead-quality.js:145-152`, `index.html:2079`, `index.html:2046-2052`

**What we found.** The query feeding CRM en vivo carries no date filter at all: qs = `location_id=${LOCATION_ID}&limit=100` and nothing else (ghl-report.js:89-90), so it walks EVERY opportunity in the CRM regardless of year. And showCRM fires it on its own: if(!crmState.syncing && (!crmState.agg || Date.now()-crmState.agg.ts > CRM_STALE_MIN*60000)) crmSync() (index.html:2079). The telling part is that this bug WAS already fixed — in another file: the comment at lead-quality.js:145-147 describes it word for word — “the whole CRM history used to be walked on every sync — with auto-refresh every 30 min per user — only to be thrown away when filtering by week” — and there the since parameter was added, with a retry without the filter in case the API rejects it. It was never carried over to ghl-report.

**Why it matters.** All it takes is somebody opening the CRM en vivo tab for the app to download the entire CRM. With several people on the team dropping in during the day, that's several full crawls a day against the GoHighLevel account — which has request limits — only to discard almost all of it when filtering by week. And since the “already syncing” guard only exists inside each browser tab, two people entering at once launch two full crawls.

**How to fix it.** Port to ghl-report.js the same filter lead-quality.js already has: accept a since parameter, pass it into the query, and retry without it if the API rejects it. The client already knows which week range it needs. It's copying about 10 lines from one file to the other.

### [MEDIUM] 22.8% of marketing.html is code for three modules nobody can open any more

`mkt-modulos-muertos` · dead-code · low effort · −117 lines

**Where:** `marketing.html:620-736`, `marketing.html:737-745`, `marketing.html:11`

**What we found.** On 2026-08-26, PPC Ads, CRM Manager and the manual Calidad de Leads module were retired: MODS only registers rrss and ORDER=['rrss'] (marketing.html:738-745). But the code stayed. Verified by reference count: ppcIngreso, ppcFill, ppcRead, ppcMetas, ppcReporte, crmIngreso, crmFill, crmRead, crmMetas, crmReporte, lqIngreso, lqFill, lqRead, lqMetas and lqReporte each appear exactly ONCE in the whole file — their own declaration. Hanging off them are PPC_CF, PPC_SEED_METAS, PPC_MF, CRM_SRC, CRM_SEG, CRM_WEB, CRM_EM, CRM_MS, CRM_SEED, CRM_SEED_METAS, CRM_MF, LQ_SRC, LQ_SEG, LQ_SEED, LQ_SEED_METAS, LQ_MF, FUNNEL, plus the helpers lqCalc/chipH/chipL/ppcPlatCard (only referenced from already-dead functions). Measured: lines 620-736 = 27,523 bytes = 22.8% of the file. The header comment (line 11) still advertises “Reportes: Redes Sociales (mensual) · PPC Ads · CRM Manager · Calidad de Leads (semanales)”.

**Why it matters.** Every visit to Marketing downloads 27 KB of unreachable code, and multiplied by the three iframes that mount marketing.html that's ~82 KB per session. Worse: whoever opens the file tomorrow can't tell what's alive and what isn't, and the EXAMPLE seeds (CRM_SEED, LQ_SEED with made-up 2026-W15 data) are still sitting there ready to reappear if someone puts the module back in ORDER.

**How to fix it.** Delete the whole 620-736 block and the CSS classes that only styled it (.camp, .camp-top, .cn, .ci, .badge). Historical records stay safe in the kv under mkt_ppc_rec / mkt_crm_rec / mkt_lq_rec: deleting the code doesn't delete the data. Update the line 11 comment.

### [MEDIUM] Three functions badly reimplement the helper they already import from shared.js

`cors-json-duplicado` · duplication · low effort · −50 lines

**Where:** `netlify/functions/lib/shared.js:29-46`, `netlify/functions/ghl-report.js:22-28`, `netlify/functions/ghl-report.js:105-112`, `netlify/functions/kpi-analyze.js:24-40`, `netlify/functions/notes-analyze.js:26-42`

**What we found.** shared.js already exports json() and corsPreflight() (29-46). Four functions use them correctly (invite, lead-quality, lq-analyze, sla-report: const json = S.json). But ghl-report, kpi-analyze and notes-analyze — which ALSO require('./lib/shared.js') and use S.authFromEvent — define their own json() and their own preflight. And the copies drifted: (1) all three local preflights declare Access-Control-Allow-Headers: 'Content-Type' while shared.js declares 'Content-Type, Authorization'; all nine functions require Authorization: Bearer, so the local preflight rejects the exact header the function needs. (2) kpi-analyze's json() (line 26) omits Access-Control-Allow-Origin, which shared.js and notes-analyze both include; its success path does add it (121-124), so success and error answer differently. A diff of kpi-analyze lines 20-55 against notes-analyze 22-57 returns exactly ONE real difference: that header. They're literal copies.

**Why it matters.** It doesn't bite today because the frontend is same-origin with the functions on Netlify. The moment something calls from another origin — a local test on a different port, an embedded dashboard, a new domain — those three functions fail the preflight and the browser never even sends the request. The error shows up as “CORS” rather than as what it is. On top of that it's ~50 copied lines that already hold three versions of the truth.

**How to fix it.** In all three: delete the local json() and the OPTIONS block, and use const json = S.json; and if (event.httpMethod === 'OPTIONS') return S.corsPreflight();. Same change in three files, leaving one definition.

### [MEDIUM] Two Save and two Clear buttons on the same screen, with different labels and the same function

`guardar-duplicado` · feature-overlap · low effort · −4 lines

**Where:** `index.html:564-565`, `index.html:581-582`, `index.html:5203-5206`

**What we found.** The Ingreso form has “Limpiar” + “Guardar” at the top (564-565) and “Limpiar” + “Guardar semana” at the bottom (581-582). All four handlers sit in the same block: btn-guardar.onclick=saveWeek; btn-guardar2.onclick=saveWeek; btn-limpiar.onclick=clearForm; btn-limpiar2.onclick=clearForm (5203-5206). Same function — but the labels don't match: “Guardar” on top and “Guardar semana” below. On “Limpiar” there's also a divergence between the two halves of the app: in index.html clearForm (1427) wipes the fields without asking anything, while marketing.html does confirm first — confirm('¿Limpiar el formulario? (no borra lo guardado)') at marketing.html:928. The button with the same name behaves differently depending on the tab.

**Why it matters.** Two different labels for the same action tell the user they do different things, on a screen where hesitating is expensive: someone unsure saves with both, or saves with the top one thinking the bottom one does something extra. And “Limpiar” sits right next to “Guardar” with no confirmation: clearForm wipes everything captured in one click, and the only separation is button order.

**How to fix it.** Keep one action bar (the bottom one, at the end of the form, where capture actually finishes) labelled “Guardar semana”. And ask for confirmation on Limpiar when the form has anything in it — the pattern already exists in the app: Asesores uses advDirty + confirm before deleting (index.html:4384, 4395).

### [MEDIUM] Three identical escape functions under three names, two of them in the same file

`escape-triple` · duplication · low effort · −2 lines

**Where:** `index.html:4375`, `marketing.html:338`, `marketing.html:1042`

**What we found.** escAttr (index.html:4375), escHtmlSafe (marketing.html:338) and escHtml (marketing.html:1042) have character-for-character the same body apart from null handling: they replace &, double quote, < and >. The last two live in the same file. They're used heavily — 123 calls to escAttr and 38 between marketing's two — across 82 innerHTML assignments in the two files.

**Why it matters.** Three definitions of the same protection guarantee that the day it needs hardening (today none of them escapes the apostrophe) one gets fixed and the other two are left behind. The different names hide the fact that they're the same thing: someone searching for 'escHtml' in index.html finds nothing and writes a fourth.

**How to fix it.** One name across both files, same body, with the null handling from marketing's versions. While there's no shared build, make it literally the same text in both, with a comment saying they're copies that must move together.

### [MEDIUM] Three iframes load the same 120 KB document, each with its own copy of Chart.js and its own state

`iframes-triples` · network · medium effort · −40 lines

**Where:** `index.html:715`, `index.html:744`, `index.html:799`, `index.html:1738`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:1237`

**What we found.** index.html mounts marketing.html in three separate iframes: mkt-frame for the Marketing tab (715, loaded by showMarketing 1738), mkt-metas-frame for Metas (744, metasShowFrame 4546) and mkt-db-frame for Base de datos (799, dbShowFrame 5065). Each loads the full document: 120 KB of HTML, its own Chart.js <script> from the CDN, its own Google Fonts stylesheet and its own bootstrap. And that bootstrap is sequential: init() does for(const id of ORDER){ await loadMod(...) } (marketing.html:1237) and each loadMod is two chained kv reads.

**Why it matters.** A user who passes through Marketing, then Metas, then Base de datos leaves three live copies of the same document, with three independent states that don't talk to each other: saving a goal in one doesn't update what the other two show. And that's three full bootstraps with their kv reads.

**How to fix it.** A single reused iframe. The API to do it already exists: mktSetEmbedMode / mktSetActive / mktShowView (marketing.html:1226-1229) can move the same document between the metas / basedatos / reporte views. Move the iframe in the DOM or, more simply, leave it in a fixed container and change which view it shows.

### [MEDIUM] The README documents two things that are no longer true

`readme-desfasado` · docs · low effort

**Where:** `README.md:116`, `README.md:220`, `marketing.html:740-744`, `marketing.html:11`

**What we found.** (1) README.md:116 says “the manual Calidad de Leads module inside Marketing still exists exactly as it was”. False since 2026-08-26: marketing.html:740-744 documents its retirement and ORDER is down to ['rrss']. (2) README.md:220 says “scripts/migrate-kv.mjs became obsolete after the cutover; it is kept for reference”. The scripts/ directory doesn't exist in the repo. (3) marketing.html:11 still advertises in its header “Reportes: Redes Sociales (mensual) · PPC Ads · CRM Manager · Calidad de Leads (semanales)”.

**Why it matters.** The README is the first thing anyone entering the project reads — person or model — and today it describes an app that no longer exists. In a repo with no tests, documentation is the only specification there is: when it lies, decisions get made on false data.

**How to fix it.** Fix the three points in the same commit that clears the dead code, so docs and code move together. Add a README note that historical records from the retired modules remain in the kv under mkt_ppc_rec / mkt_crm_rec / mkt_lq_rec.

### [MEDIUM] The GoHighLevel client is written three times; two copies are byte-for-byte identical

`ghl-cliente-triplicado` · duplication · medium effort · −100 lines

**Where:** `netlify/functions/lead-quality.js:39-53`, `netlify/functions/sla-report.js:29-43`, `netlify/functions/ghl-report.js:32-50`, `netlify/functions/ghl-report.js:83-101`, `netlify/functions/sla-report.js:255-290`, `netlify/functions/lead-quality.js:148-194`

**What we found.** The three functions that talk to GoHighLevel each build their own HTTP client: same base URL, same Version: 2021-07-28 header, same Authorization, same error handling. Verified with diff: lines 39-53 of lead-quality.js and 29-43 of sla-report.js are byte-for-byte IDENTICAL — the diff output is empty. On top of that, the cursor pagination for /opportunities/search is copied three times (ghl-report.js:83-101, sla-report.js:255-290, lead-quality.js:148-194), with the same four closing lines in all three.

**Why it matters.** When GoHighLevel changes something — the API version, a rate limit, the cursor shape — it has to be fixed in three files, and forgetting one is enough for one tab to stop returning data while the other two carry on fine. That pattern has already played out in this very repo: attrOf exists in two of the three files and sla-report.js's copy fell behind, missing the ad name field.

**How to fix it.** Move the ghl() client and the opportunity paginator into lib/shared.js, which is where the kv and the tokens already live and which all three functions already import. That's around 100 lines that come to exist once, and the change is mechanical because two of the copies are already identical.

### [MEDIUM] Six functions and constants in index.html declared and never used, plus the whole 'list' chain

`muertos-index` · dead-code · low effort · −45 lines

**Where:** `index.html:1340-1345`, `index.html:1308`, `index.html:1333-1334`, `index.html:2657-2671`, `index.html:3646`, `index.html:5358-5361`, `netlify/functions/kv.js:59`, `netlify/functions/kv.js:80-83`

**What we found.** Verified by whole-token reference count: sList, readSession, lqHierarchy, sReadFailed, sReadReset and dimThr each appear exactly ONCE in index.html — only their declaration. Three cases are worth separating out. (1) sList (1340) is the only caller of STORE.list (1308), which in turn is the only client of the kv function's 'list' operation (kv.js:59 and 80-83) and of shared.js's kvList: the chain is dead end to end, from the browser to Supabase. (2) lqHierarchy (2657) was orphaned when lqUnionTree replaced it. (3) readSession (5358) is never called, yet writeSession still writes the session to localStorage: something is stored that nobody reads.

**Why it matters.** None of this breaks, but every dead symbol is a false lead. The 'list' chain is the worst: someone wanting to know which operations the backend supports will find 'list' documented and working on the server, and assume the app uses it. And the session written to localStorage and never read is a copy of user data that exists for no purpose.

**How to fix it.** Delete the six declarations. The backend's 'list' operation can stay (it's harmless and useful for debugging), but it's worth noting in the README so it's clear nobody uses it today. And decide about writeSession: either read it at startup, or stop writing it.

### [MEDIUM] One “Metas” button and one “Base de datos” button open two different systems depending on which side of the iframe you land on

`seam-metas-db-iframe` · feature-overlap · medium effort

**Where:** `index.html:736-745`, `index.html:789-800`, `index.html:797`, `index.html:4546-4561`, `index.html:5065-5092`, `marketing.html:993`, `marketing.html:121`

**What we found.** The sidebar has one Metas button and one Base de datos button. But each of those views contains TWO worlds: a “Ventas” dropdown that renders index.html's native version, and a “Marketing” dropdown that hides the native one and shows the marketing.html iframe (metasShowFrame 4546, dbShowFrame 5065). They're two different goal editors, with two different storages (selvadentro:metas versus mkt_rrss_meta) and two different database tables. The most visible difference: the Marketing side DOES have an “Exportar JSON” button (marketing.html:993), and the Ventas side has none — even though that same screen's help text promises CSV and a JSON backup (index.html:797).

**Why it matters.** “Go to Metas and set it to 15” isn't an instruction that can be followed unambiguously: two people follow it and end up writing to different kv keys, depending on which of the two dropdowns they touched last. And the same sidebar button offers or denies the export depending on how you got there, with nothing explaining why. It's the iframe's seam showing through to the interface: an implementation detail the user ends up having to understand.

**How to fix it.** Make the view state at all times which system is being edited: a header reading “Metas · Marketing · Redes Sociales” instead of leaving it implicit in a dropdown. And harmonise what genuinely is an unjustified difference — the export should exist on both sides or on neither.

### [LOW] index.html downloads an entire typeface family it never uses

`fuentes-de-mas` · network · low effort

**Where:** `index.html:13`, `index.html:20`, `marketing.html:15`, `marketing.html:36`

**What we found.** index.html:13 requests Cardo (3 cuts), Lexend (5 weights: 300, 400, 500, 600, 700) and Yellowtail from Google Fonts. But --script:'Yellowtail' (line 20) is never applied as a font-family anywhere in index.html: the only rule that uses it is on the other side, in marketing.html:36 (.brand .name). And of Lexend, index's CSS only uses weights 400, 500, 600 and 700 — 300 is downloaded and never painted. marketing.html requests the exact same stylesheet, so in the Marketing tab everything is fetched twice, in two separate browsing contexts.

**Why it matters.** Startup weight that buys nothing. On a phone with a slow connection — the team's real situation in the field — every extra family delays the first readable text.

**How to fix it.** Drop Yellowtail and the 300 weight from index.html's stylesheet; keep Yellowtail only in marketing.html, which does use it. &display=swap is already there; what's missing is a preload for Lexend's main cut.

### [LOW] The two Dirección views share a copied chassis and walk the same data twice

`direccion-chasis-compartido` · duplication · low effort · −8 lines

**Where:** `index.html:1807-1836`, `index.html:1837-1902`, `index.html:1813`, `index.html:1817`, `index.html:1843`, `index.html:1847`, `index.html:631`, `index.html:646`, `index.html:1761-1766`

**What we found.** Worth saying first: “Dirección General” and “Dirección Comercial” are NOT the same screen. Comercial adds a conversion column next to every metric, the opp_14 column, the target mix, a totals row and the comparison against goal; General is the condensed version. They're two different products and both are justified. What is duplicated is the scaffolding: both read their range with weekSetFromRange, paint the same channel chips, use the same estadoDot/fmtMoney/pctTxt and carry the SAME help text word for word (631 and 646). And both repeat the same work: first they walk channelMetrics over the selected channels (1813 and 1843) and then over all seven (1817 and 1847), so the checked channels are computed twice per render. channelMetrics (1761) caches nothing: every call walks all of that channel's records again. Incidentally, it's a synchronous function that's awaited in all four calls.

**Why it matters.** This is the mildest finding in the report and is included for completeness: today the cost is imperceptible because the records are already in memory. It matters for the other reason: the help text repeated verbatim is a sign the two views were cloned, and that's where they start to drift. If the chip explanation changes tomorrow, both have to be remembered.

**How to fix it.** Compute perCh once over the seven channels and derive the selected subtotal from it, instead of walking twice. Drop the await on channelMetrics or make it genuinely async. And let the help text come from a shared constant.


## Interface and experience (21)

### [HIGH] The main navigation is <div>s: you can't reach the tabs with a keyboard

`foco-invisible` · accessibility · medium effort

**Where:** `index.html:114`, `index.html:189`, `index.html:198`, `index.html:224`, `index.html:266`, `index.html:268`, `index.html:290`, `index.html:385`, `marketing.html:70`, `marketing.html:134`, `marketing.html:205`, `index.html:505-510`, `index.html:38-44`

**What we found.** The five main tabs and the four Ventas sub-tabs aren't buttons but <div class="tab" data-tab="…"> (index.html:531-536 and 546-549), with no tabindex, no role and no keyboard handler — the click is bound on the div (1632). A div without tabindex can't take focus, so with a keyboard there is simply no way to change tabs. The same pattern repeats in the inner controls: the expandable rows of the Calidad de Leads tree are <tr> with onclick (2688, 2788, 3406), the four Calidad de Leads sub-tabs are divs (.lq-subtab), and the Analítica cards are clickable divs. Verified across both files: zero aria- attributes, zero semantic roles, zero tabindex. Worth being precise about what does work: the 5 sidebar buttons are real <button>s, as are the 56 <button>s in index.html and the 14 in marketing.html, and there's no global outline:none, so they keep the browser's default focus ring. The focus problem is scoped to fields: the 11 outline:none rules (index.html 114, 189, 198, 224, 266, 268, 290, 385; marketing.html 70, 134, 205) replace it with a border-color change to var(--cobre), and there isn't a single :focus-visible rule in the whole project.

**Why it matters.** Anyone navigating by keyboard — by preference or by necessity — can reach the login, fill the capture form and use the buttons, but cannot change tabs: the app's main navigation is unreachable. For a screen reader the tab bar doesn't exist as navigation either; they're divs with text. And tabbing through a forty-field form, the only indicator of where you are is a border that barely separates from the background.

**How to fix it.** (1) Turn .tab and .subtab into <button type="button">: they inherit focus and keyboard behaviour with no JS change, and the CSS barely moves. (2) Add role="tablist"/"tab"/"tabpanel" to the bar and the views. (3) One global rule :focus-visible{ outline:2px solid var(--verde-prof); outline-offset:2px } and drop the outline:none declarations, or at minimum always pair them with it. (4) For the expandable rows, a <button> inside the first cell instead of onclick on the <tr>.

### [HIGH] The app's primary button doesn't meet the contrast minimum: 2.96:1

`contraste-boton-primario` · accessibility · low effort

**Where:** `index.html:17`, `index.html:85`, `index.html:102`, `index.html:234`, `index.html:403`, `index.html:5647`, `index.html:28`, `index.html:36`

**What we found.** Ratios computed with the WCAG 2.1 formula against the real :root tokens (index.html:16-21). White on --cobre #CF8543 = 2.96:1, against the 4.5:1 minimum for normal text. That pair is .btn-primary (line 102) — Guardar, Entrar, Crear y copiar liga — and .side-btn.active (85), where the type is also 8.5px. Also failing: --neutro #6F7468 on --crema-2 #F1ECE1 = 4.08:1, which is the inactive tab at 13px (38-40), and --arena #D9B37E on --verde-prof #465241 = 4.21:1 at 10px (28, 36). Within the same system, --olivo passes fine: white on #65713F = 5.27:1.

**Why it matters.** Copper is the brand's signature and the colour of the primary action, so the problem sits exactly where it matters most: the button you're supposed to find. It shows up on a phone screen in sunlight, which is precisely where an advisor checks the report. This isn't a matter of taste: it's the difference between reading and guessing.

**How to fix it.** The brand doesn't need to change, only its use: darken copper only where it carries text on top. #A65F22 on white gives 4.6:1 and still reads as the same colour; it works well as --cobre-texto, leaving --cobre as-is for borders, dots and bars where there's no text. For the inactive tab, dropping --neutro to #5F6459 (5.1:1) is enough. The 10px arena subtitle: bump it to 11px and use --logo #EFE7D6, which already gives 6.71:1 on the green.

### [HIGH] The app has no mobile layout: four media queries in 7,200 lines, all of them touch-ups

`sin-mobile` · responsive · medium effort

**Where:** `index.html:150`, `index.html:342`, `index.html:380`, `marketing.html:142`, `index.html:38`, `index.html:77`, `index.html:106`, `index.html:170-171`, `marketing.html:59`, `marketing.html:122`, `index.html:399`, `index.html:384`, `index.html:315`

**What we found.** index.html has 3 @media and marketing.html 1. The three in index are point fixes at 680px (an input's width, a name's size, a bar's columns); none touches the structure. And the structure doesn't give: .tabs is display:flex with no overflow-x, no flex-wrap and no white-space on .tab (index.html:38), holding 5 tabs at padding 14px 22px plus two selects; .sidebar is flex:0 0 70px with height:100vh and position:sticky (77) and never collapses; .wrap carries 28px of side padding each way (72). On a 390px phone that leaves 390 - 70 (sidebar) - 56 (padding) = 264px usable, and inside it are minimums that don't fit: .lq-subtab min-width:190px × 4 sub-tabs = 760px (399), .lq-search min-width:280px (384), usr-table td.ch-col min-width:300px (315). The topbar adds to it: a 1fr auto 1fr grid with 32px side padding and a 38px logotype (index.html:24 and 32), so its minimum width exceeds 390px and pushes the “Salir” button off screen. The tab bar already overflows on tablet, not just phone. On tables, the correct pattern DOES exist and is applied where it matters most: .table-scroll carries overflow-x:auto (170) and wraps the 19 .cons tables, which are the wide ones (table.cons carries white-space:nowrap, 171). The gap is everything else: 8 of index.html's 30 tables fall outside it (lines 1515, 1825, 1879, 2030, 3163, 3965, 4614, 4641 — .rep, .fnl and .metas-table) and in marketing.html 10 of 12 do. And there the symptom is worse than scrolling: those tables sit inside .section (index.html:106), .card (marketing.html:59) and .meta-section-mkt (marketing.html:122), all three of which declare overflow:hidden for the rounded corner. When a table exceeds the width, the right-hand columns are CLIPPED with no scrollbar: nothing indicates they're missing.

**Why it matters.** The sales team checks numbers from their phones. There, the tab bar — the main navigation — compresses and the labels break across several lines while the two selects hold their width, so the bar deforms instead of scrolling. And in the tables left out of .table-scroll the damage is silent: the container clips the extra columns without leaving a bar, so the user doesn't see the data and doesn't see that data is missing.

**How to fix it.** Three rules cover most of it without a redesign: (1) an @media(max-width:900px) that switches .shell to column and the .sidebar to a horizontal bar with overflow-x:auto — marketing.html:142 already does exactly this, so it's copying a pattern the repo itself solved; (2) overflow-x:auto on .tabs and .subtabs; (3) wrap the 18 remaining tables in .table-scroll, or — cheaper — change overflow:hidden to clip only the vertical axis on .section, .card and .meta-section-mkt, so the rounded corner survives and the horizontal axis can scroll. The min-widths on .lq-subtab and .lq-search should relax to min-width:0 on mobile.

### [HIGH] Five navigation mechanisms compete for the same space, and two large reports are hidden inside a dropdown

`nav-cinco-mecanismos` · navigation · medium effort

**Where:** `index.html:508-528`, `index.html:531-536`, `index.html:546-550`, `index.html:537-544`, `marketing.html:184-189`, `marketing.html:31-33`, `index.html:1738`, `index.html:5123-5128`

**What we found.** The app navigates five ways at once: a sidebar (Metas, Asesores, Base datos, Diagnóstico, Admin), a tab bar (Dirección General, Dirección Comercial, Ventas, CRM en vivo, Marketing), Ventas sub-tabs (Ingreso de datos · Reporte · Analítica), TWO different selects carrying the same “Reporte” label in the same slot of the bar (537-544), and the marketing iframe's own navigation. That last one is in play because showMarketing (1738) only assigns the src and never calls mktSetEmbedMode(true) — unlike metasShowFrame and dbShowFrame, which do. And body.embed is precisely what hides the iframe's .tabrow and .periodbar (marketing.html:31-32). Result: in the Marketing tab you get a second row of tabs labelled “Ingreso de datos · Reporte · Analítica” — the same three as Ventas — plus a second period bar. On top of that, two full-weight reports have no tab of their own and live inside the channel select: “Desempeño de Ventas” (which per the comment at 5121-5122 used to BE a tab) and “Calidad de Leads”, a view with four sub-tabs and a three-level tree.

**Why it matters.** There's no rule that lets you guess where anything is. Diagnóstico is a CRM report but lives with the settings; Metas is configuration but switches systems depending on the tab you're in; and the same three labels “Ingreso de datos / Reporte / Analítica” describe two different trees at two heights of the screen. “Go to Ingreso de datos and capture the week” is an ambiguous instruction. The costliest part is that the two reports hidden in the select are among the most consulted: nobody finds a report inside a dropdown labelled “Reporte” that actually picks the channel.

**How to fix it.** Three decisions, none expensive: (1) pull “Desempeño de Ventas” and “Calidad de Leads” out into tabs of their own, which is what they are; (2) rename the two selects so they say what they pick — “Canal” and “Módulo” — instead of two “Reporte”s; (3) call mktSetEmbedMode(true) from showMarketing too and give Marketing's sub-navigation in the parent's sub-tab bar, so there's a single row of sub-tabs in the whole app.

### [HIGH] On an iPhone, the screen zooms in on every field and never zooms back out

`ios-zoom-captura` · responsive · low effort

**Where:** `index.html:96`, `index.html:113`, `index.html:198`, `index.html:224`, `index.html:308`, `index.html:311`, `marketing.html:66`

**What we found.** Safari on iOS zooms the page automatically when a field whose type is smaller than 16px takes focus, and doesn't zoom back out on blur. Verified: in index.html practically no field reaches 16px. .periodo input[type=date] and .periodo select are 13px (96); .frow input — the capture form's forty numeric fields — are 14px (113); .login-field input is 14px (224); the user table's fields are 13px (308-311). Of all the field rules in the file, exactly one reaches 16px. The viewport does allow zooming (there's no user-scalable=no), which is correct — and that's precisely what lets the auto-zoom act.

**Why it matters.** The app's main tab is called “Ingreso de datos” and consists of typing dozens of numbers. On an iPhone, every time you touch a field the screen zooms in, and since it doesn't zoom back out you have to pinch to see the whole form again — field by field, forty times. It's the kind of friction that makes people stop capturing from their phone and put it off until they reach a computer, which is exactly what a weekly report can't afford.

**How to fix it.** Raise field type to 16px, at least on small screens: @media(max-width:700px){ input,select,textarea{ font-size:16px } }. One rule, and the problem is gone without touching the desktop design.

### [MEDIUM] Every toggle in Calidad de Leads rebuilds the whole screen — and the code already carries the patch that gives it away

`lqrender-rerender-total` · performance · medium effort

**Where:** `index.html:3396`, `index.html:3399-3403`, `index.html:3405-3411`, `index.html:3418-3419`, `index.html:3119-3427`

**What we found.** lqRender (3119-3427, ~300 lines) ends with document.getElementById('lq-content').innerHTML = out (3396). And EVERY interaction in the tab calls it again in full: switching sub-tab (3400), switching level campaign/adset/ad (3401), switching platform (3402), changing the qualification filter (3403), expanding or collapsing a tree row (3405-3411) and typing in the search box (3418). The proof that it hurts is in the code itself: the search handler has to re-focus the input and restore the caret by hand after every render — el.focus(); el.setSelectionRange(el.value.length, el.value.length) (3419) — because the input the user is typing into gets destroyed and rebuilt on every keystroke. There's extra waste too: the entire “Calidad de Lead” sub-tab content is built ALWAYS, unconditionally — the html += blocks from line 3128 to 3378, covering the per-level table, phone and email duplicates, automatic rules vs team capture, pipeline stage, spend by campaign and methodology — and only at line 3380 is it decided whether to use it: const calidadHtml = html; … if(SUB==="calidad"){ out += calidadHtml; }. In three of the four sub-tabs that work is done in full and thrown away.

**Why it matters.** Three symptoms for whoever uses the tab: (1) the search caret always jumps to the end, so you can't fix a letter in the middle of what you typed; (2) expanding a campaign in a long tree loses the scroll position and you have to scroll back down; (3) with 12 weeks of leads the campaign>adset>ad tree gets rebuilt in full on every click. It's the most-used screen in the marketing module.

**How to fix it.** Split lqRender into “build the header and controls” (once) and “build the table” (per change). Expanding and collapsing only needs a class toggled on the row rather than a rebuild: the state already lives in lqState.exp. For search, filter already-painted rows with display:none instead of re-rendering — which also removes the need for the focus patch. And move the calidadHtml construction inside its own branch: today it's paid for in all four sub-tabs and used in one.

### [MEDIUM] Four loops that retry forever: if something won't load, the screen just waits without saying so

`polling-sin-fin` · states · low effort · −12 lines

**Where:** `index.html:4552-4557`, `index.html:5084-5089`, `index.html:4099`, `index.html:4282`

**What we found.** Four places retry with setTimeout with no attempt counter, no time limit and no error exit. Two are the bridge to the marketing iframe: metasShowFrame (4552-4557) and dbShowFrame (5084-5089) wait for the iframe to expose its API with const apply = ()=>{ … else { setTimeout(apply, 150); } }. The other two wait for Chart.js to load from the CDN: renderDirAnalitica (4099) and renderAnalitica (4282), both with if(!window.Chart){ …'Cargando librería de gráficas…'; setTimeout(…, 300); return; }. In all four, if the resource never arrives — network down, CDN blocked by a corporate network, a 404 after a half-finished deploy — the timer keeps firing indefinitely.

**Why it matters.** A permanent failure looks exactly like “still loading”. In the charts the user sees “Cargando librería de gráficas…” forever; in Metas and Base de datos they see a blank screen forever. In none of the four cases does the app ever say something failed, so the user doesn't know whether to keep waiting or reload. And since Chart.js comes from an external CDN, one network that blocks it is enough to leave two whole views in that state.

**How to fix it.** One shared helper for all four: retry with a cap (40 attempts, roughly 6-12 seconds) and on exhaustion show a concrete message with a retry button — “The charts library couldn't be loaded” or “The Marketing module couldn't be loaded”. For Chart.js it's also worth serving it from the site itself instead of the CDN: it's one file, it removes the external dependency, and it removes the failure mode.

### [MEDIUM] The design system eroded: 25 font sizes, 15 radii and 214 inline styles

`sistema-diseno-erosionado` · consistency · medium effort

**Where:** `index.html:15-426`, `index.html:16-21`, `marketing.html:17-219`

**What we found.** Measured over index.html's CSS: 25 distinct font-size values (8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 15.5, 16, 17, 18, 19, 20, 22, 23, 26, 28, 36, 38 px) — a healthy scale has 6 to 8 steps — and 50 declarations below 12px. 15 distinct border-radius values (2,3,4,6,7,8,9,10,11,12,14,16,20,30,999). 214 style= attributes in index.html and 96 in marketing.html, many inside template strings, i.e. beyond the stylesheet's reach. And colours outside the system: #a94436 (the error red) appears 21 times without being a variable, plus #bb7536 and #566034, which are the hover states of --cobre and --olivo written by hand. :root defines 15 tokens (16-21); the rest of the file contradicts them by hand. The exact inline-style breakdown explains why the stylesheet lost control: of index.html's 214 style= attributes, 0 are inside the <style> block, 23 are in the markup and 191 are inside JavaScript template literals — 89% of the inline styling is generated at runtime, outside any stylesheet's reach. Add 99 direct .style.property assignments from JS.

**Why it matters.** None of this looks broken on any one screen, but it accumulates: every appearance change has to be made in the stylesheet and then hunted down across 214 inline styles. And the 50 declarations below 12px are the underlying reason the app is hard to read on small screens.

**How to fix it.** This isn't a redesign: it's picking a scale and coming down to it. (1) Reduce to 7 font-size steps (11, 12, 13, 14, 16, 20, 28) and 4 radii (6, 10, 14, 999). (2) Promote the three already-repeated colours to tokens: --rojo #a94436, --cobre-hover #bb7536, --olivo-hover #566034. (3) The repeated inline styles in template strings (margin-bottom:18px on .table-scroll appears 8 times) are worth a class.

### [MEDIUM] 39 native browser dialogs inside an app with its own design, including a prompt() to hand over access

`alert-confirm-nativos` · consistency · medium effort

**Where:** `index.html:1437`, `index.html:5019`, `index.html:5343`, `index.html:5912`, `index.html:4395`, `marketing.html:778`, `marketing.html:928`, `index.html:1600`, `index.html:148`

**What we found.** Counted: index.html has 14 alert(, 10 confirm( and 1 prompt(; marketing.html adds 8 alert and 6 confirm. They coexist with the app's own notice system — toast at index.html:1600 with its CSS at 148, and showToast at marketing.html:255. The confirms are well written and genuinely useful: the one for deleting an advisor suggests marking them Inactive instead (4395) and the one for deleting a record warns it can't be undone (5019). The problem isn't that they exist but how they look and where they turn up. Two cases stand out: loadMod fires a three-line alert with hand-written line breaks when a read fails (marketing.html:778), and handing a new user their magic access link goes through a prompt() (index.html:5343) — a browser text box is the mechanism by which an admin passes someone their access to the system.

**Why it matters.** A browser alert() blocks the whole page, looks like a system error rather than part of the app, and on mobile appears in the browser's own styling on top of a careful design. It breaks the finished-product feeling exactly in the error moments, which are when it matters most that the app look reliable.

**How to fix it.** The toast already exists for notices. What's missing is an in-house confirmation dialog — about 20 lines — for the 16 confirms: the three delete buttons (record, user, advisor) are the most visible. The error alerts should be an error block inside the view, not a modal dialog.

### [MEDIUM] No view has a URL: you can't share a report or reload without losing your place

`sin-url-por-vista` · navigation · medium effort · −10 lines

**Where:** `index.html:1603-1629`, `index.html:5507`

**What we found.** The only appearance of history in index.html is history.replaceState in bootAuth (5507), and it's there to strip the invitation token from the address bar — not to navigate. There's no pushState, no hashchange, no popstate. In its place the app has its own history: navPush / navUpdateButtons / navGo (1603-1629) with the arrow buttons in the top bar (index.html:497-500).

**Why it matters.** Three daily consequences: (1) you can't WhatsApp a link to “SLA, weeks 30 to 34” — you have to explain the click path; (2) reloading always returns to the start, and in the syncing tabs that can trigger another full sync; (3) the browser's REAL Back button doesn't navigate within the app: it leaves it. The app's own arrow buttons teach the user there is history, and then the browser's behaves differently — two histories that don't agree.

**How to fix it.** Mirror the view in the hash (#/sla?ini=2026-W30&fin=2026-W34) and listen for hashchange. navPush already centralises view changes, so it's a single place to write the hash. With that, the custom arrow buttons can be deleted: the browser's does the job and there's no longer a second history.

### [MEDIUM] The long syncs can't be cancelled and don't coordinate between users

`sync-sin-cancelar` · states · medium effort

**Where:** `index.html:2037-2065`, `index.html:3451-3523`, `index.html:4012-4062`, `index.html:2079`, `index.html:3537`

**What we found.** The three engines (crmSync 2037, lqSync 3451, slaSync 4012) guard themselves with a local flag — if(crmState.syncing) return — that only exists inside the browser tab that started it. There's no AbortController, no cancel button, no shared “syncing” marker in the kv. Two of the three also start on their own when you enter the view if the cache is older than 30 minutes (2079 and 3537), while SLA is always manual. And when the total isn't known, the progress bar shows a made-up percentage: 50 in crmSync (2050) and 45 in lqSync (3469).

**Why it matters.** The SLA report takes 1 to 3 minutes according to the screen's own text (index.html:699) and there's no way to stop it or to know how much is genuinely left. If two people open Calidad de Leads at the same time, two full CRM crawls fire against the same GoHighLevel account. And someone who was only passing through the tab triggers a full crawl without asking for one.

**How to fix it.** (1) A Cancel button with AbortController in all three. (2) An “in progress” marker in the kv with its timestamp, so the second person sees “Diana is syncing, started 40s ago” instead of launching another. (3) When the total isn't known, show an indeterminate bar rather than an invented percentage. (4) Ask before auto-syncing on entry, or at least announce it.

### [MEDIUM] Only 3 of the 9 functions validate their configuration; the other 6 blow up without saying why

`env-sin-validar` · states · low effort

**Where:** `netlify/functions/lib/shared.js:20-27`, `netlify/functions/auth.js:41`, `netlify/functions/invite.js:120`, `netlify/functions/kv.js:48`

**What we found.** shared.js exports missingEnv() (20-27), which checks SUPABASE_URL, SUPABASE_ANON_KEY, KV_API_SECRET and SESSION_SECRET and returns whichever are missing. Verified with grep: only three handlers call it — auth.js:41, invite.js:120 and kv.js:48. The other six (ghl-report, lead-quality, sla-report, kpi-analyze, notes-analyze, lq-analyze) never call it, even though all six use S.authFromEvent, which needs SESSION_SECRET to verify the HMAC. If that variable is missing, crypto.createHmac('sha256', undefined) throws and the function answers 502 without going through the json() that sets the headers.

**Why it matters.** It's a failure mode that only shows up the day somebody touches the site's variables or stands up a new environment, and on that day the symptom is misleading: the browser reports a CORS error — because the error response carries no headers — instead of saying a variable is missing. You can lose an afternoon looking in the wrong place.

**How to fix it.** One line at the top of each handler, exactly as auth, invite and kv already do: const miss = S.missingEnv(); if (miss.length) return json(500, { error: 'Missing variables: ' + miss.join(', ') }); and extend missingEnv to take each function's extra variables (GHL_API_KEY, WINDSOR_API_KEY, ANTHROPIC_API_KEY) instead of each one checking them its own way.

### [MEDIUM] Analítica's charts pile up in memory when you switch channels

`chart-fuga` · performance · low effort

**Where:** `index.html:4167`, `index.html:4264-4266`, `index.html:4277`, `index.html:4321`

**What we found.** Each canvas id includes the channel: const canvasId = `anal-c-${chKey}-${f.k}` (4321). analDrawChart only destroys the previous instance if that exact same id is redrawn: if(ANAL_STATE.charts[canvasId]){ ANAL_STATE.charts[canvasId].destroy(); } (4266). And ANAL_STATE.charts (4167) is never purged on a channel change — there's no other reference that empties it. So moving from Brokers to Paid Orgánico leaves the previous channel's Chart.js instances alive, pointing at canvases already detached from the DOM.

**Why it matters.** Every channel visited leaves its charts behind. Over a long session — normal in a weekly review meeting, hopping across the seven channels — the tab accumulates instances and gets progressively slower with no visible cause. Chart.js registers resize handlers per instance, so every window resize also walks the dead ones.

**How to fix it.** Empty the registry on channel change: in switchChannel, Object.values(ANAL_STATE.charts).forEach(c=>{try{c.destroy()}catch(e){}}); ANAL_STATE.charts={}. The Calidad de Leads module already does exactly this with lqState._charts (index.html:2983) — same pattern, applied in one place and not the other.

### [MEDIUM] Reordering KPIs in Metas only works with a mouse: there's no touch handler at all

`drag-sin-tactil` · responsive · medium effort

**Where:** `index.html:4853`, `index.html:4866`, `index.html:4880`, `index.html:4897`

**What we found.** KPI and section reordering in the Metas editor is built on the HTML5 desktop drag API: ondragstart (4853 and 4866), ondragover (4880) and ondrop (4897). Verified by count: four drag handlers and ZERO touchstart, touchmove or pointerdown in all of index.html. HTML5 drag events don't fire from a finger on iOS or Android.

**Why it matters.** From a phone or tablet the KPI order simply can't be changed: the user drags and nothing happens, with no message explaining why. And since there's no alternative — no up/down arrows, no position field — the feature is reserved for whoever is at a computer.

**How to fix it.** The cheapest and most robust option is not to depend on dragging: add two ↑ ↓ buttons per row, which also makes the feature keyboard- and screen-reader-accessible. Dragging can stay as a shortcut for mouse users.

### [MEDIUM] The login card can end up with no way out when the keyboard is open

`login-sin-scroll` · responsive · low effort

**Where:** `index.html:213`, `index.html:215`, `index.html:224`

**What we found.** #login-screen is position:fixed with inset:0, display:flex and align-items:center (213), and declares no overflow-y. In a fixed, centred container, if the content is taller than the visible area the excess is clipped top and bottom with no way to scroll it. The card is padding:38px 42px with max-width:400px (215) and, in the invitation step, holds a title, a subtitle and TWO password fields plus the button — the tallest of the three forms.

**Why it matters.** It shows up in two ordinary situations: a phone in landscape, and a phone in portrait with the keyboard open, which cuts the visible height by more than half. In both, the sign-in button can end up off screen with no way to scroll to it. The most delicate case is the invitation step itself: it's the person's first contact with the system and it arrives over WhatsApp, i.e. from a phone.

**How to fix it.** Add overflow-y:auto to #login-screen and change align-items:center to align-items:safe center, which centres when it fits and aligns to the top when it doesn't, instead of clipping both ends.

### [MEDIUM] Several columns' meaning lives only in a tooltip, and on a phone there are no tooltips

`title-unico-canal` · consistency · low effort

**Where:** `index.html:2751-2752`, `index.html:487`, `index.html:498-499`

**What we found.** The Calidad de Leads table prints abbreviated headers and keeps the real name in the title attribute: ${LQ_COLS.map(L=>`<th title="${L.name}">${L.short}</th>`)} (2751). In that same row, the business definition of OPP — “a real closing opportunity: Seguimiento de OPP, Carta oferta, Apartado or later; a sent quote doesn't count yet”, a rule agreed with the client — exists only inside a title. There are 42 title attributes in index.html in total. On a touch screen there is no hover: the tooltip never appears.

**Why it matters.** From a phone, several columns of the marketing module's most important table are abbreviations with no meaning available. And the definition of OPP — the concept that has caused the most confusion, to the point of having to be confirmed with the client — is invisible to exactly the people checking from their phone.

**How to fix it.** Move what is content out of the tooltip: a legend row above the table, or a collapsible footnote with the definitions of OPP, WON and the column abbreviations. The title can stay as reinforcement for mouse users, but it can't be the only place the information lives.

**Status.** Partly fixed — the OPP definition is now in the Diagnóstico glossary as well as the tooltip. The abbreviated column headers still rely on hover.

### [MEDIUM] The form validates nothing: anything pasted from Excel is saved as 0, and there's no per-field error state

`captura-sin-validacion` · forms · medium effort

**Where:** `index.html:1395`, `index.html:1414`, `marketing.html:251`, `marketing.html:335`, `index.html:113-114`

**What we found.** Fields are generated as <input type="number" step="…"> with no min, no max and no required (1395), and the value is read with data[f.k] = el && el.value!=="" ? Number(el.value) : 0 (1414). With type=number the browser rejects content that isn't a pure number and leaves value as an empty string: pasting “1,200” or “$1,200” from Excel — which is how numbers come out of a spreadsheet — produces a 0, with no warning and no visible difference from a field that genuinely is 0. There are no consistency rules either (nothing stops OPPs exceeding leads) and no error styling: the form's CSS only knows rest and focus (113-114), with no .error classes and no aria-invalid. And the app's two forms use opposite conventions: marketing.html captures with type=text and a num() function that cleans the text (251, 335), so the same “1,200” gives 0 in Ventas and 1200 in Marketing.

**Why it matters.** A 0 that should have been 1,200 is indistinguishable at a glance from a legitimate 0, and it drags along everything computed on top of it: conversions, cost per lead, goal attainment and the green/red light in the Dirección report. Since there's no range or consistency validation, there's also nothing downstream to catch that the number is impossible.

**How to fix it.** (1) Harmonise capture to marketing.html's convention, which is the more forgiving one: type=text with inputmode=numeric and a function that strips commas, spaces and the currency symbol before converting. (2) Add min=0 to the counts. (3) A warning — not a block — when the funnel is impossible (OPP > leads), with the field marked in red instead of a generic toast.

### [MEDIUM] Disabled buttons look exactly like active ones

`disabled-sin-diseno` · states · low effort

**Where:** `index.html:101-104`, `index.html:80-81`, `index.html:201`, `index.html:2042`, `index.html:4016`, `index.html:3055`

**What we found.** The JS disables buttons in 14 different places (.disabled = true), mostly during long syncs and AI calls. But the button system has no disabled state: verified, there is no .btn:disabled, .btn-primary:disabled or .btn-olive:disabled rule. The file's only three :disabled rules are for other elements: the nav arrows (80-81, opacity .3) and the Asesores save button (201, cursor only). In fairness there is a signal: the code changes the button's text while it works — “Sincronizando…”, “Generando…”, “Analizando…” — so the user isn't entirely in the dark.

**Why it matters.** During the SLA report, which takes 1 to 3 minutes, the button still looks exactly like a pressable button: same colour, same hand cursor, same hover effect. The only thing that changed is the word. Anyone who doesn't read it presses again, nothing happens, and the natural conclusion is that the app is stuck — precisely when the right thing to do is wait.

**How to fix it.** One system-wide rule: .btn:disabled{ opacity:.55; cursor:progress; pointer-events:none } — and use cursor:progress rather than not-allowed during waits, because it says “working” instead of “you can't”. With the text change that already exists, that settles it.

### [MEDIUM] “Reporte” names four different things, and there are eight verbs for the same action

`vocabulario-sin-normalizar` · consistency · low effort

**Where:** `index.html:538`, `index.html:542`, `index.html:548`, `index.html:602`, `index.html:628`, `index.html:643`, `index.html:677`, `index.html:693`, `index.html:707`, `index.html:502`

**What we found.** The word “Reporte” appears with four senses, three of them visible at the same time in the top bar: the channel select's label (538), the marketing module select's label (542, same word and same look for a different thing), the Ventas “Reporte” sub-tab (548), and the document the “Generar reporte” button produces. In parallel, the buttons that occupy the same position — the right end of the period bar — and do conceptually the same thing (fetch data and paint it) use eight different verbs: “Generar reporte” (602, 628, 643, 693), “Sincronizar CRM” (677), “Sincronizar leads”, “Probar conexiones”, “Buscar”, “Recargar”, “Analizar con IA” and “Generar conclusión con IA”. And the user's role is printed with the internal English identifier: <span class="role">user</span> (502). It should be said that the rest of the app's Spanish is well written and correctly accented — this isn't a writing problem but an un-normalised vocabulary.

**Why it matters.** It forces people to memorise the app instead of inferring it. Someone new can't tell whether “Sincronizar leads” and “Generar reporte” do similar things or very different ones, nor why the same dropdown in the same place is called “Reporte” in two tabs and picks different things. And for a Mexican sales team, seeing “user” as the description of their own role is simply the system speaking its language instead of theirs.

**How to fix it.** A vocabulary table, and bring everything down to it: “Reporte” only for the document; the selects become “Canal” and “Módulo”; the buttons that fetch from the CRM all say “Actualizar desde el CRM” and the ones that build a document say “Generar reporte”. Roles display as “Administrador” and “Usuario”, leaving the slugs to the code.

### [MEDIUM] SQL, MQL, CQL and OPP are used as headers across several screens and explained on only one

`jerga-sin-glosario` · consistency · low effort

**Where:** `index.html:2101-2107`, `index.html:2752`, `index.html:2841`, `index.html:3374-3375`, `index.html:1829`

**What we found.** The qualification acronyms are declared as level names with no gloss (2101-2107: “SQL Selvadentro” abbreviated “SQL SD”, “SQL”, “MQL”, “CQL”) and used as column headers in the Calidad de Leads tables, in the per-level breakdown and in the combined report. “OPP” and “WON” appear in the consolidated Dirección table (1829). The only explanation of OPP that exists in the interface lives inside a title attribute — i.e. invisible on any touch screen — and for MQL, CQL and SQL there's no definition anywhere in the app: they're in the README, which the sales team doesn't read.

**Why it matters.** These are the acronyms the results conversation turns on, and the app takes them as given. Anyone joining the team has to ask what separates an MQL from a CQL, and since each person gets the answer from someone different, the definitions drift apart — which is exactly the problem the automatic rule-based qualification was built to solve.

**How to fix it.** The Diagnóstico tab already exists to answer this kind of question with system data: it's the natural home for the glossary — the five qualifications, OPP, WON — next to the real pipeline stages it already lists. Plus a collapsible legend above the tables that use the acronyms, so nobody has to change screens.

**Status.** Partly fixed — the glossary now lives in Diagnóstico with the five qualifications, OPP and the three WONs. The collapsible legend above the tables is still pending.

### [LOW] The brand mark says “Click to change the logo” and there's no way to change the logo

`logo-promesa-falsa` · consistency · low effort · −6 lines

**Where:** `index.html:487`, `index.html:1575-1583`, `index.html:1542-1552`, `marketing.html:1234`, `marketing.html:746`

**What we found.** index.html:487 declares <div class='brand' id='brand' title='Clic para cambiar el logo'>. The only handler attached to it is setupBrandPhrase (1575), which also overwrites the title with “Click para una dosis de energía” and shows a random motivational phrase. In index.html there is no file input, no FileReader and no writer for the selvadentro:logo key: loadLogo (1542) only READS it, so it always falls through to the GoHighLevel CDN PNG. The only real logo uploader lives on the other side of the iframe (marketing.html:1234) and writes to a different key, mkt_logo (746). On top of that, the loadLogo block that reads window.fs.readFile (1546-1549) is a leftover from the Claude prototype: window.fs doesn't exist in a browser, so those four lines and their list of eight filenames never run.

**Why it matters.** Little damage, but it's exactly the kind of detail that makes people stop trusting an app's tooltips: they promise something that doesn't happen. And two logo systems with two different keys guarantee the iframe's logo and the app's logo can end up looking different.

**How to fix it.** Decide which one wins. If the logo is changeable, lift marketing.html's uploader into index.html and use a single key. If it isn't, drop the misleading title, remove the window.fs block, and leave the phrase easter egg with an honest tooltip.


## What's already right

- **The backend is properly locked down** — The `slvd_kv` table has RLS with no policies and everything goes through an RPC whose secret lives only on the server. The client never sees the user list or the hashes. August's migration was done right.
- **The magic links are well thought through** — Signed with a separate HMAC domain (`inv:`) so an invitation can never work as a session, single-use with a nonce, 7-day expiry, and the token travels in the hash so it never reaches the server or the logs. `bootAuth` even cleans the address bar with `replaceState`.
- **The comments explain the why, not the what** — Several blocks document the business decision and the date it was taken — why “Cotización enviada” doesn't count as an OPP, why the SLA clock runs 24/7, why a failed read no longer overwrites with the seed. That's what makes a 380 KB file with no tests maintainable.
- **Asesores already solves what Ingreso doesn't** — It tracks unsaved changes, disables the button when there's nothing to save, says “Tienes cambios sin guardar”, and confirms before deleting while suggesting marking the person Inactive instead. The right pattern already exists in-house: it just needs carrying over to the capture form.

## Method

Ten independent reviews swept the code in parallel by dimension — logic duplication, dead
code, network and caching, navigation, accessibility, responsive behaviour, loading and
error states — and every finding was verified one by one against the file before inclusion.

That verification threw things out: containers flagged as unused that are in fact populated
(ids built from templates, so a literal search misses them); a double render at startup that
turned out to be a deliberate, commented optimisation; and a claim of ours that no control
had a focus state, when the app's buttons are real `<button>` elements.

Hard numbers — contrast ratios, CSS rule counts, dead-code bytes, per-symbol references —
were computed against the files, not estimated. All 252 cited line references were checked.

No migration to React and no build step is proposed: the *no build* constraint is a
project decision.
