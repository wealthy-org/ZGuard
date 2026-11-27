import type { TokenSymbol } from "@/lib/tokens";
import { TOKEN_MAP } from "@/lib/tokens";

export default function TokenLogo({ symbol, size = 28, className = "" }: { symbol: TokenSymbol; size?: number; className?: string }) {
  const token = TOKEN_MAP[symbol];
  return (
    <span className={`token-logo ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      <img src={token.logo} alt="" width={size} height={size} />
    </span>
  );
}

export function TokenPair({ first, second, size = 28 }: { first: TokenSymbol; second: TokenSymbol; size?: number }) {
  return (
    <span className="token-pair" aria-hidden="true">
      <TokenLogo symbol={first} size={size} />
      <TokenLogo symbol={second} size={size} />
    </span>
  );
}
