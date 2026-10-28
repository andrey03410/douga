/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Remotion / ffmpeg-static / music-metadata are server-only and must not be bundled.
    serverComponentsExternalPackages: [
      "@remotion/bundler",
      "@remotion/renderer",
      "ffmpeg-static",
      "music-metadata",
      "esbuild",
    ],
  },
};

export default nextConfig;
