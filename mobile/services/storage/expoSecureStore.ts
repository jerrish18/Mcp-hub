import * as SecureStore from 'expo-secure-store';
import type { SecureStorageAdapter } from '@core/services/storage/secureStorage';

/**
 * Hardware-backed Keychain (iOS) / EncryptedSharedPreferences Keystore (Android)
 * secret storage adapter for Expo.
 */
export const expoSecureStorageAdapter: SecureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async deleteItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
