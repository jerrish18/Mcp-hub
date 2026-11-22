import { signInWithGooglePopup, signOutFirebaseUser, subscribeToFirebaseAuth } from '../firebase/client';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: 'google' | 'app';
}

// Keep app session Bearer token strictly in memory (never localStorage/sessionStorage)
let appSessionToken = '';

export function getAppSessionToken(): string {
  return appSessionToken;
}

export async function registerAppAccount(params: {
  displayName: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCPHub-UI': '1',
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    user?: { id: string; email: string; displayName: string };
    error?: string;
  };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error ?? `Registration failed (${res.status})`);
  }
  appSessionToken = body.token;
  return {
    id: body.user.id,
    email: body.user.email,
    displayName: body.user.displayName,
    provider: 'app',
  };
}

export async function loginAppAccount(params: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCPHub-UI': '1',
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    user?: { id: string; email: string; displayName: string };
    error?: string;
  };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error ?? `Sign in failed (${res.status})`);
  }
  appSessionToken = body.token;
  return {
    id: body.user.id,
    email: body.user.email,
    displayName: body.user.displayName,
    provider: 'app',
  };
}

export async function loginWithGoogleAccount(): Promise<AuthUser> {
  const user = await signInWithGooglePopup();
  return {
    id: user.uid,
    email: user.email ?? '',
    displayName: user.displayName || user.email || 'Google User',
    photoURL: user.photoURL ?? undefined,
    provider: 'google',
  };
}

export async function logoutCurrentAccount(): Promise<void> {
  if (appSessionToken) {
    const token = appSessionToken;
    appSessionToken = '';
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'X-MCPHub-UI': '1',
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => {});
  }
  await signOutFirebaseUser().catch(() => {});
}

export function subscribeGoogleAuth(onUser: (user: AuthUser | null) => void): () => void {
  return subscribeToFirebaseAuth((fbUser) => {
    if (!fbUser) {
      onUser(null);
      return;
    }
    onUser({
      id: fbUser.uid,
      email: fbUser.email ?? '',
      displayName: fbUser.displayName || fbUser.email || 'Google User',
      photoURL: fbUser.photoURL ?? undefined,
      provider: 'google',
    });
  });
}
