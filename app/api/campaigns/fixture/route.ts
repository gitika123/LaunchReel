import { NextResponse } from "next/server";
import { getFixtureCampaignRuntime } from "@/src/runtime";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await (await getFixtureCampaignRuntime()).start(await request.json()), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Campaign configuration" }, { status: 400 });
  }
}
