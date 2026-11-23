/** @type {import('next').NextConfig} */
const nextConfig = {
  // Preserve the configured OIDC callback origin. Normalizing 127.0.0.1 to
  // localhost changes the redirect_uri between authorization and code exchange.
  skipMiddlewareUrlNormalize: true,
  // Workspace packages ship TypeScript sources (packages/*/src).
  transpilePackages: ["@douga/video", "@douga/render", "@douga/player", "@douga/node"],
  experimental: {
    // Remotion / ffmpeg-static / music-metadata are server-only and must not be bundled.
    serverComponentsExternalPackages: [
      "@remotion/bundler",
      "@remotion/renderer",
      "ffmpeg-static",
      "music-metadata",
      "esbuild",
      "fontkit",
    ],
  },
};

export default nextConfig;
