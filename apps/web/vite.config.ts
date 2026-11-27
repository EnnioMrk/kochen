import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  // One id per production build. The client bundle carries the same id, so an
  // open page can compare itself with /version.json and offer a reload.
  const buildId = command === "build" ? new Date().toISOString() : "dev";

  const versionFile: Plugin = {
    name: "rezeptor-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ id: buildId }),
      });
    },
  };

  return {
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [react(), tailwindcss(), versionFile],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:3000",
        "/healthz": "http://localhost:3000",
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
