// Halaman Web UI monitor (ADR-028 / M-web) — HTML SELF-CONTAINED. Kontrak (THREAT-MODEL §9):
//   • T-W4: NOL aset eksternal (CSS+JS inline; satu-satunya fetch = same-origin `/api/status`).
//   • T-W5: nilai dari API dirender via `textContent` / createElement — TAK PERNAH `innerHTML`
//           (defense-in-depth walau payload sudah ter-firewall di server).
// String statis — tak ada interpolasi data server-side (data hanya masuk di browser via fetch).

/** Formatter timestamp sisi-browser (W-3) — sumber JS MURNI diekspor sbg string agar (a) di-embed
 *  ke halaman DAN (b) dievaluasi di test (`new Function`) → nol duplikasi, nol jsdom. `reset_at`/
 *  `updated_at` epoch-ms → `HH:MM` lokal; beda >24 jam dari sekarang → sisipkan nama hari (spt CLI
 *  `formatResetCell`, B-2: `HH:MM` telanjang untuk window mingguan MENYESATKAN). Semua di browser —
 *  NOL field baru ke `/api/status` (jaga T-W1 nol-jalur-data-baru). */
export const FMT_TS_JS = `
function fmtTs(ms, now) {
  if (ms === null || ms === undefined) return '-';
  var DAYS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  var d = new Date(ms);
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var hhmm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  return Math.abs(ms - now) > 86400000 ? DAYS[d.getDay()] + ' ' + hhmm : hhmm;
}`;

