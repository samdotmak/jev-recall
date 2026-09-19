import type { Metadata } from "next";
import { Geist_Mono, Onest } from "next/font/google";
import "./globals.css";

const onest = Onest({ variable: "--font-onest", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jev Recall · See what each method finds",
  description:
    "An AI assistant knows 238 things about your life. Watch semantic search, Claude Sonnet 5 and Jev Recall pick which ones matter.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${onest.variable} ${geistMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
