import { z } from "zod";
import { ownerApi, readJson } from "@/lib/guard";
import { createBoard, listBoards } from "@/lib/repo/boards";

const body = z.object({ name: z.string().trim().min(1).max(80), source: z.enum(["list", "genre", "kind", "any"]), sourceRef: z.string().max(40).nullable().optional(), mode: z.enum(["top", "tiers"]).optional() }).strict();

export const GET = ownerApi(async () => ({ boards: listBoards() }));

/** A ranking of your own, drawing from a list, a genre, a kind, or anything you add. */
export const POST = ownerApi(async (req) => ({ id: createBoard(await readJson(req, body)), boards: listBoards() }));
