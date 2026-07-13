import { NextResponse } from "next/server";
import { getBrowserSafeJudgingPreset } from "@/src/judging-preset";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getBrowserSafeJudgingPreset(), {
    headers: { "Cache-Control": "no-store" },
  });
}
