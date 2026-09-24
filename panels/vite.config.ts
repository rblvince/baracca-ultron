import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Isola React della Baracca: un solo panels.js (IIFE) che espone
// window.mountDashboard. React entra nel bundle, supabase-js no (solo tipi).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // in library mode Vite non sostituisce process.env.NODE_ENV da solo;
  // solo in build, altrimenti i test girerebbero sul React di produzione
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: { entry: 'src/mount.tsx', name: 'BaraccaPanels', formats: ['iife'], fileName: () => 'panels.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
}));
