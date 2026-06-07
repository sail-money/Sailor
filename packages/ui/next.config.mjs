/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Local-UI dashboard ships with image-rendering: pixelated and a
    // global grayscale on partner marks — bypass next/image's
    // re-encode and use the raw paths the components already pass.
    unoptimized: true,
  },
}

export default nextConfig
