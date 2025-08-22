/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // optional, if you also have type errors (not recommended long-term)
  // typescript: { ignoreBuildErrors: true },
};
export default nextConfig; // or module.exports = nextConfig for JS
