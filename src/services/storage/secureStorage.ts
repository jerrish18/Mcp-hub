import type { ProviderKeys, ServerSecretPayload } from '../../types';

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const VAULT_PREFIX = 'mcphub_sec_v1_';
const MASTER_KEY_STORAGE = 'mcphub_device_master_key_v1';

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Web Crypto AES-GCM encrypted secret vault.
 * On mobile (Expo), this adapter is swapped for expo-secure-store (Keychain / Keystore).
 */
export class WebEncryptedStorage implements SecureStorageAdapter {
  private memoryFallback = new Map<string, string>();
  private cachedKey: CryptoKey | null = null;

  private async getOrCreateMasterKey(): Promise<CryptoKey | null> {
    if (this.cachedKey) return this.cachedKey;
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle) return null;

    let rawKeyB64: string | null = null;
    try {
      rawKeyB64 = globalThis.localStorage?.getItem(MASTER_KEY_STORAGE) ?? null;
    } catch {
      rawKeyB64 = this.memoryFallback.get(MASTER_KEY_STORAGE) ?? null;
    }

    let rawBytes: Uint8Array;
    if (rawKeyB64) {
      rawBytes = fromBase64(rawKeyB64);
    } else {
      rawBytes = cryptoObj.getRandomValues(new Uint8Array(32));
      const encoded = toBase64(rawBytes);
      try {
        globalThis.localStorage?.setItem(MASTER_KEY_STORAGE, encoded);
      } catch {
        this.memoryFallback.set(MASTER_KEY_STORAGE, encoded);
      }
    }

    const keyBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer;
    this.cachedKey = await cryptoObj.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return this.cachedKey;
  }

  async getItem(key: string): Promise<string | null> {
    const storageKey = `${VAULT_PREFIX}${key}`;
    let stored: string | null = null;
    try {
      stored = globalThis.localStorage?.getItem(storageKey) ?? null;
    } catch {
      stored = this.memoryFallback.get(storageKey) ?? null;
    }
    if (!stored) return null;

    const aesKey = await this.getOrCreateMasterKey();
    if (!aesKey) return stored;

    try {
      const parsed = JSON.parse(stored) as { iv: string; ct: string };
      const iv = fromBase64(parsed.iv);
      const ct = fromBase64(parsed.ct);
      const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
      const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuf },
        aesKey,
        ctBuf
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const storageKey = `${VAULT_PREFIX}${key}`;
    const aesKey = await this.getOrCreateMasterKey();
    let payload: string;

    if (aesKey) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(value);
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoded
      );
      payload = JSON.stringify({
        iv: toBase64(iv),
        ct: toBase64(new Uint8Array(encrypted)),
      });
    } else {
      payload = value;
    }

    try {
      globalThis.localStorage?.setItem(storageKey, payload);
    } catch {
      this.memoryFallback.set(storageKey, payload);
    }
  }

  async deleteItem(key: string): Promise<void> {
    const storageKey = `${VAULT_PREFIX}${key}`;
    try {
      globalThis.localStorage?.removeItem(storageKey);
    } catch {
      this.memoryFallback.delete(storageKey);
    }
  }
}

export class InMemorySecureStorage implements SecureStorageAdapter {
  private store = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async deleteItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

let activeAdapter: SecureStorageAdapter = new WebEncryptedStorage();

export function setSecureStorageAdapter(adapter: SecureStorageAdapter): void {
  activeAdapter = adapter;
}

export function getSecureStorageAdapter(): SecureStorageAdapter {
  return activeAdapter;
}

const PROVIDER_KEYS_KEY = 'provider_keys';

export async function loadProviderKeys(): Promise<ProviderKeys> {
  const raw = await activeAdapter.getItem(PROVIDER_KEYS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProviderKeys;
  } catch {
    return {};
  }
}

export async function saveProviderKeys(keys: ProviderKeys): Promise<void> {
  await activeAdapter.setItem(PROVIDER_KEYS_KEY, JSON.stringify(keys));
}

export async function loadServerSecrets(serverId: string): Promise<ServerSecretPayload> {
  const raw = await activeAdapter.getItem(`server_${serverId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ServerSecretPayload;
  } catch {
    return {};
  }
}

export async function saveServerSecrets(serverId: string, secrets: ServerSecretPayload): Promise<void> {
  await activeAdapter.setItem(`server_${serverId}`, JSON.stringify(secrets));
}

export async function deleteServerSecrets(serverId: string): Promise<void> {
  await activeAdapter.deleteItem(`server_${serverId}`);
}
