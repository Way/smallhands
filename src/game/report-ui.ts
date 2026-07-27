// The "Report a problem" overlay: the browser half of game/report.ts.
//
// Everything that needs the DOM or a canvas lives here — collecting and
// formatting the report itself stays pure next door, so the headless suites can
// test the interesting part without a browser.
//
// There is no submit endpoint. Smallhands is a static build, so the report goes
// to the clipboard or to disk and the player attaches it wherever they like.

import type { Game } from './sim';
import { collectReport, formatReport } from './report';
import type { ReportData, ReportKind } from './report';
import { SHOT_FULL, mapShotDataUrl } from './mapshot';
import {
  CAN_DOWNLOAD,
  canvasDataUrl,
  copyText,
  dataUrlToBlob,
  downloadAll,
  fileStem as stemFor,
} from './share';
import { getLang, t } from '../engine/i18n';
import { audio } from '../engine/audio';

const KINDS: ReportKind[] = ['bug', 'feedback', 'idea'];

export interface ReportOptions {
  game: Game;
  canvas: HTMLCanvasElement; // the live game canvas, for the viewport shot
  levelLabel: string; // "campaign 2 · level 7" — main.ts knows this, the sim doesn't
  levelName: string; // the level's displayed name; LevelDef.name is only an i18n key
  originCode?: string; // the pristine starting code, for custom levels
  speed: number; // main-loop speed multiplier; not a sim concern
  build: string;
  onClose: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export function showReportOverlay(opts: ReportOptions): void {
  const { game, canvas } = opts;

  // Grab the player's exact frame now, before anything else can redraw it.
  const viewportPng = canvasDataUrl(canvas);
  // The whole-map overview is rendered lazily — it costs a full extra draw, and
  // someone who only copies the text never needs it. `undefined` means "not
  // attempted"; `null` means "attempted and failed", so a tainted or
  // out-of-memory canvas is not re-rendered on every subsequent click.
  let mapPng: string | null | undefined = undefined;

  const data = collectReport(game, {
    kind: 'bug',
    message: '',
    levelLabel: opts.levelLabel,
    levelName: opts.levelName,
    originCode: opts.originCode,
    speed: opts.speed,
    build: opts.build,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio ?? 1}`,
    lang: getLang(),
    generatedAt: new Date().toISOString(),
  });

  const ov = el('div', 'overlay');
  const box = el('div', 'panel report-box', ov);

  const title = el('h2', 'opt-title', box);
  title.textContent = t('report.title.bug');

  const intro = el('div', 'opt-note', box);
  intro.textContent = t('report.intro');

  // ---- kind ----
  const kindRow = el('div', 'opt-row', box);
  el('span', 'opt-label', kindRow).textContent = t('report.kind');
  const seg = el('div', 'seg', kindRow);
  const kindBtns = new Map<ReportKind, HTMLButtonElement>();
  for (const k of KINDS) {
    const b = el('button', 'seg-btn' + (k === 'bug' ? ' active' : ''), seg);
    b.textContent = t(`report.kind.${k}`);
    b.onclick = () => {
      audio.click();
      data.context.kind = k;
      for (const [other, btn] of kindBtns) btn.classList.toggle('active', other === k);
      title.textContent = t(`report.title.${k}`);
      note.textContent = t(`report.hint.${k}`);
      refresh();
    };
    kindBtns.set(k, b);
  }

  const note = el('div', 'opt-note', box);
  note.textContent = t('report.hint.bug');

  // ---- what happened ----
  const ta = el('textarea', 'report-text', box);
  ta.rows = 4;
  ta.placeholder = t('report.placeholder');
  // The global keydown handler already ignores events from a TEXTAREA, so the
  // game's tool and zoom shortcuts stay out of the way while typing.
  ta.oninput = () => {
    data.context.message = ta.value;
    refresh();
  };

  // ---- preview ----
  const previewLabel = el('div', 'opt-note', box);
  previewLabel.textContent = t('report.preview');
  const preview = el('pre', 'report-preview', box);

  // ---- actions ----
  const status = el('div', 'report-status', box);
  const row = el('div', 'btn-row', box);

  const copyBtn = el('button', 'seg-btn report-copy', row);
  copyBtn.textContent = t('report.copy');
  copyBtn.onclick = async () => {
    audio.click();
    const ok = await copyText(markdown);
    status.textContent = ok ? t('report.copied') : t('report.copyFailed');
    if (!ok) selectAll(preview);
  };

  const dlBtn = el('button', 'seg-btn report-download', row);
  dlBtn.textContent = t('report.download');
  dlBtn.onclick = () => {
    audio.click();
    if (!CAN_DOWNLOAD) {
      // Some mobile browsers (iOS Safari in particular) will not take a blob:
      // download. Saying "saved" there would be a straight lie.
      status.textContent = t('report.downloadUnsupported');
      selectAll(preview);
      return;
    }
    // Everything below stays synchronous, inside the click, so the anchors keep
    // the user activation browsers require before saving a file. That costs the
    // "rendering…" status a paint, which is a fair trade for the download
    // actually happening.
    if (mapPng === undefined) mapPng = mapShotDataUrl(game, SHOT_FULL);
    const stem = fileStem(data);
    const files: { name: string; body: string | Blob }[] = [{ name: `${stem}.md`, body: markdown }];
    if (viewportPng) files.push({ name: `${stem}-viewport.png`, body: dataUrlToBlob(viewportPng) });
    if (mapPng) files.push({ name: `${stem}-map.png`, body: dataUrlToBlob(mapPng) });
    downloadAll(files);
    // "Sent", not "saved": the page issues the downloads and cannot observe
    // whether the browser accepted them, and a screenshot may be missing if the
    // canvas refused to export.
    status.textContent =
      files.length === 3 ? t('report.downloaded', { n: files.length }) : t('report.downloadedPartial', { n: files.length });
  };

  const closeBtn = el('button', 'seg-btn report-close', row);
  closeBtn.textContent = t('report.close');
  // Escape closes, even from inside the textarea. The global handler bails on
  // TEXTAREA targets — correctly, so typing never fires a game shortcut — which
  // would otherwise leave this the one overlay you cannot dismiss with the key
  // every other overlay uses.
  //
  // Bound to the document rather than to `ov`: clicking the backdrop moves focus
  // to <body>, and a listener on the overlay would never see the keydown again.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    ov.remove();
    opts.onClose();
  };
  document.addEventListener('keydown', onKey, true);
  closeBtn.onclick = () => {
    audio.click();
    close();
  };

  let markdown = '';
  function refresh(): void {
    // Only the presentation is redone here — the expensive walk over workers,
    // buildings and tiles happened once, when the overlay opened.
    markdown = formatReport(data);
    preview.textContent = markdown;
  }
  refresh();

  document.getElementById('ui-root')?.appendChild(ov);
  ta.focus();
}

// ---- selection fallback ------------------------------------------------------------

function selectAll(node: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function fileStem(d: ReportData): string {
  return stemFor(d.context.kind, d.context.levelName, d.context.generatedAt);
}
