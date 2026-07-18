// M4 — Notifier: surface transisi sesi yang penting bagi user (LIMIT_HIT / RESUMED / FAILED /
// BLOCKED). Engine MURNI + injectable: pemetaan event→notifikasi (`notificationForEvent`) tak
// menyentuh I/O; pengiriman (`deliver`) di-inject (default = satu baris ke stderr). Dipasang sebagai
// DEKORATOR atas `EventsRepo` (`withNotifications`) — setiap transisi yang sudah ditulis ke tabel
// `events` otomatis ter-surface tanpa menyentuh tiap call-site emisi (proc-wrapper & supervisor).
//
// FIREWALL PII / injection (G-9, ADR-008/013): body notifikasi HANYA dibangun dari field
// TERKONTROL/terstruktur (status, label `source`/`reason` yang kita sendiri hasilkan) — TIDAK PERNAH
// meng-echo teks bebas dari sumber tak tepercaya (`evidence` = potongan output PTY; respons probe).
// Pesan error spawn kita sendiri (FAILED.reason) boleh disurface tapi dipangkas. Redaksi rahasia
// penuh untuk streaming output = urusan M-remote (`remote/redact.ts`), bukan slice ini.

import type { UsageSnapshot } from '../shared/types.js';
import type { AppendEventInput, EventsRepo } from '../store/repositories/events.js';

export type NotificationEvent =
  | 'LIMIT_HIT'
  | 'RESUMED'
  | 'FAILED'
  | 'BLOCKED'
  | 'PROXIMITY'
  | 'INJECT_SKIPPED';
export type NotificationLevel = 'info' | 'warn' | 'error';

export interface Notification {
  event: NotificationEvent;
  level: NotificationLevel;
  title: string;
  body: string;
  sessionId: string | null;
}

export type NotificationDeliver = (n: Notification) => void;

/** Batas panjang teks error spawn kita sendiri yang disurface (FAILED). */
const MAX_REASON_LEN = 120;

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function shortId(id: string | null): string {
  return id ? `#${id}` : '#?';
}
function clip(s: string): string {
  return s.length > MAX_REASON_LEN ? `${s.slice(0, MAX_REASON_LEN - 1)}…` : s;
}

/**
 * Pure: petakan satu event `append` → Notification bila layak-surface, else `null`. Hanya membaca
 * field TERKONTROL dari payload (lihat firewall di header). RUNNING/EXITED & event non-transisi →
 * `null` (bukan noise untuk user).
 */
