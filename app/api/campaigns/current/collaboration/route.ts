import { NextResponse } from "next/server";
import { getCampaignRuntime } from "@/src/runtime";

export async function GET() {
  const runtime = await getCampaignRuntime();
  const roomUrl = runtime.collaborationRoomUrl();
  return NextResponse.json({ ...(roomUrl ? { roomUrl } : {}), tasks: runtime.bandTasks() });
}

export async function POST() {
  const runtime = await getCampaignRuntime();
  const [handoffs, tasks] = await Promise.all([runtime.retryCollaboration(), runtime.retryBandTasks()]);
  return NextResponse.json({ retried: handoffs.length + tasks.length, handoffs: handoffs.length, tasks: tasks.length });
}
