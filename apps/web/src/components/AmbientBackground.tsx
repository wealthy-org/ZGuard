import { useEffect, useRef } from 'react';

const GAP = 28; // dot matrix pitch, px
const SPOT_R = 210; // cursor spotlight radius, px
const PULSE_EVERY = 5200; // ms between ambient radar pulses
const PULSE_LIFE = 4.2; // s
const PULSE_SPEED = 300; // px per second
const PULSE_BAND = 42; // ring thickness, px

interface Pulse {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

/**
 * Fixed layer behind every page: a graphite glow, slowly drifting light,
 * an interactive dot matrix with a cursor spotlight, and radar pulses that
 * echo the logo's arcs. Clicking anywhere emits a pulse from the pointer.
 */
export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pulses: Pulse[] = [];
    const m = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, on: false };
    let w = 0;
    let h = 0;
    let raf = 0;
    let lastPulse = performance.now() - PULSE_EVERY + 1600;

    const draw = (now: number) => {
      m.x += (m.tx - m.x) * 0.12;
      m.y += (m.ty - m.y) * 0.12;
      const light = lightRef.current;
      if (light) {
        light.style.transform = `translate3d(${m.x - 450}px, ${m.y - 450}px, 0)`;
        light.style.opacity = m.on ? '1' : '0';
      }

      if (!reduce && now - lastPulse > PULSE_EVERY) {
        lastPulse = now;
        pulses.push({
          x: w * (0.12 + Math.random() * 0.76),
          y: h * (0.18 + Math.random() * 0.64),
          t0: now,
          strength: 0.3,
        });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        if ((now - pulses[i].t0) / 1000 > PULSE_LIFE) pulses.splice(i, 1);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      // Parallax: the matrix drifts at a fraction of the content scroll speed.
      const drift = (window.scrollY * 0.18) % GAP;
      const cx = w * 0.5;
      const cy = h * 0.3;
      const maxD = Math.hypot(w, h) * 0.62;
      const spot2 = SPOT_R * SPOT_R;

      for (let y = GAP / 2 - drift; y < h + GAP; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const dc = Math.hypot(x - cx, y - cy) / maxD;
          let a = 0.035 + 0.08 * Math.max(0, 1 - dc);
          let s = 1.2;

          if (m.on) {
            const dx = x - m.x;
            const dy = y - m.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < spot2) {
              const k = 1 - Math.sqrt(d2) / SPOT_R;
              a += k * k * 0.5;
              s += k * 1.2;
            }
          }

          for (let p = 0; p < pulses.length; p++) {
            const pu = pulses[p];
            const age = (now - pu.t0) / 1000;
            const band = Math.abs(Math.hypot(x - pu.x, y - pu.y) - age * PULSE_SPEED);
            if (band < PULSE_BAND) {
              const k = (1 - band / PULSE_BAND) * (1 - age / PULSE_LIFE);
              a += k * pu.strength;
              s += k * 0.9;
            }
          }

          if (a < 0.03) continue;
          ctx.globalAlpha = a > 0.85 ? 0.85 : a;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(performance.now());
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      m.tx = e.clientX;
      m.ty = e.clientY;
      if (!m.on) {
        m.x = m.tx;
        m.y = m.ty;
        m.on = true;
      }
    };
    const onLeave = () => {
      m.on = false;
    };
    const onDown = (e: PointerEvent) => {
      if (reduce) return;
      pulses.push({ x: e.clientX, y: e.clientY, t0: performance.now(), strength: 0.45 });
      if (pulses.length > 6) pulses.shift();
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    if (!reduce) raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, #151518 0%, #08080a 42%, #000 78%)' }}
      />
      <div className="ambient-blob ambient-blob-a" />
      <div className="ambient-blob ambient-blob-b" />
      <div className="ambient-blob ambient-blob-c" />
      <div
        ref={lightRef}
        className="absolute left-0 top-0 h-[900px] w-[900px] opacity-0 transition-opacity duration-700"
        style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.07), transparent)' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute inset-0 bg-zguard-grid opacity-70 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_25%,black,transparent)]" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 85% 75% at 50% 45%, transparent 45%, rgba(0,0,0,0.72) 100%)' }}
      />
    </div>
  );
}
