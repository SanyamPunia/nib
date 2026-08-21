/**
 * The name, the description and the origin, in one place.
 *
 * Metadata, the canonical link, `robots.txt` and the sitemap all read from here. Three
 * copies would be three chances to move host and forget one, and a sitemap advertising an
 * address the canonical link disagrees with is worse than no sitemap, because a crawler
 * then has to choose between them.
 */
export const site = {
  name: "nib",
  description: "Two pens on a desk. Knock the other one off.",
  origin: "https://nib.game",
} as const;
