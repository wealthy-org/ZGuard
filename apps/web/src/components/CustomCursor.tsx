import { useEffect, useRef } from 'react';

export function CustomCursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (!fine) return;

    document.body.classList.add('cursor-hidden');

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let hovering = false;
    let down = false;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      const target = e.target as HTMLElement | null;
      hovering = !!target?.closest(
        'a, button, input, textarea, select, [data-cursor="hover"]'
      );
    };
    const onDown = () => {
      down = true;
    };
    const onUp = () => {
      down = false;
    };

    const tick = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      const ring = ringRef.current;
      const dot = dotRef.current;
      if (ring) {
        const s = hovering ? 1.85 : down ? 0.72 : 1;
        ring.style.transform = `translate3d(${rx - 18}px, ${ry - 18}px, 0) scale(${s})`;
        ring.style.borderColor = hovering
          ? 'rgba(255,255,255,0.95)'
          : 'rgba(255,255,255,0.55)';
        ring.style.background = hovering ? 'rgba(255,255,255,0.08)' : 'transparent';
      }
      if (dot) {
        dot.style.transform = `translate3d(${mx - 3}px, ${my - 3}px, 0) scale(${down ? 0.4 : 1})`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    raf = requestAnimationFrame(tick);

    return () => {
      document.body.classList.remove('cursor-hidden');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        className="pointer-events-none fixed top-0 left-0 z-[90] hidden md:block w-9 h-9 rounded-full border border-white/60 mix-blend-difference"
        style={{ willChange: 'transform' }}
      />
      <div
        ref={dotRef}
        className="pointer-events-none fixed top-0 left-0 z-[91] hidden md:block w-1.5 h-1.5 rounded-full bg-white mix-blend-difference"
        style={{ willChange: 'transform' }}
      />
    </>
  );
}
