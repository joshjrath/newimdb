import { STATUS_LABEL, type WatchStatus } from "@/lib/domain/types";

export function StatusPill({ status }: { status: WatchStatus | null }) {
  if (!status) return null;
  return <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>;
}
