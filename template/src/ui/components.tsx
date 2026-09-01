import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { palette, radius, spacing } from "./theme";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.screenInner}>{children}</View>
    </SafeAreaView>
  );
}

export function Button({
  title, onPress, loading, variant = "solid", disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "solid" | "outline";
  disabled?: boolean;
}) {
  const outline = variant === "outline";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        outline && styles.buttonOutline,
        (pressed || disabled || loading) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outline ? palette.accent : palette.bg} />
      ) : (
        <Text style={[styles.buttonText, outline && { color: palette.accent }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Text field. Password fields get a show/hide toggle from one place, so every
 *  screen inherits it (this shipped once as a 1.0.1 fix — start with it). */
export function Input({ secureTextEntry, ...props }: TextInputProps) {
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View style={styles.inputWrap}>
      <TextInput
        {...props}
        secureTextEntry={hidden}
        placeholderTextColor={palette.muted}
        style={styles.input}
        // iOS autocorrect in a password field silently mangles the value.
        autoCorrect={false}
        autoCapitalize="none"
      />
      {secureTextEntry && (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={12}>
          <Text style={styles.reveal}>{hidden ? "Show" : "Hide"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  screenInner: { flex: 1, padding: spacing.lg, gap: spacing.md },
  button: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.accent },
  buttonText: { color: palette.bg, fontSize: 16, fontWeight: "600" },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: palette.text, paddingVertical: 14, fontSize: 16 },
  reveal: { color: palette.muted, fontSize: 13 },
});
