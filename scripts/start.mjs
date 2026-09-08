import { config } from "dotenv";
config();
process.env.NODE_ENV = "production";
await import("../dist/server/index.js");
