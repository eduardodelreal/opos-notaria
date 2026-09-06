import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imagen mucho mas pequena en Railway; Netlify lo ignora sin problema.
  output: "standalone",
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/:ruta*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            // El microfono SI, y solo para el propio origen: es lo que
            // permite grabar el cante (lib/audio/). Sin `self` el navegador
            // corta getUserMedia antes de preguntar nada, con un aviso de
            // "Permissions policy violation" en consola y ningun dialogo.
            // Camara y geolocalizacion siguen cerradas: no se usan.
            value: "camera=(), geolocation=(), microphone=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
