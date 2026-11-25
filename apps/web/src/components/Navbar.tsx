import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { ZGuardLogo } from './ZGuardLogo';
import { XLogo } from './XLogo';
import { NAV_ROUTES, ROUTES, X_URL, type Navigate, type RouteId } from '../types';
import { fetchRuntimeConfig } from '../lib/zguard-api';
import { WalletPill } from './WalletButton';

interface NavbarProps {
  route: RouteId;
  navigate: Navigate;
}

export function Navbar({ route, navigate }: NavbarProps) {
  const [open, setOpen] = useState(false);
  // Chain badge reflects the API's real active chain; "API OFFLINE" when /v1/config is unreachable (C3).
  const [chainBadge, setChainBadge] = useState<{ chainId: number; isTestnet: boolean } | null>(null);
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    fetchRuntimeConfig()
      .then((cfg) => {
        if (cfg && cfg.chainId) {
          setChainBadge({ chainId: cfg.chainId, isTestnet: cfg.isTestnet });
          setApiState('online');
        } else {
          setApiState('offline');
        }
      })
      .catch(() => setApiState('offline'));
  }, []);

  const go = (id: RouteId) => {
    setOpen(false);
    navigate(id);
  };

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-40"
    >
      <div className="mx-auto max-w-7xl px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-4 lg:px-8">
        <div className="flex items-center justify-between gap-3 rounded-full border border-white/12 bg-black/60 py-2 pl-2 pr-2 shadow-[0_12px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              go('home');
            }}
            className="group flex min-w-0 items-center gap-2.5 pl-1"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black transition group-hover:border-white/70">
              <ZGuardLogo size={26} animated />
            </div>
            <div className="min-w-0 leading-none">
              <div className="font-display text-[13px] text-white">ZGUARD</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    apiState === 'offline'
                      ? 'bg-rose-400'
                      : apiState === 'checking'
                        ? 'bg-zinc-500'
                        : chainBadge?.isTestnet
                          ? 'bg-emerald-400'
                          : 'bg-sky-400'
                  }`}
                />
                <span className="truncate" data-testid="chain-badge">
                  {apiState === 'offline'
                    ? 'API OFFLINE'
                    : chainBadge
                      ? `RHC · ${chainBadge.chainId} ${chainBadge.isTestnet ? 'TESTNET' : 'MAINNET'}`
                      : 'RHC · …'}
                </span>
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-0.5 xl:flex">
            {NAV_ROUTES.map((r) => {
              const active = r.id === route;
              return (
                <a
                  key={r.id}
                  href={`#${r.path}`}
                  title={r.hint}
                  onClick={(e) => {
                    e.preventDefault();
                    go(r.id);
                  }}
                  className={`relative rounded-full px-3 py-1.5 font-mono text-[11px] tracking-wide transition-colors ${
                    active ? 'text-black' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full bg-white"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{r.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <WalletPill />
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="ZGuard on X"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition hover:rotate-12 hover:border-white/60 hover:text-white"
            >
              <XLogo size={14} />
            </a>
            <a
              href="#/docs"
              onClick={(e) => {
                e.preventDefault();
                go('docs');
              }}
              className={`hidden items-center gap-1.5 rounded-full border px-4 py-2 font-mono text-[11px] transition sm:inline-flex ${
                route === 'docs'
                  ? 'border-white bg-white text-black font-bold'
                  : 'border-white/20 text-zinc-300 hover:border-white/60 hover:text-white'
              }`}
            >
              Docs
            </a>
            <button
              type="button"
              onClick={() => go('console')}
              className="hidden items-center gap-1.5 rounded-full bg-white px-4 py-2 font-mono text-[11px] font-bold text-black transition hover:bg-zinc-200 sm:inline-flex"
            >
              Open Console
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white xl:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {apiState === 'offline' && (
        <div className="mx-auto mt-2 max-w-7xl px-3 sm:px-6 lg:px-8" data-testid="api-offline-banner">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-950/70 px-4 py-2 font-mono text-[10px] leading-relaxed text-rose-100 backdrop-blur-xl sm:text-[11px]">
            Live API unreachable or not configured (web needs ZGUARD_INTERNAL_API_URL). Console results are example
            fixtures, not live verdicts.
          </div>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            data-lenis-prevent
            className="mx-3 mt-2 max-h-[calc(100dvh-5.5rem)] space-y-1 overflow-y-auto overscroll-contain rounded-3xl border border-white/12 bg-black/90 p-3 backdrop-blur-xl sm:mx-6 lg:mx-8 xl:hidden"
          >
            {ROUTES.filter((r) => r.id !== 'home').map((r, i) => (
              <motion.a
                key={r.id}
                href={`#${r.path}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={(e) => {
                  e.preventDefault();
                  go(r.id);
                }}
                className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 font-mono text-xs ${
                  r.id === route ? 'bg-white text-black' : 'text-zinc-300 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span className="shrink-0">{r.label}</span>
                <span className="min-w-0 truncate text-right text-[10px] opacity-60">{r.hint}</span>
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
