"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CustomCursor } from './components/CustomCursor';
import { SmoothScroll } from './components/SmoothScroll';
import { ScrollProgress } from './components/ScrollProgress';
import { AmbientBackground } from './components/AmbientBackground';
import { jumpToTop } from './lib/scroll';
import { IntroSequence } from './components/IntroSequence';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { ZGuardLogo } from './components/ZGuardLogo';
import { HomePage } from './views/HomePage';
import { ConsolePage } from './views/ConsolePage';
import { ChecksPage } from './views/ChecksPage';
import { ArchitecturePage } from './views/ArchitecturePage';
import { ZkPage } from './views/ZkPage';
import { RegistryPage } from './views/RegistryPage';
import { ApiPage } from './views/ApiPage';
import { DocsPage } from './views/DocsPage';
import { FaqPage } from './views/FaqPage';
import { ROUTES, routeFromHash, type Navigate, type RouteId } from './types';

const EASE_IO = [0.76, 0, 0.24, 1] as const;

function renderPage(route: RouteId, navigate: Navigate) {
  switch (route) {
    case 'console':
      return <ConsolePage />;
    case 'checks':
      return <ChecksPage navigate={navigate} />;
    case 'architecture':
      return <ArchitecturePage />;
    case 'zk':
      return <ZkPage />;
    case 'registry':
      return <RegistryPage />;
    case 'api':
      return <ApiPage navigate={navigate} />;
    case 'docs':
      return <DocsPage />;
    case 'faq':
      return <FaqPage />;
    default:
      return <HomePage navigate={navigate} />;
  }
}

/** Six-column curtain that covers the page during route changes. */
function Curtain({ covered, label }: { covered: boolean; label: string }) {
  return (
    <div className={`fixed inset-0 z-[70] flex ${covered ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {Array.from({ length: 6 }, (_, i) => (
        <motion.div
          key={i}
          className="h-full flex-1 bg-black"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: covered ? 1 : 0 }}
          style={{ transformOrigin: covered ? 'bottom' : 'top' }}
          transition={{ duration: 0.55, ease: EASE_IO, delay: covered ? i * 0.06 : (5 - i) * 0.06 }}
        />
      ))}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center gap-5"
        animate={{ opacity: covered ? 1 : 0 }}
        transition={{ duration: 0.25, delay: covered ? 0.3 : 0 }}
      >
        <ZGuardLogo size={76} draw={covered} />
        <span className="font-mono text-[11px] uppercase tracking-[0.35em] text-zinc-400">{label}</span>
      </motion.div>
    </div>
  );
}

export function App() {
  const [intro, setIntro] = useState(true);
  const [route, setRoute] = useState<RouteId>('home');
  const [incoming, setIncoming] = useState<RouteId>('home');
  const [covered, setCovered] = useState(false);
  const routeRef = useRef<RouteId>('home');
  const busy = useRef(false);

  const finishIntro = useCallback(() => setIntro(false), []);

  useEffect(() => {
    const initial = routeFromHash(window.location.hash);
    routeRef.current = initial;
    setRoute(initial);
    setIncoming(initial);
  }, []);

  const navigate = useCallback<Navigate>((next) => {
    if (next === routeRef.current || busy.current) return;
    busy.current = true;
    setIncoming(next);
    setCovered(true);
    window.setTimeout(() => {
      routeRef.current = next;
      setRoute(next);
      const path = ROUTES.find((r) => r.id === next)?.path ?? '/';
      window.history.pushState(null, '', path === '/' ? window.location.pathname : `#${path}`);
      jumpToTop();
      window.setTimeout(() => {
        setCovered(false);
        busy.current = false;
      }, 300);
    }, 620);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = routeFromHash(window.location.hash);
      if (next !== routeRef.current) navigate(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);

  const label = `Loading ${ROUTES.find((r) => r.id === incoming)?.path ?? '/'}`;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-black text-white antialiased">
      <SmoothScroll />
      <CustomCursor />
      {!intro && <ScrollProgress />}
      <div className="noise-overlay" />
      <AmbientBackground />

      <AnimatePresence>{intro && <IntroSequence onComplete={finishIntro} />}</AnimatePresence>

      {!intro && (
        <>
          <Navbar route={route} navigate={navigate} />
          <AnimatePresence mode="wait">
            <motion.main
              key={route}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18, transition: { duration: 0.25 } }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10"
            >
              {renderPage(route, navigate)}
            </motion.main>
          </AnimatePresence>
          <Footer navigate={navigate} />
        </>
      )}

      <Curtain covered={covered} label={label} />
    </div>
  );
}

export default App;
