import type { Adapter, SpawnSpec } from './types.js';

export const antigravityAdapter: Adapter = {
  tool: 'antigravity',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'agy', args };
  },
};
