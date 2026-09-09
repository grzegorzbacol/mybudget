export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { applyEnsureSchema } = await import("@/lib/ensure-schema");
    const result = await applyEnsureSchema();
    if (result.skipped) {
      console.warn("[ensure-schema]", result.skipped, "— transfer columns will not be auto-created.");
    } else if (!result.ok) {
      console.warn("[ensure-schema] partial/failed after", result.applied, "statements:", result.error);
    } else {
      console.log("[ensure-schema] applied", result.applied, "statements");
    }
  } catch (error) {
    console.warn("[ensure-schema] boot hook failed", error);
  }
}
