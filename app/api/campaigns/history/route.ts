import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function GET() {
  return NextResponse.json(await (await getCampaignRuntime()).history());
}
