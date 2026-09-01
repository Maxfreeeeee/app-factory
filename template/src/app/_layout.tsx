import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/providers/AuthProvider";
import { AuthGate } from "@/providers/AuthGate";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (s) => handleFocus(s === "active"));
  return () => sub.remove();
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings", presentation: "modal" }} />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
