import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // Expose env variable — set VITE_WORKER_URL in .env
  },
  server: {
    port: 5173,
  },
});
