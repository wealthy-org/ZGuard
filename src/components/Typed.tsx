import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

export function Typed({
  text,
  active,
  delay = 0,
  speed = 24,
}: {
  text: string;
  active: boolean;
  delay?: number;
  speed?: number;
}) {
  const [n, setN] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setStarted(true), delay);
    return () => window.clearTimeout(t);
  }, [active, delay]);

  useEffect(() => {
    if (!started || n >= text.length) return;
    const t = window.setTimeout(() => setN((v) => v + 1), speed);
    return () => window.clearTimeout(t);
  }, [started, n, text, speed]);

  const done = n >= text.length;
  return (
    <span>
      {text.slice(0, n)}
      {started && !done && <span className="animate-caret">▌</span>}
    </span>
  );
}

export type TermLine = { text: string; kind?: 'cmd' | 'out' | 'ok' };

export function TerminalBlock({ lines, className = '' }: { lines: TermLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  let acc = 0;

  return (
    <div ref={ref} className={`font-mono text-[11px] leading-7 ${className}`}>
      {lines.map((l, i) => {
        const delay = acc;
        acc += l.text.length * 24 + 220;
        const color = l.kind === 'ok' ? 'text-white' : l.kind === 'out' ? 'text-zinc-500' : 'text-zinc-300';
        return (
          <div key={i} className={color}>
            {l.kind !== 'out' && <span className="mr-2 text-zinc-600">{l.kind === 'cmd' ? '$' : '›'}</span>}
            <Typed text={l.text} active={inView} delay={delay} />
          </div>
        );
      })}
    </div>
  );
}
