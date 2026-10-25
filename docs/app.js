/*
  The playable part of the page. All math is in quant.js; this file only reads
  the controls and draws results. Claude's picks come from the snapshot in
  data.json (made by publish.py), because Claude can't run in a visitor's browser.
*/
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, digits = 1) => (x === null || x === undefined) ? "n/a" : (x >= 0 ? "+" : "") + (x * 100).toFixed(digits) + "%";
  const cls = x => x === null ? "" : x >= 0 ? "pos" : "neg";
  const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const RISK_INFO = {
    low: "Calm stocks only: volatility at or below the middle of the pack, and no drop worse than -25%.",
    medium: "Some bumps allowed: volatility in the calmer 80%, and no drop worse than -35%.",
    high: "Anything goes. Rewards momentum and raw return.",
  };
  const MEDALS = [["#ffd23f", "#c99a00", "#7a5c00", "Gold"], ["#d9dee3", "#8d969e", "#4a5259", "Silver"], ["#e09a5c", "#9c5f2b", "#5c3612", "Bronze"]];

  let data, state;

  function medal(i) {
    const [fill, stroke, text] = MEDALS[i] || MEDALS[2];
    return `<svg class="medal" viewBox="0 0 96 96" aria-hidden="true"><polygon points="48,4 88,26 88,70 48,92 8,70 8,26" fill="${fill}" stroke="${stroke}" stroke-width="5"/><text x="48" y="60" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="34" fill="${text}">${i + 1}</text></svg>`;
  }

  function miniStats(m) {
    return `<div class="mini"><span>Sharpe ${m.sharpe.toFixed(2)}</span><span>Vol ${(m.ann_vol * 100).toFixed(1)}%</span><span>DD ${(m.max_drawdown * 100).toFixed(1)}%</span></div>`;
  }

  function lastIndex() { return data.dates.length - 1; }
  function fullSquad() { return state.squad.size === data.tickers.length; }

  /* ---------- controls ---------- */

  function buildControls() {
    const chips = $("squad");
    chips.innerHTML = data.tickers.map(t =>
      `<button type="button" class="chip-btn" aria-pressed="true" data-t="${t}">${t}</button>`).join("");
    chips.addEventListener("click", e => {
      const b = e.target.closest(".chip-btn");
      if (!b) return;
      const t = b.dataset.t;
      if (state.squad.has(t)) {
        if (state.squad.size <= 3) { flash("Keep at least 3 stocks in your squad."); return; }
        state.squad.delete(t);
      } else state.squad.add(t);
      b.setAttribute("aria-pressed", state.squad.has(t));
      render();
    });
    $("squad-all").addEventListener("click", () => {
      state.squad = new Set(data.tickers);
      chips.querySelectorAll(".chip-btn").forEach(b => b.setAttribute("aria-pressed", "true"));
      render();
    });

    document.querySelectorAll(".risk-btn").forEach(b => b.addEventListener("click", () => {
      state.risk = b.dataset.risk;
      document.querySelectorAll(".risk-btn").forEach(x => x.setAttribute("aria-pressed", x === b));
      render();
    }));

    const slider = $("when");
    slider.min = Quant.TRADING_DAYS;
    slider.max = lastIndex();
    slider.value = lastIndex();
    slider.addEventListener("input", () => { state.asOf = +slider.value; render(); });
    $("when-today").addEventListener("click", () => { slider.value = lastIndex(); state.asOf = lastIndex(); render(); });
  }

  let flashTimer;
  function flash(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------- results ---------- */

  function render() {
    const tickers = data.tickers.filter(t => state.squad.has(t));
    const metrics = Quant.computeMetrics(data, tickers, state.asOf);
    const ok = Quant.eligible(metrics, state.risk);
    const ranking = Quant.baselineRanking(metrics, state.risk).filter(t => ok.includes(t));

    $("when-label").textContent = fmtDate(data.dates[state.asOf]);
    $("when-today").hidden = state.asOf === lastIndex();
    $("risk-info").textContent = RISK_INFO[state.risk];
    $("squad-count").textContent = `${tickers.length} of ${data.tickers.length} picked`;

    renderPodium(ranking, metrics);
    renderClaude(ranking);
    renderCut(tickers, ok, metrics);
    renderTable(tickers, ok, metrics);
    renderLeaderboard(tickers);
    renderBadges();
  }

  function renderPodium(ranking, metrics) {
    const top = ranking.slice(0, 3);
    const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i); // silver, gold, bronze
    $("podium").innerHTML = top.length ? order.map(i => {
      const t = top[i], m = metrics[t];
      return `<div class="step-block p${i + 1}">
        <div class="podium-name">${t}</div>
        <div class="podium-stats">Sharpe ${m.sharpe.toFixed(2)}<br>DD ${(m.max_drawdown * 100).toFixed(1)}%</div>
        <div class="podium-base">${i + 1}</div>
      </div>`;
    }).join("") : `<p class="empty">No stock in your squad passes the ${state.risk}-risk gate on this date. Add more stocks or try a higher risk level.</p>`;

    const fwd = top.map(t => Quant.forwardReturn(data, t, state.asOf, 21));
    const spy = Quant.forwardReturn(data, Quant.BENCHMARK, state.asOf, 21);
    const valid = fwd.filter(x => x !== null);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    $("future").innerHTML = (avg === null || spy === null)
      ? "🔮 This is the latest date, so there's no future to peek at yet. Slide back in time to see how a pick would have done."
      : `🔮 <b>Peek at the future:</b> over the next month ${top.length === 1 ? "this pick" : `these ${top.length}`} went <b class="${cls(avg)}">${pct(avg)}</b> on average, vs SPY <b class="${cls(spy)}">${pct(spy)}</b>. ${avg > spy ? "Team Code wins this round! 🏆" : "SPY wins this round."}`;
  }

  function renderClaude(ranking) {
    const snap = data.claude && data.claude[state.risk];
    const box = $("claude-call");
    if (!snap) {
      box.innerHTML = `<p class="empty">No Claude snapshot yet for ${state.risk} risk. Run <code>python publish.py</code> to make one.</p>`;
      return;
    }
    const snapIdx = data.dates.indexOf(snap.as_of);
    if (state.asOf !== snapIdx || !fullSquad()) {
      box.innerHTML = `<div class="locked">
        <div class="lock-ico" aria-hidden="true">🔒</div>
        <div><b>Claude's call is locked here.</b> Claude can't run inside your browser, so its picks are a snapshot from ${fmtDate(snap.as_of)} using the full squad.
        <div><button type="button" class="btn btn-small btn-orange" id="go-claude">Jump to Claude's day</button></div></div>
      </div>`;
      $("go-claude").addEventListener("click", () => {
        state.squad = new Set(data.tickers);
        document.querySelectorAll(".chip-btn").forEach(b => b.setAttribute("aria-pressed", "true"));
        state.asOf = snapIdx;
        $("when").value = snapIdx;
        render();
      });
      return;
    }
    const picks = [...snap.answer.picks].sort((a, b) => a.rank - b.rank).map(p => p.ticker);
    const agree = picks.filter((t, i) => ranking[i] === t).length;
    const overlap = picks.filter(t => ranking.slice(0, picks.length).includes(t)).length;
    box.innerHTML = `<p class="claude-line">Claude picked
      ${picks.map((t, i) => `<b>${i + 1}. ${t}</b>`).join(" · ")}</p>
      <p class="muted">${esc(snap.answer.summary)}</p>
      <p class="muted">Agrees with Team Code on ${overlap} of ${picks.length} picks${agree === picks.length ? ", in the same order" : ""}. See the <a href="#tabs" data-jump="badges">Badges tab</a> for its full reasoning.</p>`;
    box.querySelector("[data-jump]").addEventListener("click", () => selectTab("badges"));
  }

  function renderCut(tickers, ok, metrics) {
    const rule = Quant.RISK_RULES[state.risk];
    const vols = tickers.map(t => metrics[t].ann_vol).sort((a, b) => a - b);
    const pos = (vols.length - 1) * rule.volPct, lo = Math.floor(pos);
    const cap = vols[lo] + (vols[Math.ceil(pos)] - vols[lo]) * (pos - lo);
    const kicked = tickers.filter(t => !ok.includes(t)).map(t => {
      const m = metrics[t], why = [];
      if (m.max_drawdown < rule.maxDrawdownMin) why.push(`dropped ${(m.max_drawdown * 100).toFixed(0)}%`);
      if (m.ann_vol > cap) why.push(`too bumpy (vol ${(m.ann_vol * 100).toFixed(0)}%)`);
      return `<li><b>${t}</b> <span>${why.join(", ")}</span></li>`;
    });
    $("cut").innerHTML = `<p class="muted"><b class="pos">${ok.length} made it</b> through the ${state.risk}-risk gate: ${ok.join(", ") || "none"}.</p>` +
      (kicked.length ? `<ul class="kicked-list">${kicked.join("")}</ul>` : `<p class="muted">Nobody got kicked.</p>`);
  }

  function renderTable(tickers, ok, metrics) {
    const cols = [["sharpe", "Sharpe", 2, false], ["ann_return", "Return", 1, true], ["ann_vol", "Vol", 1, true], ["max_drawdown", "Max drop", 1, true], ["beta", "Beta", 2, false], ["mom_3m", "3-mo", 1, true]];
    const rows = [...tickers].sort((a, b) => metrics[b].sharpe - metrics[a].sharpe);
    $("stats-table").innerHTML = `<thead><tr><th>Stock</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(t => `<tr class="${ok.includes(t) ? "" : "out"}"><td class="who">${t}${ok.includes(t) ? "" : ' <small>kicked</small>'}</td>` +
        cols.map(([k, , d, isPct]) => {
          const v = metrics[t][k];
          return `<td>${isPct ? pct(v, d) : v.toFixed(d)}</td>`;
        }).join("") + "</tr>").join("") + "</tbody>";
  }

  function renderLeaderboard(tickers) {
    const bt = Quant.backtest(data, tickers, state.risk);
    const players = [
      ["Team Code's top 3", "Top 3 by weighted stat ranks", bt.baseline],
      ["Everyone who made the cut", "Equal weight, all that passed the gate", bt.eligibleEqWt],
      ["SPY", "Just hold the market", bt.spy],
    ].sort((a, b) => b[2].total - a[2].total);
    const icons = ["🥇", "🥈", "🥉"];
    $("lb-caption").textContent = `${bt.rows.length} monthly replays (${fmtDate(bt.rows[0].date)} to ${fmtDate(bt.rows[bt.rows.length - 1].date)}), ${state.risk} risk, ${tickers.length} stocks, top 3 picks held for 21 trading days. Each month only uses data that existed on that date.`;
    $("lb-body").innerHTML = players.map(([name, sub, s], i) => `<tr>
      <td class="place${i === 0 ? " gold" : ""}">${icons[i]}</td>
      <td class="who">${name}<small>${sub}</small></td>
      <td class="${cls(s.avg)}">${pct(s.avg)}</td><td class="${cls(s.worst)}">${pct(s.worst)}</td>
      <td>${name === "SPY" ? "n/a" : s.beatSpy + " / " + bt.rows.length}</td><td class="${cls(s.total)}">${pct(s.total)}</td></tr>`).join("");
    $("lb-months").innerHTML = bt.rows.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${r.picks.join(" ")}</td><td class="${cls(r.baseline)}">${pct(r.baseline)}</td><td class="${cls(r.spy)}">${pct(r.spy)}</td></tr>`).join("");
    document.querySelectorAll("[data-risk-name]").forEach(el => { el.textContent = state.risk; });
  }

  function renderBadges() {
    const snap = data.claude && data.claude[state.risk];
    if (!snap) { $("badge-grid").innerHTML = `<p class="empty">No Claude snapshot for ${state.risk} risk yet.</p>`; $("badge-extra").innerHTML = ""; return; }
    const idx = data.dates.indexOf(snap.as_of);
    const metrics = Quant.computeMetrics(data, data.tickers, idx);
    $("badge-lead").textContent = `Claude's ${state.risk}-risk picks using closing prices from ${fmtDate(snap.as_of)}. Every stat it cited was checked against the data. Change the risk level on the Play tab to see its other picks.`;
    const picks = [...snap.answer.picks].sort((a, b) => a.rank - b.rank);
    $("badge-grid").innerHTML = picks.map((p, i) => `<article class="card badge">
      ${medal(i)}
      <div class="rank">${(MEDALS[i] || MEDALS[2])[3]} · Rank ${p.rank}</div>
      <h3>${esc(p.ticker)}</h3>
      ${metrics[p.ticker] ? miniStats(metrics[p.ticker]) : ""}
      <p>${esc(p.thesis)} <b>Main risk:</b> ${esc(p.main_risk)}</p>
    </article>`).join("");
    const avoid = snap.answer.avoid || [];
    const tries = snap.attempts.length, last = snap.attempts[tries - 1];
    $("badge-extra").innerHTML =
      (avoid.length ? `<div class="card kicked"><h3>🥾 Kicked from the server</h3>${avoid.map(a => `<div class="kick"><b>${esc(a.ticker)}</b><span>${esc(a.reason)}</span></div>`).join("")}</div>` : "") +
      `<div class="runlog"><span class="ok">✓ Passed fact check on try ${tries}</span><span>⏱ ${last.seconds} seconds</span></div>`;
  }

  /* ---------- tabs + start ---------- */

  function selectTab(id) { document.getElementById("tab-" + id).click(); }

  function heroStats() {
    const runs = Object.values(data.claude || {});
    $("stat-tickers").textContent = data.tickers.length;
    $("stat-checks").textContent = runs.length ? `${runs.filter(r => r.attempts.length === 1).length}/${runs.length}` : "0";
    $("stat-time").textContent = runs.length ? Math.round(runs.reduce((s, r) => s + r.attempts.reduce((a, b) => a + b.seconds, 0), 0) / runs.length) + "s" : "n/a";
  }

  fetch("data.json")
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => {
      data = d;
      state = { risk: "low", squad: new Set(d.tickers), asOf: d.dates.length - 1 };
      buildControls();
      heroStats();
      render();
      document.body.classList.add("ready");
    })
    .catch(() => {
      document.querySelectorAll("[data-needs-data]").forEach(el => {
        el.innerHTML = `<p class="empty">Couldn't load the game data. If you opened this file directly, serve the docs folder instead (for example <code>python -m http.server</code>) or visit the GitHub Pages site.</p>`;
      });
    });
})();
