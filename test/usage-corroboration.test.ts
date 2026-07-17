// I-35: validasi pembaca snapshot usage untuk korroborasi sinyal limit OUTPUT.
// KENAPA fungsi ini diuji terpisah & agak paranoid: arah kegagalannya ASIMETRIS. Bug yang membuatnya
// mengembalikan angka RENDAH dari data rusak → engine men-suppress limit ASLI → sesi menggantung
// selamanya tanpa error (false-negative = kegagalan inti produk). Sedangkan `null` cuma berarti
// "tak tahu" → latch spt pra-I-35 (aman). Jadi setiap jalur cacat WAJIB berakhir di `null`.

import { describe, expect, it } from 'vitest';
import { readUsageCorroboration } from '../src/daemon/process-wrapper.js';

/** Bentuk NYATA `meta.usage_snapshot_claude` saat FP live 17 Jul (sesi z36i). */
const REAL_SNAPSHOT = JSON.stringify({
  tool: 'claude',
  capturedAt: 1784280152486,
  limits: [
    { kind: 'session', usedFraction: 0.55, resetAt: 1784289000122, isActive: true },
    { kind: 'weekly_all', usedFraction: 0.39, resetAt: 1784437200122, isActive: false },
    { kind: 'weekly_scoped', usedFraction: 0, resetAt: null, scope: 'Fable', isActive: false },
  ],
});

const reader = (json: string | undefined) => () => json;

describe('readUsageCorroboration (I-35)', () => {
  it('membaca snapshot NYATA (bentuk saat FP live 17 Jul) → 0.55 @ capturedAt asli', () => {
    const result = readUsageCorroboration('claude', reader(REAL_SNAPSHOT));
    expect(result).not.toBeNull();
    expect(result?.maxBindingUsedFraction).toBeCloseTo(0.55);
    expect(result?.capturedAt).toBe(1784280152486);
  });

  it('agy → null: semantik window-mengikat CC salah arti untuk agy (G-31), tolak STRUKTURAL', () => {
    expect(readUsageCorroboration('antigravity', reader(REAL_SNAPSHOT))).toBeNull();
  });

  it('dep tak di-wire → null (fitur mati ke sisi AMAN, bukan ke sisi salah)', () => {
    expect(readUsageCorroboration('claude', undefined)).toBeNull();
  });

  it('snapshot belum pernah ditulis → null', () => {
    expect(readUsageCorroboration('claude', reader(undefined))).toBeNull();
  });

  it('JSON rusak → null, TAK melempar (wrapper tak boleh mati gara-gara meta korup)', () => {
    expect(readUsageCorroboration('claude', reader('{tidak-json'))).toBeNull();
    expect(readUsageCorroboration('claude', reader(''))).toBeNull();
    expect(readUsageCorroboration('claude', reader('null'))).toBeNull();
    expect(readUsageCorroboration('claude', reader('[]'))).toBeNull();
    expect(readUsageCorroboration('claude', reader('"string"'))).toBeNull();
  });

  it('capturedAt hilang/bukan angka/NaN → null (kesegaran tak terhitung = tak boleh membantah)', () => {
    const noTs = JSON.stringify({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 0.1 }] });
    expect(readUsageCorroboration('claude', reader(noTs))).toBeNull();
    const badTs = JSON.stringify({ capturedAt: 'kemarin', limits: [{ kind: 'session', usedFraction: 0.1 }] });
    expect(readUsageCorroboration('claude', reader(badTs))).toBeNull();
  });

  it('limits hilang/kosong/bukan array → null', () => {
    expect(readUsageCorroboration('claude', reader(JSON.stringify({ capturedAt: 1 })))).toBeNull();
    expect(readUsageCorroboration('claude', reader(JSON.stringify({ capturedAt: 1, limits: [] })))).toBeNull();
    expect(readUsageCorroboration('claude', reader(JSON.stringify({ capturedAt: 1, limits: {} })))).toBeNull();
  });

  it('SATU entri cacat membatalkan SELURUH snapshot → null (jangan diam-diam pakai sisanya)', () => {
    // Kalau entri rusak dibuang lalu sisanya dipakai, angka bisa jadi terlalu RENDAH → suppress
    // limit asli. Tolak seluruhnya: lebih baik "tak tahu" daripada angka yang salah ke arah bahaya.
    const partial = JSON.stringify({
      capturedAt: 1784280152486,
      limits: [
        { kind: 'session', usedFraction: 0.99 },
        { kind: 'weekly_all', usedFraction: 'entah' },
      ],
    });
    expect(readUsageCorroboration('claude', reader(partial))).toBeNull();
  });

  it('usedFraction NaN/Infinity → null (Math.max akan menular & merusak perbandingan ambang)', () => {
    const nan = JSON.stringify({ capturedAt: 1, limits: [{ kind: 'session', usedFraction: null }] });
    expect(readUsageCorroboration('claude', reader(nan))).toBeNull();
  });

  it('scope/isActive dihormati — scoped non-aktif yang habis tak mengerek angka (konsisten I-25)', () => {
    const scoped = JSON.stringify({
      capturedAt: 1784280152486,
      limits: [
        { kind: 'session', usedFraction: 0.2 },
        { kind: 'weekly_scoped', usedFraction: 1, scope: 'Claude Opus 4.6', isActive: false },
      ],
    });
    expect(readUsageCorroboration('claude', reader(scoped))?.maxBindingUsedFraction).toBeCloseTo(0.2);
  });
});
