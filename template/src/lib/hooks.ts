import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Profile, Subscription } from "./types";

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Entitlement as the CLIENT sees it — for rendering only. The server re-checks
 * `subscriptions` on every paid endpoint; never gate anything that costs money
 * or exposes data on this value alone.
 */
export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: ["subscription", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
