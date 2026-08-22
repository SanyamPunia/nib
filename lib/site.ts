/**
 * The name, the description and the origin, in one place.
 *
 * The origin is read by `metadataBase`, which is what turns the canonical link and the card image
 * into absolute URLs, and by `og:url`. One copy, because an origin written twice is two chances to
 * move host and update one of them, and a card image pointing at the wrong host is a card that never
 * renders. Anything added later that needs the origin, a sitemap or a robots file among them, reads
 * it from here rather than restating it.
 *
 * `nib.game` was the origin for a while and was never bought, which meant every absolute URL in the
 * page pointed at a host that does not resolve. Nothing in the app failed and nothing in the build
 * complained: the canonical asked crawlers to index an address that 404s, and the card could not be
 * fetched at all.
 */
export const site = {
  name: "nib",
  description: "two pens on a desk. knock the other one off.",
  origin: "https://nib.sanyam.sh",
} as const;
