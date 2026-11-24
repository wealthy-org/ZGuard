import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EASE, LineReveal, type LineItem } from './Reveal';

interface PageHeaderProps {
  kicker: string;
  lines: LineItem[];
  desc: string;
  aside?: ReactNode;
}

export function PageHeader({ kicker, lines, desc, aside }: PageHeaderProps) {
  return (
    <section className="relative overflow-hidden pb-20 pt-36 sm:pt-44">
      <div className="pointer-events-none absolute inset-0 bg-zguard-grid opacity-50 [mask-image:radial-gradient(ellipse_80%_70%_at_30%_20%,black,transparent)]" />
      <div className="pointer-events-none absolute -right-48 -top-48 hidden h-[640px] w-[640px] rounded-full border border-white/5 animate-spin-slow md:block" />
      <div className="pointer-events-none absolute -right-24 -top-24 hidden h-[440px] w-[440px] rounded-full border border-dashed border-white/10 animate-spin-rev md:block" />

      <div className="relative mx-auto grid max-w-7xl items-end gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
            className="mb-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500"
          >
            <span className="h-px w-10 bg-white/60" />
            {kicker}
          </motion.div>
          <h1 className="font-display text-5xl leading-[0.92] text-white sm:text-6xl lg:text-7xl">
            <LineReveal lines={lines} immediate delay={0.2} />
          </h1>
        </div>
        <div className="lg:col-span-5">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
            className="max-w-md text-sm leading-relaxed text-zinc-400 sm:text-base"
          >
            {desc}
          </motion.p>
          {aside && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-8">
              {aside}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
