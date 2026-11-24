import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';

const scryptAsync = promisify(crypto.scrypt);

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  revokedTokensFilePath?: string;
  sessionSecret?: string;
  isProduction?: boolean;
}

const RegisterSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ saltHex: string; hashHex: string }> {
  const salt = saltHex ?? crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return { saltHex: salt, hashHex: derived.toString('hex') };
}

async function verifyPassword(
  password: string,
  saltHex: string,
  storedHashHex: string
): Promise<boolean> {
  const derived = (await scryptAsync(password, saltHex, 64)) as Buffer;
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

export interface AuthService {
  router: Router;
  verifyBearerToken: (authHeader?: string) => PublicAppUser | null;
}

interface RevokedRecord {
  jti: string;
  exp: number;
}

export function createAuthService(options: CreateAuthRouterOptions = {}): AuthService {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const rawSecret = (options.sessionSecret ?? process.env.AUTH_SESSION_SECRET ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  const hasRealSecret = Boolean(rawSecret && !rawSecret.startsWith('MY_'));

  if (isProduction && !hasRealSecret) {
    throw new Error('AUTH_SESSION_SECRET must be set in production.');
  }
  const signingSecret = hasRealSecret ? rawSecret : crypto.randomBytes(32).toString('hex');

  const storageFilePath =
    options.storageFilePath ?? path.resolve(process.cwd(), '.data', 'app-users.json');
  const revokedTokensFilePath =
    options.revokedTokensFilePath ??
    (storageFilePath ? path.join(path.dirname(storageFilePath), 'revoked-tokens.json') : '');

  const users: StoredAppUser[] = [];
  const revokedTokens = new Map<string, number>();

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

  if (revokedTokensFilePath) {
    try {
      if (fs.existsSync(revokedTokensFilePath)) {
        const parsed = JSON.parse(
          fs.readFileSync(revokedTokensFilePath, 'utf8')
        ) as RevokedRecord[];
        const now = Date.now();
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (entry && entry.jti && entry.exp > now) {
              revokedTokens.set(entry.jti, entry.exp);
            }
          }
        }
      }
    } catch {
      // ignore unavailable revocation store
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

  const persistRevokedTokens = () => {
    if (!revokedTokensFilePath) return;
    try {
      const now = Date.now();
      const active: RevokedRecord[] = [];
      for (const [jti, exp] of revokedTokens.entries()) {
        if (exp > now) {
          active.push({ jti, exp });
        } else {
          revokedTokens.delete(jti);
        }
      }
      fs.mkdirSync(path.dirname(revokedTokensFilePath), { recursive: true });
      fs.writeFileSync(revokedTokensFilePath, JSON.stringify(active, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
  };

  const revokeJti = (jti: string, exp: number) => {
    revokedTokens.set(jti, exp);
    persistRevokedTokens();
  };

  const signToken = (
    user: StoredAppUser,
    kind: 'access' | 'refresh',
    ttlMs: number
  ): string => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        kind,
        jti: crypto.randomBytes(12).toString('hex'),
        exp: Date.now() + ttlMs,
      }),
      'utf8'
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  };

  const issueTokenPair = (user: StoredAppUser) => ({
    token: signToken(user, 'access', ACCESS_TOKEN_TTL_MS),
    refreshToken: signToken(user, 'refresh', REFRESH_TOKEN_TTL_MS),
    expiresInMs: ACCESS_TOKEN_TTL_MS,
  });

  const verifySessionToken = (
    token: string,
    expectedKind?: 'access' | 'refresh'
  ): { user: StoredAppUser; jti: string; exp: number; kind: 'access' | 'refresh' } | null => {
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
        kind?: 'access' | 'refresh';
      };
      const kind = parsed.kind ?? 'access';
      if (expectedKind && kind !== expectedKind) {
        return null;
      }
      if (!parsed.sub || !parsed.jti || !parsed.exp || Date.now() > parsed.exp) {
        return null;
      }
      if (revokedTokens.has(parsed.jti)) return null;
      const user = users.find((u) => u.id === parsed.sub);
      if (!user) return null;
      return { user, jti: parsed.jti, exp: parsed.exp, kind };
    } catch {
      return null;
    }
  };

  const verifyBearerToken = (authHeader?: string): PublicAppUser | null => {
    const token = (authHeader ?? '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const verified = token ? verifySessionToken(token, 'access') : null;
    return verified ? toPublicUser(verified.user) : null;
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

  router.post('/auth/register', requireSameOriginUi, async (req, res) => {
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
    const { saltHex, hashHex } = await hashPassword(parsed.data.password);
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

    const tokens = issueTokenPair(user);
    res.status(201).json({ ...tokens, user: toPublicUser(user) });
  });

  router.post('/auth/login', requireSameOriginUi, async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' });
      return;
    }

    const user = users.find((u) => u.email === parsed.data.email);
    const valid = user ? await verifyPassword(parsed.data.password, user.saltHex, user.hashHex) : false;
    if (!user || !valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const tokens = issueTokenPair(user);
    res.json({ ...tokens, user: toPublicUser(user) });
  });

  router.post('/auth/refresh', requireSameOriginUi, (req, res) => {
    const rawRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    const verified = rawRefresh ? verifySessionToken(rawRefresh, 'refresh') : null;
    if (!verified) {
      res.status(401).json({ error: 'Invalid or expired refresh token.' });
      return;
    }
    revokeJti(verified.jti, verified.exp);
    const tokens = issueTokenPair(verified.user);
    res.json({ ...tokens, user: toPublicUser(verified.user) });
  });

  router.get('/auth/me', requireSameOriginUi, (req, res) => {
    const user = verifyBearerToken(req.get('authorization'));
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json({ user });
  });

  router.post('/auth/logout', requireSameOriginUi, (req, res) => {
    const authHeader = req.get('authorization') ?? '';
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const verified = token ? verifySessionToken(token) : null;
    if (verified) {
      revokeJti(verified.jti, verified.exp);
    }
    const rawRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    const verifiedRefresh = rawRefresh ? verifySessionToken(rawRefresh, 'refresh') : null;
    if (verifiedRefresh) {
      revokeJti(verifiedRefresh.jti, verifiedRefresh.exp);
    }
    res.json({ ok: true });
  });

  return { router, verifyBearerToken };
}

export function createAuthRouter(options: CreateAuthRouterOptions = {}): Router {
  return createAuthService(options).router;
}
