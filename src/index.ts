import { createProgram } from "./cli.js";
import { error } from "./lib/ui.js";

const program = createProgram();

// Handle unhandled rejections gracefully
process.on("unhandledRejection", (err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

program.parseAsync().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
