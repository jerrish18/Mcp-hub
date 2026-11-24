import type { ProviderKeys, ServerSecretPayload } from '../../types';

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

const VAULT_PREFIX = 'mcphub_sec_v1_';
const MASTER_KEY_STORAGE = 'mcphub_device_master_key_v1';
const VAULT_META_KEY = 'mcphub_vault_meta_v1';
const VAULT_CHECK_KEY = 'mcphub_vault_check_v1';
const VAULT_CANARY = 'mcphub_vault_verified_v1';
const PBKDF2_ITERATIONS = 250_000;

interface VaultMeta {
  mode: 'pbkdf2';
  saltB64: string;
  iterations: number;
}

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

function createDefaultBackend(): KeyValueBackend {
  const memoryFallback = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try {
        if (globalThis.localStorage) {
          return globalThis.localStorage.getItem(key);
        }
      } catch {
        // fallback below
      }
      return memoryFallback.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      try {
        if (globalThis.localStorage) {
          globalThis.localStorage.setItem(key, value);
          return;
        }
      } catch {
        // fallback below
      }
      memoryFallback.set(key, value);
    },
    removeItem(key: string): void {
      try {
        if (globalThis.localStorage) {
          globalThis.localStorage.removeItem(key);
          return;
        }
      } catch {
        // fallback below
      }
      memoryFallback.delete(key);
    },
    keys(): string[] {
      try {
        if (globalThis.localStorage) {
          const out: string[] = [];
          for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i);
            if (k) out.push(k);
          }
          return out;
        }
      } catch {
        // fallback below
      }
      return Array.from(memoryFallback.keys());
    },
  };
}

/**
 * Web Crypto AES-GCM encrypted secret vault.
 * Supports two key modes:
 * 1. Default device-local key stored in localStorage (convenience only; defends against casual inspection, not XSS).
 * 2. Optional passphrase-derived key (PBKDF2-SHA256, 250k iterations) held strictly in memory while unlocked.
 * On mobile (Expo), this adapter is swapped for expo-secure-store (Keychain / Keystore).
 */
export class WebEncryptedStorage implements SecureStorageAdapter {
  private backend: KeyValueBackend;
  private cachedDeviceKey: CryptoKey | null = null;
  private passphraseKey: CryptoKey | null = null;

  constructor(backend?: KeyValueBackend) {
    this.backend = backend ?? createDefaultBackend();
  }

  private getVaultMeta(): VaultMeta | null {
    const raw = this.backend.getItem(VAULT_META_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<VaultMeta>;
      if (parsed.mode === 'pbkdf2' && typeof parsed.saltB64 === 'string') {
        return {
          mode: 'pbkdf2',
          saltB64: parsed.saltB64,
          iterations: Number(parsed.iterations) || PBKDF2_ITERATIONS,
        };
      }
    } catch {
      // ignore corrupted meta
    }
    return null;
  }

  isPassphraseModeEnabled(): boolean {
    return this.getVaultMeta() !== null;
  }

  isLocked(): boolean {
    return this.isPassphraseModeEnabled() && this.passphraseKey === null;
  }

  lock(): void {
    this.passphraseKey = null;
  }

  private async derivePassphraseKey(
    passphrase: string,
    salt: Uint8Array,
    iterations = PBKDF2_ITERATIONS
  ): Promise<CryptoKey> {
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle) {
      throw new Error('WebCrypto SubtleCrypto is unavailable in this environment.');
    }
    const baseKey = await cryptoObj.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
    return cryptoObj.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuf,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async getOrCreateDeviceKey(): Promise<CryptoKey | null> {
    if (this.cachedDeviceKey) return this.cachedDeviceKey;
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle) return null;

    const rawKeyB64 = this.backend.getItem(MASTER_KEY_STORAGE);
    let rawBytes: Uint8Array;
    if (rawKeyB64) {
      rawBytes = fromBase64(rawKeyB64);
    } else {
      rawBytes = cryptoObj.getRandomValues(new Uint8Array(32));
      this.backend.setItem(MASTER_KEY_STORAGE, toBase64(rawBytes));
    }

