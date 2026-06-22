/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8071/api/:path*",
      },
    ];
  },
};

export default nextConfig;
