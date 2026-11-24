import { useEffect } from 'react';
import Lenis from 'lenis';
import { registerLenis } from '../lib/scroll';

export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      wheelMultiplier: 0.92,
    });
    registerLenis(lenis);

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      registerLenis(null);
      lenis.destroy();
    };
  }, []);

  return null;
}
