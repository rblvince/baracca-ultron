# Redesign: la Baracca a strati

Proposta dell'08/10. Prototipo funzionante in `baracca-strati.html` (`http://127.0.0.1:8795/baracca-strati.html`).

## L'idea

Oggi la Baracca è **una pianta vista dall'alto**: un disegno solo, grande, che si trascina. La proposta è girarla di 90° e guardarla **in sezione, di fronte**, come una casa delle bambole o un teatrino di carta: il palazzo tagliato a metà, due piani da tre reparti, e dentro Ultron e la truppa.

La profondità non viene da modelli 3D ma da **otto disegni 2D piatti messi uno dietro l'altro nello spazio** (la *multiplane camera* dei vecchi cartoni). Ogni piano resta pixel-art pura; il 3D sta solo nella distanza tra i piani.

- **Camera ferma**: i piani sono scalati per combaciare, si legge un'illustrazione 2D unica.
- **Camera che si muove** (basta il mouse): i piani scorrono a velocità diverse, il fondale quasi fermo, il primo piano veloce. La base prende volume senza perdere il tratto.

## Gli otto piani

| # | Piano | z | Cosa c'è | Si ridisegna |
|---|---|---|---|---|
| 1 | CIELO | −1100 | stelle, luna, nebbia | 4 volte al secondo (le stelle brillano) |
| 2 | DUNE | −560 | colline, antenne lontane | mai |
| 3 | PARETI DI FONDO | −170 | muri dei reparti, lesene delle sottostanze, vani ascensore. **Bucati**: l'OBLÒ, la saracinesca del MOLO e la finestra dell'ANTENNA lasciano vedere il cielo lontano | mai |
| 4 | ARREDI | −80 | una macchina per sottostanza (terminali, forgia, rastrelliera delle prove, radar, schedario, nucleo, razzo…) e i cartellini | mai |
| 5 | SCENA | 0 | Ultron, la truppa ferma al suo posto, gli ascensori, gli schermi vivi | ogni fotogramma |
| 6 | LUCI | +36 | coni delle lampade, alone della forgia e del nucleo, faro di Ultron | ogni fotogramma |
| 7 | TELAIO | +120 | solai, pilastri, strisce di pericolo, targhe dei reparti, insegna sul tetto | mai |
| 8 | QUINTE | +300 | primo piano scuro e sfocato: terreno, bidoni, cavi che pendono | mai |

Sei piani su otto sono disegnati una volta sola: il costo per fotogramma è quello di due canvas da 820×540 pixel logici.

## Come si guarda

- **Mouse**: parallasse leggera (±7°). **Trascinare**: ruota davvero (±42°), doppio clic raddrizza.
- **Clic su un reparto** (o tasti **1–6**): la camera ci entra; i piani si separano di più perché la camera è più vicina.
- **U**: segue Ultron, anche in ascensore.
- **E / ESPLODI**: i piani si allontanano e la camera gira di tre quarti; si vede la pila con il nome di ogni piano. Serve a capire com'è fatta la scena, ed è bello.
- **Pannello STRATI**: passando sopra un piano lo si evidenzia, cliccando lo si spegne.
- **ESC**: torna alla vista generale.

## Cosa resta uguale

- **I dati**: stesso stream `/api/events` (ripiego: nessuno, resta la demo). Un evento con `room` porta Ultron nel reparto; la sottostanza esce dalle **stesse regex** di `DEMO.cells` in `baracca.html`.
- **I sei reparti e le ventiquattro sottostanze**, con gli stessi nomi.
- **La truppa sta ferma** (scelta del 07/10): ognuno al posto di `STATION`, si accende e gesticola quando Ultron lavora nella sua sottostanza. Camminano solo Ultron e, quando ci saranno, cloni e sub-agenti.
- **Palette, font e HUD** (Silkscreen, Pixelify Sans, teal/arancio).

## Cosa cambia nella pianta

La pianta dall'alto aveva un anello di corridoi; in sezione i reparti stanno su **due piani** collegati da **due ascensori** (tra LABORATORIO e OFFICINA, tra OFFICINA e COLLAUDO). Sopra: LABORATORIO, OFFICINA, COLLAUDO. Sotto: RICERCA, ARCHIVIO, SPEDIZIONI. È la stessa disposizione della pianta di oggi, vista da davanti invece che dall'alto.

## Scelte tecniche

- **CSS 3D, niente librerie**: un `perspective` sul palco, un contenitore `preserve-3d` per la camera, otto `<div>` con un `<canvas>` ciascuno. Ogni piano ha `translateZ(z) scale((P − z) / P)` così a camera ferma combacia col disegno 2D.
- **Testo nel DOM dentro i piani**: targhe e cartellini sono `<div>` nei piani, quindi restano nitidi a ogni zoom e si muovono con la parallasse.
- **Niente `mix-blend-mode`**: in Chrome isola il contenitore e appiattisce tutto il 3D (provato: i piani tornano piatti e le scale si vedono sbagliate). Le luci sono semplici aloni trasparenti. `test_server.py` controlla che non torni.
- **Margine di 90 pixel logici** intorno a ogni piano, così ruotando non si vedono i bordi.

## Prossimi passi, se la direzione piace

1. Portare dentro la sala comando (pannello laterale, DASHBOARD, STORICO) come HUD sopra la scena.
2. Cloni e sub-agenti (mini-Ultron, CODER, VALUTATORE, JEV GIURIA) che entrano dal portellone e usano gli ascensori.
3. Le casse delle missioni, la sbarra del GUARDIANO, il contesto pressato in FORGIA: le animazioni di oggi, rifatte di fronte.
4. Riposo e notte: luci spente nel piano LUCI, Ultron in branda.
5. Sostituire `baracca.html` solo quando la sezione fa tutto quello che fa la pianta.
