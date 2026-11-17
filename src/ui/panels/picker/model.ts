/**
 * Pure helpers for the picker: category chips, search filtering, upload
 * report wording and the "last used dance" rule. No DOM, unit-tested in Node.
 */
import type { UploadReport } from '../../../types';

/** Anything listed in the picker. */
export interface PickerItem {
  id: string;
  name: string;
  source: string;
  category?: string;
}

/** Chip values: 'all', 'uploads', or 'cat:<category>'. */
export type CategoryValue = string;

export const ALL = 'all';
export const UPLOADS = 'uploads';

export interface CategoryOption {
  value: CategoryValue;
  label: string;
  count: number;
}

/** True for entries the user added on this device (deletable from their card). */
export function isUpload(item: Pick<PickerItem, 'id'>): boolean {
  return item.id.startsWith('upload:');
}

/** "All", then each category in first-seen order, then "My uploads" when there are any. */
export function categoryOptions(items: readonly PickerItem[]): CategoryOption[] {
  const counts = new Map<string, number>();
  let uploads = 0;
  for (const item of items) {
    if (isUpload(item)) uploads++;
    const category = item.category?.trim();
    if (category && !isUpload(item)) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const options: CategoryOption[] = [{ value: ALL, label: 'All', count: items.length }];
  for (const [category, count] of counts) options.push({ value: `cat:${category}`, label: category, count });
  if (uploads > 0) options.push({ value: UPLOADS, label: 'My uploads', count: uploads });
  return options;
}

/** Lower-case, accent-free text for matching. */
export function normalizeText(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Items in `category` whose name or category contains every word of `query`. */
export function filterItems<T extends PickerItem>(items: readonly T[], category: CategoryValue, query: string): T[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (category === UPLOADS && !isUpload(item)) return false;
    if (category.startsWith('cat:') && (isUpload(item) || item.category?.trim() !== category.slice(4))) return false;
    if (words.length === 0) return true;
    const haystack = normalizeText(`${item.name} ${item.category ?? ''}`);
    return words.every((word) => haystack.includes(word));
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One-line summary of an upload, e.g. "Added 1 character and 2 dances. 1 file could not be used." */
export function summarizeUpload(report: UploadReport): string {
  const parts: string[] = [];
  if (report.characters.length) parts.push(plural(report.characters.length, 'character'));
  if (report.dances.length) parts.push(plural(report.dances.length, 'dance'));
  if (report.songs.length) parts.push(plural(report.songs.length, 'song'));
  const added = parts.length === 0 ? 'Nothing was added.' : `Added ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`;
  const problems = report.problems.length;
  return problems === 0 ? added : `${added} ${plural(problems, 'file')} could not be used.`;
}

/**
 * The dance a new dancer gets: the dance most recently chosen or changed on
 * stage, when it still exists, else `fallback`.
 */
export function lastUsedDance(
  previous: readonly { id: string; danceId: string }[] | undefined,
  next: readonly { id: string; danceId: string }[],
  remembered: string | null,
): string | null {
  if (!previous) return next.length > 0 ? next[next.length - 1]!.danceId : remembered;
  const before = new Map(previous.map((d) => [d.id, d.danceId]));
  let found = remembered;
  for (const dancer of next) {
    const old = before.get(dancer.id);
    if (old !== dancer.danceId) found = dancer.danceId;
  }
  return found;
}
