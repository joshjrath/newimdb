import { Suspense } from "react";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { RankingsBoard, type Target } from "@/components/rankings/RankingsBoard";
import { getRankings } from "@/lib/repo/rankings";
import { getBoard, listBoards } from "@/lib/repo/boards";
import { listLists } from "@/lib/repo/lists";
import { listGenres } from "@/lib/repo/genres";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const metadata = { title: "Rankings" };

export default async function RankingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwnerPage("/rankings");
  const sp = await searchParams;
  const boards = listBoards();
  const boardView = sp.board && boards.some((b) => b.id === Number(sp.board)) ? getBoard(Number(sp.board)) : null;
  const kind = (MEDIA_TYPES as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as MediaType) : "movie";
  const target: Target = boardView ? { board: boardView.board } : { kind };
  const view = boardView ?? getRankings(kind);
  const mode = sp.mode === "tiers" || sp.mode === "top" ? sp.mode : (boardView?.board.mode ?? "top");
  return (
    <Shell active="rankings">
      <header className="page-head">
        <div>
          <h1>Rankings</h1>
          <p className="sub">Your all-time order, your tier lists, and rankings of your own: from a list, a genre, or anything you pick.</p>
        </div>
      </header>
      <Suspense fallback={null}>
        <RankingsBoard
          key={boardView ? `b${boardView.board.id}` : kind}
          initial={view}
          target={target}
          mode={mode}
          boards={boards}
          lists={listLists().map((l) => ({ id: l.id, name: l.name }))}
          genres={listGenres().map((g) => ({ id: g.id, name: g.name }))}
        />
      </Suspense>
    </Shell>
  );
}
