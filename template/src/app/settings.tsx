import { Alert, Text } from "react-native";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { Button, Screen } from "@/ui/components";
import { palette } from "@/ui/theme";

export default function Settings() {
  // App Store 5.1.1(v): an app that creates accounts must let the user delete
  // one from inside the app. Review rejects for this, so it ships from day one.
  const deleteAccount = () =>
    Alert.alert(
      "Delete account",
      "This permanently deletes your account and all of its data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteAccount();
              await supabase.auth.signOut();
            } catch (e) {
              // The endpoint requires a recent sign-in (requireRecentAuth).
              Alert.alert("Could not delete", e instanceof Error ? e.message : "Please sign in again and retry.");
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 20, fontWeight: "700" }}>Account</Text>
      <Button title="Sign out" variant="outline" onPress={() => supabase.auth.signOut()} />
      <Text style={{ color: palette.muted, fontSize: 12, marginTop: 24 }}>
        Deleting removes your account and data permanently.
      </Text>
      <Button title="Delete account" variant="outline" onPress={deleteAccount} />
    </Screen>
  );
}
