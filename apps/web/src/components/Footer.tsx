import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowUpRight } from 'lucide-react';
import { ZGuardLogo } from './ZGuardLogo';
import { XLogo } from './XLogo';
import { DotWordmark } from './DotWordmark';
import { EASE } from './Reveal';
import { scrollToTop } from '../lib/scroll';
import { ROUTES, X_URL, type Navigate, type RouteId } from '../types';

const PRODUCT: RouteId[] = ['console', 'checks', 'architecture', 'zk'];
const PLATFORM: RouteId[] = ['registry', 'api', 'docs', 'faq'];

const ECOSYSTEM = [
  { label: 'Robinhood Chain docs', href: 'https://docs.robinhood.com/chain/connecting/' },
  { label: 'Blockscout · RHC 4663', href: 'https://robinhoodchain.blockscout.com' },
  { label: 'Paxos USDG', href: 'https://docs.paxos.com/guides/stablecoin/usdg/mainnet' },
  { label: 'pons docs', href: 'https://docs.ponsfamily.com' },
];

function Column({
  title,
  delay,
  className = '',
  children,
}: {
  title: string;
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.26em] text-zinc-500">
        <span className="h-px w-4 bg-white/30" />
        {title}
      </div>
      <div className="flex flex-col items-start gap-3">{children}</div>
    </motion.div>
  );
}

function FooterLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center text-left text-[13px] text-zinc-400 transition-colors hover:text-white"
    >
      <span className="h-px w-0 bg-white transition-all duration-300 group-hover:mr-1.5 group-hover:w-3" />
      {label}
    </button>
  );
}

export function Footer({ navigate }: { navigate: Navigate }) {
  const product = ROUTES.filter((r) => PRODUCT.includes(r.id));
  const platform = ROUTES.filter((r) => PLATFORM.includes(r.id));

  return (
    <footer className="relative z-10 overflow-hidden border-t border-white/10 bg-[#040405]">
      {/* Backdrop: top hairline, grid rising from the bottom, soft floor glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
        <div className="absolute inset-0 bg-zguard-grid [mask-image:radial-gradient(ellipse_75%_85%_at_50%_100%,black,transparent_78%)]" />
        <div
          className="absolute -bottom-[45%] left-1/2 h-[90%] w-[110%] -translate-x-1/2"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.08), transparent)' }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 pb-12 pt-16 lg:grid-cols-12 lg:gap-x-8">
          {/* Brand */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="col-span-2 lg:col-span-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-black">
                <ZGuardLogo size={30} animated />
              </div>
              <div>
                <div className="font-display text-lg leading-none text-white">ZGUARD</div>
                <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">Scanner &amp; guard layer</div>
              </div>
            </div>
            <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-zinc-400">
              One check before your agent signs on Robinhood Chain. Quote-match, simulation and token risk in a single call.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Chain 4663 · mainnet
            </div>
          </motion.div>

          <Column title="Product" delay={0.06} className="lg:col-span-2">
            {product.map((r) => (
              <FooterLink key={r.id} label={r.label} onClick={() => navigate(r.id)} />
            ))}
          </Column>

          <Column title="Platform" delay={0.12} className="lg:col-span-2">
            {platform.map((r) => (
              <FooterLink key={r.id} label={r.label} onClick={() => navigate(r.id)} />
            ))}
            <FooterLink label="Open Console" onClick={() => navigate('console')} />
          </Column>

          <Column title="Ecosystem" delay={0.18} className="col-span-2 sm:col-span-1 lg:col-span-2">
            {ECOSYSTEM.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-1 text-[13px] text-zinc-400 transition-colors hover:text-white"
              >
                {l.label}
                <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
              </a>
            ))}
          </Column>

          <Column title="Community" delay={0.24} className="col-span-2 sm:col-span-1 lg:col-span-3">
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              className="group relative block w-full overflow-hidden rounded-2xl border border-white/12 bg-white/[0.03] p-4 transition-colors duration-500 hover:border-white/40 hover:bg-white/[0.06]"
            >
              <span className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full border border-white/10 transition-transform duration-700 group-hover:scale-125" />
              <span className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full border border-white/10 transition-transform duration-700 group-hover:scale-125" />
              <span className="relative flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
                  <XLogo size={16} />
                </span>
                <ArrowUpRight className="h-4 w-4 text-zinc-500 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
              </span>
              <span className="relative mt-5 block font-display text-lg text-white">@zguard_rhc</span>
              <span className="relative mt-1 block text-[12px] leading-relaxed text-zinc-400">
                Updates, open config changes and integration news.
              </span>
            </a>
          </Column>
        </div>
      </div>

      {/* Dot-matrix wordmark, fitted to the container and cropped to the glyphs */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <DotWordmark text="ZGUARD" />
      </div>

      <div className="relative mt-8 border-t border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            © 2026 ZGuard · Not investment advice · Not Wormbook
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:inline">
              allow · deny · abstain — never “safe”
            </span>
            <button
              type="button"
              onClick={scrollToTop}
              className="group inline-flex h-8 items-center gap-2 rounded-full border border-white/15 px-3.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 transition hover:border-white/60 hover:text-white"
            >
              Back to top
              <ArrowUp className="h-3 w-3 transition-transform duration-300 group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
