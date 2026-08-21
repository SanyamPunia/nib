import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Out of the way of the settings, which run along the bottom of the window. Development only,
   * so this is courtesy rather than layout.
   */
  devIndicators: {
    position: "top-left",
  },
};

export default nextConfig;