export function notificationForEvent(input: AppendEventInput): Notification | null {
  const p = asRecord(input.payload);
  const sid = input.session_id;

  if (input.type === 'status_change') {
    const to = str(p.to);
    if (to === 'LIMIT_HIT') {
      const source = str(p.source);
      return {
        event: 'LIMIT_HIT',
        level: 'warn',
        title: 'Usage limit reached', // gate:allow-canonical-literal — user-facing, sengaja pakai bahasa kanonik (jelas
        // bagi manusia); risiko notif-memicu-diri-sendiri (I-35 akar #2, G-45) sudah ditangani di lapis DETEKSI
        // (korroborasi ambang 0.85), bukan dengan menyembunyikan kata dari user. Menyamarkan title jadi kurang jelas.
        // `source` = label detektor kita ('output'/'hook'/…), bukan isi output → aman. `evidence`
        // (snippet PTY) sengaja TIDAK disertakan (firewall).
        body: `Session ${shortId(sid)} hit its usage limit${source ? ` (via ${source})` : ''}.`,
        sessionId: sid,
      };
    }
    if (to === 'RESUMED') {
      // Jalur inject-continue (ADR-014 §1): reason = label kita ('inject_continue').
      const reason = str(p.reason);
      return {
        event: 'RESUMED',
        level: 'info',
        title: 'Session resumed',
        body: `Session ${shortId(sid)} resumed${reason ? ` (${reason})` : ''}.`,
        sessionId: sid,
      };
    }
    if (to === 'FAILED') {
      // reason = pesan Error spawn KITA sendiri (mis. "Executable tak ditemukan…") — terkontrol,
      // berguna untuk user bertindak; dipangkas. Bukan output PTY / respons pihak ketiga.
      const reason = str(p.reason);
      return {
        event: 'FAILED',
        level: 'error',
        title: 'Session failed',
        body: `Session ${shortId(sid)} failed${reason ? `: ${clip(reason)}` : '.'}`,
        sessionId: sid,
      };
    }
    // RUNNING / EXITED / orphan 'exited' (lowercase) → tak di-surface.
    return null;
  }

  // R3 (I-21): inject-continue sukses pada sesi HIDUP (ADR-014 §1). Transisi status kini `RUNNING`
  // (ditulis wrapper, bukan lagi `status_change RESUMED`) supaya siklus limit berikutnya terdeteksi →
  // notifikasi "resumed" ke user pindah ke event dispatch ini. `action` = label terkontrol kita (G-9).
  if (input.type === 'job_dispatch_done' && str(p.action) === 'inject_continue') {
    return {
      event: 'RESUMED',
      level: 'info',
      title: 'Session resumed',
      body: `Session ${shortId(sid)} resumed (inject-continue).`,
      sessionId: sid,
    };
  }

  // Resume-by-id (proc `exited`, ADR-014 §3): dispatch men-spawn sesi wrapper BARU dan menandai sesi
  // lama RESUMED lewat `job_dispatch_done` (bukan `status_change`) — surface juga sebagai "resumed".
  if (input.type === 'job_dispatch_done' && str(p.action) === 'resume_spawned') {
    const newId = str(p.newSessionId) ?? null;
    return {
      event: 'RESUMED',
      level: 'info',
      title: 'Session resumed',
      body: `Session ${shortId(sid)} resumed as ${shortId(newId)}.`,
      sessionId: sid,
    };
  }

  // I-18: inject-continue pada sesi HIDUP di-skip (gating wrapper menolak / wrapper tak terjangkau) →
  // sesi tertinggal LIMIT_HIT, auto-continue tak bisa lanjut sendiri → user perlu bertindak manual
  // (ADR-014: surface manual, JANGAN auto-kill). `reason` = label terkontrol kita (bukan isi output).
  if (input.type === 'job_dispatch_pending' && str(p.action) === 'inject_skipped') {
    const reason = str(p.reason);
    return {
      event: 'INJECT_SKIPPED',
      level: 'warn',
      title: 'Auto-continue skipped',
      body: `Session ${shortId(sid)} could not auto-continue${reason ? ` (${reason})` : ''} — manual action needed.`,
      sessionId: sid,
    };
  }

  // AC-8: cwd asli hilang → resume diblokir (jalur `job_dispatch_error`, status sesi belum di-set
  // BLOCKED oleh dispatch). reason = label kita ('cwd_missing').
  if (input.type === 'job_dispatch_error' && str(p.status) === 'BLOCKED') {
    const reason = str(p.reason);
    return {
      event: 'BLOCKED',
      level: 'error',
      title: 'Resume blocked',
      body: `Session ${shortId(sid)} blocked${reason ? `: ${reason}` : ''} — manual action needed.`,
      sessionId: sid,
    };
  }

  return null;
}

// ── Proximity monitor (I-8) ──────────────────────────────────────────────────────────────────
// Ambang "mendekati limit" dari snapshot usage-probe (bukan transisi event). Meniru default Claude
// Code sendiri: ~90% window 5-jam / ~75% window mingguan (G-15). agy = per-bucket weekly+5h
// (`parseAgyQuotaSummary`, G-31) atau per-model 5-jam (`parseAgyUserStatus`). WIRING: `usage-monitor.ts`
// (I-17) memanggil ini dari loop probe PERIODIK saat sesi RUNNING. Dedup rising-edge (`createProximityGate`)
// mencegah spam — tanpanya proximity ter-deliver TIAP tick (~2 mnt) selama sesi bertahan di atas ambang.

export interface ProximityThresholds {
  /** Ambang window jangka-pendek (5-jam/session). Default 0.90 (meniru Claude Code). */
  fiveHour: number;
  /** Ambang window mingguan (7-hari). Default 0.75 (meniru Claude Code). */
  weekly: number;
}

export const DEFAULT_PROXIMITY_THRESHOLDS: ProximityThresholds = { fiveHour: 0.9, weekly: 0.75 };

/** kind → window mingguan? (CC: 'weekly_*'/'seven_day'; agy summary: 'weekly'). Sisanya (session/
 *  five_hour/5h/label-model agy) = window 5-jam. Model label agy = nama model, BUKAN PII (G-9). */
function isWeeklyKind(kind: string): boolean {
  return /week/i.test(kind) || kind === 'seven_day';
}

/** Kandidat proximity (window yang menembus ambang & belum penuh) + kunci stabil per (tool, kind)
 *  untuk dedup rising-edge. Threshold logic tinggal SATU tempat di sini — dipakai fungsi stateless
 *  `proximityNotifications` DAN `createProximityGate` (jangan duplikasi kalibrasi ambang). */
interface ProximityCandidate {
  key: string;
  notification: Notification;
}

