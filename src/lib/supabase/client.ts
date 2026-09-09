import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./config";

export function createClient() {
  return createBrowserClient(supabaseUrl || "https://example.supabase.co", supabaseAnonKey || "public-anon-key");
}
