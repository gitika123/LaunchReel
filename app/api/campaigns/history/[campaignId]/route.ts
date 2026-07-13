import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

interface CampaignRouteContext {
  params: Promise<{ campaignId: string }>;
}

export async function GET(_request: Request, context: CampaignRouteContext) {
  const { campaignId } = await context.params;
  try {
    const campaign = await (await getCampaignRuntime()).completedCampaign(campaignId);
    return campaign ? NextResponse.json(campaign) : NextResponse.json({ error: "Completed Campaign was not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign lookup failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: CampaignRouteContext) {
  const { campaignId } = await context.params;
  try {
    const body = await request.json() as { confirmCampaignId?: string };
    if (body.confirmCampaignId !== campaignId) return NextResponse.json({ error: "Campaign deletion requires matching explicit confirmation" }, { status: 400 });
    await (await getCampaignRuntime()).deleteCampaign(campaignId);
    return NextResponse.json({ deleted: campaignId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign deletion failed" }, { status: 400 });
  }
}
