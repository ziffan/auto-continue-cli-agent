// Halaman Web UI monitor (ADR-028 / M-web) — HTML SELF-CONTAINED. Kontrak (THREAT-MODEL §9):
//   • T-W4: NOL aset eksternal (CSS+JS inline; satu-satunya fetch = same-origin `/api/status`).
//   • T-W5: nilai dari API dirender via `textContent` / createElement — TAK PERNAH `innerHTML`
//           (defense-in-depth walau payload sudah ter-firewall di server).
// String statis — tak ada interpolasi data server-side (data hanya masuk di browser via fetch).

const PAGE_HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>acca — monitor</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --dim:#6b7280; --bg:#ffffff; --card:#f4f4f5; --line:#e4e4e7; --accent:#0e7490; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e5e7eb; --dim:#9ca3af; --bg:#0b0c0e; --card:#17181b; --line:#26272b; --accent:#22d3ee; }
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
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:.25rem .5rem; border-bottom:1px solid var(--line); }
  th { color:var(--dim); font-weight:600; font-size:.72rem; text-transform:uppercase; }
  td { white-space:nowrap; }
  .events { max-height:16rem; overflow:auto; }
  .empty { color:var(--dim); }
  .err { color:#dc2626; }
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
(function () {
  var REFRESH_MS = 5000;
  var $ = function (id) { return document.getElementById(id); };

  function setText(el, text) { el.textContent = text; }

  function renderSessions(list) {
    var host = $('sessions');
    host.textContent = '';
    if (!list || list.length === 0) { host.className = 'empty'; host.textContent = 'Belum ada sesi.'; return; }
    host.className = '';
    var cols = ['id', 'tool', 'status', 'proc_state', 'pid', 'reset_at', 'reset_source', 'updated_at'];
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; htr.appendChild(th); });
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    list.forEach(function (row) {
      var tr = document.createElement('tr');
      cols.forEach(function (c) {
        var td = document.createElement('td');
        var v = row[c];
        td.textContent = (v === null || v === undefined) ? '-' : String(v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function apply(data) {
    var claude = (data.usage && data.usage.claude) || [];
    var agy = (data.usage && data.usage.antigravity) || [];
    $('usage').className = ''; setText($('usage'), claude.concat([''], agy).join('\\n'));
    $('daemon').className = ''; setText($('daemon'), data.daemon || '-');
    renderSessions(data.sessions);
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
