/** @type {import('next').NextConfig} */
const nextConfig = {
  // Future: add DigitalOcean Spaces image domain here when implementing uploads
  // images: { remotePatterns: [{ hostname: "*.digitaloceanspaces.com" }] },

  // Remotion's bundler pulls in @rspack/core, which ships a platform-specific
  // native binary (e.g. @rspack/binding-win32-x64-msvc/rspack.win32-x64-msvc.node).
  // Webpack cannot parse a .node binary and fails the build with
  // "Module parse failed: Unexpected character". These packages are only ever
  // used server-side (inside VideoGenerationService -> remotionService, via
  // dynamic import), so we tell Next to leave them as runtime require()s
  // instead of bundling them.
  experimental: {
    serverComponentsExternalPackages: [
      "@remotion/bundler",
      "@remotion/renderer",
      "@remotion/cli",
      "@rspack/core",
      "@rspack/binding",
      "esbuild",
    ],
  },

  // Safety net (no extra dependency required): if any native .node addon still
  // makes it into the server module graph, treat it as a runtime require()
  // instead of letting webpack try to parse the binary.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(({ request }, callback) => {
        if (request && request.endsWith(".node")) {
          return callback(null, "commonjs " + request);
        }
        callback();
      });
    }
    return config;
  },
};

module.exports = nextConfig;
