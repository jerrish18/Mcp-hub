import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createAuthRouter } from './src/server/authRouter.ts';
import { createControlRouter } from './src/server/controlRouter.ts';
import { createStudyImagesRouter } from './src/server/studyImagesRouter.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const distDir = path.resolve(__dirname, 'dist');
const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));
const isRunningUnderTsx = process.execArgv.some((arg) => arg.includes('tsx'));
const isProduction =
  process.env.NODE_ENV === 'production' ||
  (hasBuiltDist && !isRunningUnderTsx && process.env.npm_lifecycle_event !== 'dev');

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  const controlRouter = createControlRouter();
  const authRouter = createAuthRouter();
  const studyImagesRouter = createStudyImagesRouter();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mcp-hub' });
  });

  // Mount app authentication, study image search, & control REST / key management under /api/*
  app.use('/api', authRouter);
  app.use('/api', studyImagesRouter);
  app.use('/api', controlRouter);

  // Also mount root /mcp so external MCP agents (Claude Desktop, Cursor, etc.) can connect directly to https://<host>/mcp
  app.post('/mcp', (req, res, next) => {
    req.url = '/mcp-endpoint';
    controlRouter(req, res, next);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true as const },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP Hub listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
