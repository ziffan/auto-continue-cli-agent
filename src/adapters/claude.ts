import type { Adapter, SpawnSpec } from './types.js';

export const claudeAdapter: Adapter = {
  tool: 'claude',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'claude', args };
  },
};
