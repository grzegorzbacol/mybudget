export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return false;

  const placeholders = [
    "your-project.supabase.co",
    "your-anon-key",
    "https://your-project.supabase.co",
  ];

  return !placeholders.some((p) => url.includes(p) || key.includes(p));
}
