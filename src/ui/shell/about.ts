/** The About and help dialog: what this is, keyboard shortcuts, bring your own assets. */
import { APP_NAME, APP_TAGLINE, BAND, MAX_DANCERS } from '../../config';
import { createModal } from '../components/modal';
import type { DialogHandle, UiContext } from '../context';
import { externalLink, h, icon, logo } from '../dom';
import { isApplePlatform, shortcutList } from '../shortcuts';

export function createAboutDialog(_ctx: UiContext): DialogHandle {
  const modal = createModal({ title: `About ${APP_NAME}`, size: 'md', className: 'about' });
  const mod = isApplePlatform(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
  const section = (title: string, ...children: Node[]) =>
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h3', { class: 'section__title', text: title })), ...children);

  const shortcuts = h('dl', { class: 'about__keys' });
  for (const item of shortcutList(mod)) {
    const keys = h('dt', {});
    item.keys.forEach((key) => keys.append(key === '–' ? h('span', { class: 'about__to', text: 'to' }) : h('kbd', { class: 'kbd', text: key })));
    shortcuts.append(h('div', { class: 'about__key' }, keys, h('dd', { text: item.action })));
  }

  const folders = h(
    'ul',
    { class: 'about__list' },
    h('li', {}, h('strong', { text: 'Characters: ' }), 'a humanoid .glb, .gltf or .fbx model in ', h('code', { text: 'public/assets/characters/' })),
    h('li', {}, h('strong', { text: 'Dances: ' }), 'an animated .glb, .fbx or .bvh file in ', h('code', { text: 'public/assets/dances/' })),
    h('li', {}, h('strong', { text: 'Music: ' }), 'an .mp3, .wav, .ogg or .m4a file in ', h('code', { text: 'public/assets/music/' })),
  );

  const bandLinks = h(
    'p',
    { class: 'about__links' },
    externalLink(BAND.website, `${BAND.name} website`, icon('external', 'sm'), BAND.websiteLabel),
    externalLink(BAND.instagram, `${BAND.name} on Instagram`, icon('instagram', 'sm'), BAND.instagramHandle),
  );
  const band = h(
    'section',
    { class: 'section about__band' },
    logo(BAND.name),
    h(
      'div',
      { class: 'about__band-text' },
      h('p', { class: 'about__text', text: `A dance party by ${BAND.name}. Find their music, shows and videos here:` }),
      bandLinks,
    ),
  );

  modal.body.append(
    band,
    section(
      'What this is',
      h('p', { class: 'about__text', text: `${APP_TAGLINE} Put up to ${MAX_DANCERS} dancers on the floor, give each one a character and a dance, tune how they move and look, set the scene, and share it with a link.` }),
      h('p', { class: 'about__text', text: 'Any dance works on any humanoid character: the motion is retargeted on the fly. The built-in characters, dances and music are placeholders generated in code.' }),
    ),
    section('Keyboard shortcuts', shortcuts, h('p', { class: 'about__text about__muted', text: 'Shortcuts pause while you type in a field or a dialog is open.' })),
    section(
      'Bring your own',
      h('p', { class: 'about__text', text: 'Drag files anywhere onto the page, or use the upload cards in the pickers. Uploads stay on this device.' }),
      h('p', { class: 'about__text', text: 'To ship files with the app, drop them into these folders and reload:' }),
      folders,
    ),
  );
  const done = h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'Got it' });
  done.addEventListener('click', () => modal.close());
  modal.actions.append(done);
  modal.hint.append(h('span', { text: `Logo © ${BAND.name}. Have fun.` }));
  return { open: () => modal.open(), destroy: () => modal.destroy() };
}
