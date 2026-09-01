const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  // supabase/ is Deno: remote `npm:` specifiers and .ts imports that this
  // resolver cannot follow. It is linted by the Supabase CLI, not by Expo's.
  { ignores: ["dist/*", "node_modules/*", ".expo/*", "supabase/*"] },
]);
