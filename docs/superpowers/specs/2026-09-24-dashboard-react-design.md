# Porting della DASHBOARD in React — design

Data: 2026-09-24 · Stato: approvato a sezioni da Vincent in chat, in attesa della revisione della spec scritta.

## Perché

Pezzo da **portfolio** (piano portfolio 2027): la sala comando della Baracca riscritta in React fatto bene — componenti piccoli, tipi stretti, test. Scelta di Vincent: solo questo. La dashboard fuori dal Mac (telefono, gemello pubblico) resta in standby; prima si finisce quello che esiste, niente funzioni nuove.

**Riuscito quando:** a occhio la dashboard è identica a oggi (stessi 11 pannelli, stesso aspetto, stessi dati, stessi clic), il codice vanilla della `#dashv` non esiste più, e tutto ha test.

## Stato di partenza (verificato sul codice, commit `2803dcd`)

- Vista `#dashv` in `baracca.html`: 11 pannelli vanilla in tre gruppi (3 SESSIONE, 5 LAVORO, 3 MEMORIA) più lo STORICO già in React (`panels/`, `mountStorico`).
- `renderDashLive(t)` (≈130 righe) gira ogni ~110 ms a dashboard aperta e legge le globali del motore: `STATE`, `LIVE`, `ULTRON`, `SKFX`, `EVENTS`, `LAST_TOOL`, `LAST_NODE`, `LAST_STATE`, `CREW`, `TASKS`, `SKILLS`, `ROOMS`, `ROOMTIME`, `STAGES`, `DELIVERED_LOG`, `delivered`, `pulseHist`, `LINK_HIT/LINK_LAST/LINK_AT`, `VAULT`.
- `renderVault(v)` / `renderVinland` / `renderCal` / `drawShelf` disegnano MEMORIA e PRIORITÀ; `buildCrew` / `buildSkills` costruiscono una volta sola le card con gli sprite.
- Sprite pixel-art del motore: `bustSprite`, `crewSprite`, `cameoSprite`, `specSprite`. Schede di dettaglio vanilla condivise con la vista BASE: `openItemDetail`, `showMissionDetail`, `showTaskDetail`.
- I dati arrivano da `state.json` (hook) e `/api/vault` (`server.py`). Nessun pannello della dashboard legge Supabase (lo STORICO sì).

## Architettura: il ponte

Unico punto di contatto vanilla ↔ React, come oggi `mountStorico`.

**`mountDashboard(el, client, opts)`** in `panels/src/`, registrato su `window`. `opts` porta le funzioni che solo il motore sa fare, passate **una volta** al montaggio:

```ts
type Engine = {
  rooms: Room[];
  sprites: {
    bust(status: string, blink: boolean, talk: boolean): HTMLCanvasElement;
    crew(agentId: string): HTMLCanvasElement;   // cameo se ha un costume
    spec(skillId: string): HTMLCanvasElement;   // cameo se ha un costume
  };
  openDetail(title: string, sub: string, html: string): void;
  openMission(index: number): void;          // indice in activeMissions(VAULT) al clic
  openTask(taskId: number): void;            // TASKS[].id
};
```

Ritorna `{ publish(snap: DashSnapshot): void; setActive(active: boolean): void; unmount(): void }`.

**Dal vanilla, i dati.** A ogni giro il vanilla chiama `dash.publish(dashSnapshot(motore))` al posto di `renderDashLive`. `DashSnapshot` è un oggetto semplice e serializzabile, tipizzato in `panels/src/dashTypes.ts`:

- `header`: `status`, `statusColor`, `where` (testo) + `whereBold` (nodo o compito), `clock`, `live`, `lastSeenS`, `moving`.
- `signal`: `pulse: number[]`, `events`, `perMin` (numero o null), `lastTool`, `lastToolLabel`, `node`.
- `link`: `hit: Record<'prompt'|'tool'|'sub'|'stop', boolean>`, `last`, `hotUntil` (ms).
- `crew`: per operativo `id`, `name`, `color`, `role` (testo: reparto / IN CAMMINO / PORTA CASSA), `busy`, `tokens: [in, out, cread, cwrite] | null`.
- `board`: `real` (titolo, fatti, totale, prossimo tag), `scene` (id, testo, avanzamento, fase, qa), `delivered: string[]`, `deliveredCount`, `sub` (testo).
- `skills`: per specialista `id`, `name`, `color`, `desc`, `uses`, `hot`, `where` (testo).
- `roomTime`: per reparto `id`, `name`, `color`, `ms`.
- `vault`: `null` se non raggiungibile, altrimenti `identity`, `priorities` (aperte, completate), `vinland` (stato, job con passi), `daily` (ultima, conteggio), `shelf` (sei righe nome/conteggio/colore).
- `debugRaw`: stringa JSON solo se l'URL ha `#debug`, altrimenti null.

