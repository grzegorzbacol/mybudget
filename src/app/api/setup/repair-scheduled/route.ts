import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { applyScheduledIdSchemaRepair } from "@/lib/ensure-schema";
import { polishPaymentsWarning } from "@/lib/payments-http";
import { SCHEDULED_ID_OWNER_SQL, SCHEDULED_ID_UI_MESSAGE } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.SETUP_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  const ctx = await getAuthContext();
  return !("error" in ctx);
}

/**
 * Reload PostgREST and ADD scheduled_id when the owner URL can ALTER.
 * Catalog presence (parent already added the column) is success even if
 * app postgres cannot ALTER public.transactions.
 */
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repair = await applyScheduledIdSchemaRepair();
  const present = repair.columnPresent === true || repair.ok;
  return NextResponse.json({
    ok: present,
    repair,
    columns: {
      scheduled_id: present,
    },
    notified: Boolean(repair.notified),
    error: present ? undefined : polishPaymentsWarning(repair.error) ?? SCHEDULED_ID_UI_MESSAGE,
    ownerSql: present ? undefined : SCHEDULED_ID_OWNER_SQL,
  });
}
