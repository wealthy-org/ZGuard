import type { Metadata, Viewport } from "next";
import "./globals.css";
import Web3Provider from "@/components/Web3Provider";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://useperm.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Perm — Compare routes. See every fee.",
    template: "%s · Perm",
  },
  description:
    "Multi-venue swap routing with a transparent Perm fee rebate and verifiable settlement receipts.",
  openGraph: {
    title: "Perm — Compare routes. See every fee.",
    description:
      "Compare supported routes, see the fee breakdown, and keep more of your swap through a transparent Perm fee rebate.",
    siteName: "Perm",
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Perm swap router" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@usepermonx",
    images: ["/og.jpg"],
  },
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#edf4f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Perm",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: siteUrl,
    description:
      "A swap routing interface with signed multi-venue route candidates, transparent fee rebate accounting, and settlement receipts.",
  };

  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
