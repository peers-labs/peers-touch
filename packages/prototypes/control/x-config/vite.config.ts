import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: "/tmp/peers-x-config-preview-dist", emptyOutDir: true },
});