    const keyBuffer = rawBytes.buffer.slice(
      rawBytes.byteOffset,
      rawBytes.byteOffset + rawBytes.byteLength
    ) as ArrayBuffer;
    this.cachedDeviceKey = await cryptoObj.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return this.cachedDeviceKey;
  }

  private async encryptWithKey(key: CryptoKey, plaintext: string): Promise<string> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    return JSON.stringify({
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(encrypted)),
    });
  }

  private async decryptWithKey(key: CryptoKey, payload: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(payload) as { iv: string; ct: string };
      const iv = fromBase64(parsed.iv);
      const ct = fromBase64(parsed.ct);
      const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
      const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuf },
        key,
        ctBuf
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  private async getActiveKey(): Promise<CryptoKey | null> {
    if (this.isPassphraseModeEnabled()) {
      return this.passphraseKey;
    }
    return this.getOrCreateDeviceKey();
  }

  async unlockWithPassphrase(passphrase: string): Promise<boolean> {
    const meta = this.getVaultMeta();
    if (!meta) return true;
    const salt = fromBase64(meta.saltB64);
    const derived = await this.derivePassphraseKey(passphrase, salt, meta.iterations);
    const canaryPayload = this.backend.getItem(VAULT_CHECK_KEY);
    if (!canaryPayload) {
      this.passphraseKey = derived;
      return true;
    }
    const check = await this.decryptWithKey(derived, canaryPayload);
    if (check !== VAULT_CANARY) {
      return false;
    }
    this.passphraseKey = derived;
    return true;
  }

  async enablePassphrase(passphrase: string): Promise<void> {
    if (passphrase.trim().length < 6) {
      throw new Error('Passphrase must be at least 6 characters.');
    }
    if (this.isLocked()) {
      throw new Error('Unlock the vault before changing the passphrase.');
    }

    // Read all existing vault entries under current key before rotating
    const vaultKeys = this.backend.keys().filter((k) => k.startsWith(VAULT_PREFIX));
    const currentEntries: Array<[string, string]> = [];
    for (const fullKey of vaultKeys) {
      const shortKey = fullKey.slice(VAULT_PREFIX.length);
      const val = await this.getItem(shortKey);
      if (val !== null) {
        currentEntries.push([shortKey, val]);
      }
    }

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const newKey = await this.derivePassphraseKey(passphrase, salt, PBKDF2_ITERATIONS);
    const canary = await this.encryptWithKey(newKey, VAULT_CANARY);

    this.backend.setItem(
      VAULT_META_KEY,
      JSON.stringify({
        mode: 'pbkdf2',
        saltB64: toBase64(salt),
        iterations: PBKDF2_ITERATIONS,
      } satisfies VaultMeta)
    );
    this.backend.setItem(VAULT_CHECK_KEY, canary);
    this.passphraseKey = newKey;
    this.cachedDeviceKey = null;
    this.backend.removeItem(MASTER_KEY_STORAGE);

    for (const [shortKey, val] of currentEntries) {
      await this.setItem(shortKey, val);
    }
  }

  async disablePassphrase(): Promise<void> {
    if (!this.isPassphraseModeEnabled()) return;
    if (this.isLocked()) {
      throw new Error('Unlock the vault before disabling passphrase protection.');
    }

    const vaultKeys = this.backend.keys().filter((k) => k.startsWith(VAULT_PREFIX));
    const currentEntries: Array<[string, string]> = [];
    for (const fullKey of vaultKeys) {
      const shortKey = fullKey.slice(VAULT_PREFIX.length);
      const val = await this.getItem(shortKey);
      if (val !== null) {
        currentEntries.push([shortKey, val]);
      }
    }

    this.passphraseKey = null;
    this.backend.removeItem(VAULT_META_KEY);
    this.backend.removeItem(VAULT_CHECK_KEY);
    this.cachedDeviceKey = null;

    for (const [shortKey, val] of currentEntries) {
      await this.setItem(shortKey, val);
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (this.isLocked()) {
      return null;
    }
    const storageKey = `${VAULT_PREFIX}${key}`;
    const stored = this.backend.getItem(storageKey);
    if (!stored) return null;

    const aesKey = await this.getActiveKey();
    if (!aesKey) return stored;

    return this.decryptWithKey(aesKey, stored);
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.isLocked()) {
      throw new Error('Vault is locked. Unlock with your passphrase first.');
    }
    const storageKey = `${VAULT_PREFIX}${key}`;
    const aesKey = await this.getActiveKey();
    const payload = aesKey ? await this.encryptWithKey(aesKey, value) : value;
    this.backend.setItem(storageKey, payload);
  }

  async deleteItem(key: string): Promise<void> {
    this.backend.removeItem(`${VAULT_PREFIX}${key}`);
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

export function isPassphraseVaultEnabled(): boolean {
  return activeAdapter instanceof WebEncryptedStorage && activeAdapter.isPassphraseModeEnabled();
}

export function isVaultUnlocked(): boolean {
  if (activeAdapter instanceof WebEncryptedStorage) {
    return !activeAdapter.isLocked();
  }
  return true;
}

export function lockVault(): void {
  if (activeAdapter instanceof WebEncryptedStorage) {
    activeAdapter.lock();
  }
}

export async function unlockVaultWithPassphrase(passphrase: string): Promise<boolean> {
  if (activeAdapter instanceof WebEncryptedStorage) {
    return activeAdapter.unlockWithPassphrase(passphrase);
  }
  return true;
}

export async function enablePassphraseVault(passphrase: string): Promise<void> {
  if (activeAdapter instanceof WebEncryptedStorage) {
    await activeAdapter.enablePassphrase(passphrase);
  }
}

export async function disablePassphraseVault(): Promise<void> {
  if (activeAdapter instanceof WebEncryptedStorage) {
    await activeAdapter.disablePassphrase();
  }
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
