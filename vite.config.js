import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Bei GitHub Pages liegt die App unter /<repo-name>/
// Setze VITE_BASE in den GitHub Secrets auf z.B. "/schulnotfall/"
// Für lokales Entwickeln und für Vercel/Firebase Hosting bleibt base = "/"
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Schulnotfall',
        short_name: 'Schulnotfall',
        description: 'Notfall-Anwesenheitsliste für Schulen',
        theme_color: '#1d4ed8',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
