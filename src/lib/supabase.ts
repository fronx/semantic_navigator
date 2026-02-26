import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Server-side client with service role for admin operations (singleton)
let serverClient: ReturnType<typeof createClient<Database>> | null = null;

export function createServerClient() {
  if (!serverClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    serverClient = createClient<Database>(supabaseUrl, serviceRoleKey);
  }
  return serverClient;
}
