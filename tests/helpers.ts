import { openDatabase, setDbForTests } from "@/lib/db";

export function freshDb() {
  const db = openDatabase(":memory:");
  setDbForTests(db);
  return db;
}
