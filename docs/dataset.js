/*
  Turns an uploaded CSV of daily closing prices into the same shape as data.json.
  Runs entirely in the browser; the file is never sent anywhere.

  Accepted layouts:
    wide:  Date,AAPL,MSFT,SPY        one column per stock (what publish.py's sample uses)
    long:  Date,Ticker,Close         one row per stock per day ("Adj Close", "Symbol", "Price" also work)
  Dates can be YYYY-MM-DD or M/D/YYYY. Comma, semicolon or tab separated.
*/
(function (root) {
  const MIN_DAYS = 253; // one year of returns, same as quant.py's lookback + 1

  function splitLine(line, delim) {
    const out = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
      } else if (c === delim && !quoted) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parseDate(s) {
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let y, mo, d;
    if (m) [, y, mo, d] = m;
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
      [, mo, d, y] = m;
      if (y.length === 2) y = "20" + y;
    } else return null;
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const t = new Date(iso + "T12:00:00Z");
    return isNaN(t) || t.toISOString().slice(0, 10) !== iso ? null : iso;
  }

  function parseNumber(s) {
    if (s === undefined) return null;
    const v = s.replace(/[$\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
    if (v === "" || /^(na|n\/a|nan|null|-)$/i.test(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  const cleanName = s => s.replace(/^"|"$/g, "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12);

  /** Returns { dates, close: {NAME: [...]}, columns, warnings }. Throws Error with a friendly message. */
  function parse(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error("The file looks empty. It needs a header row and at least one row of prices.");
    const first = lines[0];
    const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const header = splitLine(first, delim);
    const lower = header.map(h => h.toLowerCase().replace(/[^a-z]/g, ""));
    const dateCol = Math.max(0, lower.findIndex(h => h === "date" || h === "day" || h === "timestamp"));
    const tickerCol = lower.findIndex(h => ["ticker", "symbol", "stock", "name"].includes(h));
    const priceCol = ["adjclose", "close", "price", "closeprice"].map(p => lower.indexOf(p)).find(i => i >= 0);
    const warnings = [];
    const byDate = new Map(); // date -> {NAME: price}
    let badDates = 0, badNums = 0;

    const put = (date, name, value) => {
      if (!byDate.has(date)) byDate.set(date, {});
      byDate.get(date)[name] = value;
    };

    if (tickerCol >= 0 && priceCol !== undefined) {
      for (const line of lines.slice(1)) {
        const cells = splitLine(line, delim);
        const date = parseDate(cells[dateCol] || "");
        if (!date) { badDates++; continue; }
        const name = cleanName(cells[tickerCol] || "");
        const v = parseNumber(cells[priceCol]);
        if (!name) continue;
        if (Number.isNaN(v)) { badNums++; continue; }
        if (v !== null) put(date, name, v);
      }
    } else {
      const names = header.map((h, i) => i === dateCol ? null : cleanName(h));
      const seen = new Set();
      names.forEach((n, i) => {
        if (n === null) return;
        if (!n) throw new Error(`Column ${i + 1} has no name. Every price column needs a ticker in the header row.`);
        if (seen.has(n)) throw new Error(`The column ${n} appears twice.`);
        seen.add(n);
      });
      for (const line of lines.slice(1)) {
        const cells = splitLine(line, delim);
        const date = parseDate(cells[dateCol] || "");
        if (!date) { badDates++; continue; }
        names.forEach((n, i) => {
          if (n === null) return;
          const v = parseNumber(cells[i]);
          if (Number.isNaN(v)) badNums++;
          else if (v !== null) put(date, n, v);
        });
      }
    }

    const total = lines.length - 1;
    if (byDate.size === 0) throw new Error("No rows had a date I could read. Use YYYY-MM-DD (like 2026-10-23) or M/D/YYYY.");
    if (badDates > total * 0.05) throw new Error(`${badDates} of ${total} rows have a date I couldn't read. Use YYYY-MM-DD (like 2026-10-23) or M/D/YYYY.`);
    if (badDates) warnings.push(`Skipped ${badDates} row${badDates > 1 ? "s" : ""} with an unreadable date.`);
    if (badNums) warnings.push(`Ignored ${badNums} value${badNums > 1 ? "s" : ""} that weren't numbers.`);

    let dates = [...byDate.keys()].sort();
    const counts = {};
    for (const row of byDate.values()) for (const n in row) counts[n] = (counts[n] || 0) + 1;
    const columns = Object.keys(counts).filter(n => {
      if (counts[n] >= dates.length * 0.5) return true;
      warnings.push(`Dropped ${n}: it has prices for fewer than half the days.`);
      return false;
    });
    if (!columns.length) throw new Error("No column has enough prices to use.");

    // Start on the first day every column has a price, then carry prices forward over gaps.
    const start = dates.findIndex(d => columns.every(n => byDate.get(d)[n] !== undefined));
    if (start < 0) throw new Error("There's no single day where every stock has a price. Check that the columns cover the same period.");
    if (start > 0) warnings.push(`Started on ${dates[start]}, the first day every stock has a price.`);
    dates = dates.slice(start);
    const close = {};
    let filled = 0;
    for (const n of columns) {
      let last = null;
      close[n] = dates.map(d => {
        const v = byDate.get(d)[n];
        if (v === undefined) { filled++; return last; }
        if (v <= 0) throw new Error(`${n} has a price of ${v} on ${d}. Prices must be above zero.`);
        last = v;
        return v;
      });
    }
    if (filled) warnings.push(`Filled ${filled} missing price${filled > 1 ? "s" : ""} with the previous day's price.`);
    return { dates, close, columns, warnings };
  }

  /** Builds a dataset the game can use, with `benchmark` as the market column. */
  function toDataset(parsed, benchmark, sourceName) {
    if (!parsed.columns.includes(benchmark)) throw new Error(`There's no ${benchmark} column to use as the market benchmark.`);
    const tickers = parsed.columns.filter(n => n !== benchmark);
    if (tickers.length < 3) throw new Error(`Found ${tickers.length} stock column${tickers.length === 1 ? "" : "s"} besides the benchmark. The game needs at least 3.`);
    if (parsed.dates.length < MIN_DAYS) throw new Error(`Found ${parsed.dates.length} days of prices. The stats need at least ${MIN_DAYS} trading days (about one year).`);
    return { source: sourceName, benchmark, tickers, dates: parsed.dates, close: parsed.close, claude: {} };
  }

  root.Dataset = { parse, toDataset, MIN_DAYS };
  if (typeof module !== "undefined") module.exports = root.Dataset;
})(typeof window !== "undefined" ? window : globalThis);
