/**
 * The shared "add these files" routine: calls registry.addUploads and reports
 * the outcome as toasts (one per kind added, one for rejected files).
 */
import { FALLBACK_DANCE_ID, MAX_DANCERS } from '../../../config';
import type { UploadReport } from '../../../types';
import type { UiContext } from '../../context';
import { describeUploadReport, describeUploadStart } from './report';

export interface AddFilesOptions {
  /** Start playing the first added song (the music drawer's dropzone does this). */
  playFirstSong?: boolean;
}

/** Add files through the registry and show toasts. Resolves with the report (null if adding failed). */
export async function addFilesWithToasts(ctx: UiContext, files: File[], options: AddFilesOptions = {}): Promise<UploadReport | null> {
  if (files.length === 0) return null;
  const { registry, store } = ctx.services;
  const dismissBusy = ctx.toast(describeUploadStart(files.length), { kind: 'info', duration: 0, id: 'uploads-busy' });
  let report: UploadReport;
  try {
    report = await registry.addUploads(files);
  } catch (error) {
    dismissBusy();
    ctx.toast(`Those files could not be added: ${error instanceof Error ? error.message : String(error)}`, { kind: 'error' });
    return null;
  }
  dismissBusy();
  const firstSong = report.songs[0];
  if (options.playFirstSong && firstSong) store.updateAudio({ songId: firstSong.id });

  for (const notice of describeUploadReport(report)) {
    let action: { label: string; run: () => void } | undefined;
    if (notice.subject === 'songs' && firstSong && !options.playFirstSong) {
      action = { label: 'Play', run: () => store.updateAudio({ songId: firstSong.id }) };
    } else if (notice.subject === 'characters' && report.characters[0]) {
      const character = report.characters[0];
      action = {
        label: 'Add to stage',
        run: () => {
          const danceId = report.dances[0]?.id ?? FALLBACK_DANCE_ID;
          if (!store.addDancer({ characterId: character.id, danceId })) {
            ctx.toast(`The stage is full: ${MAX_DANCERS} dancers at most.`, { kind: 'warn' });
          }
        },
      };
    }
    ctx.toast(notice.message, { kind: notice.kind, action, duration: notice.kind === 'warn' ? 9000 : undefined });
  }
  return report;
}
