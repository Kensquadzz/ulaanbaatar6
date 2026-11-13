import type { NextConfig } from "next";

// Static export: the explorer is a fully client-side app, so it can be hosted on any static
// CDN (Vercel, Cloudflare Pages/R2). CesiumJS runtime files are copied to public/cesium.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  env: { NEXT_PUBLIC_CESIUM_BASE_URL: "/cesium" },
};

export default nextConfig;
