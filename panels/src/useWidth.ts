import { useEffect, useState } from 'react';

/** Larghezza vera (px) dell'elemento, per disegnare un SVG 1:1 invece di
 *  stirare un viewBox fisso (che scalerebbe anche il testo). Ref a callback:
 *  l'elemento può comparire dopo il primo render (pannello in caricamento).
 *  Senza ResizeObserver (jsdom nei test) resta sul valore di ripiego. */
export function useWidth<T extends Element>(fallback: number) {
  const [el, ref] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, width] as const;
}
