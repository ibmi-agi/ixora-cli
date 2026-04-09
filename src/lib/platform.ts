import { arch } from "node:os";
import { execa } from "execa";

export type ComposeCmd = "docker compose" | "podman compose" | "docker-compose";

export async function detectComposeCmd(
  optRuntime?: string,
): Promise<ComposeCmd> {
  if (optRuntime) {
    switch (optRuntime) {
      case "docker":
        return "docker compose";
      case "podman":
        return "podman compose";
      default:
        throw new Error(
          `Unknown runtime: ${optRuntime} (choose: docker, podman)`,
        );
    }
  }

  // Try docker compose (v2)
  try {
    await execa("docker", ["compose", "version"]);
    return "docker compose";
  } catch {}

  // Try podman compose
  try {
    await execa("podman", ["compose", "version"]);
    return "podman compose";
  } catch {}

  // Try docker-compose (v1)
  try {
    await execa("docker-compose", ["version"]);
    return "docker-compose";
  } catch {}

  throw new Error(
    "Neither 'docker compose', 'podman compose', nor 'docker-compose' found.\nPlease install Docker or Podman first.",
  );
}

export async function verifyRuntimeRunning(
  composeCmd: ComposeCmd,
): Promise<void> {
  const runtime = composeCmd.startsWith("docker") ? "docker" : "podman";
  try {
    await execa(runtime, ["info"]);
  } catch {
    const name = runtime === "docker" ? "Docker Desktop" : "Podman";
    throw new Error(
      `${name} is not running. Please start it and try again.`,
    );
  }
}

export function detectPlatform(): { dbImage?: string } {
  const cpuArch = arch();
  if (cpuArch === "ppc64") {
    return {
      dbImage:
        process.env["IXORA_DB_IMAGE"] ??
        `ghcr.io/ibmi-agi/ixora-db:${process.env["IXORA_VERSION"] ?? "latest"}`,
    };
  }
  return {};
}

export function getComposeParts(cmd: ComposeCmd): [string, string[]] {
  if (cmd === "docker-compose") {
    return ["docker-compose", []];
  }
  const [bin, sub] = cmd.split(" ");
  return [bin, [sub]];
}

export function getRuntimeBin(cmd: ComposeCmd): string {
  return cmd.startsWith("docker") ? "docker" : "podman";
}
