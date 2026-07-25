import { describe, expect, it } from 'vitest';
import { createLimitWatcher } from '../src/daemon/limit-watcher.js';
import type { DetectionResult } from '../src/adapters/types.js';
import type { Tool } from '../src/shared/types.js';

function makeCounter(tool: Tool, now?: () => number) {
  let calls = 0;
  let suppressed = 0;
  let lastResult: DetectionResult | undefined;
  const watcher = createLimitWatcher({
    tool,
    now,
    onLimit: (result) => {
      calls += 1;
      lastResult = result;
    },
    onOutputSuppressed: () => {
      suppressed += 1;
    },
  });
  return {
    watcher,
    getCalls: () => calls,
    getSuppressed: () => suppressed,
    getLastResult: () => lastResult,
  };
}

describe('createLimitWatcher — feedOutput', () => {
  it('CC limit line with trailing newline fires onLimit once', () => {
    const { watcher, getCalls, getLastResult } = makeCounter('claude');
    watcher.feedOutput("You've hit your session limit · resets 7:30am (Asia/Jakarta)\n");
    expect(getCalls()).toBe(1);
    expect(getLastResult()?.kind).toBe('limit');
    expect(getLastResult()?.evidence).toBeDefined();
  });

  it('agy real quota-reached message fires onLimit once', () => {
    const { watcher, getCalls, getLastResult } = makeCounter('antigravity');
    watcher.feedOutput(
      '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 59m14s.\n',
    );
    expect(getCalls()).toBe(1);
    expect(getLastResult()?.kind).toBe('limit');
  });

  it('chunk split across a line only fires after the newline completes it', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("You've hit your ");
    expect(getCalls()).toBe(0);
    watcher.feedOutput('session limit\n');
    expect(getCalls()).toBe(1);
  });

  it('no newline yet → not fired; newline arrives later → fired', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("You've hit your session limit");
    expect(getCalls()).toBe(0);
    watcher.feedOutput('\n');
    expect(getCalls()).toBe(1);
  });

  it('ANSI-wrapped limit line still fires (proves ANSI stripping)', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("\x1b[31mYou've hit your session limit\x1b[0m\n");
    expect(getCalls()).toBe(1);
  });

  it('overload line does NOT fire onLimit', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('API Error: 529\n');
    expect(getCalls()).toBe(0);
  });

  it('benign noise line does NOT fire onLimit', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('Compiling project... done\n');
    expect(getCalls()).toBe(0);
  });

  it('two limit lines in one chunk → onLimit fires exactly once (latch)', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('usage limit reached\nusage limit reached\n');
    expect(getCalls()).toBe(1);
  });
});

