import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveCampaignArchivePath } from "@/src/package-download";
import { getCampaignRuntime } from "@/src/runtime";

export async function GET() {
  const snapshot = (await getCampaignRuntime()).snapshot();
  const archivePath = snapshot.packageManifest?.archivePath;
  if (snapshot.status !== "completed" || !archivePath) {
    return NextResponse.json({ error: "Campaign package is not ready" }, { status: 409 });
  }
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
