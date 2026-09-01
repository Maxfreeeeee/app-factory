import { Link } from "expo-router";
import { Text } from "react-native";
import { Screen } from "@/ui/components";
import { palette } from "@/ui/theme";

export default function NotFound() {
  return (
    <Screen>
      <Text style={{ color: palette.text, fontSize: 18 }}>This screen does not exist.</Text>
      <Link href="/" style={{ color: palette.accent, marginTop: 12 }}>Go home</Link>
    </Screen>
  );
}
