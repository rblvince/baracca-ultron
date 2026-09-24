import type { ShelfRow } from './types';

export type Spine = { x: number; w: number; color: string };
export type ShelfLine = { y: number; text: string; color: string; spines: Spine[] };

const RH = 25;

/** Geometria dello scaffale di ARCHIVIO, identica a drawShelf del vanilla:
 *  una fila per cartella, dorsi larghi 3-5 px, al massimo 22, fermi prima
 *  dell'etichetta a destra. */
export function shelfLayout(rows: ShelfRow[], width: number): ShelfLine[] {
  return rows.map((row, i) => {
    const spines: Spine[] = [];
    let x = 4;
    for (let k = 0; k < Math.min(row.count, 22); k++) {
      const w = 3 + (k % 3);
      spines.push({ x, w, color: k % 4 === 0 ? row.color : k % 3 === 0 ? '#a37b47' : '#7a5a33' });
      x += w + 3;
      if (x > width - 90) break;
    }
    return { y: 2 + i * RH, text: `${row.label} ${row.count}`, color: row.color, spines };
  });
}

export function drawShelf(g: CanvasRenderingContext2D, lines: ShelfLine[], width: number, height: number) {
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#3a2a18'; g.fillRect(0, 0, width, height);
  for (const l of lines) {
    g.fillStyle = '#2e2114'; g.fillRect(0, l.y, width, RH - 2);
    g.fillStyle = '#7a5a33'; g.fillRect(0, l.y + RH - 5, width, 3);
    g.fillStyle = '#12100c'; g.fillRect(0, l.y + RH - 2, width, 2);
    for (const s of l.spines) {
      g.fillStyle = '#12100c'; g.fillRect(s.x, l.y + 3, s.w + 2, RH - 8);
      g.fillStyle = s.color; g.fillRect(s.x + 1, l.y + 4, s.w, RH - 10);
    }
    g.font = "8px 'Silkscreen', monospace"; g.textBaseline = 'middle';
    g.fillStyle = '#12100c'; g.fillText(l.text, width - 79, l.y + RH / 2 + 1);
    g.fillStyle = l.color; g.fillText(l.text, width - 80, l.y + RH / 2);
  }
}
