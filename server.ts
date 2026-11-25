import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createAuthService } from './src/server/authRouter.ts';
import { handleCanvasPreviewRequest } from './src/server/canvasPreview.ts';
import { createControlRouter } from './src/server/controlRouter.ts';
import { createStudyImagesRouter } from './src/server/studyImagesRouter.ts';
import { createWorkspaceRouter } from './src/server/workspaceRouter.ts';

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

  // Dedicated isolated preview loader for Pro Canvas (must bypass parent helmet CSP & SPA fallback)
  app.get('/__canvas-preview', handleCanvasPreviewRequest);

  app.use(
    helmet({
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: isProduction
            ? ["'self'", 'https://apis.google.com']
            : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://apis.google.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: [
            "'self'",
            'https:',
            'wss:',
            ...(!isProduction ? ['ws:', 'http://localhost:*', 'http://127.0.0.1:*'] : []),
          ],
          frameSrc: ["'self'", 'blob:', 'data:', 'https://accounts.google.com', 'https://*.firebaseapp.com'],
          frameAncestors: ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    })
  );

  const generalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down briefly.' },
  });

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait before retrying.' },
  });

  app.use('/api/auth/login', authRateLimiter);
  app.use('/api/auth/register', authRateLimiter);
  app.use('/api', generalApiLimiter);

  const controlRouter = createControlRouter({ isProduction });
  let authService: ReturnType<typeof createAuthService> | null = null;
  try {
    authService = createAuthService({ isProduction });
  } catch (err) {
    console.warn(
      `[server] ${(err as Error).message} App account routes (/api/auth/*, /api/workspace) disabled until AUTH_SESSION_SECRET is configured; Google Sign-In and local mode remain active.`
    );
  }
  const studyImagesRouter = createStudyImagesRouter();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mcp-hub' });
  });

  // Mount app authentication, workspace persistence, study image search, & control REST under /api/*
  if (authService) {
    const workspaceRouter = createWorkspaceRouter({
      verifyBearerToken: authService.verifyBearerToken,
    });
    app.use('/api', authService.router);
    app.use('/api', workspaceRouter);
  } else {
    app.use('/api/auth', (_req, res) => {
      res.status(503).json({
        error:
          'App account sign-in is disabled in production until AUTH_SESSION_SECRET is configured. Use Google Sign-In or Continue locally.',
      });
    });
    app.use('/api/workspace', (_req, res) => {
      res.status(503).json({
        error:
          'Server workspace sync requires AUTH_SESSION_SECRET to be configured in production.',
      });
    });
  }
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
