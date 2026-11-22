import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';

export interface StoredAppUser {
  id: string;
  email: string;
  displayName: string;
  saltHex: string;
  hashHex: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicAppUser {
  id: string;
  email: string;
  displayName: string;
  provider: 'app';
  createdAt: number;
}

export interface CreateAuthRouterOptions {
  storageFilePath?: string;
  sessionSecret?: string;
}

const RegisterSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

function hashPassword(password: string, saltHex?: string): { saltHex: string; hashHex: string } {
  const salt = saltHex ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64);
  return { saltHex: salt, hashHex: derived.toString('hex') };
}

function verifyPassword(password: string, saltHex: string, storedHashHex: string): boolean {
  const derived = crypto.scryptSync(password, saltHex, 64);
  const stored = Buffer.from(storedHashHex, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

function toPublicUser(u: StoredAppUser): PublicAppUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    provider: 'app',
    createdAt: u.createdAt,
  };
}

export function createAuthRouter(options: CreateAuthRouterOptions = {}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  const storageFilePath =
    options.storageFilePath ?? path.resolve(process.cwd(), '.data', 'app-users.json');
  const signingSecret =
    (options.sessionSecret ?? process.env.AUTH_SESSION_SECRET ?? '').trim() ||
    crypto.randomBytes(32).toString('hex');

  const users: StoredAppUser[] = [];
  const revokedTokens = new Set<string>();

  if (storageFilePath) {
    try {
      if (fs.existsSync(storageFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(storageFilePath, 'utf8')) as StoredAppUser[];
        if (Array.isArray(parsed)) {
          users.push(...parsed);
        }
      }
    } catch {
      // ignore unavailable cache file
    }
  }

  const persistUsers = () => {
    if (!storageFilePath) return;
    try {
      fs.mkdirSync(path.dirname(storageFilePath), { recursive: true });
      fs.writeFileSync(storageFilePath, JSON.stringify(users, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
  };

  const signSessionToken = (user: StoredAppUser): string => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        jti: crypto.randomBytes(12).toString('hex'),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
      'utf8'
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  };

  const verifySessionToken = (
    token: string
  ): { user: StoredAppUser; jti: string } | null => {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const expectedSig = crypto
      .createHmac('sha256', signingSecret)
      .update(payloadB64)
      .digest('base64url');
    const bufA = Buffer.from(sigB64, 'utf8');
    const bufB = Buffer.from(expectedSig, 'utf8');
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        sub: string;
        jti: string;
        exp: number;
      };
      if (!parsed.sub || !parsed.jti || !parsed.exp || Date.now() > parsed.exp) {
        return null;
      }
      if (revokedTokens.has(parsed.jti)) return null;
      const user = users.find((u) => u.id === parsed.sub);
      if (!user) return null;
      return { user, jti: parsed.jti };
    } catch {
      return null;
    }
  };

  const requireSameOriginUi = (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.get('origin');
    const hostHeader = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim();
    if (originHeader && hostHeader) {
      try {
        if (new URL(originHeader).host.toLowerCase() !== hostHeader.toLowerCase()) {
          res.status(403).json({ error: 'Cross-origin auth request rejected.' });
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
    next();
  };

  router.post('/auth/register', requireSameOriginUi, (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration data.' });
      return;
    }

    const exists = users.some((u) => u.email === parsed.data.email);
    if (exists) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const now = Date.now();
    const { saltHex, hashHex } = hashPassword(parsed.data.password);
    const user: StoredAppUser = {
      id: `usr_${now}_${crypto.randomBytes(4).toString('hex')}`,
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      saltHex,
      hashHex,
      createdAt: now,
      updatedAt: now,
    };

    users.push(user);
    persistUsers();

    const token = signSessionToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  });

  router.post('/auth/login', requireSameOriginUi, (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' });
      return;
    }

    const user = users.find((u) => u.email === parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.saltHex, user.hashHex)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signSessionToken(user);
    res.json({ token, user: toPublicUser(user) });
  });

  router.get('/auth/me', requireSameOriginUi, (req, res) => {
    const authHeader = req.get('authorization') ?? '';
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const verified = token ? verifySessionToken(token) : null;
    if (!verified) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json({ user: toPublicUser(verified.user) });
  });

  router.post('/auth/logout', requireSameOriginUi, (req, res) => {
    const authHeader = req.get('authorization') ?? '';
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const verified = token ? verifySessionToken(token) : null;
    if (verified) {
      revokedTokens.add(verified.jti);
    }
    res.json({ ok: true });
  });

  return router;
}
