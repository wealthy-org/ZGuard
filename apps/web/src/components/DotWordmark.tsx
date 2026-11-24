import { useEffect, useRef } from 'react';

interface Dot {
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
}

const font = (px: number) => `800 ${px}px Unbounded, Syne, sans-serif`;

/**
 * Giant wordmark drawn as a dot matrix on canvas. It fits the container
 * width exactly and crops to the real glyph bounds, so there is no dead
 * space. It assembles left-to-right on first view, dots part around the
 * cursor, and a scan beam sweeps across. It only animates while on screen.
 */
export function DotWordmark({ text = 'ZGUARD', className = '' }: { text?: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: -1e4, y: -1e4, on: false };
    let dots: Dot[] = [];
    let W = 0;
    let H = 0;
    let size = 2;
    let raf = 0;
    let buildRaf = 0;
    let visible = false;
    let revealAt = -1;
    let disposed = false;
    let ro: ResizeObserver | null = null;

    const frame = (now: number) => {
      raf = 0;
      if (disposed || W === 0) return;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';

      const R = Math.max(70, W * 0.08);
      const R2 = R * R;
      const glowR = R * 1.8;
      const cycle = 6.5;
      const beam = -0.2 * W + (((now / 1000) % cycle) / cycle) * 1.4 * W;
      const since = revealAt < 0 ? -1 : (now - revealAt) / 1000;

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const life = reduce ? 1 : since < 0 ? 0 : Math.min(Math.max((since - d.delay) / 0.5, 0), 1);
        if (life === 0) continue;

        if (!reduce) {
          let fx = (d.ox - d.x) * 0.07;
          let fy = (d.oy - d.y) * 0.07;
          if (mouse.on) {
            const dx = d.x - mouse.x;
            const dy = d.y - mouse.y;
            const dd = dx * dx + dy * dy;
            if (dd < R2 && dd > 0.01) {
              const dist = Math.sqrt(dd);
              const k = (1 - dist / R) * 2.4;
              fx += (dx / dist) * k;
              fy += (dy / dist) * k;
            }
          }
          d.vx = (d.vx + fx) * 0.8;
          d.vy = (d.vy + fy) * 0.8;
          d.x += d.vx;
          d.y += d.vy;
        }

        let a = 0.5 - (d.oy / H) * 0.34;
        if (mouse.on) {
          const gd = Math.hypot(d.ox - mouse.x, d.oy - mouse.y);
          if (gd < glowR) a += (1 - gd / glowR) * 0.55;
        }
        if (!reduce) {
          const bd = Math.abs(d.ox - beam);
          if (bd < 90) a += (1 - bd / 90) * 0.45;
        }
        ctx.globalAlpha = (a > 1 ? 1 : a) * life;
        ctx.fillRect(d.x - size / 2, d.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };

    const build = () => {
      const width = Math.floor(wrap.clientWidth);
      if (width < 40) return;
      const off = document.createElement('canvas');
      const o = off.getContext('2d', { willReadFrequently: true });
      if (!o) return;

      o.font = font(100);
      const probe = o.measureText(text);
      const probeW = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight;
      if (!probeW) return;
      const fs = (width / probeW) * 100 * 0.995;
      o.font = font(fs);
      const m = o.measureText(text);
      const left = m.actualBoundingBoxLeft;
      const glyphW = left + m.actualBoundingBoxRight;
      const asc = Math.ceil(m.actualBoundingBoxAscent);
      const height = asc + Math.ceil(m.actualBoundingBoxDescent) + 4;

      off.width = width;
      off.height = height;
      o.font = font(fs);
      o.fillStyle = '#fff';
      o.fillText(text, (width - glyphW) / 2 + left, asc + 2);
      const data = o.getImageData(0, 0, width, height).data;

      const step = width < 520 ? 4 : width < 900 ? 5 : 6;
      const scatter = revealAt < 0 && !reduce;
      const next: Dot[] = [];
      const start = Math.floor(step / 2);
      for (let y = start; y < height; y += step) {
        for (let x = start; x < width; x += step) {
          if (data[(y * width + x) * 4 + 3] > 128) {
            next.push({
              ox: x,
              oy: y,
              x: scatter ? x + (Math.random() - 0.5) * 120 : x,
              y: scatter ? y + height * (0.5 + Math.random()) : y,
              vx: 0,
              vy: 0,
              delay: (x / width) * 0.8 + Math.random() * 0.2,
            });
          }
        }
      }

      W = width;
      H = height;
      size = Math.max(1.5, step * 0.5);
      dots = next;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const scheduleBuild = () => {
      cancelAnimationFrame(buildRaf);
      buildRaf = requestAnimationFrame(build);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && revealAt < 0) revealAt = performance.now();
        if (visible && !raf) raf = requestAnimationFrame(frame);
      },
      { threshold: 0.2 }
    );
    io.observe(wrap);

    const onMove = (e: PointerEvent) => {
      if (!visible || e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      mouse.x = x;
      mouse.y = y;
      mouse.on = x > -60 && x < r.width + 60 && y > -60 && y < r.height + 60;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const fontsReady = document.fonts ? document.fonts.load(font(100)).catch(() => undefined) : Promise.resolve();
    fontsReady.then(() => {
      if (disposed) return;
      build();
      ro = new ResizeObserver(scheduleBuild);
      ro.observe(wrap);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(buildRaf);
      io.disconnect();
      ro?.disconnect();
      window.removeEventListener('pointermove', onMove);
    };
  }, [text]);

  return (
    <div ref={wrapRef} aria-hidden className={`relative w-full select-none ${className}`}>
      <canvas ref={canvasRef} className="block h-0 w-full" />
    </div>
  );
}
