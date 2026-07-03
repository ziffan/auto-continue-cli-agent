import { antigravityAdapter } from './antigravity.js';
import { claudeAdapter } from './claude.js';
import type { Adapter } from './types.js';
import type { Tool } from '../shared/types.js';

export const adapters: Record<Tool, Adapter> = {
  claude: claudeAdapter,
  antigravity: antigravityAdapter,
};

/** Dilempar saat nama tool dari CLI tak dikenali (mis. `acca run -- foo`). */
export class UnknownToolError extends Error {
  constructor(public readonly input: string) {
    super(`Tool tidak dikenal: "${input}". Gunakan "claude" atau "antigravity"/"agy".`);
    this.name = 'UnknownToolError';
  }
}

/** Resolusi nama tool dari argumen CLI ke Adapter. `claude`→claude; `agy`|`antigravity`→antigravity. */
export function resolveAdapter(name: string): Adapter {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'claude') return adapters.claude;
  if (normalized === 'agy' || normalized === 'antigravity') return adapters.antigravity;
  throw new UnknownToolError(name);
}
