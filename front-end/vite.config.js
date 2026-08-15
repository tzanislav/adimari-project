import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose server to the local network
    port: 5173, // Optional: specify the port (default is 5173)
    proxy: {
      // Keeps the future NAS explorer on the Adimari origin during development.
      // The proxy removes this public prefix before forwarding to File Sync.
      '/file-sync-api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/file-sync-api/, ''),
      },
    },
  },
})
