import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Jev Recall · Catches the memories semantic search misses",
  description:
    "An AI assistant knows 238 things about your life. Watch semantic search, Claude Sonnet 5 and Jev Recall pick which ones matter.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
