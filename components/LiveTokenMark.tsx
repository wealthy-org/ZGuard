import type { LiveToken, LiveTokenSymbol } from "@/lib/web3/tokens";

type TokenMark = {
  logo: string;
  background: string;
  scale: number;
};

const TOKEN_MARKS: Record<LiveTokenSymbol, TokenMark> = {
  ETH: { logo: "/tokens/eth.png", background: "#f1f3f7", scale: 1 },
  NVDA: { logo: "/tokens/nvda.svg", background: "#f5f9ec", scale: 0.74 },
  AAPL: { logo: "/tokens/aapl.svg", background: "#f3f4f4", scale: 0.58 },
  SPCX: { logo: "/tokens/spcx.svg", background: "#f1f4f6", scale: 0.76 },
  OPENAI: { logo: "/tokens/openai.svg", background: "#f2f3f1", scale: 0.66 },
  ANTHROPIC: { logo: "/tokens/anthropic.svg", background: "#f3ece6", scale: 0.64 },
  TSLA: { logo: "/tokens/tsla.svg", background: "#fff1f1", scale: 0.66 },
  AMZN: { logo: "/tokens/amzn.svg", background: "#fff7e8", scale: 0.68 },
  PLTR: { logo: "/tokens/pltr.svg", background: "#f2f2f2", scale: 0.66 },
  NFLX: { logo: "/tokens/nflx.svg", background: "#fff0f1", scale: 0.64 },
  AMD: { logo: "/tokens/amd.svg", background: "#fff1f1", scale: 0.68 },
  // Neutral lettermarks (not issuer logos) for the additional mainnet Stock Tokens.
  GOOGL: { logo: "/tokens/googl.svg", background: "#eef3fe", scale: 1 },
  META: { logo: "/tokens/meta.svg", background: "#edf3ff", scale: 1 },
  SPY: { logo: "/tokens/spy.svg", background: "#f8eef1", scale: 1 },
  QQQ: { logo: "/tokens/qqq.svg", background: "#eef4fa", scale: 1 },
  COIN: { logo: "/tokens/coin.svg", background: "#edf2ff", scale: 1 },
  MSFT: { logo: "/tokens/msft.svg", background: "#f1f1f1", scale: 1 },
  WETH: { logo: "/tokens/weth.png", background: "#f1f3f7", scale: 1 },
  USDG: { logo: "/tokens/usdg.svg", background: "#eaf5f0", scale: 1 },
};

export default function LiveTokenMark({ token, size }: { token: LiveToken; size: number }) {
  const mark = TOKEN_MARKS[token.symbol];
  const badgeSize = Math.max(7, Math.round(size * 0.38));
  const badgeOffset = -Math.max(1, Math.round(size * 0.045));

  return (
    <span
      className={`live-token-mark live-token-mark--${token.symbol.toLowerCase()}`}
      style={{ width: size, height: size, background: mark.background }}
      aria-hidden="true"
    >
      <img
        className="live-token-mark__logo"
        src={mark.logo}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ width: `${mark.scale * 100}%`, height: `${mark.scale * 100}%` }}
      />
      <span
        className="live-token-mark__network"
        style={{ width: badgeSize, height: badgeSize, right: badgeOffset, bottom: badgeOffset }}
      >
        <img src="/tokens/robinhood.svg" alt="" draggable={false} />
      </span>
    </span>
  );
}
