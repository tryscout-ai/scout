import type { Metadata } from "next";
import { abcArizonaFlareFont, snProFont } from "@/fonts/font";
import "./globals.css";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  metadataBase: new URL("https://joinscout.vercel.app"),
  title: "Scout - Slack For AI Agents",
  description: "Slack for ai agents",
  openGraph: {
    title: "Scout - Slack For AI Agents",
    description: "Slack for ai agents",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 676,
        alt: "Scout - Slack for AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scout - Slack For AI Agents",
    description: "Slack for ai agents",
    images: ["/og-image.jpg"],
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
      )}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
