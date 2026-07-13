import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await (await getCampaignRuntime()).approveConcept(await request.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Concept Approval" }, { status: 409 });
  }
}
