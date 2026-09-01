import { useState } from "react";
import { Alert, Text } from "react-native";
import { Link } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Button, Input, Screen } from "@/ui/components";
import { palette } from "@/ui/theme";

// NOTE: there is deliberately no "dev login" button here. The one in the first
// app of this family shipped behind an env flag and had to be pulled in a
// security audit. Seed a test user in Supabase and type the password.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert("Sign-in failed", error.message);
  };

  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700", marginBottom: 8 }}>
        Welcome back
      </Text>
      <Input
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Input
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />
      <Button title="Sign in" onPress={signIn} loading={busy} />
      <Link href="/(auth)/reset-password" style={{ color: palette.muted, marginTop: 4 }}>
        Forgot your password?
      </Link>
      <Link href="/(auth)/sign-up" style={{ color: palette.accent, marginTop: 12 }}>
        No account yet? Sign up
      </Link>
    </Screen>
  );
}
