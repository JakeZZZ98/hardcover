import { defineConfig } from "vitest/config";

// `base: "./"` keeps the built demo working from any sub-path (GitHub Pages serves it under /<repo>/).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    chunkSizeWarningLimit: 800, // three.js is most of the bundle
    rollupOptions: { input: { demo: "index.html", minimal: "examples/minimal.html" } },
  },
  test: { include: ["src/**/*.test.ts"] },
});
