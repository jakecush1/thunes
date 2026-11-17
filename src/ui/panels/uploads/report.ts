/**
 * Pure helpers that turn an UploadReport into short toast messages, plus the
 * one shared routine panels use to add files (music dropzone, window drop).
 */
import type { CharacterDef, DanceDef, SongDef, UploadReport } from '../../../types';

export type UploadNoticeKind = 'ok' | 'warn' | 'error';

/** One toast's worth of feedback about an upload. */
export interface UploadNotice {
  kind: UploadNoticeKind;
  message: string;
  /** What the notice is about, so callers can attach a matching action (e.g. play the song). */
  subject: 'characters' | 'dances' | 'songs' | 'problems' | 'empty';
}

/** Most file names listed in one message before it says "and N more". */
const MAX_NAMES = 3;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "A, B and C" / "A, B, C and 2 more" with curly quotes around each name. */
export function listNames(names: readonly string[], max = MAX_NAMES): string {
  const quoted = names.map((n) => `“${n}”`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length <= max) return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `${quoted.slice(0, max).join(', ')} and ${quoted.length - max} more`;
}

/**
 * Messages for a finished upload: one per kind of asset added, and one for the
 * files that could not be used (each listed with its reason).
 */
export function describeUploadReport(report: UploadReport): UploadNotice[] {
  const notices: UploadNotice[] = [];
  const added = <T>(list: readonly T[], one: string, many: string, name: (item: T) => string, subject: UploadNotice['subject']) => {
    if (list.length === 0) return;
    notices.push({ kind: 'ok', subject, message: `Added ${plural(list.length, one, many)}: ${listNames(list.map(name))}` });
  };
  added<CharacterDef>(report.characters, 'character', 'characters', (c) => c.name, 'characters');
  added<DanceDef>(report.dances, 'dance', 'dances', (d) => d.name, 'dances');
  added<SongDef>(report.songs, 'song', 'songs', (s) => s.title, 'songs');

  const problems = report.problems;
  if (problems.length === 1) {
    const p = problems[0]!;
    notices.push({ kind: 'warn', subject: 'problems', message: `${p.file}: ${p.reason}` });
  } else if (problems.length > 1) {
    const shown = problems.slice(0, MAX_NAMES).map((p) => `${p.file} (${p.reason.replace(/\.$/, '')})`);
    const more = problems.length > MAX_NAMES ? `; and ${problems.length - MAX_NAMES} more` : '';
    notices.push({
      kind: 'warn',
      subject: 'problems',
      message: `${plural(problems.length, 'file', 'files')} could not be used: ${shown.join('; ')}${more}.`,
    });
  }
  if (notices.length === 0) notices.push({ kind: 'warn', subject: 'empty', message: 'Nothing in those files could be used.' });
  return notices;
}

/** Message shown while files are being read. */
export function describeUploadStart(count: number): string {
  return `Adding ${plural(count, 'file', 'files')}…`;
}
