"use client";
import { useState } from "react";
import type { MediaType, SegmentView } from "@/lib/domain/types";
import { Heatmap } from "./Heatmap";
import { StructureEditor } from "./studio/StructureEditor";

/** Episodes on a show's page: the rating grid, with its seasons editable right here. */
export function EpisodesSection({ mediaId, type, version: v0, initial, initialSegment }: { mediaId: number; type: MediaType; version: number; initial: SegmentView[]; initialSegment: number | null }) {
  const [segments, setSegments] = useState(initial);
  const [version, setVersion] = useState(v0);
  const [editing, setEditing] = useState(initial.length === 0);
  // A structure save replaces the grid with the server's copy, so remount it.
  const [gridKey, setGridKey] = useState(0);

  return (
    <section className="panel" aria-labelledby="eps-h">
      <div className="episodes-head">
        <h2 id="eps-h">Episodes</h2>
        <button type="button" className="btn small" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done editing seasons" : "Edit seasons"}
        </button>
      </div>
      {editing && (
        <StructureEditor
          mediaId={mediaId}
          type={type}
          segments={segments}
          version={version}
          onChange={(segs, v) => {
            setSegments(segs);
            if (v != null) setVersion(v);
            setGridKey((k) => k + 1);
          }}
          onDirty={() => {}}
        />
      )}
      <p className="hint">Your overall rating above is set by you. The episode average below is calculated and shown separately.</p>
      <Heatmap key={gridKey} mediaId={mediaId} initial={segments} initialSegment={initialSegment} onSegments={setSegments} />
    </section>
  );
}
