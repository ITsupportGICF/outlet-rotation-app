import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * - default 'self': the app may only load resources from its own origin.
 * - 'unsafe-inline' for script/style: required by Next.js's inline hydration
 *   bootstrap and by inline style attributes. A future hardening is a
 *   nonce-based CSP.
 * - img data:/blob: — used for small inline/data images and generated charts.
 * - frame-src 'self' + frame-ancestors 'self': the app may only be framed by
 *   itself (blocks clickjacking from other sites); no third-party frames.
 * - connect-src 'self': the browser only ever talks to our own API routes.
 *   All Microsoft Graph / SharePoint calls happen server-side, never from
 *   the browser, so Graph's domain never needs to appear here.
 * - object-src 'none': no plugins.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework in responses.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
