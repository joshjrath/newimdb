/** Save status line shared by the Studio forms. */
export function SaveState({ error, saving, dirty, dirtyText = "Unsaved changes", savedText = "All changes saved" }: { error: string | null; saving: boolean; dirty: boolean; dirtyText?: string; savedText?: string }) {
  return (
    <span className={`save-state push-right${error ? " err" : dirty ? " dirty" : ""}`} role="status">
      {error ?? (saving ? "Saving…" : dirty ? dirtyText : savedText)}
    </span>
  );
}
