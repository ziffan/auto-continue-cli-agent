// Gate artefak Task Scheduler XML (M5.5, ADR-026) - I-34: artefak shippable WAJIB punya >=1 gate
// yang MEMVALIDASINYA, bukan sekadar dibaca reviewer. `npm run check` (typecheck+lint+test) tak
// menyentuh file non-TS; reviewer membaca template, tak mengeksekusinya. Kelas ini sudah menggigit
// dua kali (G-44 .ps1 em-dash; README `&&`) -> tiap artefak deploy punya gate lintas-OS pure-TS.
//
// Konteks ADR-026: deployment Windows MVP = autostart per-user via Task Scheduler trigger "At log on"
// (BUKAN Windows Service - itu LocalSystem -> acca.db beda + creds putus = I-33). Template ini jalan
// SEBAGAI user login -> DB + kredensial benar by construction.
//
// Kenapa placeholder `{{TOKEN}}` bukan `<TOKEN>` (beda dari template systemd M5.4): di XML, `<...>`
// adalah sintaks tag. Placeholder `<NODE>` akan bertabrakan dgn tag XML nyata (mis. `<URI>` all-caps).
// `{{...}}` nol-tabrakan dgn angle-bracket -> deteksi remnant render tak ambigu.
//
// Yang divalidasi (pure fs+string -> jalan di Ubuntu DAN Windows, tak pernah skip di daily driver):
//   1. XML well-formed (tag balance) - template MAUPUN hasil render.
//   2. Pure ASCII (kelas kehati-hatian G-44; XML native UTF-8 tapi ASCII = nol risiko schtasks/encoding).
//   3. Elemen keamanan/keandalan WAJIB ada dgn nilai benar:
//      - LogonTrigger + UserId placeholder (per-user, bukan any-user).
//      - Principal LogonType=InteractiveToken + RunLevel=LeastPrivilege (BUKAN HighestAvailable -
//        kontras I-33/ADR-023: spawn agent CLI dgn privilege minimal, analog systemd --user bukan root).
//      - Settings: Hidden=true (nol UI task), ExecutionTimeLimit=PT0S (WAJIB - default 72 jam akan
//        MEMBUNUH daemon long-running), DisallowStartIfOnBatteries=false + StopIfGoingOnBatteries=false
//        (WAJIB untuk laptop - jangan mati saat baterai), MultipleInstancesPolicy=IgnoreNew (cegah
//        dua daemon), RestartOnFailure Interval+Count (auto-restart on-crash, AC-M5-2).
//      - Actions/Exec: Command={{NODE}}, Arguments memuat {{ENTRYPOINT}} + `daemon`.
//   4. Render (substitusi {{...}} dgn nilai contoh) -> nol remnant {{...}} + tetap well-formed.
//   5. Setiap {{TOKEN}} disubstitusi oleh scripts/install-windows.ps1 (celah I-34 yang SEBENARNYA:
//      template dikirim, hubungan template<->substitusi tak pernah di-gate).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const xmlPath = join(repoRoot, 'deploy', 'windows', 'acca-daemon.task.xml');
const installPs1 = join(repoRoot, 'scripts', 'install-windows.ps1');

const template = readFileSync(xmlPath, 'utf8');

/** Substitusi placeholder dgn nilai contoh - persis peran install-windows.ps1. */
const sample: Record<string, string> = {
  '{{NODE}}': 'C:\\Program Files\\nodejs\\node.exe',
  '{{ENTRYPOINT}}': 'D:\\PROYEK\\auto-continue-cli-agent\\dist\\cli\\index.js',
  '{{WORKDIR}}': 'D:\\PROYEK\\auto-continue-cli-agent',
  '{{USERID}}': 'LAB2026ZF\\ziffa',
};

