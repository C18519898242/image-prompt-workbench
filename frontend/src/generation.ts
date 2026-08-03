import type { GenerationHistoryItem, PromptCard } from "./api";

export type AspectRatio =
  | "Auto"
  | "1:1"
  | "9:16"
  | "16:9"
  | "3:4"
  | "4:3"
  | "3:2"
  | "2:3"
  | "5:4"
  | "4:5"
  | "21:9"
  | "4:1"
  | "1:4"
  | "8:1"
  | "1:8";

export type GenerationSubmission = {
  card: PromptCard;
  prompt: string;
  model: "Nano Banana 2";
  aspectRatio: AspectRatio;
  resolution: "1K" | "2K";
  quantity: 1 | 2 | 4;
  thinkingLevel: "minimal" | "high";
  referenceImages: File[];
};

export type SessionGenerationCard = {
  clientId: string;
  batchId: number;
  status: "loading" | "failed" | "completed";
  promptCardId: number;
  title: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  createdAtMs: number;
  sequence: number;
  history?: GenerationHistoryItem;
};
