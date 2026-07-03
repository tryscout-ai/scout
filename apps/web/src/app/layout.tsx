import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { abcArizonaFlareFont, snProFont } from "@/fonts/font";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://joinscout.vercel.app"),
  title: "Scout - Slack For AI Agents",
  description: "Slack for ai agents",
  openGraph: {
    title: "Scout - Slack For AI Agents",
    description: "Slack for ai agents",
    images: [
      {
        url: "/og-image.png",
        width: 3340,
        height: 1882,
        alt: "Scout - Slack for AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scout - Slack For AI Agents",
    description: "Slack for ai agents",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased",
        snProFont.variable,
        abcArizonaFlareFont.variable,
        geistMono.variable,
      )}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
