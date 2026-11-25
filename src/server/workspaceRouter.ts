import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { PublicAppUser } from './authRouter';

export interface CreateWorkspaceRouterOptions {
  verifyBearerToken: (authHeader?: string) => PublicAppUser | null;
  storageDir?: string;
}

const WorkspacePayloadSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
  agents: z.array(z.record(z.string(), z.unknown())).max(60).optional(),
  servers: z.array(z.record(z.string(), z.unknown())).max(60).optional(),
  dynamicModels: z.array(z.record(z.string(), z.unknown())).max(150).optional(),
  dismissedDefaultServerIds: z.array(z.string().max(128)).max(60).optional(),
  savedPrompts: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
  projects: z.array(z.record(z.string(), z.unknown())).max(60).optional(),
  conversations: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  savedStudyNotes: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
});

export interface StoredWorkspaceSnapshot {
  ownerId: string;
  settings?: Record<string, unknown>;
  agents?: Array<Record<string, unknown>>;
  servers?: Array<Record<string, unknown>>;
  dynamicModels?: Array<Record<string, unknown>>;
  dismissedDefaultServerIds?: string[];
  savedPrompts?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
  savedStudyNotes?: Array<Record<string, unknown>>;
  updatedAt: number;
}

function resolveSafeUserWorkspacePath(baseDir: string, userId: string): string | null {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(userId)) {
    return null;
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, `${userId}.json`);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

export function createWorkspaceRouter(options: CreateWorkspaceRouterOptions): Router {
  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  const baseDir = options.storageDir ?? path.resolve(process.cwd(), '.data', 'workspaces');

  const requireAuthenticatedAppUser = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const originHeader = req.get('origin');
    const hostHeader = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim();
    if (originHeader && hostHeader) {
      try {
        if (new URL(originHeader).host.toLowerCase() !== hostHeader.toLowerCase()) {
          res.status(403).json({ error: 'Cross-origin workspace request rejected.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid Origin header.' });
        return;
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-mcphub-ui') !== '1') {
      res.status(403).json({ error: 'Missing required UI request header.' });
      return;
    }

    const user = options.verifyBearerToken(req.get('authorization'));
    if (!user) {
      res.status(401).json({ error: 'Authentication required to access workspace database.' });
      return;
    }
    (req as Request & { authUser?: PublicAppUser }).authUser = user;
    next();
  };

  router.get('/workspace', requireAuthenticatedAppUser, (req, res) => {
    const user = (req as Request & { authUser: PublicAppUser }).authUser;
    const targetFile = resolveSafeUserWorkspacePath(baseDir, user.id);
    if (!targetFile) {
      res.status(400).json({ error: 'Invalid user identifier.' });
      return;
    }

    try {
      if (!fs.existsSync(targetFile)) {
        res.json({ workspace: null });
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8')) as StoredWorkspaceSnapshot;
      res.json({ workspace: parsed });
    } catch {
      res.status(500).json({ error: 'Unable to read saved workspace.' });
    }
  });

  router.put('/workspace', requireAuthenticatedAppUser, (req, res) => {
    const user = (req as Request & { authUser: PublicAppUser }).authUser;
    const targetFile = resolveSafeUserWorkspacePath(baseDir, user.id);
    if (!targetFile) {
      res.status(400).json({ error: 'Invalid user identifier.' });
      return;
    }

    const parsed = WorkspacePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid workspace payload.',
      });
      return;
    }

    let existing: StoredWorkspaceSnapshot | null = null;
    try {
      if (fs.existsSync(targetFile)) {
        existing = JSON.parse(fs.readFileSync(targetFile, 'utf8')) as StoredWorkspaceSnapshot;
      }
    } catch {
      existing = null;
    }

    const nextSnapshot: StoredWorkspaceSnapshot = {
      ownerId: user.id,
      settings: parsed.data.settings ?? existing?.settings,
      agents: parsed.data.agents ?? existing?.agents,
      servers: parsed.data.servers ?? existing?.servers,
      dynamicModels: parsed.data.dynamicModels ?? existing?.dynamicModels,
      dismissedDefaultServerIds:
        parsed.data.dismissedDefaultServerIds ?? existing?.dismissedDefaultServerIds,
      savedPrompts: parsed.data.savedPrompts ?? existing?.savedPrompts,
      projects: parsed.data.projects ?? existing?.projects,
      conversations: parsed.data.conversations ?? existing?.conversations,
      savedStudyNotes: parsed.data.savedStudyNotes ?? existing?.savedStudyNotes,
      updatedAt: Date.now(),
    };

    try {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, JSON.stringify(nextSnapshot, null, 2), 'utf8');
      res.json({ ok: true, updatedAt: nextSnapshot.updatedAt });
    } catch {
      res.status(500).json({ error: 'Unable to persist workspace to database.' });
    }
  });

  return router;
}
