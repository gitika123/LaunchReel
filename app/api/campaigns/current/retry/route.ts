import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function POST() {
  try {
    return NextResponse.json(await (await getCampaignRuntime()).retry());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign retry failed" }, { status: 409 });
  }
}
