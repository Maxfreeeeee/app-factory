// SecureStore-backed storage adapter for the Supabase auth session.
// The JWT + refresh token live in the iOS Keychain / Android Keystore
// (encrypted at rest) instead of plaintext AsyncStorage. SecureStore caps
// each value at ~2 KB, so values are transparently chunked.
import * as SecureStore from "expo-secure-store";

const CHUNK = 2000;
const key = (k: string, i: number) => `${k}.${i}`;
const sanitize = (k: string) => k.replace(/[^a-zA-Z0-9._-]/g, "_");

export const SecureStorageAdapter = {
  async getItem(k: string): Promise<string | null> {
    const base = sanitize(k);
    const countRaw = await SecureStore.getItemAsync(`${base}.n`);
    if (countRaw == null) {
      // legacy single-value (pre-chunking) fallback
      return SecureStore.getItemAsync(base);
    }
    const count = Number(countRaw);
    let out = "";
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(key(base, i));
      if (part == null) return null;
      out += part;
    }
    return out;
  },

  async setItem(k: string, value: string): Promise<void> {
    const base = sanitize(k);
    await this.removeItem(k);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));
    await SecureStore.setItemAsync(`${base}.n`, String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(key(base, i), chunks[i]);
    }
  },

  async removeItem(k: string): Promise<void> {
    const base = sanitize(k);
    const countRaw = await SecureStore.getItemAsync(`${base}.n`);
    if (countRaw != null) {
      const count = Number(countRaw);
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(key(base, i));
      await SecureStore.deleteItemAsync(`${base}.n`);
    }
    await SecureStore.deleteItemAsync(base);
  },
};
