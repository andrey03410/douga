/** @type {import('next').NextConfig} */
const nextConfig = {
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