describe('createLimitWatcher — unlatch (R3/I-21: deteksi siklus limit >1× per sesi hidup)', () => {
  it('setelah onLimit fire + latched, unlatch() membuka deteksi siklus limit BERIKUTNYA (CC output, >grace)', () => {
    // I-31: siklus-2 CC via OUTPUT hanya terdeteksi SETELAH grace-window pasca-unlatch (genuine cycle-2
    // selalu jauh kemudian; re-fire DALAM window = repaint FP, diuji terpisah di bawah). Clock manual.
    const clock = { t: 1_000_000 };
    const { watcher, getCalls } = makeCounter('claude', () => clock.t);
    watcher.feedOutput('usage limit reached\n');
    expect(getCalls()).toBe(1);
    watcher.feedOutput('usage limit reached\n'); // masih latched → diabaikan
    expect(getCalls()).toBe(1);

    watcher.unlatch(); // auto-continue berhasil di-inject → siap deteksi siklus berikutnya
    clock.t += 120_000; // majukan melewati grace-window OUTPUT-CC (genuine cycle-2 = jauh kemudian)
    watcher.feedOutput('usage limit reached\n');
    expect(getCalls()).toBe(2); // siklus limit KEDUA terdeteksi (bukan lagi one-shot)
  });

  it('I-31: repaint banner limit LAMA CC via OUTPUT dalam grace-window pasca-unlatch → DISUPPRESS (bukan LIMIT_HIT palsu)', () => {
    // G-37 terkonfirmasi live 16 Jul: pasca inject-continue (unlatch), TUI CC me-repaint banner limit lama
    // ber-`\n` → tanpa guard diklasifikasi ulang sbg limit BARU. Grace-window OUTPUT-CC menolaknya.
    const clock = { t: 5_000_000 };
    const { watcher, getCalls, getSuppressed } = makeCounter('claude', () => clock.t);
    watcher.feedOutput("You've hit your session limit · resets 10:20pm\n");
    expect(getCalls()).toBe(1);

    watcher.unlatch(); // inject sukses → sesi kembali RUNNING
    clock.t += 500; // repaint banner terjadi ~seketika (detik yang sama, live)
    watcher.feedOutput("You've hit your session limit · resets 10:20pm\n"); // banner LAMA di-repaint
    expect(getCalls()).toBe(1); // TAK re-fire → tak ada LIMIT_HIT palsu
    expect(getSuppressed()).toBe(1); // audit-only

    // Setelah window lewat, sinyal limit SAH via output tetap bisa fire (genuine cycle berikutnya).
    clock.t += 120_000;
    watcher.feedOutput('usage limit reached\n');
    expect(getCalls()).toBe(2);
  });

  it('I-31: grace-window OUTPUT-CC TAK menyuppress jalur feedSignal (hook StopFailure = PRIMER, authoritative)', () => {
    // Re-limit CC SAH datang lewat hook StopFailure, bukan output → tak boleh kena grace-window.
    const clock = { t: 2_000_000 };
    const { watcher, getCalls, getSuppressed } = makeCounter('claude', () => clock.t);
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);

    watcher.unlatch();
    clock.t += 100; // masih DALAM grace-window
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' }); // hook → tak disuppress
    expect(getCalls()).toBe(2);
    expect(getSuppressed()).toBe(0);
  });

  it('I-31: agy TAK terkena grace-window → re-limit output langsung (ADR-019 optimistic) tetap fire', () => {
    // agy tak punya hook; deteksi = output. Grace-window CC-only → agy immediate re-detect ADR-019 utuh.
    const clock = { t: 3_000_000 };
    const { watcher, getCalls, getSuppressed } = makeCounter('antigravity', () => clock.t);
    watcher.feedOutput('⚠ Individual quota reached. Resets in 59m14s.\n');
    expect(getCalls()).toBe(1);

    watcher.unlatch();
    clock.t += 100; // dalam window seandainya berlaku — tapi agy dikecualikan
    watcher.feedOutput('⚠ Individual quota reached. Resets in 59m14s.\n');
    expect(getCalls()).toBe(2); // agy re-limit langsung terdeteksi (bukan disuppress)
    expect(getSuppressed()).toBe(0);
  });

  it('unlatch juga membuka jalur feedSignal (StopFailure) untuk siklus berikutnya', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
    watcher.unlatch();
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(2);
  });

  it('unlatch me-reset buffer → sisa baris parsial limit lama tak langsung re-fire', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('usage limit reached\n');
    expect(getCalls()).toBe(1);
    // baris limit lama tersisa di buffer TANPA newline (belum ter-classify)
    watcher.feedOutput('...tail usage limit reached tanpa newline');
    watcher.unlatch(); // buffer di-reset
    // newline yang datang kemudian TIDAK melengkapi baris limit lama (sudah dibuang) → tak fire
    watcher.feedOutput('\n');
    expect(getCalls()).toBe(1);
  });
});

describe('createLimitWatcher — feedSignal', () => {
  it('stopfailure rate_limit fires once; a second rate_limit signal does not fire again', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
  });

  it('stopfailure overloaded on a fresh watcher does not fire', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedSignal({ type: 'stopfailure', error: 'overloaded' });
    expect(getCalls()).toBe(0);
  });
});

