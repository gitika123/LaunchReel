import { join, resolve, sep } from "node:path";

export const resolveCampaignArchivePath = (archivePath: string, rootDirectory = process.cwd()) => {
  const publicDirectory = resolve(rootDirectory, "public");
  const campaignDirectory = join(publicDirectory, "campaigns");
  const absolutePath = archivePath.startsWith("/campaigns/")
    ? join(publicDirectory, archivePath.slice(1))
    : resolve(archivePath);
  return absolutePath === campaignDirectory || absolutePath.startsWith(`${campaignDirectory}${sep}`) ? absolutePath : undefined;
};
