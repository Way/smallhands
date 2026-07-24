// The "Report a problem" overlay: the browser half of game/report.ts.
//
// Everything that needs the DOM or a canvas lives here — collecting and
// formatting the report itself stays pure next door, so the headless suites can
// test the interesting part without a browser.
//
// There is no submit endpoint. Smallhands is a static build, so the report goes
// to the clipboard or to disk and the player attaches it wherever they like.

import { TILE } from './types';
import type { Game } from './sim';
import { Camera, Renderer } from './render';
import { collectReport, formatReport } from './report';
import type { ReportData, ReportKind } from './report';
import { getLang, t } from '../engine/i18n';
import { audio } from '../engine/audio';

const KINDS: ReportKind[] = ['bug', 'feedback', 'idea'];

// Widest the whole-map overview may get. Big enough to read individual tiles on
// a large map, small enough that the PNG stays attachable.
const MAP_MAX_W = 2048;
const MAP_MAX_H = 1400;

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
  const viewportPng = safeDataUrl(canvas);
  // The whole-map overview is rendered lazily — it costs a full extra draw, and
  // someone who only copies the text never needs it.
  let mapPng: string | null = null;

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

  const copyBtn = el('button', 'seg-btn', row);
  copyBtn.textContent = t('report.copy');
  copyBtn.onclick = async () => {
    audio.click();
    const ok = await copyText(markdown);
    status.textContent = ok ? t('report.copied') : t('report.copyFailed');
    if (!ok) selectAll(preview);
  };

  const dlBtn = el('button', 'seg-btn', row);
  dlBtn.textContent = t('report.download');
  dlBtn.onclick = async () => {
    audio.click();
    status.textContent = t('report.rendering');
    // Yield a frame so the status paints before the map render blocks.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (mapPng === null) mapPng = renderWholeMap(game);
    const stem = fileStem(data);
    const files: { name: string; body: string | Blob }[] = [{ name: `${stem}.md`, body: markdown }];
    if (viewportPng) files.push({ name: `${stem}-viewport.png`, body: dataUrlToBlob(viewportPng) });
    if (mapPng) files.push({ name: `${stem}-map.png`, body: dataUrlToBlob(mapPng) });
    downloadAll(files);
    status.textContent = t('report.downloaded', { n: files.length });
  };

  const closeBtn = el('button', 'seg-btn', row);
  closeBtn.textContent = t('report.close');
  closeBtn.onclick = () => {
    audio.click();
    ov.remove();
    opts.onClose();
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

// ---- screenshots -----------------------------------------------------------------

function safeDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null; // tainted canvas or an out-of-memory browser: text report only
  }
}

// One offscreen draw of the entire level, so a reader sees the global layout
// without hunting around the player's viewport.
function renderWholeMap(game: Game): string | null {
  const zoom = Math.min(2, MAP_MAX_W / (game.world.w * TILE), MAP_MAX_H / (game.world.h * TILE));
  const off = document.createElement('canvas');
  off.width = Math.ceil(game.world.w * TILE * zoom);
  off.height = Math.ceil(game.world.h * TILE * zoom);

  const cam = new Camera();
  cam.x = 0;
  cam.y = 0;
  cam.zoom = zoom;

  const renderer = new Renderer(off);
  // Static frame: no springs, ropes or bird animation to settle for a still.
  renderer.effectsReduced = true;

  // The look-physics layer drains game.lookEvents on every update — including
  // when reduced. Hand this renderer its own throwaway buffer so it cannot eat
  // breadcrumbs the live renderer has not drawn yet.
  const live = game.lookEvents;
  game.lookEvents = [];
  try {
    renderer.draw(game, cam, { tool: 'select', tx: -1, ty: -1, visible: false }, 0);
    return safeDataUrl(off);
  } catch {
    return null;
  } finally {
    game.lookEvents = live;
  }
}

// ---- clipboard & downloads --------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // insecure context, denied permission, or no clipboard API
  }
}

function selectAll(node: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream' });
}

// Browsers rate-limit a burst of downloads from one gesture, so space them out.
function downloadAll(files: { name: string; body: string | Blob }[]): void {
  files.forEach((f, i) => {
    setTimeout(() => {
      const blob = typeof f.body === 'string' ? new Blob([f.body], { type: 'text/markdown' }) : f.body;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, i * 300);
  });
}

function fileStem(d: ReportData): string {
  const slug = d.context.levelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const stamp = d.context.generatedAt.replace(/[:.]/g, '-').slice(0, 19);
  return `smallhands-${d.context.kind}-${slug || 'level'}-${stamp}`;
}
