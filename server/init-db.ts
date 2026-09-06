/**
 * Creates / migrates the local SQLite file at data/onlineshare.db
 * Run: npx tsx server/init-db.ts
 */
import { db, getDbPath } from "./db.js";

const row = db.prepare("SELECT COUNT(*) AS n FROM shares").get() as { n: number };
console.log(`SQLite ready at: ${getDbPath()}`);
console.log(`Shares in database: ${row.n}`);
db.close();
