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
