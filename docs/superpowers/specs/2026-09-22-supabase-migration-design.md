# La Baracca di Ultron — Migrazione a Supabase (Giro 1)

Status: approvato a grandi linee da Vincent (2026-09-22), in attesa del piano di implementazione.

## Scope

Sostituire il livello dati della Baracca (oggi: file JSON locali letti/scritti da `server.py` e dagli hook) con Supabase (Postgres + Auth + Realtime). **Fuori scope per questo giro**: qualunque riscrittura della UI in React (pannelli DASHBOARD/STATUS/RAPPORTO/modale restano HTML-a-mano come oggi) e qualunque modifica al motore canvas pixel-art (`drawUltron`, `drawCrew`, `drawSpec`, `bakeRoom`, ecc. — nessuna di queste funzioni viene toccata). Quei due pezzi sono il Giro 2, con una spec propria quando arriva il momento.

Il vault (`Active Priorities.md`, le note) **non entra in Supabase** — resta letto localmente da `server.py` via `/api/vault`, invariato.

## Perché

La nota di design della Baracca dichiara già tre limiti accettati: nessuno storico (i file JSON si "riscrivono freschi ogni volta"), accesso solo da `127.0.0.1`, una race condition nota su scritture concorrenti senza file-lock. Supabase risolve tutti e tre, più abilita push Realtime al posto del poll ogni 400ms.

## Architettura

```
Hook Claude Code (invariati nel trigger)
  → script Python (barracks.py, set_state.py, session_track.py)
  → HTTPS via urllib (stdlib, nessuna dipendenza pip nuova)
  → Supabase REST (service-role key, locale, 600 perm)
  → Postgres (RLS scoped a user_id)
  → Supabase Realtime
  → baracca.html (client Supabase JS via CDN, anon key + sessione utente)
  → stesse funzioni di rendering di oggi, invariate
```

`server.py` perde `/api/state`, `/api/sessions`, `/api/subagents` (il browser legge Supabase direttamente). Tiene `/api/vault` (vault locale) e `/api/talk` (lancia terminale, deve restare locale) e continua a servire `baracca.html`.

## Schema (Postgres, un solo progetto Supabase per l'istanza privata)

**`agent_state`** — una riga per utente, upsert ad ogni evento.
| campo | tipo | note |
|---|---|---|
| user_id | uuid | RLS key, references auth.users |
| status | text | idle / thinking / waiting / spawning |
| area | text, nullable | nota vault toccata, se presente |
| updated_at | timestamptz | |

**`sessions`** — una riga per `transcript_path` (terminale) attivo.
| campo | tipo | note |
|---|---|---|
| user_id | uuid | |
| transcript_path | text | unique per user_id |
| status | text | |
| updated_at | timestamptz | query-side filtra `> now() - 15 min`, stessa soglia di oggi |

**`subagents`** — coda FIFO, stessa approssimazione onesta già documentata (gli hook non dicono quale Task esatto termina).
| campo | tipo | note |
|---|---|---|
| user_id | uuid | |
| room | text | settore |
| agent | text | |
| task | text | |
| created_at | timestamptz | reap = elimina la riga più vecchia per quel `room` su `SubagentStop` |

**`token_usage`** — **aggregata per giorno/reparto**, non una riga per evento (decisione esplicita per restare nell'ordine di poche decine di KB/anno, ben dentro i 500MB del piano gratuito verificati su supabase.com/pricing).
| campo | tipo | note |
|---|---|---|
| user_id | uuid | |
| day | date | |
| room | text | |
| input, output, cache_read, cache_write | bigint | incrementati con upsert (`on conflict (user_id, day, room) do update ... = valore + delta`) |

Vincolo unique su `(user_id, day, room)`.

**RLS**: su tutte e 4 le tabelle, policy `user_id = auth.uid()` per select/insert/update lato browser (anon key). Gli hook scrivono con la **service-role key** (bypassa RLS, tagga comunque `user_id` di Vincent) — stesso pattern già in uso per `watch`/OpenRouter: chiave in un file locale a permessi 600, mai nel vault o nel repo.

## Auth

Un solo utente Supabase Auth (Vincent). `baracca.html` mostra un login minimale alla prima apertura (email+password), la sessione persiste via `localStorage` grazie al client Supabase JS — non richiesto di nuovo ad ogni apertura. Predispone anche l'accesso remoto futuro (stessa gate, se un giorno la pagina è raggiungibile oltre `127.0.0.1`).

## Migrazione sicura (nessun rischio di rottura)

1. **Doppia scrittura transitoria**: gli hook scrivono sia su Supabase sia sui vecchi file JSON locali. `baracca.html` continua a leggere dai file locali come oggi finché non si passa allo step 2 — zero rischio, puro lavoro additivo.
2. Una volta verificato che Supabase riceve dati corretti (controllo diretto delle righe), si passa `baracca.html` a leggere da Supabase (poll iniziale + Realtime) dietro un flag facile da disattivare.
3. Solo dopo un periodo di stabilità si tolgono le scritture locali dagli hook.

Rete di sicurezza già in posizione: snapshot pre-migrazione pubblicato su `github.com/rblvince/baracca-ultron` (commit `ce22434`), rollback immediato disponibile in qualunque momento.

## Gestione offline

Terza pillola oltre DEMO/LIVE: **OFFLINE**, quando Supabase non risponde (timeout sulla connessione Realtime o sulla query iniziale). L'ultima istantanea nota viene tenuta in `localStorage` del browser così la pagina non resta vuota — mostra dati stantii con l'etichetta esplicita, non finge che siano freschi.

## Testing

- `hooks/test_barracks.py` (stesso stile attuale, nessun framework, solo `assert`) esteso per coprire la nuova chiamata HTTP verso Supabase (via mock/stub della risposta, non una chiamata di rete vera nel test).
- Verifica dal vivo: iniettare una riga di prova direttamente in Supabase (SQL editor o REST), ricaricare `baracca.html`, confermare a schermo che compare in tempo reale — stesso metodo già usato nel Giro 3 per multi-sessione/sub-agenti (dati finti iniettati, poi ripuliti).
- `python3 -m py_compile` su tutti gli script Python toccati, `node --check` sullo script estratto da `baracca.html`.

## Aperto (da decidere in fase di piano, non blocca l'approvazione di questa spec)

- Nome/regione del progetto Supabase da creare.
- Se il login iniziale usa email+password o un magic link (dettaglio implementativo, non architetturale).
