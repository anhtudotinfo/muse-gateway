/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev-server HMR is requested through the local preview proxy (127.0.0.1)
  // — without this the live-reload channel is blocked and the page hard-reloads in a loop.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['puppeteer-core'],
  outputFileTracingExcludes: {
    '*': ['.browser-profile/**', '.browser-profile/**/*'],
  },
};

export default nextConfig;
