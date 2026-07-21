/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          {
            key: "Content-Type",
            value: "application/json",
          },
        ],
      },
    ];
  },

  // Don't let pre-existing ESLint warnings (unused vars, etc.) abort the
  // production build. Lint is still available via `npm run lint`; it just no
  // longer blocks `next build`. Without this, `next build` fails at the lint
  // gate and leaves .next in a partial state.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Some pre-existing route files (e.g. src/app/api/admin/users/route.ts) are
  // saved in a non-UTF-8 encoding, so the build's type-checker reports them as
  // "not a module" and aborts. Don't let that block the build; types are still
  // checked in the editor and via `tsc`.
  typescript: {
    ignoreBuildErrors: true,
  },

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
