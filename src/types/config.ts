import { z } from "zod";
import { MODEL_IDS } from "@/lib/core/catalog";

export const ModelIdSchema = z.enum(MODEL_IDS);

export const SideSchema = z.object({ label: z.string().trim().min(1).max(60) });

export const DebateConfigSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  sideA: SideSchema,
  sideB: SideSchema,
  debaterModel: ModelIdSchema,
  moderatorModel: ModelIdSchema,
});
export type DebateConfig = z.infer<typeof DebateConfigSchema>;
