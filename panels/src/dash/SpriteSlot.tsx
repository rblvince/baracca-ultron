import { useEffect, useRef } from 'react';

/** Mette nel DOM, una volta sola, il canvas sprite già disegnato dal motore
 *  (come facevano buildCrew/buildSkills). Il CSS di .cc/.sk canvas lo impagina. */
export function SpriteSlot({ make }: { make: () => HTMLCanvasElement }) {
  const ref = useRef<HTMLSpanElement>(null);
  const makeRef = useRef(make);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(makeRef.current());
    return () => host.replaceChildren();
  }, []);
  return <span ref={ref} style={{ display: 'contents' }} />;
}
