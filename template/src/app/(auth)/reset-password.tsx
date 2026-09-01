import { useState } from "react";
import { Alert, Text } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button, Input, Screen } from "@/ui/components";
import { palette } from "@/ui/theme";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    // The redirect target must also be listed under Auth → URL Configuration
    // in the Supabase dashboard, or the link silently fails.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "__SCHEME__://update-password",
    });
    setBusy(false);
    Alert.alert(
      error ? "Could not send" : "Check your inbox",
      error ? error.message : "If that address has an account, a reset link is on its way.",
    );
  };

  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700", marginBottom: 8 }}>
        Reset password
      </Text>
      <Input placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Button title="Send reset link" onPress={send} loading={busy} />
    </Screen>
  );
}