// I-35 (insiden live 17 Jul): korroborasi sinyal limit OUTPUT terhadap snapshot usage.
// Konteks: sesi `z36i` kena 2 LIMIT_HIT palsu dalam 8 menit — sekali dari query pencarian agent
// yang memuat frasa kanonik, sekali dari teks notifikasi acca SENDIRI yang di-paste owner. Window
// mengikat saat itu 0.55; limit ASLI terukur >=0.94 (T-6). Ambang 0.85 (keputusan owner Ziffan).
describe('createLimitWatcher — korroborasi usage (I-35)', () => {
  const CC_LIMIT_LINE = "You've hit your session limit · resets 7:30am (Asia/Jakarta)\n";
  const AGY_LIMIT_LINE = '⚠ Individual quota reached. Resets in 59m14s.\n';
  const NOW = 1_700_000_000_000;

  function makeCorroborated(opts: {
    tool?: Tool;
    maxBindingUsedFraction?: number;
    /** umur snapshot dalam ms (default: segar). */
    ageMs?: number;
    /** true = `usageSnapshot` mengembalikan null (tak tahu). */
    unknown?: boolean;
  }) {
    let calls = 0;
    let contradictions = 0;
    let fraction = opts.maxBindingUsedFraction ?? 0.55;
    const watcher = createLimitWatcher({
      tool: opts.tool ?? 'claude',
      now: () => NOW,
      onLimit: () => {
        calls += 1;
      },
      usageSnapshot: () =>
        opts.unknown === true
          ? null
          : { capturedAt: NOW - (opts.ageMs ?? 30_000), maxBindingUsedFraction: fraction },
      onUsageContradiction: () => {
        contradictions += 1;
      },
    });
    return {
      watcher,
      getCalls: () => calls,
      getContradictions: () => contradictions,
      setFraction: (f: number) => {
        fraction = f;
      },
    };
  }

  it('snapshot SEGAR yang membantah (0.55 < 0.85) → TAK melatch + audit kontradiksi', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.55 });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(0);
    expect(c.getContradictions()).toBe(1);
  });

  it('limit ASLI (0.94, T-6) tetap melatch — korroborasi tak menelan limit sungguhan', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.94 });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(1);
    expect(c.getContradictions()).toBe(0);
  });

  it('tepat DI ambang (0.85) melatch — suppress hanya bila BENAR-BENAR di bawah', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.85 });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(1);
  });

  it('snapshot BASI (>5 menit) tak boleh membantah — daemon mati = korroborasi mati, latch spt pra-I-35', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.1, ageMs: 5 * 60_000 + 1 });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(1);
    expect(c.getContradictions()).toBe(0);
  });

  it('snapshot tak diketahui (null) → latch (ragu tak pernah berarti "tak limit")', () => {
    const c = makeCorroborated({ unknown: true });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(1);
  });

  it('hook StopFailure = PRIMER (ADR-001) → BYPASS korroborasi walau snapshot membantah', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.02 });
    c.watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(c.getCalls()).toBe(1);
    expect(c.getContradictions()).toBe(0);
  });

  it('agy TAK disuppress (nol hook + snapshot LS stale in-sesi, G-35) → latch', () => {
    const c = makeCorroborated({ tool: 'antigravity', maxBindingUsedFraction: 0.02 });
    c.watcher.feedOutput(AGY_LIMIT_LINE);
    expect(c.getCalls()).toBe(1);
    expect(c.getContradictions()).toBe(0);
  });

  it('JARING FALSE-NEGATIVE: suppress TAK membuang sinyal — begitu snapshot menyusul, repaint (G-37) melatch', () => {
    const c = makeCorroborated({ maxBindingUsedFraction: 0.55 });
    c.watcher.feedOutput(CC_LIMIT_LINE);
    expect(c.getCalls()).toBe(0); // snapshot masih tertinggal → ditahan
    c.setFraction(1.0); // usage-monitor menyusul: ternyata limitnya ASLI
    c.watcher.feedOutput(CC_LIMIT_LINE); // CC me-repaint bannernya (G-37, terbukti live)
    expect(c.getCalls()).toBe(1); // → latch. Tak ada limit asli yang hilang.
  });
});
