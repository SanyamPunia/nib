import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { site } from "@/lib/site.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: site.name,
  description: site.description,
  metadataBase: new URL(site.origin),
  alternates: { canonical: "/" },
  openGraph: {
    title: site.name,
    description: site.description,
    url: site.origin,
    type: "website",
  },
  /*
   * The card image itself is `app/opengraph-image.png`, which Next finds by name and turns into
   * `og:image` plus its type and dimensions. Nothing here names it, so nothing here can go stale
   * against it.
   *
   * There is no `twitter-image.png` beside it. X falls back to `og:image` when no Twitter image is
   * given, so a second copy of the same 270KB would buy nothing. The card type does have to be said
   * out loud: the default is `summary`, which crops a 1200 by 630 image into a small square.
   */
  twitter: { card: "summary_large_image" },
};

/*
 * Zoom is left alone deliberately. The canvas sets `touch-action: none`, so a drag on the desk
 * never turns into a pinch, and disabling zoom for the whole page to protect one element takes
 * something away from anyone who needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
