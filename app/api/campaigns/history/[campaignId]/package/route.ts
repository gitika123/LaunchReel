import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveCampaignArchivePath } from "@/src/package-download";
import { getCampaignRuntime } from "@/src/runtime";

interface CampaignPackageRouteContext {
  params: Promise<{ campaignId: string }>;
}

export async function GET(_request: Request, context: CampaignPackageRouteContext) {
  const { campaignId } = await context.params;
  let snapshot;
  try {
    snapshot = await (await getCampaignRuntime()).completedCampaign(campaignId);
  } catch {
    return NextResponse.json({ error: "Campaign package path is invalid" }, { status: 400 });
  }
  const archivePath = snapshot?.packageManifest?.archivePath;
  if (!snapshot || snapshot.status !== "completed" || !archivePath) return NextResponse.json({ error: "Campaign package is not ready" }, { status: 404 });
  const absolutePath = resolveCampaignArchivePath(archivePath);
  if (!absolutePath) return NextResponse.json({ error: "Campaign package path is invalid" }, { status: 400 });
  try {
    const archive = await readFile(absolutePath);
    return new NextResponse(archive, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="launchreel-${snapshot.id}.zip"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Campaign package file is unavailable" }, { status: 404 });
  }
}
