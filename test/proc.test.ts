import { describe, expect, it } from 'vitest';
import { isProcessAlive } from '../src/shared/proc.js';

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent pid', () => {
    // PID sangat besar yang praktis mustahil ada → ESRCH → false.
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });
});
