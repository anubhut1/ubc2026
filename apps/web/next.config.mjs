/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@agent-firewall/policy"],
  devIndicators: false,
};
export default nextConfig;
