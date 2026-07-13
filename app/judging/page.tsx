import type { Metadata } from "next";
import { ProductionStudio } from "@/components/production-studio";

export const metadata: Metadata = {
  title: "Production Proof",
  description: "A completed LaunchReel Campaign production record for judging.",
};

export default function JudgingPage() {
  return <ProductionStudio judging />;
}