const placeholders = [...new Set(template.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
const rendered = placeholders.reduce(
  (acc, ph) => acc.replaceAll(ph, sample[ph] ?? `__UNMAPPED_${ph}__`),
  template,
);

/** Well-formedness ringan tanpa dep XML: cocokkan buka/tutup tag via stack. Placeholder {{...}}
 *  tak punya `<` -> tak mengganggu. Cukup untuk menangkap korupsi realistis (tag tak tertutup/mismatch). */
function xmlTagBalance(text: string): { ok: boolean; error?: string } {
  const stripped = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([A-Za-z][\w.:-]*)(\s[^>]*?)?(\/?)>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(stripped)) !== null) {
    const closing = m[1] === '/';
    const name = m[2] as string;
    const selfClose = m[4] === '/';
    if (selfClose) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== name) return { ok: false, error: `</${name}> tak cocok pembuka <${top ?? '(kosong)'}>` };
    } else {
      stack.push(name);
    }
  }
  if (stack.length) return { ok: false, error: `tag belum ditutup: ${stack.join(', ')}` };
  return { ok: true };
}

/** XML comment TAK boleh memuat `--` (selain penutup `-->`). System.Xml/Register-ScheduledTask
 *  MENOLAK ini -> task gagal register. Naive tag-balance tak menangkapnya; ini gap yang ditemukan
 *  saat menjalankan parser sungguhan (I-34: eksekusi artefak, jangan cuma baca). Cross-OS pure-string. */
function commentWithDoubleHyphen(text: string): string | null {
  const re = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1] as string;
    if (body.includes('--')) return body.trim().slice(0, 80);
  }
  return null;
}

function firstNonAscii(text: string): { index: number; ctx: string } | null {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) {
      return { index: i, ctx: text.slice(Math.max(0, i - 20), i + 20) };
    }
  }
  return null;
}

