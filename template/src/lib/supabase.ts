import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { SecureStorageAdapter } from "./secureStorage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env",
  );
}

// The session store is NOT configurable. An earlier app made it selectable by
// an EXPO_PUBLIC_ flag so simulator screenshots would work without a Keychain;
// that flag ships inside the bundle and can be flipped in a release build, and
// the second app inherited it by copy. AsyncStorage is not a dependency of this
// template at all, so the shortcut cannot be reintroduced by accident.
// If you need an unsigned simulator build, sign in again — do not weaken this.
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
