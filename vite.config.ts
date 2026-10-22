import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-national-exam-date',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'app/national-exam-date.json'),
          resolve(__dirname, 'dist/app/national-exam-date.json'),
        )
        copyFileSync(
          resolve(__dirname, 'app/national-exam-date-qual.json'),
          resolve(__dirname, 'dist/app/national-exam-date-qual.json'),
        )
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
        qualificationPrototype: resolve(__dirname, 'qualification-prototype.html'),
      },
    },
  },
})
