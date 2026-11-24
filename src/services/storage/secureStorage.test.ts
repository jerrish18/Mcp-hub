import test from 'node:test';
import assert from 'node:assert/strict';
import { WebEncryptedStorage, type KeyValueBackend } from './secureStorage';

function createMemoryBackend(): KeyValueBackend & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    keys: () => Array.from(map.keys()),
    dump: () => map,
  };
}

test('WebEncryptedStorage supports PBKDF2 passphrase-derived keys without persisting raw key in storage', async () => {
  const backend = createMemoryBackend();
  const vault = new WebEncryptedStorage(backend);

  await vault.setItem('provider_keys', JSON.stringify({ gemini: 'AIzaTestKey1234567890' }));
  assert.equal(vault.isPassphraseModeEnabled(), false);
  assert.ok(backend.getItem('mcphub_device_master_key_v1'));

  await vault.enablePassphrase('correct-horse-battery-staple');
  assert.equal(vault.isPassphraseModeEnabled(), true);
  assert.equal(vault.isLocked(), false);
  // Device master key must be deleted when passphrase mode is enabled
  assert.equal(backend.getItem('mcphub_device_master_key_v1'), null);

  // Lock clears key from memory; reads return null and writes throw
  vault.lock();
  assert.equal(vault.isLocked(), true);
  assert.equal(await vault.getItem('provider_keys'), null);
  await assert.rejects(() => vault.setItem('provider_keys', '{}'), /locked/i);

  // Wrong passphrase fails to unlock
  assert.equal(await vault.unlockWithPassphrase('wrong-passphrase'), false);
  assert.equal(vault.isLocked(), true);

  // Correct passphrase unlocks and decrypts migrated secret
  assert.equal(await vault.unlockWithPassphrase('correct-horse-battery-staple'), true);
  assert.equal(vault.isLocked(), false);
  const decrypted = await vault.getItem('provider_keys');
  assert.ok(decrypted?.includes('AIzaTestKey1234567890'));

  // Disable passphrase migrates back to device key cleanly
  await vault.disablePassphrase();
  assert.equal(vault.isPassphraseModeEnabled(), false);
  const afterDisable = await vault.getItem('provider_keys');
  assert.ok(afterDisable?.includes('AIzaTestKey1234567890'));
});
