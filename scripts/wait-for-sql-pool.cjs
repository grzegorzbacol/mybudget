/**
 * Poll GET /api/health until the Node pg pool has opened a connection.
 * Used by docker-entrypoint so Coolify does not send the first user to a cold pool.
 * Then hit /api/cashflow once so that route chunk is loaded (401 is expected).
 */
const port = process.env.PORT || "3000";
const deadline = Date.now() + 45_000;

async function once() {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  return res.json();
}

async function preloadCashflowRoute() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/cashflow?days=60&bucket=week&lite=1`);
    console.log("cashflow route warm", res.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("cashflow route warm skipped", message);
  }
}

(async () => {
  while (Date.now() < deadline) {
    try {
      const json = await once();
      if (json && json.db === true) {
        console.log("SQL pool ready", JSON.stringify(json));
        await preloadCashflowRoute();
        process.exit(0);
      }
      if (json && json.skipped) {
        console.log("SQL pool skipped", JSON.stringify(json));
        await preloadCashflowRoute();
        process.exit(0);
      }
      if (json && json.degraded) {
        console.log("SQL pool degraded (DNS/connect); continuing so PostgREST-backed routes still work", JSON.stringify(json));
        await preloadCashflowRoute();
        process.exit(0);
      }
      console.log("waiting for SQL pool", JSON.stringify(json));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("waiting for listen", message);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log("WARNING: SQL pool did not report db:true before timeout");
  await preloadCashflowRoute();
  process.exit(0);
})();
