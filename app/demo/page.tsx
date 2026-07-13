import type { Metadata } from "next";
import { DemoLaunchpad } from "@/components/demo-launchpad";
import { readLocalPreflightReport } from "@/src/preflight-report";
import { getCampaignPresentationData } from "@/src/runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demo Launchpad",
  description: "A read-only presentation control surface for persisted LaunchReel Campaign evidence.",
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "fixture" ? "fixture" : undefined;
  const [data, preflight] = await Promise.all([
    getCampaignPresentationData(mode),
    readLocalPreflightReport(),
  ]);
  return <DemoLaunchpad data={data} preflight={preflight} />;
}
