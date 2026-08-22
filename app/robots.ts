import type { MetadataRoute } from "next";
import { site } from "@/lib/site.ts";

/**
 * Everything, to everyone.
 *
 * There is one page and it has nothing on it that is not meant to be seen. The file exists so a
 * crawler is told that outright rather than guessing, and so the origin comes from `lib/site.ts`
 * like every other absolute URL rather than being written out again here.
 *
 * No `sitemap` field. One page needs no map, and naming a file that does not exist would send every
 * crawler to a 404.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    host: site.origin,
  };
}
