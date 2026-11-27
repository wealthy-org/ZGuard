import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE } from '../components/Reveal';
import { XLogo } from '../components/XLogo';
import { X_URL } from '../types';

const FAQ = [
  {
    q: 'What is ZGuard?',
    a: 'A scanner and guard layer for agents and terminals that transact on Robinhood Chain (4663). Before an agent signs a payment or swap, and before it trusts token metadata, ZGuard answers three questions in one API call: is this the quoted payment, what happens onchain if it runs, and what state is the token in.',
  },
  {
    q: 'How is it different from Blockaid, Webacy or GoPlus?',
    a: 'Classic simulators answer “what will this transaction do”. ZGuard adds “is this the payment that was quoted”, and combines both with token risk for Robinhood Chain assets: USDG, WETH, Stock Tokens from the official registry, pons curves V1 and V2, and graduated Uniswap v4 pools with the pons meme hook. Most competitors do not document RHC 4663 support.',
  },
  {
    q: 'Does an allow mean the token is safe?',
    a: 'No. ZGuard never says “safe”. Verdicts are allow, deny and abstain. Text findings are clean_by_rules or findings. Token risk reports onchain facts and configured rules, not an investment judgment.',
  },
  {
    q: 'Which chains are supported?',
    a: 'Robinhood Chain mainnet (4663) first. USDG is the required x402 payment asset on 4663; USDC on Base and Solana is optional. Testnet 46630 is for testing only. Other chains come only after RHC is stable.',
  },
  {
    q: 'What happens if the API or the RPC goes down?',
    a: 'Fail-closed. An RPC timeout, a node without trace support or an unreadable policy store all produce abstain, and abstain is not permission. The signer wrapper refuses to sign. Overriding abstain requires an explicit operator config, recorded in the receipt.',
  },
  {
    q: 'Do I need to hold $ZGUARD to use it?',
    a: 'No. Local quote-match is free, offline, key-less and does not phone home. Hosted API calls are paid per call in USDG on RHC through x402, with no subscription and no minimum. The proposed model sends net API revenue to buyback and burn after the pons launch [ASSUMPTION].',
  },
  {
    q: 'Does ZGuard see my keys or my intent?',
    a: 'No keys ever leave your machine. Quote-match runs locally. The hosted API receives only the quote, the transaction payload and the token addresses or metadata that are being checked. Swap intents are built by router code, not by the model.',
  },
  {
    q: 'What does the zk layer prove?',
    a: 'Only quote-match. The design is Groth16 via SP1: a Rust rule engine runs in a zkVM and the proof is checked by ZGuardQuoteVerifier on testnet 46630. Today the SP1 guest is a scaffold and no prover or verifier is deployed, so attestations stay pending. A Halo2-KZG circuit with a generated Solidity verifier is tested in CI for the eip3009 rail but is not deployed either. Public outputs are commitments: quoteHash, txHash, verdict and ruleCodes. Simulation and token risk are never proven, and proofs arrive asynchronously.',
  },
  {
    q: 'Is Wormbook part of ZGuard?',
    a: 'No. ZGuard is not a launchpad, a social network, a trading venue, or a burrow or callout product. It is only the scanner and guard layer: quote-match, simulation, token risk, signer wrapper, MCP and hosted API.',
  },
];

export function FaqPage() {
  const [open, setOpen] = useState<number>(0);

  return (
    <div className="relative">
      <PageHeader
        kicker="FAQ"
        lines={['Questions,', { text: 'answered plainly.', muted: true }]}
        desc="Answers follow the implementation brief. Anything not yet locked is marked [ASSUMPTION] or [VERIFY] so you can see what is decided and what is still open."
      />

      <section className="relative pb-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-32">
              <div className="rounded-3xl border border-white/10 bg-[#070708] p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Still have a question?</div>
                <p className="mt-3 text-sm text-zinc-400">Follow the project on X for updates and open config changes.</p>
                <a
                  href={X_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-3 rounded-2xl bg-white px-5 py-3 font-mono text-xs font-bold text-black transition hover:gap-4"
                >
                  <XLogo size={13} /> @zguard_rhc
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            {FAQ.map((item, i) => {
              const isOpen = open === i;
              return (
                <motion.div
                  key={item.q}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: (i % 4) * 0.05, duration: 0.5, ease: EASE }}
                  className="border-b border-white/10 first:border-t"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    className="group flex w-full items-center justify-between gap-6 py-6 text-left"
                  >
                    <span className="flex items-baseline gap-4">
                      <span className="font-mono text-[10px] text-zinc-600">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`font-display text-lg transition-colors sm:text-xl ${isOpen ? 'text-white' : 'text-zinc-300 group-hover:text-white'}`}>{item.q}</span>
                    </span>
                    <motion.span
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${isOpen ? 'border-white bg-white text-black' : 'border-white/20 text-zinc-400'}`}
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-2xl pb-7 pl-10 text-[14px] leading-relaxed text-zinc-400">{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
