import { toClassifyCatalog, type ClassifyCatalogItem } from "./ai-classify";
import { fetchFamilyCategories } from "./budget-read";
import type { createClient } from "./supabase/server";

/** PostgREST client — server, admin, or test double. */
type ClassifySupabase = Awaited<ReturnType<typeof createClient>>;

export const CLASSIFY_CATALOG_LOAD_ERROR = "Nie udało się wczytać kopert budżetu.";

export async function loadClassifyCatalog(
  supabase: ClassifySupabase,
  familyId: string
): Promise<{ catalog: ClassifyCatalogItem[]; error?: string }> {
  const fetched = await fetchFamilyCategories(supabase, familyId);
  if (fetched.error) {
    console.error("[classify] failed to load budget envelopes", fetched.error);
    return { catalog: [], error: CLASSIFY_CATALOG_LOAD_ERROR };
  }
  return { catalog: toClassifyCatalog(fetched.data) };
}
