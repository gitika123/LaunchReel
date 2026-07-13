import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await (await getCampaignRuntime()).requestCorrection(await request.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Campaign correction" }, { status: 409 });
  }
}

export async function PUT() {
  try {
    return NextResponse.json(await (await getCampaignRuntime()).authorizeCorrection());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign correction failed" }, { status: 409 });
  }
}
