import type { Metadata } from "next";
import "../index.css";

export const metadata: Metadata = {
  title: "ZGuard — Scanner & Guard Layer on Robinhood Chain (4663 / Testnet 46630)",
  description:
    "Pre-signing quote-match, RHC 4663 transaction simulation, RHC token risk, and BN254 ZK quote attestations for AI agents and wallets.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "ZGuard — Scanner & Guard Layer on Robinhood Chain",
    description:
      "Pre-signing quote-match, RHC simulation, token risk, and BN254 ZK attestations for AI agents and wallets.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Syne:wght@600;700;800&family=Unbounded:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