`dashSnapshot(motore)` è una **funzione pura** (il motore le passa le globali come argomento) in un blocco `/* DASH-PURE-START */ … /* DASH-PURE-END */` di `baracca.html`, testata da Node come `test_aux.mjs` fa con `AUX-PURE`. La pagina non ha un build: questo metodo esiste già.

**Ridisegni.** React confronta l'istantanea nuova con la precedente per sezione (uguaglianza strutturale) e aggiorna solo i pannelli che cambiano: niente render a vuoto ogni 110 ms. Il ritratto è l'eccezione (vedi Canvas).

## Componenti

Un componente per pannello, stesse classi CSS di oggi (`.dp`, `.c4`, `.dgroup`, `.stats`, `.bars`…): lo stile non si riscrive, l'aspetto resta identico per costruzione.

| Gruppo | Componenti | Legge |
|---|---|---|
| MEMORIA | `Archivio` (canvas), `Diario`, `Vinland` | `vault` |
| LAVORO | `Operativi`, `BachecaMissioni`, `PrioritaAperte`, `Specialisti`, `TempoPerReparto` | `crew`, `board`, `vault.priorities`, `skills`, `roomTime`, sprite, schede |
| SESSIONE | `Testata` (ritratto), `Segnale` (canvas), `PonteHook` | `header`, `signal`, `link`, `debugRaw` |

Le etichette REALE/SCENA dei pannelli seguono `header.live` come oggi.

## Canvas

- **`Archivio`**: `ref` + funzione di disegno TS; si ridisegna solo quando cambia `vault.shelf`. Il calcolo di righe e dorsi è una funzione pura testata.
- **`Segnale`**: si ridisegna a ogni `signal.pulse` nuovo. Altezze e posizioni delle barre in una funzione pura testata.
- **Ritratto**: battito di ciglia e parlato dipendono dal tempo, quindi ha un suo `requestAnimationFrame` attivo solo a dashboard aperta (`setActive`), che chiama `sprites.bust(...)` con lo stato dell'ultima istantanea.

## Ordine di lavoro

MEMORIA → LAVORO → SESSIONE (dal più semplice al più delicato), dopo il ponte. Per ogni gruppo:

1. il gruppo React prende il posto di quello vanilla nella `#dashv`;
2. si cancella il vanilla di quel gruppo (alla fine non resta niente di `renderDashLive`, `renderVault` per la dashboard, `renderVinland`, `renderCal`, `drawShelf`, `buildCrew`, `buildSkills`, `drawPulse`, `renderLink`);
3. suite intera verde;
4. confronto a schermo prima/dopo;
5. un commit locale (push solo su ok di Vincent).

Alla fine `mountStorico` viene inglobato in `mountDashboard`: un solo punto d'ingresso.

## Cosa resta vanilla

Le schede di dettaglio (condivise con la vista BASE), il pannello missioni a destra (`renderMissions`, non è dashboard), il motore e gli sprite, `server.py`, la vista BASE.

## Errori e casi limite

- Vault non raggiungibile: `vault: null` → stessi testi di oggi ("vault non raggiungibile · avvia start.sh", scaffale vuoto, "nessun job nel vault", "nessuna nota").
- Nessuna istantanea ancora arrivata: i pannelli mostrano lo stato vuoto di oggi, mai un errore.
- `#debug`: il JSON grezzo si vede solo con `#debug`, come oggi.
- Un errore dentro un componente non deve spegnere la scena: la dashboard ha un error boundary che mostra "pannello non disponibile" al posto del pannello rotto.

## Test

- `dashSnapshot`: test Node sul blocco `DASH-PURE` (LIVE e DEMO, vault presente e assente, missioni vere e di scena, `#debug`).
- Ogni componente: Vitest + Testing Library con istantanee finte (stato vuoto, pieno, errore), come lo STORICO.
- Funzioni pure dei canvas: test diretti.
- Ponte: `publish` aggiorna solo i pannelli cambiati; `setActive(false)` ferma l'animazione del ritratto; i clic chiamano `openDetail` / `openMission` / `openTask` con gli argomenti giusti.
- Tipi stretti, nessun `any`; `tsc --noEmit` pulito.

## Verifica

A ogni gruppo, sulla Baracca vera: screenshot prima/dopo a 1400 e 700 px, in LIVE e in DEMO; ogni clic su priorità, missioni e bacheca apre la stessa scheda di prima. Alla fine `/impeccable audit` sulla dashboard: zero regressioni rispetto a oggi (non migliorie: sarebbero lavoro nuovo).

## Coordinamento

`baracca.html` è condiviso con un'altra sessione (400 righe riscritte il 24/09, `2803dcd`). Prima di ogni gruppo: working tree dell'altra sessione pulito, messaggio "tocco `#dashv` e `renderDashLive`, non il resto", partenza dal suo ultimo commit.

## Fuori scopo

Telefono e gemello pubblico (standby), dati da Supabase per la dashboard, schede di dettaglio, pannello missioni a destra, motore e sprite, nuove funzioni, restyling.
