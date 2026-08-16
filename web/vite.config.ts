import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 避开 5173：本机其他 Vite 项目常占用默认端口
    port: 5190,
    strictPort: true,
    // 允许从 Bot 容器内的浏览器访问开发服务器（用于在真实浏览器里核对 UI）
    allowedHosts: ['host.docker.internal', 'localhost'],
    proxy: {
      '/api': 'http://localhost:8790',
      '/ws': { target: 'ws://localhost:8790', ws: true },
    },
  },
})
