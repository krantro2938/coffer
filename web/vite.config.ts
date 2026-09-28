import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Built as a static SPA (end-to-end encryption happens entirely in the
// browser), then served by the Go backend from a single origin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
})
