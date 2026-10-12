import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Built as a static SPA (end-to-end encryption happens entirely in the
// browser), then served by the Go backend from a single origin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // /pay is the bare checkout page the Go server renders when billing is on.
    // changeOrigin stays off: the server rejects a POST whose Origin differs from its Host,
    // and the browser's Origin is this dev server's.
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: false },
      "/pay": { target: "http://localhost:8080", changeOrigin: false },
    },
  },
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
})
