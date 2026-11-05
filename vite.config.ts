import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// A IA (Workers AI) só roda conectada à conta Cloudflare. Para testar no
// computador sem login, use: SEM_IA=1 npm run dev
const semIa = process.env.SEM_IA === "1";
// Pasta alternativa para o banco local (útil para testar do zero): ESTADO=/caminho npm run dev
const estado = process.env.ESTADO;

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: !semIa, ...(estado ? { persistState: { path: estado } } : {}) })],
});
