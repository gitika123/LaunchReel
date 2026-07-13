import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function GET() {
  return NextResponse.json((await getCampaignRuntime()).snapshot());
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await (await getCampaignRuntime()).start(await request.json()), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Campaign configuration" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const runtime = await getCampaignRuntime();
  const campaign = runtime.snapshot();
  try {
    const body = await request.json() as { confirmCampaignId?: string };
    if (campaign.status === "idle" || body.confirmCampaignId !== campaign.id) {
      return NextResponse.json({ error: "Campaign deletion requires matching explicit confirmation" }, { status: 400 });
    }
    return NextResponse.json(await runtime.deleteCampaign(campaign.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign deletion failed" }, { status: 400 });
  }
}
