// Read daily aggregates saved by a statistics collector. The background
// countdown engine does not itself save these records.
const PREFIX = 'headcloud-stats-';
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export async function getWeeklyStatistics() {
  const dates = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    dates.push(localDate(date));
  }
  const keys = dates.map(date => PREFIX + date);
  const stored = await chrome.storage.local.get(keys);
  const number = x => Number.isFinite(x) && x >= 0 ? x : 0;
  const daily = dates.map((date, index) => {
    const entry = stored[keys[index]];
    return {
      date,
      screenMs: number(entry?.screenMs),
      awayMs: number(entry?.awayMs),
      breaks: Number.isInteger(entry?.breaks) && entry.breaks >= 0 ? entry.breaks : 0,
      recorded: Boolean(entry && typeof entry === 'object')
    };
  });
  const totals = daily.reduce((acc, d) => ({
    screenMs: acc.screenMs + d.screenMs,
    awayMs: acc.awayMs + d.awayMs,
    breaks: acc.breaks + d.breaks
  }), { screenMs:0, awayMs:0, breaks:0 });
  // Do not leak the local-only 'recorded' flag to the Worker.
  return { daily, totals };
}
