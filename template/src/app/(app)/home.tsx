import { Text } from "react-native";
import { Link } from "expo-router";
import { Screen } from "@/ui/components";
import { useAuth } from "@/providers/AuthProvider";
import { palette } from "@/ui/theme";

export default function Home() {
  const { profile } = useAuth();
  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700" }}>
        __APP_NAME__
      </Text>
      <Text style={{ color: palette.muted }}>
        Signed in as {profile?.display_name ?? "…"}. Build the app here.
      </Text>
      <Link href="/settings" style={{ color: palette.accent, marginTop: 16 }}>Settings</Link>
    </Screen>
  );
}
