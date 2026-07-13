import { join, resolve } from "node:path";

export interface QaCliOptions {
  archivePath: string;
  snapshotPath?: string;
  outputDirectory: string;
}

export const parseQaArgs = (argv: string[]): QaCliOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") continue;
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`${flag ?? "Argument"} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const allowed = new Set(["--archive", "--snapshot", "--output-dir"]);
  const unknown = [...values.keys()].find((value) => !allowed.has(value));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  const archivePath = values.get("--archive");
  if (!archivePath) throw new Error("--archive is required");
  return {
    archivePath: resolve(archivePath),
    snapshotPath: values.get("--snapshot"),
    outputDirectory: resolve(values.get("--output-dir") ?? join("output", "campaign-qa", "standalone")),
  };
};