function proximityCandidates(snapshot: UsageSnapshot, thresholds: ProximityThresholds): ProximityCandidate[] {
  const out: ProximityCandidate[] = [];
  for (const limit of snapshot.limits) {
    if (limit.usedFraction >= 1) continue; // exhausted = LIMIT_HIT, bukan proximity.
    const weekly = isWeeklyKind(limit.kind);
    const threshold = weekly ? thresholds.weekly : thresholds.fiveHour;
    if (limit.usedFraction < threshold) continue;
    const pct = Math.round(limit.usedFraction * 100);
    out.push({
      key: `${snapshot.tool}::${limit.kind}`,
      notification: {
        event: 'PROXIMITY',
        level: 'warn',
        title: 'Approaching usage limit',
        body: `${snapshot.tool} ${weekly ? 'weekly' : '5h'} usage at ${pct}% (${limit.kind}).`,
        sessionId: null,
      },
    });
  }
  return out;
}

/**
 * Pure & STATELESS: dari `UsageSnapshot` (hasil usage-probe), hasilkan notifikasi "mendekati limit"
 * untuk tiap window yang `usedFraction` sudah menembus ambang tapi belum penuh. `usedFraction === 1`
 * (exhausted) = wilayah LIMIT_HIT (di-surface jalur lain) → dilewati. Body hanya dari field terkontrol
 * (tool, kind/window, persen) — tak ada PII (G-9). Tak menyentuh I/O. **Tanpa dedup** — pemanggil
 * periodik (usage-monitor) HARUS pakai `createProximityGate` supaya tak spam tiap tick.
 */
export function proximityNotifications(
  snapshot: UsageSnapshot,
  thresholds: ProximityThresholds = DEFAULT_PROXIMITY_THRESHOLDS,
): Notification[] {
  return proximityCandidates(snapshot, thresholds).map((c) => c.notification);
}

/** Gate proximity STATEFUL (rising-edge dedup, I-8): `evaluate(snapshot)` hanya mengembalikan
 *  notifikasi untuk window yang BARU melewati ambang sejak terakhir di-report. Window yang turun di
 *  bawah ambang / reset / menjadi exhausted → state-nya di-clear sehingga crossing berikutnya
 *  re-notify. Dipakai `usage-monitor.ts` (satu gate hidup lintas-tick). State per (tool, kind). */
export interface ProximityGate {
  evaluate(snapshot: UsageSnapshot): Notification[];
}

export function createProximityGate(
  thresholds: ProximityThresholds = DEFAULT_PROXIMITY_THRESHOLDS,
): ProximityGate {
  const notified = new Set<string>(); // key `${tool}::${kind}` yang sedang di atas ambang & sudah di-report.
  return {
    evaluate(snapshot: UsageSnapshot): Notification[] {
      const candidates = proximityCandidates(snapshot, thresholds);
      const currentKeys = new Set(candidates.map((c) => c.key));
      const out: Notification[] = [];
      for (const c of candidates) {
        if (notified.has(c.key)) continue; // sudah di-report pada episode crossing ini → suppress (anti-spam).
        notified.add(c.key);
        out.push(c.notification);
      }
      // Clear key milik TOOL ini yang tak lagi di atas ambang → crossing berikutnya re-notify.
      // Scope per-tool: snapshot per-tool; jangan sentuh state tool lain.
      const prefix = `${snapshot.tool}::`;
      for (const key of [...notified]) {
        if (key.startsWith(prefix) && !currentKeys.has(key)) notified.delete(key);
      }
      return out;
    },
  };
}

/** Format satu baris out-of-band untuk sink stderr. */
export function formatNotification(n: Notification): string {
  return `[acca ${n.level}] ${n.title} — ${n.body}`;
}

/** Deliver default: satu baris ke stderr (out-of-band → tak mengotori stdout TUI child). Desktop
 *  (node-notifier) = opt-in menyusul di belakang gate DEPENDENCY-POLICY. */
export const stderrDeliver: NotificationDeliver = (n) => {
  process.stderr.write(`${formatNotification(n)}\n`);
};

/**
 * Dekorator `EventsRepo`: teruskan `append` apa adanya lalu surface bila layak. Kegagalan `deliver`
 * di-swallow — surfacing TAK BOLEH memutus jalur lifecycle sesi (append = jalur kritikal). `deliver`
 * di-inject (test/desktop); default stderr.
 */
export function withNotifications(events: EventsRepo, deliver: NotificationDeliver = stderrDeliver): EventsRepo {
  // Spread repo asli lalu override `append` saja: `EventsRepo` kini juga punya method BACA
  // (listRecent/listBySession, M4 `acca log`). Dekorator yang cuma expose `append` akan (a) tak
  // memenuhi tipe `EventsRepo` (error tsc) & (b) menyembunyikan method baca dari konsumen repo
  // terbungkus. Logika append (forward → notificationForEvent → deliver dgn try/catch swallow) TAK berubah.
  return {
    ...events,
    append(input: AppendEventInput): void {
      events.append(input);
      const n = notificationForEvent(input);
      if (n) {
        try {
          deliver(n);
        } catch {
          // Surfacing gagal (mis. stderr tertutup) — abaikan; audit tetap tersimpan di `events`.
        }
      }
    },
  };
}
