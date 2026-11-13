import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Pasta alternativa para o banco local (útil para testar do zero): ESTADO=/caminho npm run dev
const estado = process.env.ESTADO;

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: false, ...(estado ? { persistState: { path: estado } } : {}) })],
});
