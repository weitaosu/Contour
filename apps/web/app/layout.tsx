import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { GrokChat } from "@/components/GrokChat";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

const inter = Inter({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Contour — trade your whole view",
  description: "Turn a forecast into a position on Gemini prediction markets, locked on Solana.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets data-theme on <html> before React runs, so its attribute differs by design.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
          <GrokChat />
        </Providers>
      </body>
    </html>
  );
}
