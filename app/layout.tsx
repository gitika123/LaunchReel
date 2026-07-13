import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope, Newsreader } from "next/font/google";
import "./globals.css";

const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
const display = Newsreader({ subsets: ["latin"], variable: "--font-display" });
const utility = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-utility" });

export const metadata: Metadata = {
  title: {
    default: "LaunchReel — Your AI creative company",
    template: "%s · LaunchReel",
  },
  description: "Turn a SaaS website into a research-backed, human-approved vertical Campaign through a visible team of AI creative Agents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${body.variable} ${display.variable} ${utility.variable}`}>{children}</body>
    </html>
  );
}
