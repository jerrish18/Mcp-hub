import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import { handleCanvasPreviewRequest } from './src/server/canvasPreview';
import { CANVAS_PREVIEW_PATH } from './src/utils/canvasPreview';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      {
        name: 'canvas-preview',
        configurePreviewServer(server) {
          server.middlewares.use(CANVAS_PREVIEW_PATH, handleCanvasPreviewRequest);
        },
      },
      {
        name: 'offline-app-shell',
        apply: 'build',
        generateBundle(_options, bundle) {
          const assets = Object.keys(bundle).filter(name => name.startsWith('assets/')).map(name => '/' + name);
          const source = fs.readFileSync(path.resolve(__dirname, 'public/sw.js'), 'utf8');
          const version = assets.join(',');
          let hash = 0;
          for (const character of version) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
          this.emitFile({ type: 'asset', fileName: 'sw.js', source: source.replace("mcphub-shell-v1", `mcphub-shell-${hash >>> 0}`).replace("['/', '/manifest.webmanifest', '/app-icon.svg']", JSON.stringify(['/', '/manifest.webmanifest', '/app-icon.svg', ...assets])) });
        },
      },
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'motion/react',
        'lucide-react',
        'zustand',
        'zod',
      ],
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : { ignored: ['**/.data/**', '**/.playwright-cli/**'] },
    },
  };
});
