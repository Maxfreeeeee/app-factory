import { useState } from "react";
import { Alert, Text } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Button, Input, Screen } from "@/ui/components";
import { palette } from "@/ui/theme";

const MIN_PASSWORD = 8;

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const signUp = async () => {
    if (password.length < MIN_PASSWORD) {
      Alert.alert("Password too short", `Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) return Alert.alert("Sign-up failed", error.message);
    // Email confirmation is ON (supabase/config.toml). Say so, or the user
    // sits on a blank screen waiting to be logged in.
    Alert.alert("Check your inbox", "Confirm your email address to finish signing up.", [
      { text: "OK", onPress: () => router.replace("/sign-in") },
    ]);
  };

  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700", marginBottom: 8 }}>
        Create an account
      </Text>
      <Input placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" />
      <Input placeholder={`Password (min. ${MIN_PASSWORD})`} value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" />
      <Button title="Sign up" onPress={signUp} loading={busy} />
      <Text style={{ color: palette.muted, fontSize: 12, marginTop: 8 }}>
        By signing up you accept the Terms and the Privacy Policy.
      </Text>
    </Screen>
  );
}
