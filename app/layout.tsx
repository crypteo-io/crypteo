import type { Metadata } from "next";
import { DM_Sans, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { FeedbackProvider } from "@/components/providers/FeedbackProvider";

// The optical-size axis is what turns Inter into the template's "Inter Display" at heading sizes.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://crypteo.io"),
  title: {
    default: "Non-Custodial Crypto Payments | Crypteo",
    template: "%s | Crypteo",
  },
  description:
    "Non-custodial crypto payments that settle straight to your own wallet. Accept BTC, ETH, SOL, XRP, BNB, POL, TRX, DOGE, ZEC, ADA, USDC and USDT across 10 networks. No processor to freeze you, no exchange in the middle.",
  // Defaults for pages without their own (pageMetadata, lib/seo.ts). No
  // canonical here: inherited, it pointed every such page at the home page.
  openGraph: { type: "website", siteName: "Crypteo", locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased selection:bg-sky/15 selection:text-default-950`}
      >
        <AuthProvider>
          <FeedbackProvider>
            {children}
          </FeedbackProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