const PAGE_HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>acca — monitor</title>
<style>
  :root { color-scheme: light dark;
    --fg:#1a1a1a; --dim:#6b7280; --bg:#ffffff; --card:#f4f4f5; --line:#e4e4e7;
    --accent:#0e7490; --green:#16a34a; --yellow:#ca8a04; --red:#dc2626;
    --st-RUNNING:#16a34a; --st-LIMIT_HIT:#dc2626; --st-BLOCKED:#9333ea;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e5e7eb; --dim:#9ca3af; --bg:#0b0c0e; --card:#17181b; --line:#26272b;
      --accent:#22d3ee; --green:#4ade80; --yellow:#facc15; --red:#f87171;
      --st-RUNNING:#4ade80; --st-LIMIT_HIT:#f87171; --st-BLOCKED:#c084fc;
    }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:1.25rem; background:var(--bg); color:var(--fg);
         font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { display:flex; flex-wrap:wrap; gap:.5rem 1rem; align-items:baseline; margin-bottom:1rem; }
  h1 { font-size:1rem; margin:0; letter-spacing:.02em; }
  h1 .g { color:var(--accent); }
  .meta { color:var(--dim); font-size:.8rem; }
  section { background:var(--card); border:1px solid var(--line); border-radius:8px;
            padding:.75rem 1rem; margin-bottom:1rem; }
  h2 { font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; color:var(--dim);
       margin:0 0 .5rem; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word; }
  .events { max-height:16rem; overflow:auto; }
  .empty { color:var(--dim); }
  .err { color:var(--red); }

  /* Card layout per sesi */
  .cards { display:flex; flex-direction:column; gap:.5rem; }
  .card { background:var(--bg); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .card-hdr { display:flex; gap:.5rem; align-items:baseline; padding:.4rem .65rem;
              font-weight:600; font-size:.82rem; border-bottom:1px solid var(--line); }
  .card-body { padding:.5rem .65rem; font-size:.8rem; line-height:1.7; }
  .card-ft { padding:.3rem .65rem; font-size:.72rem; color:var(--dim); border-top:1px solid var(--line); }

  /* Status badge */
  .st { font-size:.7rem; padding:1px 5px; border-radius:3px; font-weight:500; }
  .st-RUNNING { color:var(--st-RUNNING); }
  .st-LIMIT_HIT { color:var(--st-LIMIT_HIT); }
  .st-RESUMED, .st-BLOCKED, .st-FAILED { color:var(--st-BLOCKED); }
  .st-EXITED { color:var(--dim); }

  /* Progress bar DOM */
  .bar-wrap { display:inline-block; width:10ch; height:1em; background:var(--line);
              vertical-align:middle; border-radius:2px; overflow:hidden; }
  .bar-fill { height:100%; display:block; border-radius:2px; }
  .c-g { background:var(--green); }
  .c-y { background:var(--yellow); }
  .c-r { background:var(--red); }
</style>
</head>
<body>
<header>
  <h1>acca <span class="g">&#9619;&#9619;&#9619;&#9617;&#9617;</span> monitor</h1>
  <span class="meta" id="meta">memuat&hellip;</span>
</header>

<section><h2>Usage</h2><pre id="usage" class="empty">&hellip;</pre></section>
<section><h2>Daemon</h2><pre id="daemon" class="empty">&hellip;</pre></section>
<section><h2>Sesi</h2><div id="sessions" class="empty">&hellip;</div></section>
<section><h2>Event log</h2><pre id="events" class="events empty">&hellip;</pre></section>

<script>
${FMT_TS_JS}
(function () {
  var REFRESH_MS = 5000;
  var $ = function (id) { return document.getElementById(id); };
  function setText(el, text) { el.textContent = text; }

  function barHtml(pct) {
    var cls = pct >= 90 ? 'c-r' : pct >= 70 ? 'c-y' : 'c-g';
    return '<span class="bar-wrap"><span class="bar-fill ' + cls + '" style="width:' + Math.round(pct) + '%"></span></span>';
  }

  function renderSessions(list, nowMs) {
    var host = $('sessions');
    host.textContent = '';
    if (!list || list.length === 0) { host.className = 'empty'; host.textContent = 'Belum ada sesi.'; return; }
    host.className = 'cards';
    list.forEach(function (row) {
      var card = document.createElement('div');
      card.className = 'card';

      var hdr = document.createElement('div');
      hdr.className = 'card-hdr';
      var idSpan = document.createElement('span'); idSpan.textContent = '#' + row.id; hdr.appendChild(idSpan);
      var toolSpan = document.createElement('span'); toolSpan.textContent = row.tool; hdr.appendChild(toolSpan);
      var stSpan = document.createElement('span');
      stSpan.className = 'st st-' + (row.status || 'EXITED');
      stSpan.textContent = row.status || '-';
      hdr.appendChild(stSpan);
      card.appendChild(hdr);

      var body = document.createElement('div');
      body.className = 'card-body';
      var ctx = row.context;
      if (ctx) {
        if (ctx.model) {
          var ml = document.createElement('div'); ml.textContent = 'Model:   ' + ctx.model; body.appendChild(ml);
        }
        var cx = document.createElement('div');
        cx.innerHTML = 'Context: ' + barHtml(ctx.contextPct) + ' ';
        cx.appendChild(document.createTextNode(formatK(ctx.contextTokens) + ' / ' + ctx.contextPct + '%'));
        body.appendChild(cx);
      } else {
        var na = document.createElement('div'); na.textContent = '(detail tak tersedia)'; body.appendChild(na);
      }
      card.appendChild(body);

      var ft = document.createElement('div');
      ft.className = 'card-ft';
      ft.textContent = 'Diperbarui ' + fmtTs(row.updated_at, nowMs);
      card.appendChild(ft);

      host.appendChild(card);
    });
  }

  function formatK(tokens) {
    if (tokens == null || isNaN(tokens)) return '-';
    if (tokens < 1000) return String(Math.round(tokens));
    return (tokens / 1000).toFixed(1) + 'K';
  }

  function apply(data) {
    var claude = (data.usage && data.usage.claude) || [];
    var agy = (data.usage && data.usage.antigravity) || [];
    $('usage').className = ''; setText($('usage'), claude.concat([''], agy).join('\\n'));
    $('daemon').className = ''; setText($('daemon'), data.daemon || '-');
    renderSessions(data.sessions, data.now || Date.now());
    var ev = data.events || [];
    $('events').className = 'events' + (ev.length ? '' : ' empty');
    setText($('events'), ev.length ? ev.join('\\n') : 'Belum ada event.');
    var d = new Date(data.now || Date.now());
    setText($('meta'), '127.0.0.1 \\u00b7 diperbarui ' + d.toLocaleTimeString());
  }

  function tick() {
    fetch('/api/status', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(apply)
      .catch(function (e) { $('meta').className = 'meta err'; setText($('meta'), 'gagal muat: ' + e.message); });
  }

  tick();
  setInterval(tick, REFRESH_MS);
})();
</script>
</body>
</html>`;

/** HTML halaman monitor (statis, self-contained). Fungsi (bukan konstanta ekspor) supaya konsisten
 *  pola `render*` + mudah di-mock/di-uji. */
export function renderPage(): string {
  return PAGE_HTML;
}
