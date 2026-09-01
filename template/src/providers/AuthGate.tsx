import { useEffect } from "react";
import { useRootNavigationState, useRouter, useSegments } from "expo-router";
import { useAuth } from "./AuthProvider";

/**
 * Sends signed-out users to (auth) and signed-in users to (app). One place, so
 * no screen has to remember to check. Add role routing here when an app needs
 * it rather than scattering redirects across layouts.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  useEffect(() => {
    // Cold start: navigating before the navigator mounts is a silent no-op.
    if (loading || !navState?.key) return;
    const group = segments[0] as string | undefined;
    if (!group || group === "+not-found") return;
    if (!session && group !== "(auth)") router.replace("/sign-in");
    if (session && group === "(auth)") router.replace("/(app)/home");
  }, [loading, session, segments, router, navState?.key]);

  return <>{children}</>;
}
