import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";

import { site } from "@/lib/site";

import "./globals.css";

const funnelSans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const funnelDisplay = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: site.name, title: site.title, description: site.description },
  twitter: { card: "summary_large_image", title: site.title, description: site.description },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: [{ color: "#efeaf8" }, { media: "(prefers-color-scheme: dark)", color: "#efeaf8" }] };

// The page is light unless the visitor chose dark before. Set before anything is drawn, so there's no flash.
const THEME = `try{var t=localStorage.getItem("dwm-clip-theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className={`${funnelSans.variable} ${funnelDisplay.variable} min-h-dvh overflow-x-clip`} suppressHydrationWarning>{children}</body>
    </html>
  );
}
