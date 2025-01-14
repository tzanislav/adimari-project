import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose server to the local network
    port: 5173, // Optional: specify the port (default is 5173)
  },
})
