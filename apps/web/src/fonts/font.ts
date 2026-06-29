import localFont from "next/font/local";

export const snProFont = localFont({
  src: [
    {
      path: "./SNPro-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./SNPro-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./SNPro-RegularItalic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-sn-pro",
});

export const abcArizonaFlareFont = localFont({
  src: [
    {
      path: "./ABCArizonaFlareVariable.ttf",
      style: "normal",
      weight: "400 700",
    },
  ],
  variable: "--font-abc-arizona-flare",
});
