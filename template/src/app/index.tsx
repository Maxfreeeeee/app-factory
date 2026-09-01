import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { palette } from "@/ui/theme";

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, justifyContent: "center" }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  return <Redirect href={session ? "/(app)/home" : "/sign-in"} />;
}
