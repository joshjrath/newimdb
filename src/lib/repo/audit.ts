import { nowIso, type DB } from "../db";

export function audit(db: DB, action: string, entity: string, entityId: number | string | null, detail?: unknown) {
  db.prepare(`INSERT INTO audit_event (at, action, entity, entity_id, detail) VALUES (?,?,?,?,?)`).run(
    nowIso(),
    action,
    entity,
    entityId == null ? null : String(entityId),
    detail === undefined ? null : JSON.stringify(detail).slice(0, 4000),
  );
}
