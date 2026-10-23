/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['puppeteer-core'],
  outputFileTracingExcludes: {
    '*': ['.browser-profile/**', '.browser-profile/**/*'],
  },
};

export default nextConfig;
