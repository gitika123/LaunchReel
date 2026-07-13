import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { validateReplacementImages, type ValidatedReplacementImage } from "./ingestion";

export const assetProvenanceSchema = z.enum(["source", "uploaded", "generated", "cached", "fixture"]);
export const visualContentRoleSchema = z.enum(["hero", "decorative", "logo", "price", "product_ui", "factual_typography"]);

export const campaignAssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  name: z.string().trim().min(1).max(255),
  provenance: assetProvenanceSchema,
  uri: z.string().min(1),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  sourcePageUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  contentRole: visualContentRoleSchema.optional(),
}).strict().superRefine((asset, context) => {
  if (asset.provenance === "source" && (!asset.sourcePageUrl || !asset.sourceUrl)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Source assets require page and asset attribution" });
  }
  if (asset.provenance === "uploaded" && (!asset.fileName || !asset.mediaType || !asset.sizeBytes)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Uploaded assets require validated file metadata" });
  }
});

export type AssetProvenance = z.infer<typeof assetProvenanceSchema>;
export type CampaignAsset = z.infer<typeof campaignAssetSchema>;
export type VisualContentRole = z.infer<typeof visualContentRoleSchema>;

const extensions = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const safeSegment = (value: string, label: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error(`${label} contains unsafe path characters`);
  return value;
};

const containedPath = (root: string, ...segments: string[]) => {
  const path = resolve(root, ...segments);
  const relation = relative(resolve(root), path);
  if (relation.startsWith("..") || relation === "" || relation.split(sep).includes("..")) throw new Error("Asset path must remain inside campaign storage");
  return path;
};

export interface CampaignAssetStore {
  store(campaignId: string, upload: ValidatedReplacementImage): Promise<CampaignAsset>;
  read(campaignId: string, asset: CampaignAsset): Promise<Uint8Array>;
}

export class LocalCampaignAssetStore implements CampaignAssetStore {
  constructor(private readonly rootDirectory: string) {}

  async store(campaignId: string, upload: ValidatedReplacementImage) {
    const campaign = safeSegment(campaignId, "Campaign ID");
    const id = `upload-${randomUUID()}`;
    const path = containedPath(this.rootDirectory, campaign, `${id}.${extensions[upload.mediaType]}`);
    await mkdir(resolve(this.rootDirectory, campaign), { recursive: true });
    await writeFile(path, upload.bytes, { flag: "wx" });
    return campaignAssetSchema.parse({
      id,
      name: basename(upload.name),
      provenance: "uploaded",
      uri: `/api/campaigns/current/assets?assetId=${encodeURIComponent(id)}`,
      mediaType: upload.mediaType,
      sizeBytes: upload.sizeBytes,
      fileName: basename(upload.name),
    });
  }

  async read(campaignId: string, asset: CampaignAsset) {
    const campaign = safeSegment(campaignId, "Campaign ID");
    const validated = campaignAssetSchema.parse(asset);
    if (validated.provenance !== "uploaded" || !validated.mediaType) throw new Error("Only validated uploaded assets are stored locally");
    const id = safeSegment(validated.id, "Asset ID");
    const path = containedPath(this.rootDirectory, campaign, `${id}.${extensions[validated.mediaType]}`);
    return new Uint8Array(await readFile(path));
  }
}

export const validateImageUpload = (value: unknown) => validateReplacementImages([value])[0]!;

const exactContentRoles = new Set<VisualContentRole>(["logo", "price", "product_ui", "factual_typography"]);

export const assertAssetCanFillScene = (asset: Pick<CampaignAsset, "provenance"> & { contentRole?: VisualContentRole }, contentRole?: VisualContentRole) => {
  if (asset.provenance !== "generated") return;
  const role = contentRole ?? asset.contentRole;
  if (!role) throw new Error("Generated assets require an explicit hero or decorative content role");
  if (exactContentRoles.has(role)) throw new Error(`Generated assets cannot replace exact ${role.replace("_", " ")} content`);
};
