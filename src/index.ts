import { startServer } from "./server.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("[fatal] Unhandled rejection:", err);
});

console.log("Starting Walkie-Talkie...");
startServer().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
