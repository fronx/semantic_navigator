import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role for admin operations (singleton)
let serverClient: ReturnType<typeof createClient> | null = null;

export function createServerClient() {
  if (!serverClient) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    serverClient = createClient(supabaseUrl, serviceRoleKey);
  }
  return serverClient;
}
