/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev-server HMR is requested through the local preview proxy (127.0.0.1)
  // — without this the live-reload channel is blocked and the page hard-reloads in a loop.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['puppeteer-core'],
  output: 'standalone',
  // puppeteer-core is external (serverExternalPackages) and loads files by
  // computed path — nft misses them, so ship its whole dep subtree.
  outputFileTracingIncludes: {
    '*': [
      'node_modules/puppeteer-core/**/*',
      'node_modules/@puppeteer/**/*',
      'node_modules/chromium-bidi/**/*',
      'node_modules/devtools-protocol/**/*',
      'node_modules/typed-query-selector/**/*',
      'node_modules/webdriver-bidi-protocol/**/*',
      'node_modules/ws/**/*',
      'node_modules/debug/**/*',
      'node_modules/ms/**/*',
      'node_modules/zod/**/*',
      // Next itself loads dist/compiled/** and parts of dist/server/** via
      // computed paths — nft misses most of them, which left the shipped
      // standalone depending on a parent node_modules that only exists on
      // the dev machine. Trace the whole runtime subtrees.
      'node_modules/next/dist/compiled/**/*',
      'node_modules/next/dist/server/**/*',
    ],
  },
  outputFileTracingExcludes: {
    // Keep runtime state, secrets, vendor tooling and VCS noise out of the
    // traced standalone tree — this is what ships inside the customer exe.
    '*': [
      '.browser-profile/**',
      '.browser-profile/**/*',
      'data/**',
      'data/**/*',
      'scripts/**',
      'scripts/**/*',
      'dist/**',
      'dist/**/*',
      'license-server/**',
      'license-server/**/*',
      'extension/**',
      'extension/**/*',
      'src/**',
      'src/**/*',
      '.git/**',
      '.git/**/*',
      '*.log',
      '*.md',
      'test-req.json',
      '*.bat',
      'server.cjs',
      'tsconfig.tsbuildinfo',
    ],
  },
};

export default nextConfig;
