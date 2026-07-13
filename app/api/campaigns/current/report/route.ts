import { getCampaignRuntime } from "@/src/runtime";
import { serializeProductionProof } from "@/src/proof/production-report";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runtime = await getCampaignRuntime();
    const snapshot = runtime.snapshot();
    const report = serializeProductionProof({
      snapshot,
      events: await runtime.eventsAfter(0),
      bandRoomUrl: runtime.collaborationRoomUrl(),
    });
    const filenameId = snapshot.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "campaign";
    return new Response(report, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="launchreel-${filenameId}-production-proof.json"`,
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Production Proof is unavailable" }, { status: 409 });
  }
}
