/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@jml-ops/shared"],
  output: "standalone", // required for the production Dockerfile's slim runtime stage
};

module.exports = nextConfig;
