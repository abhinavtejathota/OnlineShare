import "dotenv/config";
import { getDbLabel, initDb, pool } from "./db.js";

await initDb();
const count = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM shares");
console.log(`Postgres ready → ${getDbLabel()}`);
console.log(`Shares in database: ${count.rows[0]?.n ?? 0}`);
await pool.end();
