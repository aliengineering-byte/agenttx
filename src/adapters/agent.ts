import { basename } from "node:path";
import type { AgentCapabilities, CommandSpec } from "../core/types.js";

export interface AgentAdapter {
  readonly id: string;
  detect(command: string): boolean;
  command(command: string, args: string[]): CommandSpec;
  capabilities(): AgentCapabilities;
}

class GenericAdapter implements AgentAdapter {
  readonly id: string = "generic";

  detect(_command: string): boolean {
    return true;
  }

  command(command: string, args: string[]): CommandSpec {
    return { command, args };
  }

  capabilities(): AgentCapabilities {
    return { structuredEvents: false, commandObservation: "path-shim" };
  }
}

class NamedAdapter extends GenericAdapter {
  override readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
  }

  override detect(command: string): boolean {
    const name = basename(command).replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase();
    return name === this.id;
  }
}

const adapters: AgentAdapter[] = [
  new NamedAdapter("claude"),
  new NamedAdapter("codex"),
  new NamedAdapter("gemini"),
  new NamedAdapter("opencode")
];
const generic = new GenericAdapter();

export function resolveAdapter(command: string): AgentAdapter {
  return adapters.find((adapter) => adapter.detect(command)) ?? generic;
}

export { GenericAdapter };
