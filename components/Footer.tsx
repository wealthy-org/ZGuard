import Link from "next/link";
import { IS_MAINNET } from "@/lib/web3/network";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <Link className="wordmark" href="/" aria-label="Perm home">
          <img src="/perm-mark.png" alt="" />
          <span>PERM</span>
        </Link>
        <p>Compare supported routes. See every fee. Keep more of your swap.</p>
        {IS_MAINNET
          ? <div className="footer-status"><i /> Live on Robinhood Chain · <Link href="/proofs">settlement receipts</Link></div>
          : <div className="footer-status"><i /> Contracts tested · <Link href="/setup">owner-signed testnet setup</Link></div>}
      </div>

      <div className="footer-links">
        <div>
          <h4>PRODUCT</h4>
          <Link href="/trade">Trade</Link>
          <Link href="/routes">Route explorer</Link>
          <Link href="/rebate">Fee rebate</Link>
          <Link href="/proofs">Proof receipts</Link>
        </div>
        <div>
          <h4>BUILD</h4>
          <Link href="/docs">Docs</Link>
          {!IS_MAINNET && <Link href="/setup">Testnet setup</Link>}
          <a href="https://github.com/wealthy-org/Perm" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          <a href="https://developers.uniswap.org/docs/protocols/v4/concepts/hooks" target="_blank" rel="noopener noreferrer">Uniswap v4 hooks ↗</a>
        </div>
        <div>
          <h4>COMMUNITY</h4>
          <a className="footer-social" href="https://x.com/usepermonx" target="_blank" rel="noopener noreferrer" aria-label="Perm on X"><svg className="x-mark" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M18.25 2.25h3.37l-7.36 8.42 8.66 11.08h-6.79l-5.32-6.84-5.99 6.84H1.44l7.8-8.91L.92 2.25h6.96l4.8 6.16 5.57-6.16Zm-1.18 17.55h1.87L6.86 4.1H4.85L17.07 19.8Z" /></svg><span>@usepermonx ↗</span></a>
          <span>© 2026 Perm</span>
        </div>
      </div>
    </footer>
  );
}
