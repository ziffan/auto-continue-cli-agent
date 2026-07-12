// I-23 — pembangun MURNI fragmen settings.json Claude Code yang memasang dua hook supervisor ke sesi
// yang di-spawn (`--settings <file>`, isolasi — auth tetap diwarisi kredensial mesin, ADR-005):
//
//   • StopFailure (v2.1.78+) → jalur deteksi limit CC **PRIMER** (ADR-001/CLAUDE.md §7): event-driven
//     resmi dengan taxonomy error (`rate_limit` = limit; `overloaded`/`server_error` = overload transient).
//     Selama ini hanya ada fallback output-scrape (`limit-watcher`); hook ini yang dimaksud ADR-001.
//   • SessionStart (matcher startup|resume) → sumber ANDAL `cli_session_id` CC (I-20/R2b/G-34): payload
//     memuat `session_id` = id yang dipakai `claude --resume <id>` (korelasi transcript termuda = racy,
//     hook = jalur robust). Menutup paruh CC I-20 (agy sudah lewat output, G-36).
//
// Bentuk hook = **exec-form** (`command` + `args[]`) → argv diteruskan apa adanya TANPA shell parsing,
// jadi tak ada jebakan quoting/PATHEXT lintas-OS (G-12). Satu entry forwarder dipakai ulang untuk kedua
// event; `hook_event_name` di payload yang membedakan aksi di sisi wrapper.
//
// Skema + payload terverifikasi: RESEARCH §2c (payload nyata 3 Jul) + docs resmi hooks (code.claude.com).

import type { HookForwarderSpec } from './types.js';

// Matcher StopFailure & SessionStart = set exact-match join '|' (CC hanya menerima huruf/digit/`_`/`|`;
// koma/hyphen membuatnya dievaluasi sbg regex — RESEARCH §2c). `rate_limit` = target primer; overload
// disertakan agar hook fire & bisa DIBEDAKAN dari limit (engine tetap mengabaikan overload).
export const STOPFAILURE_MATCHER = 'rate_limit|overloaded|server_error';
export const SESSIONSTART_MATCHER = 'startup|resume';

/** Bangun objek settings.json CC (hooks StopFailure + SessionStart → forwarder yang sama). Murni. */
export function buildClaudeHookSettings(forwarder: HookForwarderSpec): unknown {
  const entry = { type: 'command', command: forwarder.command, args: forwarder.args };
  return {
    hooks: {
      StopFailure: [{ matcher: STOPFAILURE_MATCHER, hooks: [entry] }],
      SessionStart: [{ matcher: SESSIONSTART_MATCHER, hooks: [entry] }],
    },
  };
}
