/** Relative dates for saved scenes: "just now", "5 min ago", "yesterday", "3 days ago", "12 Mar 2026". */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Short, human description of `then` relative to `now` (both epoch ms, local time). */
export function formatRelative(then: number, now: number): string {
  if (!Number.isFinite(then)) return '';
  const diff = now - then;
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 0) {
    const hours = Math.max(1, Math.round(diff / HOUR));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** "3 dancers" / "1 dancer" / "Empty stage". */
export function dancerCount(count: number): string {
  if (count === 0) return 'Empty stage';
  return `${count} ${count === 1 ? 'dancer' : 'dancers'}`;
}
