/** 503 body returned when the web deployment has no API proxy configured (gap C3). */
export function misconfiguredResponse(): Response {
  return Response.json(
    {
      status: "misconfigured",
      decision: "abstain",
      codes: ["P-UNAVAIL"],
      reason:
        "API proxy not configured: set ZGUARD_INTERNAL_API_URL on the web project to the API deployment URL and redeploy",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
