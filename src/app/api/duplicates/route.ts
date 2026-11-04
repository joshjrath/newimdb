import { ownerApi } from "@/lib/guard";
import { findDuplicates, mergeDuplicates } from "@/lib/repo/duplicates";

/** Titles that are in the library more than once. */
export const GET = ownerApi(async () => ({ groups: findDuplicates() }));

/** Merge them (Letterboxd's copy wins). A backup is saved first. */
export const POST = ownerApi(async () => ({ result: mergeDuplicates(), groups: findDuplicates() }));
