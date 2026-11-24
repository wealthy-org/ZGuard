import { useRef, type ReactNode } from 'react';
import { motion, useInView } from 'framer-motion';

export const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  className = '',
  y = 32,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.9, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export type LineItem = string | { text: string; muted?: boolean };

export function LineReveal({
  lines,
  className = '',
  immediate = false,
  delay = 0,
}: {
  lines: LineItem[];
  className?: string;
  immediate?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Observe the wrapper, never the masked lines: a line pushed below its
  // overflow-hidden mask is fully clipped, so IntersectionObserver would
  // report it as hidden forever and the heading would never appear.
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const show = immediate || inView;

  return (
    <div ref={ref} className={className}>
      {lines.map((l, i) => {
        const text = typeof l === 'string' ? l : l.text;
        const muted = typeof l === 'string' ? false : Boolean(l.muted);
        return (
          <span key={i} className="block overflow-hidden pb-[0.06em]">
            <motion.span
              initial={{ y: '110%' }}
              animate={{ y: show ? '0%' : '110%' }}
              transition={{ duration: 1, delay: show ? delay + i * 0.12 : 0, ease: EASE }}
              className={`block ${muted ? 'text-zinc-500' : ''}`}
            >
              {text}
            </motion.span>
          </span>
        );
      })}
    </div>
  );
}
