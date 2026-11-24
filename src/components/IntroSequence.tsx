import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ZGuardLogo } from './ZGuardLogo';

interface IntroSequenceProps {
  onComplete: () => void;
}

export function IntroSequence({ onComplete }: IntroSequenceProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 280);
    const t2 = setTimeout(() => setPhase(2), 1100);
    const t3 = setTimeout(() => setPhase(3), 2100);
    const t4 = setTimeout(() => setPhase(4), 2900);
    const t5 = setTimeout(onComplete, 3600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden"
      initial={{ opacity: 1 }}
      exit={{
        opacity: 0,
        filter: 'blur(12px)',
        scale: 1.06,
        transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
      }}
    >
      {/* Expanding radar rings */}
      <div className="absolute inset-0 flex items-center justify-center">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border border-white/20"
            initial={{ width: 40, height: 40, opacity: 0 }}
            animate={{
              width: 180 + i * 160,
              height: 180 + i * 160,
              opacity: phase >= 1 ? [0.55, 0.12, 0] : 0,
            }}
            transition={{
              duration: 2.4,
              delay: i * 0.14,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        ))}
      </div>

      {/* Scanline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/10 to-transparent animate-scanline" />

      <div className="relative flex flex-col items-center gap-7">
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="absolute inset-0 blur-2xl bg-white/20 rounded-full scale-150" />
          <ZGuardLogo size={148} draw />
        </motion.div>

        <div className="overflow-hidden">
          <motion.div
            initial={{ y: '110%' }}
            animate={{ y: phase >= 2 ? '0%' : '110%' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-4xl sm:text-6xl tracking-[-0.06em] text-white"
          >
            ZGUARD
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, letterSpacing: '0.6em' }}
          animate={{
            opacity: phase >= 2 ? 1 : 0,
            letterSpacing: phase >= 2 ? '0.28em' : '0.6em',
          }}
          className="font-mono text-[10px] sm:text-xs text-zinc-400 uppercase"
        >
          Scanner &amp; Guard Layer · RHC 4663
        </motion.div>

        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: phase >= 3 ? 180 : 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="h-px bg-gradient-to-r from-transparent via-white to-transparent"
        />

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 8 }}
          className="font-mono text-[10px] text-zinc-500"
        >
          allow · deny · abstain
        </motion.p>
      </div>

      <button
        type="button"
        onClick={onComplete}
        className="absolute bottom-8 right-8 font-mono text-[10px] tracking-[0.25em] uppercase text-zinc-500 hover:text-white transition"
      >
        Skip intro →
      </button>

      {/* Bottom progress */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10">
        <motion.div
          className="h-full bg-white"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 3.5, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
