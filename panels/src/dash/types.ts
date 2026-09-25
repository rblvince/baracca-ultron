// Istantanea della sala comando pubblicata dal vanilla (dashSnapshot in
// baracca.html, blocco DASH-PURE). Oggetti semplici: niente funzioni, niente DOM.

export type LinkKey = 'session' | 'prompt' | 'pre' | 'tool' | 'notify' | 'sub' | 'compact' | 'stop';

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
};

export type DashSignal = {
  pulse: number[];         // pulseHist, 48 valori 0..1
  events: number;
  perMin: string | null;   // "3.4" oppure null ("—")
  lastTool: string;        // nome grezzo (title)
  lastToolLabel: string;   // toolLabel(LAST_TOOL)
  node: string;            // già tagliato a 14 caratteri
};

// seen: secondi dall'ultimo evento VERO di quell'hook (ricordato nel browser), null = mai visto
export type DashLink = { hit: Record<LinkKey, boolean>; last: LinkKey | null; hot: boolean; seen: Record<LinkKey, number | null> };

export type CrewCard = {
  id: string; name: string; color: string;
  role: string;            // nome del reparto, "IN CAMMINO" o "PORTA CASSA"
  busy: boolean;
  tokens: [number, number, number, number] | null; // in, out, cache-r, cache-w (solo LIVE)
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

export type SkillCard = { id: string; name: string; color: string; desc: string; uses: number; hot: boolean; where: string };
export type RoomTimeRow = { id: string; name: string; color: string; ms: number }; // già ordinate, dalla più alta
export type ShelfRow = { label: string; count: number; color: string };

export type VaultSnap = {
  priorities: { open: string[]; completed: number }; // testi già ripuliti dal Markdown
  vinland: { status: string | null; jobs: { name: string; steps: number }[] };
  daily: { latest: string | null; count: number };
};

export type Palette = { gold: string; cyan: string; violet: string; green: string; red: string };

export type DashSnapshot = {
  header: DashHeader;
  signal: DashSignal;
  link: DashLink;
  crew: CrewCard[];
  board: DashBoard;
  skills: SkillCard[];
  roomTime: RoomTimeRow[];
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
};

export type Slots = { sessione?: HTMLElement; lavoro?: HTMLElement; memoria?: HTMLElement; storico?: HTMLElement };
