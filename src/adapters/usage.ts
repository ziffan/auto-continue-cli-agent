// Usage Probe — parser murni (M3c). Mengubah respons API usage (CC OAuth/statusLine, agy
// GetUserStatus) jadi `UsageSnapshot` ternormalisasi. TAK ADA jaringan/fs/kredensial di sini —
// itu tanggung jawab jalur probe LIVE (M3d, out of scope slice ini). Input = JSON tak tepercaya
// dari endpoint undocumented/berubah-ubah (RESEARCH §2, §5b) → parsing defensif: field
// hilang/salah-tipe di-skip per-entry, bukan melempar. Hanya bentuk top-level yang bukan objek
// JSON yang dianggap kesalahan pemanggil (`UsageParseError`).

import type { UsageLimit, UsageSnapshot } from '../shared/types.js';

/** Dilempar hanya bila input top-level bukan objek JSON (mis. respons non-JSON/kosong dari
 * jalur probe live). Payload objek yang bentuknya tak dikenali TIDAK melempar ini — endpoint
 * usage tak terdokumentasi & bisa berubah (RESEARCH §2/§5b), jadi bentuk tak dikenal = skip
 * per-field, bukan crash. */
export class UsageParseError extends Error {
  constructor(source: string) {
    super(`UsageParse: payload "${source}" bukan objek JSON di level atas.`);
    this.name = 'UsageParseError';
  }
}

/** Narrowing objek JSON (bukan null, bukan array) — dasar semua akses field defensif di bawah. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** `remainingFraction`/`percent`/`utilization` semuanya "display only" (CONVENTIONS.md) — clamp
 * ke [0,1] supaya nilai sumber yang di luar rentang (bug upstream, endpoint undocumented) tak
 * bocor ke UI/agregasi hilir sebagai fraksi tak masuk akal. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Parse timestamp ISO-8601 (dipakai `api/oauth/usage` & agy `resetTime` — G-4) → epoch ms, atau
 * `null` bila absen/tak valid. TIDAK dipakai untuk statusLine (epoch seconds, ditangani terpisah). */