describe('gate artefak Task Scheduler XML (M5.5, I-34)', () => {
  it('template acca-daemon.task.xml ada & tak kosong', () => {
    expect(template.trim().length).toBeGreaterThan(0);
  });

  it('template = XML well-formed (tag balance)', () => {
    const r = xmlTagBalance(template);
    expect(r.ok, r.error).toBe(true);
  });

  it('komentar XML tak memuat `--` (ditolak System.Xml/Register-ScheduledTask)', () => {
    const bad = commentWithDoubleHyphen(template);
    expect(bad, bad ? `komentar memuat "--": "${bad}"` : '').toBeNull();
  });

  it('template = pure ASCII (nol risiko encoding schtasks/CP1252 kelas G-44)', () => {
    const bad = firstNonAscii(template);
    expect(bad, bad ? `byte non-ASCII di offset ${bad.index}: ...${bad.ctx}...` : '').toBeNull();
  });

  describe('elemen keamanan & keandalan WAJIB', () => {
    it('LogonTrigger per-user (Enabled + UserId placeholder)', () => {
      expect(template).toMatch(/<LogonTrigger>/);
      expect(template).toMatch(/<LogonTrigger>[\s\S]*?<Enabled>true<\/Enabled>[\s\S]*?<\/LogonTrigger>/);
      expect(template).toMatch(/<LogonTrigger>[\s\S]*?<UserId>\{\{USERID\}\}<\/UserId>[\s\S]*?<\/LogonTrigger>/);
    });

    it('watchdog: LogonTrigger ber-Repetition PT1M (crash-recovery primer - RestartOnFailure tak andal, LIVE 18 Jul)', () => {
      // Schema Task Scheduler: <Repetition> WAJIB sebelum <Enabled> di dlm trigger. Watchdog +
      // IgnoreNew = self-heal; tanpa ini daemon yg di-kill tak pulih sampai logon berikutnya.
      const trig = template.match(/<LogonTrigger>([\s\S]*?)<\/LogonTrigger>/);
      expect(trig, 'LogonTrigger wajib ada').not.toBeNull();
      const body = trig![1] as string;
      expect(body).toMatch(/<Repetition>[\s\S]*?<Interval>PT\d+M<\/Interval>[\s\S]*?<\/Repetition>/);
      // Urutan schema: Repetition mendahului Enabled (kalau tidak, Register-ScheduledTask menolak).
      expect(body.indexOf('<Repetition>')).toBeLessThan(body.indexOf('<Enabled>'));
    });

    it('Principal = InteractiveToken + LeastPrivilege (bukan HighestAvailable - least-privilege, kontras I-33)', () => {
      expect(template).toMatch(/<LogonType>InteractiveToken<\/LogonType>/);
      expect(template).toMatch(/<RunLevel>LeastPrivilege<\/RunLevel>/);
      expect(template).not.toMatch(/HighestAvailable/);
      expect(template).toMatch(/<Principal[^>]*>[\s\S]*?<UserId>\{\{USERID\}\}<\/UserId>[\s\S]*?<\/Principal>/);
    });

    it('Hidden=true (nol UI task)', () => {
      expect(template).toMatch(/<Hidden>true<\/Hidden>/);
    });

    it('ExecutionTimeLimit=PT0S (WAJIB - default 72 jam membunuh daemon long-running)', () => {
      expect(template).toMatch(/<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    });

    it('laptop-safe: tak stop/tak tolak-start saat baterai', () => {
      expect(template).toMatch(/<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
      expect(template).toMatch(/<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/);
    });

    it('MultipleInstancesPolicy=IgnoreNew (cegah dua daemon)', () => {
      expect(template).toMatch(/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
    });

    it('RestartOnFailure: Interval + Count numerik (auto-restart on-crash, AC-M5-2)', () => {
      const block = template.match(/<RestartOnFailure>([\s\S]*?)<\/RestartOnFailure>/);
      expect(block, 'blok RestartOnFailure wajib ada').not.toBeNull();
      const body = block![1] as string;
      expect(body).toMatch(/<Interval>PT\d+[MS]<\/Interval>/);
      const count = body.match(/<Count>(\d+)<\/Count>/);
      expect(count, 'Count numerik wajib ada').not.toBeNull();
      expect(Number(count![1])).toBeGreaterThanOrEqual(1);
    });

    it('Actions/Exec menjalankan node + entrypoint + `daemon`', () => {
      expect(template).toMatch(/<Command>\{\{NODE\}\}<\/Command>/);
      const args = template.match(/<Arguments>([\s\S]*?)<\/Arguments>/);
      expect(args, 'Arguments wajib ada').not.toBeNull();
      const body = args![1] as string;
      expect(body).toContain('{{ENTRYPOINT}}');
      expect(body.trimEnd().endsWith('daemon')).toBe(true);
    });
  });

  describe('render (substitusi placeholder)', () => {
    it('semua placeholder punya nilai contoh (tak ada {{TOKEN}} tak dikenal)', () => {
      expect(placeholders.filter((ph) => !(ph in sample))).toEqual([]);
    });

    it('render TIDAK menyisakan {{...}} (spec: nol placeholder lolos ke task terpasang)', () => {
      expect(rendered.match(/\{\{[A-Z_]+\}\}/g)).toBeNull();
    });

    it('render tetap XML well-formed', () => {
      const r = xmlTagBalance(rendered);
      expect(r.ok, r.error).toBe(true);
    });

    it('render: Command + Arguments memuat nilai tersubstitusi', () => {
      expect(rendered).toContain(`<Command>${sample['{{NODE}}']}</Command>`);
      expect(rendered).toContain(sample['{{ENTRYPOINT}}'] as string);
    });
  });

  it('setiap {{TOKEN}} disubstitusi oleh scripts/install-windows.ps1 (celah I-34)', () => {
    const ps1 = readFileSync(installPs1, 'utf8');
    const missing = placeholders.filter((ph) => !ps1.includes(ph));
    expect(
      missing,
      `install-windows.ps1 tak menyubstitusi: ${missing.join(', ')} -> placeholder lolos ke task terpasang`,
    ).toEqual([]);
  });
});
