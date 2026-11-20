import { z } from "zod";

export type Seat = "mod" | "a" | "b";
export type Debater = "a" | "b";

export const FactCheckStatusSchema = z.enum(["clean", "unsupported", "wrong", "fake"]);
export type FactCheckStatus = z.infer<typeof FactCheckStatusSchema>;

/** Who a deciding question currently favours. */
export const FavoursSchema = z.enum(["a", "b", "open"]);
export type Favours = z.infer<typeof FavoursSchema>;
