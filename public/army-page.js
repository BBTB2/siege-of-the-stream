/** Keep every knight's world slot; only choose which 60-person company is drawn. */
export function armyPage(knights, now) {
  const pageSize = 60;
  const pageCount = Math.max(1, Math.ceil(knights.length / pageSize));
  const page = Math.floor(now / 6000) % pageCount;
  return {
    page: page + 1,
    pageCount,
    knights: knights.slice(page * pageSize, (page + 1) * pageSize),
  };
}
