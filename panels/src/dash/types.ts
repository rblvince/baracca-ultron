// Istantanea della sala comando pubblicata dal vanilla (dashSnapshot in
// baracca.html, blocco DASH-PURE). Oggetti semplici: niente funzioni, niente DOM.

export type LinkKey = 'session' | 'prompt' | 'pre' | 'tool' | 'notify' | 'sub' | 'compact' | 'stop';

export type Mode = 'live' | 'rest' | 'demo';

export type DashHeader = {
  status: string;          // parola dello stato (stateWord)
  rawStatus: string;       // STATE.status grezzo, per l'animazione del ritratto
  color: string;           // stColor()
  where: string;           // "in OFFICINA", "nel corridoio", …
  whereBold: string | null; // nodo o compito, in grassetto dopo " · "
  identity: string;        // "Ultron · chief of staff…", "Ultron · in attesa del vault", "Ultron"
  clock: string;           // testo di #coreClock
  live: boolean;
  lastSeenS: number | null; // secondi dall'ultimo segnale se LIVE, altrimenti null ("demo")
  moving: boolean;
  mode: Mode;              // LIVE, A RIPOSO o DEMO
  waiting: string | null;  // "permesso · Bash", "attesa": Ultron aspetta te; null se no
  queue: number;           // eventi ancora in coda nella scena
  terminals: number;       // terminali Claude Code attivi
  subagents: number;       // sub-agenti al lavoro
  events: number;
  perMin: string | null;   // "3.4" oppure null ("—")
};

/** Una riga dell'attività: un reparto, o "turno" per prompt, attese e fine turno. */
export type ActivityRow = { id: string; name: string; color: string };
export type ActivityEvent = { ts: number; row: string; label: string; fail: boolean };
export type DashActivity = { now: number; win: number; rows: ActivityRow[]; events: ActivityEvent[] };

export type RoomCard = {
  id: string; name: string; color: string;
  ms: number;              // tempo di Ultron nel reparto da quando è aperta la pagina
  share: number;           // 0..1 sul totale
  out: number;             // token d'uscita spesi lì da quando è aperta la pagina
  events: number;          // eventi negli ultimi 30 minuti
  here: boolean;           // Ultron è lì adesso
};

export type DashLink = { hit: Record<LinkKey, boolean>; last: LinkKey | null; hot: boolean; seen: Record<LinkKey, number | null> };

export type CrewCard = {
  id: string; name: string; color: string;
  desc: string;            // il mestiere, in una riga
  role: string;            // nome del reparto della postazione, o "PORTELLONE"
  state: string;           // cosa sta facendo, in parole
  busy: boolean;
};

export type RealPaper = { index: number; title: string; done: number; total: number; nextTag: string | null };
export type ScenePaper = { id: number; text: string; p: number; stage: string; qa: boolean };
export type DashBoard = {
  real: RealPaper[];
  scene: ScenePaper[];     // già vuoto se LIVE
  delivered: string[];     // già vuoto se LIVE
  deliveredCount: number;
  live: boolean;
  sub: string;             // "2 ATTIVE" oppure "3 IN CORSO · 5 CONSEGNATE"
};

/** I tre sub-agenti con un personaggio (CODER, VALUTATORE, JEV GIURIA): busy = c'è un loro sub-agente in corso. */
export type AgentCard = { id: string; name: string; color: string; desc: string; state: string; busy: boolean };

export type SkillCard = { id: string; name: string; color: string; desc: string; uses: number; hot: boolean; where: string; busy: boolean };
export type ShelfRow = { label: string; count: number; color: string };

export type VaultSnap = {
  priorities: { open: string[]; completed: number }; // testi già ripuliti dal Markdown
  vinland: { status: string | null; jobs: { name: string; steps: number }[] };
  daily: { latest: string | null; count: number };
};

export type Palette = { gold: string; cyan: string; violet: string; green: string; red: string };

export type DashSnapshot = {
  header: DashHeader;
  activity: DashActivity;
  rooms: RoomCard[];
  link: DashLink;
  crew: CrewCard[];
  board: DashBoard;
  skills: SkillCard[];
  agents: AgentCard[];
  shelf: ShelfRow[];                  // sempre 6 righe
  vault: VaultSnap | 'down' | null;   // null = non ancora letto
  debugRaw: { label: string; json: string } | null; // solo con #debug
  palette: Palette;
};

/** Quello che solo il motore sa fare, passato una volta al montaggio. */
export type Engine = {
  sprites: {
    bust(status: string, blink: boolean, talk: boolean): CanvasImageSource;
    crew(id: string): HTMLCanvasElement;  // canvas 24×30 già disegnato
    spec(id: string): HTMLCanvasElement;  // canvas 22×32 già disegnato
  };
  openPriority(text: string): void;
  openMission(index: number): void;
  openTask(id: number): void;
  openDelivered(name: string): void;
  goRoom(id: string): void;          // alla BASE, camera sul reparto
  goActor(id: string): void;         // alla BASE, camera sulla persona ('ultron' = seguilo)
};

export type Slots = { adesso?: HTMLElement; squadra?: HTMLElement; vault?: HTMLElement; storico?: HTMLElement };
