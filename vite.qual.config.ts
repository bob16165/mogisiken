import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 鍼灸・あん摩画面を app/qual/ に単一ファイルで出力する（本番は静的配信のためコミットして配布）
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'app/qual',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/qual/mount.tsx'),
      formats: ['iife'],
      name: 'QualificationApp',
      fileName: () => 'qualification-app.js',
    },
  },
})
