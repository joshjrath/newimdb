import { MEDIA_TYPES, STATUS_LABEL, typePluralLabel, WATCH_STATUSES } from "@/lib/domain/types";

/** <option>s for every watch status. */
export function StatusOptions() {
  return WATCH_STATUSES.map((s) => (
    <option key={s} value={s}>
      {STATUS_LABEL[s]}
    </option>
  ));
}

/** <option>s for Movies / TV Shows / Anime. */
export function TypeOptions() {
  return MEDIA_TYPES.map((t) => (
    <option key={t} value={t}>
      {typePluralLabel(t)}
    </option>
  ));
}
