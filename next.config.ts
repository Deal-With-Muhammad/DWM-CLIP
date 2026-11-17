import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const DWM = "https://www.dealwithmuhammad.com";
const PADDLE = "https://*.paddle.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${DWM} https://static.cloudflareinsights.com ${PADDLE}`,
  `style-src 'self' 'unsafe-inline' ${PADDLE}`,
  `img-src 'self' data: blob: ${DWM} https://i.ytimg.com ${PADDLE}`,
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${DWM} https://cloudflareinsights.com ${PADDLE}`,
  // Paddle's checkout opens in a frame over the Settings page.
  `frame-src ${PADDLE}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: csp }] : []),
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

// Gives `next dev` local copies of the database and clip bucket (.wrangler/).
initOpenNextCloudflareForDev();
