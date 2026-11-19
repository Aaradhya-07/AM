import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Oxanium, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import { AuthProvider } from "./components/auth-provider";

import "./globals.css";
import "./alpha.css";

const body = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600"],
  variable: "--font-display",
});

const brand = Oxanium({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600"],
  variable: "--font-brand",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const socialImage = "/brand/logo-horizontal-on-light.png";

const description =
  "Anvilmark is a free, local-first development decision record. Connect bounded tasks, coding-agent and model choices, recorded runs, checks, human review and cost evidence. Bring your own agent.";

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Anvilmark — Good decisions. Kept on record.",
    template: "%s · ANVILMARK",
  },
  description,
  applicationName: "ANVILMARK",
  keywords: [
    "decision contract",
    "architecture decisions",
    "local-first",
    "vendor-neutral",
    "conformance",
    "evidence-backed",
    "coding agents",
  ],
  authors: [{ name: "ANVILMARK" }],
  icons: {
    icon: [
      { url: "/brand/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/brand/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "ANVILMARK",
    title: "Anvilmark — Good decisions. Kept on record.",
    description,
    ...(siteUrl
      ? {
          images: [
            {
              url: socialImage,
              alt: "Anvilmark — a local-first development decision record.",
            },
          ],
        }
      : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "Anvilmark — Good decisions. Kept on record.",
    description,
    ...(siteUrl ? { images: [socialImage] } : {}),
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f3f0e7",
};

// Runs before first paint so scroll-reveal never flashes, and so no-JS or
// reduced-motion visitors get the fully visible, unanimated page.
const revealBootstrap = `try{if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches){document.documentElement.classList.add("js-reveal")}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${brand.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: revealBootstrap }} />
      </head>
      <body className="bg-ink font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
