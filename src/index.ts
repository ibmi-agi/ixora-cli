import { createProgram } from "./cli.js";
import { error } from "./lib/ui.js";

const program = createProgram();

/**
 * @inquirer/prompts throws ExitPromptError on Ctrl+C and AbortPromptError
 * when an AbortController bound to a prompt fires (we use this for Esc in
 * the component picker). Both are user-initiated cancellation — exit
 * silently with the conventional SIGINT code (130) so the shell prompt
 * comes back clean instead of with a confusing "User force closed the
 * prompt with 0 null" stack.
 */
function isUserCancellation(err: unknown): boolean {
  if (err === null || typeof err !== "object" || !("name" in err)) {
    return false;
  }
  const name = (err as { name?: unknown }).name;
  return name === "ExitPromptError" || name === "AbortPromptError";
}

process.on("unhandledRejection", (err) => {
  if (isUserCancellation(err)) process.exit(130);
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

program.parseAsync().catch((err) => {
  if (isUserCancellation(err)) process.exit(130);
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
