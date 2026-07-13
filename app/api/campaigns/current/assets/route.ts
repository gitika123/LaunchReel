import { NextResponse } from "next/server";
import { MAX_REPLACEMENT_IMAGE_BYTES } from "@/src/ingestion";
import { getCampaignAssetStore, getCampaignRuntime } from "@/src/runtime";
import { validateImageUpload } from "@/src/source-assets";

export const runtime = "nodejs";

const MAX_MULTIPART_BYTES = MAX_REPLACEMENT_IMAGE_BYTES + 1024 * 1024;

class UploadTooLargeError extends Error {}

const readBoundedFormData = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new Error("Replacement image must use multipart form data");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Replacement image upload body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new UploadTooLargeError("Upload exceeds the 10MB replacement image limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, { headers: { "content-type": contentType } }).formData();
};

export async function GET(request: Request) {
  try {
    const campaign = await getCampaignRuntime();
    const snapshot = campaign.snapshot();
    const assetId = new URL(request.url).searchParams.get("assetId");
    const asset = snapshot.uploadedAssets.find(({ id }) => id === assetId);
    if (!asset) return NextResponse.json({ error: "Uploaded Campaign asset was not found" }, { status: 404 });
    const bytes = await getCampaignAssetStore().read(snapshot.id, asset);
    return new Response(bytes, {
      headers: {
        "content-type": asset.mediaType!,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Campaign asset could not be read" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
      return NextResponse.json({ error: "Upload exceeds the 10MB replacement image limit" }, { status: 413 });
    }
    const form = await readBoundedFormData(request);
    if ([...form.keys()].some((key) => key !== "file")) throw new Error("Only an uploaded image file is accepted");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Replacement image must be an uploaded file, not a remote URL");
    if (file.size > MAX_REPLACEMENT_IMAGE_BYTES) {
      return NextResponse.json({ error: `${file.name} exceeds the 10MB replacement image limit` }, { status: 413 });
    }
    const upload = validateImageUpload({
      kind: "upload",
      name: file.name,
      mediaType: file.type || undefined,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    const campaign = await getCampaignRuntime();
    const asset = await getCampaignAssetStore().store(campaign.snapshot().id, upload);
    return NextResponse.json(await campaign.registerUploadedAsset(asset), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid replacement image" },
      { status: error instanceof UploadTooLargeError ? 413 : 400 },
    );
  }
}
