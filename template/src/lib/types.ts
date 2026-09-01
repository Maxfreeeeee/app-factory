export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Subscription {
  user_id: string;
  status: "active" | "expired" | "cancelled";
  expires_at: string | null;
  product_id: string | null;
}
