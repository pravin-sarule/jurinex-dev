import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc' // Use SWC plugin for better performance and TypeScript support
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    strictPort: false,
    hmr: { overlay: false },
  },
})