function parseIso(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `api/oauth/usage` (RESEARCH §2 poin 2). Sumber kebenaran = array `limits[]` (lebih kaya
 * daripada bucket top-level `five_hour`/`seven_day` — punya `severity`/`is_active`/`scope.model`).
 * `resets_at` di sini = **ISO-8601 string** (G-4) — beda dari statusLine.
 */
export function parseClaudeOAuthUsage(raw: unknown, now: number): UsageSnapshot {
  if (!isRecord(raw)) throw new UsageParseError('parseClaudeOAuthUsage');
  const limits: UsageLimit[] = [];
  const limitsArr = raw['limits'];
  if (Array.isArray(limitsArr)) {
    for (const entry of limitsArr) {
      if (!isRecord(entry)) continue;
      const kind = entry['kind'];
      const percent = entry['percent'];
      // Skip entri yang tak punya kind/percent — kontrak: entri malformed di-skip, bukan crash.
      if (typeof kind !== 'string' || !isFiniteNumber(percent)) continue;
      const scopeRaw = entry['scope'];
      let scope: string | undefined;
      if (isRecord(scopeRaw)) {
        const model = scopeRaw['model'];
        if (isRecord(model) && typeof model['display_name'] === 'string') {
          scope = model['display_name'];
        }
      }
      const isActive = typeof entry['is_active'] === 'boolean' ? entry['is_active'] : undefined;
      limits.push({
        kind,
        usedFraction: clamp01(percent / 100),
        resetAt: parseIso(entry['resets_at']),
        scope,
        isActive,
      });
    }
  }
  return { tool: 'claude', limits, capturedAt: now };
}

/**
 * I-25: apakah snapshot usage **CC** mengizinkan resume. Gate naif `every(usedFraction<1)` SALAH untuk
 * CC — limit **model-scoped** (mis. weekly Opus habis) akan memblokir resume **selamanya** walau sesi
 * memakai model lain yang kuotanya masih ada (`is_active` global, RESEARCH §2). Gate HANYA window yang
 * benar-benar mengikat sesi:
 *  - **global** = limit tanpa `scope` per-model (`session`/`weekly_all` dari OAuth; `five_hour`/`seven_day`
 *    dari statusLine) → selalu diperhitungkan;
 *  - **scoped-aktif** = limit ber-`scope` yang `isActive === true` (model yang benar-benar dipakai) →
 *    diperhitungkan.
 * Scoped NON-aktif (model lain) diabaikan. Bila tak ada window gating teridentifikasi (skema tak dikenal)
 * → fallback strict `every()` atas SEMUA limit (sisi aman, jangan resume kalau ragu). **agy TIDAK** pakai
 * ini: dual-limit per grup → SEMUA bucket mengikat (G-31) → default supervisor `every(<1)` sudah benar.
 */
export function claudeUsageAvailable(snapshot: UsageSnapshot): boolean {
  const effective = bindingLimits(snapshot);
  return effective.every((l) => l.usedFraction < 1);
}

/** Window yang benar-benar MENGIKAT sesi CC (definisi di doc `claudeUsageAvailable`): global +
 *  scoped-aktif; bila tak ada yang teridentifikasi → SEMUA limit (sisi aman). Satu definisi dipakai
 *  bersama `claudeUsageAvailable` (I-25) & `claudeMaxBindingUsedFraction` (I-35) supaya keduanya tak
 *  pernah menyimpang soal "window mana yang dihitung". */
function bindingLimits(snapshot: UsageSnapshot): UsageLimit[] {
  const isGating = (l: UsageLimit): boolean => l.scope === undefined || l.isActive === true;
  const gating = snapshot.limits.filter(isGating);
  return gating.length > 0 ? gating : snapshot.limits;
}

/**
 * I-35: fraksi terpakai TERTINGGI di antara window mengikat CC. Dipakai untuk **korroborasi** sinyal
 * limit yang datang dari OUTPUT: bila kuota nyata masih jauh di bawah ambang, output yang mengklaim
 * limit hampir pasti **prosa** (dokumentasi, komentar kode, notifikasi acca sendiri, paste user) —
 * bukan keadaan sesi. Insiden live 17 Jul: 2 FP dalam 1 sesi saat window mengikat baru 0.55.
 *
 * Return `null` bila snapshot tak punya limit sama sekali → pemanggil **tak boleh menyimpulkan apa pun**
 * dan WAJIB jatuh ke perilaku pra-I-35 (latch). Ragu = jangan suppress: false-negative (limit asli tak
 * pernah di-resume) jauh lebih mahal daripada false-positive.
 */
export function claudeMaxBindingUsedFraction(snapshot: UsageSnapshot): number | null {
  const effective = bindingLimits(snapshot);
  if (effective.length === 0) return null;
  return Math.max(...effective.map((l) => l.usedFraction));
}

/** Kedua bucket statusLine (RESEARCH §2 poin 1). `resets_at` = **Unix epoch SECONDS** (G-4) —
 * beda dari `api/oauth/usage`. Bucket bisa absen independen (mis. sebelum API-call pertama). */
const STATUSLINE_BUCKETS = ['five_hour', 'seven_day'] as const;

export function parseClaudeStatusLine(raw: unknown, now: number): UsageSnapshot {
  if (!isRecord(raw)) throw new UsageParseError('parseClaudeStatusLine');
  const limits: UsageLimit[] = [];
  const rateLimits = raw['rate_limits'];
  if (isRecord(rateLimits)) {
    for (const kind of STATUSLINE_BUCKETS) {
      const bucket = rateLimits[kind];
      if (!isRecord(bucket)) continue; // bucket absen — skip, bukan error (caveat RESEARCH §2)
      const usedPercentage = bucket['used_percentage'];
      if (!isFiniteNumber(usedPercentage)) continue;
      const resetsAt = bucket['resets_at'];
      const resetAt = isFiniteNumber(resetsAt) ? resetsAt * 1000 : null; // epoch s → ms
      limits.push({ kind, usedFraction: clamp01(usedPercentage / 100), resetAt });
    }
  }
  return { tool: 'claude', limits, capturedAt: now };
}

/** Field kandidat label model di tiap `clientModelConfigs[]`. Bentuk NYATA (live Ubuntu 2026-07-05):
 * display name = **`label`** (mis. "Claude Opus 4.6 (Thinking)"); slug enum ada di
 * **`modelOrAlias.model`** (mis. `MODEL_PLACEHOLDER_M26`) — BUKAN field `model` datar (koreksi I-7:
 * asumsi lama "flat `model` = display name" salah). `label` diprioritaskan; sisanya fallback lawas;
 * lalu `modelOrAlias.model`; terakhir indeks posisi supaya entri tak silently dropped tanpa mengarang. */
const AGY_MODEL_LABEL_FIELDS = ['label', 'model', 'modelName', 'displayName'] as const;

function agyModelLabel(config: Record<string, unknown>, index: number): string {
  for (const field of AGY_MODEL_LABEL_FIELDS) {
    const v = config[field];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  const alias = config['modelOrAlias'];
  if (isRecord(alias) && typeof alias['model'] === 'string' && alias['model'].length > 0) {
    return alias['model'];
  }
  return `model-${index}`;
}

/**
 * agy `GetUserStatus` (ADR-010, verifikasi 3 Jul malam). Menerima respons dibungkus top-level
 * `userStatus` (skema CodexBar/RESEARCH §4c) ATAU flat (langsung `cascadeModelConfigData` di root)
 * — dua bentuk ditoleransi karena skema persis pembungkus LS lokal tak dikonfirmasi di sini.
 * **PII firewall (G-9):** HANYA `quotaInfo.{remainingFraction,resetTime}` + label model yang
 * diekstrak. `name`/`email`/`planInfo`/`availableCredits` di root TIDAK PERNAH disentuh.
 */
export function parseAgyUserStatus(raw: unknown, now: number): UsageSnapshot {
  if (!isRecord(raw)) throw new UsageParseError('parseAgyUserStatus');
  const wrapped = raw['userStatus'];
  const root = isRecord(wrapped) ? wrapped : raw;

  const limits: UsageLimit[] = [];
  const cascade = root['cascadeModelConfigData'];
  if (isRecord(cascade)) {
    const configs = cascade['clientModelConfigs'];
    if (Array.isArray(configs)) {
      configs.forEach((config: unknown, index: number) => {
        if (!isRecord(config)) return;
        const quotaInfo = config['quotaInfo'];
        if (!isRecord(quotaInfo)) return; // config tanpa quotaInfo sama sekali — bukan model ber-kuota, skip.
        // G-17: saat pool habis, LS MENGHILANGKAN field `remainingFraction` (hanya `resetTime` tersisa) —
        // BUKAN menyetel 0. Absennya field = EXHAUSTED → usedFraction 1 (bukan di-skip: kalau di-skip,
        // model habis lenyap dari limits[] dan supervisor `limits.every(usedFraction<1)` keliru RESUME
        // padahal masih habis). Nilai present-tapi-non-finite (null/string) = korup → skip defensif.
        const remainingFraction = quotaInfo['remainingFraction'];
        let usedFraction: number;
        if (!('remainingFraction' in quotaInfo)) {
          usedFraction = 1; // exhausted (G-17)
        } else if (isFiniteNumber(remainingFraction)) {
          usedFraction = clamp01(1 - remainingFraction);
        } else {
          return; // field ada tapi bukan angka finite → data korup, skip.
        }
        const label = agyModelLabel(config, index);
        limits.push({
          kind: label,
          usedFraction,
          resetAt: parseIso(quotaInfo['resetTime']),
          scope: label,
        });
      });
    }
  }
  return { tool: 'antigravity', limits, capturedAt: now };
}

/**
 * agy `RetrieveUserQuotaSummary` (I-16, live-verify 7 Jul — G-31). Sumber kebenaran kuota agy yang
 * BENAR untuk keputusan resume: tiap grup model berbagi **window MINGGUAN + 5-jam** (dua-duanya harus
 * >0). `parseAgyUserStatus` (GetUserStatus) HANYA memuat window 5-jam → buta weekly → dispatch bisa
 * keliru resume saat weekly habis; parser ini menggantikannya di jalur probe. Bentuk NYATA (live):
 * `response.groups[].buckets[].{bucketId, window:"weekly"|"5h", remainingFraction, resetTime}`
 * (juga ditoleransi flat `groups` di root). Tiap bucket → satu `UsageLimit`.
 * **PII firewall (G-9):** HANYA `window`/`bucketId`/`remainingFraction`/`resetTime` diekstrak —
 * `displayName`/`description` grup/bucket (bisa memuat plan/PII) TIDAK PERNAH disentuh.
 * **G-17:** absennya `remainingFraction` pada bucket nyata = exhausted → `usedFraction=1` (BUKAN skip:
 * kalau di-skip, bucket habis lenyap & `every(usedFraction<1)` keliru resume). Bucket tanpa identitas
 * (tanpa window & bucketId) = malformed → skip (jangan salah anggap exhausted).
 */
export function parseAgyQuotaSummary(raw: unknown, now: number): UsageSnapshot {
  if (!isRecord(raw)) throw new UsageParseError('parseAgyQuotaSummary');
  const response = raw['response'];
  const root = isRecord(response) ? response : raw;

  const limits: UsageLimit[] = [];
  const groups = root['groups'];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (!isRecord(group)) continue;
      const buckets = group['buckets'];
      if (!Array.isArray(buckets)) continue;
      for (const bucket of buckets) {
        if (!isRecord(bucket)) continue;
        const windowRaw = bucket['window'];
        const bucketIdRaw = bucket['bucketId'];
        const window = typeof windowRaw === 'string' && windowRaw.length > 0 ? windowRaw : undefined;
        const bucketId = typeof bucketIdRaw === 'string' && bucketIdRaw.length > 0 ? bucketIdRaw : undefined;
        // Identitas non-PII wajib: bucket tanpa window & bucketId = malformed → skip (jangan diperlakukan exhausted).
        if (window === undefined && bucketId === undefined) continue;

        const remainingFraction = bucket['remainingFraction'];
        let usedFraction: number;
        if (!('remainingFraction' in bucket)) {
          usedFraction = 1; // exhausted (G-17)
        } else if (isFiniteNumber(remainingFraction)) {
          usedFraction = clamp01(1 - remainingFraction);
        } else {
          continue; // field ada tapi bukan angka finite → korup, skip.
        }
        limits.push({
          kind: window ?? (bucketId as string), // 'weekly' | '5h' (fallback bucketId bila window absen)
          usedFraction,
          resetAt: parseIso(bucket['resetTime']),
          scope: bucketId,
        });
      }
    }
  }
  return { tool: 'antigravity', limits, capturedAt: now };
}
