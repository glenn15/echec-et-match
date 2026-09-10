import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://icvbfhqcekcwogmrwgfl.supabase.co";
const supabaseAnonKey = "sb_publishable_MFwKHqlzGqEnQt_f9_U4HA_Fv-rp0wY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
