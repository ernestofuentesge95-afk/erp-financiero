import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El backend (Fastify, puerto 3000) no tiene CORS habilitado — en vez de
// tocarlo, el dev server de Vite hace de proxy de /api hacia él.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
