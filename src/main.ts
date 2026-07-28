import './style.css';
import { FEATS, TILE, TOOL_DEFS, bestTier, fmtTime, medalFor, weatherEffects } from './game/types';
import { detectLang, getLang, setLang, t } from './engine/i18n';
import type { Lang } from './engine/i18n';
import { BIOMES } from './engine/biomes';
import type { Biome } from './engine/biomes';
import type { ItemType, MedalTier, NodeKind, Tool } from './game/types';
import { buildAtlas, drawIconTo, sprite } from './engine/sprites';
import { audio, music } from './engine/audio';
import type { Material } from './engine/audio';
import {
  deleteCustomLevel,
  exportAllData,
  importAllData,
  loadCustomLevels,
  loadSave,
  persistCustomLevels,
  persistSave,
  upsertCustomLevel,
} from './engine/save';
import type { ExportBundle } from './engine/save';
import { Game } from './game/sim';
import { findPath } from './game/nav';
import type { GameEvent } from './game/sim';
import { LEVELS } from './game/levels';
import type { LevelDef } from './game/levels';
import { Camera, Renderer } from './game/render';
import type { HoverState } from './game/render';
import { Hud, TOOL_ICON } from './game/ui';
import { FrontDoor } from './game/frontdoor';
import { Editor } from './game/editor';
import { blankLevelData, decodeShareCode, encodeShareCode, levelDefFromData, verifyLevel } from './game/leveldata';
import type { CustomLevelData } from './game/leveldata';
import { dailySeed, generateVerifiedLevel, randomSeed } from './game/generator';
import { dailyLog, dailyStats, dailyStrip } from './game/dailylog';
import type { DailyLogEntry } from './game/dailylog';
import { buildWorldMap } from './game/worldmap';
import { SHOT_CARD, SHOT_FULL, SHOT_THUMB, renderMapShot } from './game/mapshot';
import {
  CAN_DOWNLOAD,
  CAN_COPY_IMAGE,
  canShareFiles,
  canvasDataUrl,
  copyImage,
  dataUrlToBlob,
  downloadAll,
  fileStem,
  shareFiles,
} from './game/share';
import { rampCellsFaceLeft } from './game/world';
import { computeCampaignStates } from './game/progress';
import { devUnlockAll } from './engine/devmode';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;
const frontDoorRoot = document.getElementById('frontdoor') as HTMLDivElement;

buildAtlas();

// favicon from our own pixel art
{
  const fav = document.createElement('canvas');
  drawIconTo(fav, 'item_plank', 32);
  (document.getElementById('favicon') as HTMLLinkElement).href = fav.toDataURL();
}

const save = loadSave();
let customLevels = loadCustomLevels();
// Local dev mode (Vite dev server + `?dev` in the URL, see engine/devmode.ts):
// every campaign level is playable for testing. Progress stays truthful.
const devUnlock = devUnlockAll();
if (devUnlock) console.info('[smallhands] dev unlock active — all campaign levels are playable');
audio.muted = save.muted;
music.setEnabled(save.music); // background music preference; plays only once in a live level
// language: an explicit choice from the options menu wins; otherwise follow the browser
setLang(save.lang ?? detectLang());

const renderer = new Renderer(canvas);
renderer.effectsReduced = save.effects === 'reduced';
const cam = new Camera();

let game: Game | null = null;
let hud: Hud | null = null;
// Locate-on-map (card #49): a pending camera target the frame loop eases toward.
// Cleared the moment the player pans manually (they've taken over).
let panTarget: { x: number; y: number } | null = null;
function cancelPan(): void { panTarget = null; }
let currentLevelIdx = 0;
// context of the running level: campaign index or custom data (+ playtest flag)
let currentCustom: CustomLevelData | null = null;
let playtesting = false;
let speed = 1;
let lastRate = 1; // rate ⏸→▶ resumes at (never 0)
let prevSpeed = 1; // speed to restore when resuming from the level-select overlay
let running = false;
// True while a live level is the current screen — stays true through a manual
// pause or the options overlay (so the music toggle is audible), and goes false
// on the menus, the front door, the editor and on win. Distinct from `running`,
// which the options overlay clears.
let inLevel = false;

// Background music follows the scene: it plays only in a live, unfinished level
// with the tab visible. Called wherever the scene changes.
function syncMusic(): void {
  music.setPlaying(inLevel && game !== null && !game.won && !document.hidden);
}

const hover: HoverState = { tool: 'select', tx: 0, ty: 0, visible: false };
const noHover: HoverState = { tool: 'select', tx: 0, ty: 0, visible: false };

// result of the most recent win, feeding the medal ceremony
interface WinResult {
  time: number;
  medal: MedalTier | null;
  feats: string[];
  newRecord: boolean;
  firstClear: boolean;
}
let lastWin: WinResult | null = null;

function mkIcon(name: string, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'px-icon';
  drawIconTo(c, name, size);
  return c;
}

// save-file key for the running level's personal best
function recordKey(): string {
  return currentCustom ? currentCustom.id : `c${LEVELS[currentLevelIdx].id}`;
}

// How a bug report names the level. Untranslated on purpose — the report body
// is read by maintainers, not players (see game/report.ts).
function reportLevelLabel(): string {
  if (currentCustom) return `custom level "${currentCustom.name}"`;
  const def = LEVELS[currentLevelIdx];
  return `campaign ${def.campaign ?? 1} · level ${currentLevelIdx + 1}`;
}

// medal + feat slots as shown on level cards
function medalSlotRow(key: string): HTMLElement {
  const rec = save.records[key];
  const row = document.createElement('div');
  row.className = 'medal-row';
  const medalSlot = document.createElement('span');
  medalSlot.className = 'mslot' + (rec?.medal ? ' filled' : '');
  medalSlot.title = rec?.medal ? t('slot.medal', { tier: t(`medal.${rec.medal}`) }) : t('slot.none');
  if (rec?.medal) medalSlot.appendChild(mkIcon(`medal_${rec.medal}`, 26));
  row.appendChild(medalSlot);
  for (const feat of FEATS) {
    const got = rec?.feats.includes(feat.id) ?? false;
    const slot = document.createElement('span');
    slot.className = 'mslot pin' + (got ? ' filled' : '');
    slot.title = `${t(`feat.${feat.id}.name`)} — ${t(`feat.${feat.id}.desc`)}`;
    if (got) slot.appendChild(mkIcon('pin_feat', 20));
    row.appendChild(slot);
  }
  return row;
}

// The best-time / gold-target line plus the medal + feat slot row, shared by
// every card kind (campaign, daily, custom). The slots always render — empty
// ones are the replay magnet — while the text line only appears when there is
// something to show. `goldTime` is null when a card can't cheaply know its gold
// threshold (the daily is generated on demand).
function addMedalBits(card: HTMLElement, key: string, goldTime: number | null): void {
  const foot = card.querySelector('.lv-foot') as HTMLElement;
  const anchor = foot.querySelector('.lv-status');
  const rec = save.records[key];
  const parts: string[] = [];
  if (rec) parts.push(`${t('card.best')} <b>${fmtTime(rec.bestTime)}</b>`);
  if (goldTime != null) parts.push(`${t('card.gold')} ${fmtTime(goldTime)}`);
  if (parts.length) {
    const best = document.createElement('div');
    best.className = 'lv-best';
    best.innerHTML = parts.join(' · ');
    foot.insertBefore(best, anchor);
  }
  foot.insertBefore(medalSlotRow(key), anchor);
}

// ---- editor ---------------------------------------------------------------------

const editor = new Editor(uiRoot, {
  onExit: () => {
    const leave = () => {
      editor.close();
      showLevelSelect();
    };
    if (editor.dirty) showConfirm(t('confirm.leaveEditor'), t('btn.leaveEditor'), leave);
    else leave();
  },
  onPlaytest: (data) => {
    editor.close();
    startCustomLevel(data, { playtest: true });
  },
  onSave: (data) => {
    customLevels = upsertCustomLevel(customLevels, data);
  },
});

function openEditor(data?: CustomLevelData): void {
  clearOverlay();
  running = false;
  inLevel = false;
  game = null;
  hud = null;
  syncMusic();
  uiRoot.innerHTML = '';
  editor.open(data);
  canvas.style.cursor = 'crosshair'; // editor paints tiles; drop the game tool cursor
  cam.zoom = 2;
  const dpr = canvas.width / canvas.clientWidth;
  cam.rightInset = editor.panelRightInset() * dpr;
  const th = editor.game.townhall;
  cam.x = th.x * TILE * cam.zoom - (renderer.viewW - cam.rightInset) / 3;
  cam.y = th.y * TILE * cam.zoom - renderer.viewH / 2;
  cam.clamp(editor.game, renderer.viewW, renderer.viewH);
}

// ---- overlays ---------------------------------------------------------------

function clearOverlay(): void {
  document.querySelectorAll('.overlay').forEach((e) => e.remove());
}

// The front door: the game's animated title screen doubles as the marketing
// page. It renders into #frontdoor over the live idle backdrop; Play enters the
// game in place (no navigation).
const frontDoor = new FrontDoor(frontDoorRoot, {
  onPlay: () => {
    audio.click();
    enterGame();
  },
  onOptions: () => {
    audio.click();
    showOptions(enterFrontDoor);
  },
  onLang: (l) => applyLanguage(l),
  continueLabel: () => t('btn.play'),
});

// Show the scroll-reveal front door over the idle backdrop.
function enterFrontDoor(): void {
  document.body.classList.add('front-door');
  document.body.classList.remove('in-game');
  clearOverlay();
  running = false;
  inLevel = false;
  syncMusic();
  drawIdleBackdrop(); // ensure the idle scene exists behind the hero
  frontDoor.show();
  window.scrollTo(0, 0);
}

// Leave the front door and start play (level select).
function enterGame(): void {
  document.body.classList.remove('front-door');
  document.body.classList.add('in-game');
  frontDoor.hide();
  window.scrollTo(0, 0);
  showLevelSelect();
}

// Legacy entry point: "back to title" and options-return now land on the front
// door. Kept as an alias so existing call sites don't need to change.
function showTitle(): void {
  enterFrontDoor();
}

// Is there a running level whose progress would be lost?
function gameInProgress(): boolean {
  return game !== null && !game.won && game.time > 3;
}

// Small confirmation dialog stacked on top of whatever overlay is open.
function showConfirm(message: string, confirmLabel: string, onYes: () => void): void {
  const ov = document.createElement('div');
  ov.className = 'overlay confirm-overlay';
  const box = document.createElement('div');
  box.className = 'panel confirm-box';
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  msg.textContent = message;
  box.appendChild(msg);
  const row = document.createElement('div');
  row.className = 'btn-row';
  const yes = document.createElement('button');
  yes.className = 'big-btn danger';
  yes.textContent = confirmLabel;
  yes.onclick = () => {
    ov.remove();
    onYes();
  };
  row.appendChild(yes);
  const no = document.createElement('button');
  no.className = 'big-btn secondary';
  no.textContent = t('btn.cancel');
  no.autofocus = true;
  no.onclick = () => {
    audio.click();
    ov.remove();
  };
  row.appendChild(no);
  box.appendChild(row);
  ov.appendChild(box);
  ov.addEventListener('pointerdown', (e) => {
    if (e.target === ov) ov.remove();
  });
  uiRoot.appendChild(ov);
  no.focus();
}

function confirmIfInProgress(message: string, confirmLabel: string, action: () => void): void {
  if (gameInProgress()) showConfirm(message, confirmLabel, action);
  else action();
}

function resumeGame(): void {
  clearOverlay();
  running = true;
  inLevel = true;
  syncMusic();
  setSpeed(prevSpeed > 0 ? prevSpeed : 1);
  // touch: restore the armed tool's bar (dropped when the map took over) —
  // buildings park their draft ghost again, everything else re-shows its hint
  if (COARSE) {
    if (isGhostBuildTool(hover.tool)) parkTouchAim(hover.tool);
    else showAimHint();
  }
}

// ---- auto-pause on focus loss -------------------------------------------------
// Losing the tab/window focus freezes the sim so the player never comes back to
// find time (and disasters) ran on without them. Regaining focus does NOT
// silently resume: it raises a resume dialog and the game stays paused until the
// player dismisses it. `blur` covers window focus loss; `visibilitychange` covers
// tab switches — both funnel through the same guarded pause/resume pair.
let autoPaused = false;
let autoPausedSpeed = 1;

// Only a live, unfinished level should auto-pause. Front door, level select,
// options and the editor all leave `running` false (or `game` won), so they're
// naturally excluded.
function inPlayableGame(): boolean {
  return running && game !== null && !game.won;
}

function autoPauseOnFocusLoss(): void {
  if (autoPaused || !inPlayableGame()) return;
  if (speed === 0) return; // already paused by the player — nothing to freeze
  autoPaused = true;
  autoPausedSpeed = speed;
  setSpeed(0);
}

function resumeDialogOnFocus(): void {
  if (!autoPaused) return;
  // The player may have left the level while away (menu, restart, title). If we
  // aren't in a running game anymore, just drop the auto-pause state silently.
  if (!inPlayableGame()) {
    autoPaused = false;
    return;
  }
  if (uiRoot.querySelector('.resume-overlay')) return; // dialog already up
  showResumeDialog();
}

function showResumeDialog(): void {
  const ov = document.createElement('div');
  ov.className = 'overlay confirm-overlay resume-overlay';
  const box = document.createElement('div');
  box.className = 'panel confirm-box resume-box';
  const title = document.createElement('div');
  title.className = 'resume-title';
  title.textContent = t('resume.title');
  box.appendChild(title);
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  msg.textContent = t('resume.body');
  box.appendChild(msg);
  const row = document.createElement('div');
  row.className = 'btn-row';
  const btn = document.createElement('button');
  btn.className = 'big-btn';
  btn.textContent = t('resume.btn');
  btn.onclick = () => {
    ov.remove();
    autoPaused = false;
    setSpeed(autoPausedSpeed > 0 ? autoPausedSpeed : 1); // setSpeed plays the click
  };
  row.appendChild(btn);
  box.appendChild(row);
  ov.appendChild(box);
  uiRoot.appendChild(ov);
  btn.focus();
}

window.addEventListener('blur', autoPauseOnFocusLoss);
window.addEventListener('focus', resumeDialogOnFocus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autoPauseOnFocusLoss();
  else resumeDialogOnFocus();
  syncMusic(); // pause the bed when the tab is hidden, resume it when it returns
});

// ---- options menu -------------------------------------------------------------

// Language switch re-renders every open surface: the HUD is rebuilt in place
// (the sim is untouched), and the options overlay re-opens on top.
function applyLanguage(l: Lang): void {
  if (getLang() === l) return;
  setLang(l);
  save.lang = l;
  persistSave(save);
  if (game) attachHud(); // wipes uiRoot — the caller re-opens its overlay
}

function showOptions(returnTo: () => void): void {
  clearOverlay();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const box = document.createElement('div');
  box.className = 'panel options-box';
  const h = document.createElement('h2');
  h.className = 'opt-title';
  h.textContent = t('opt.title');
  box.appendChild(h);

  // a labelled row with a segmented control
  const segRow = <T extends string>(
    label: string,
    choices: { value: T; label: string }[],
    active: T,
    onPick: (v: T) => void,
    note?: string
  ): void => {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const lab = document.createElement('span');
    lab.className = 'opt-label';
    lab.textContent = label;
    row.appendChild(lab);
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (c.value === active ? ' active' : '');
      b.textContent = c.label;
      b.onclick = () => {
        audio.click();
        onPick(c.value);
      };
      seg.appendChild(b);
    }
    row.appendChild(seg);
    box.appendChild(row);
    if (note) {
      const n = document.createElement('div');
      n.className = 'opt-note';
      n.textContent = note;
      box.appendChild(n);
    }
  };

  segRow(
    t('opt.language'),
    [
      { value: 'en' as Lang, label: t('opt.lang.en') },
      { value: 'de' as Lang, label: t('opt.lang.de') },
    ],
    getLang(),
    (l) => {
      applyLanguage(l);
      showOptions(returnTo); // re-open with the new labels
    }
  );

  segRow(
    t('opt.sound'),
    [
      { value: 'on', label: t('opt.on') },
      { value: 'off', label: t('opt.off') },
    ],
    audio.muted ? 'off' : 'on',
    (v) => {
      audio.muted = v === 'off';
      save.muted = audio.muted;
      persistSave(save);
      showOptions(returnTo);
    }
  );

  segRow(
    t('opt.music'),
    [
      { value: 'on', label: t('opt.on') },
      { value: 'off', label: t('opt.off') },
    ],
    save.music ? 'on' : 'off',
    (v) => {
      save.music = v === 'on';
      music.setEnabled(save.music);
      persistSave(save);
      showOptions(returnTo);
    }
  );

  segRow(
    t('opt.effects'),
    [
      { value: 'full', label: t('opt.effects.full') },
      { value: 'reduced', label: t('opt.effects.reduced') },
    ],
    save.effects === 'reduced' ? 'reduced' : 'full',
    (v) => {
      save.effects = v as 'full' | 'reduced';
      renderer.effectsReduced = v === 'reduced';
      persistSave(save);
      showOptions(returnTo);
    },
    t('opt.effectsNote')
  );

  // reset progress
  {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const lab = document.createElement('span');
    lab.className = 'opt-label';
    lab.textContent = t('opt.reset');
    row.appendChild(lab);
    const btn = document.createElement('button');
    btn.className = 'seg-btn danger';
    btn.textContent = t('btn.reset');
    btn.onclick = () => {
      audio.click();
      showConfirm(t('confirm.reset'), t('btn.reset'), () => {
        save.completed = [];
        save.completedCustom = [];
        save.records = {};
        persistSave(save);
        showOptions(returnTo);
      });
    };
    row.appendChild(btn);
    box.appendChild(row);
    const n = document.createElement('div');
    n.className = 'opt-note';
    n.textContent = t('opt.resetDesc');
    box.appendChild(n);
  }

  // export / import: carry the whole save (progress + custom levels) to
  // another browser or device as a single JSON file
  {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const lab = document.createElement('span');
    lab.className = 'opt-label';
    lab.textContent = t('opt.transfer');
    row.appendChild(lab);
    const seg = document.createElement('div');
    seg.className = 'seg';
    const exp = document.createElement('button');
    exp.className = 'seg-btn';
    exp.textContent = t('btn.export');
    exp.onclick = () => {
      audio.click();
      const blob = new Blob([exportAllData(save, customLevels)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smallhands-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    seg.appendChild(exp);
    const imp = document.createElement('button');
    imp.className = 'seg-btn';
    imp.textContent = t('btn.import');
    imp.onclick = () => {
      audio.click();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        file.text().then((text) => {
          const bundle = importAllData(text);
          if (!bundle) {
            window.alert(t('save.importError'));
            return;
          }
          showConfirm(t('confirm.import'), t('btn.import'), () => applyImportedData(bundle, returnTo));
        });
      };
      input.click();
    };
    seg.appendChild(imp);
    row.appendChild(seg);
    box.appendChild(row);
    const n = document.createElement('div');
    n.className = 'opt-note';
    n.textContent = t('opt.transferDesc');
    box.appendChild(n);
  }

  const rowBtns = document.createElement('div');
  rowBtns.className = 'btn-row';
  const back = document.createElement('button');
  back.className = 'big-btn';
  back.textContent = t('opt.back');
  back.onclick = () => {
    audio.click();
    returnTo();
  };
  rowBtns.appendChild(back);
  box.appendChild(rowBtns);
  ov.appendChild(box);
  uiRoot.appendChild(ov);
}

// Replace the local save with an imported bundle and push it through every
// live surface (persistence, audio, effects, language, HUD), then land back
// on the options menu.
function applyImportedData(bundle: ExportBundle, returnTo: () => void): void {
  Object.assign(save, bundle.save);
  persistSave(save);
  customLevels = bundle.customLevels;
  persistCustomLevels(customLevels);
  audio.muted = save.muted;
  renderer.effectsReduced = save.effects === 'reduced';
  setLang(save.lang ?? detectLang());
  if (game) attachHud(); // wipes uiRoot — re-opened below
  showOptions(returnTo);
}

// trophy cartouche: the collection at a glance (world-map top bar)
function buildShelf(): HTMLElement | null {
  if (Object.keys(save.records).length === 0) return null;
  const shelf = document.createElement('div');
  shelf.className = 'shelf';
  const counts = { gold: 0, silver: 0, bronze: 0, feats: 0 };
  for (const r of Object.values(save.records)) {
    if (r.medal) counts[r.medal]++;
    counts.feats += r.feats.length;
  }
  for (const tier of ['gold', 'silver', 'bronze'] as const) {
    const c = document.createElement('span');
    c.className = 'count';
    c.appendChild(mkIcon(`medal_${tier}`, 30));
    c.appendChild(document.createTextNode(`× ${counts[tier]}`));
    shelf.appendChild(c);
  }
  const sep = document.createElement('span');
  sep.className = 'sep';
  shelf.appendChild(sep);
  const pins = document.createElement('span');
  pins.className = 'count';
  pins.appendChild(mkIcon('pin_feat', 24));
  pins.appendChild(document.createTextNode(`× ${counts.feats}`));
  shelf.appendChild(pins);
  const sep2 = document.createElement('span');
  sep2.className = 'sep';
  shelf.appendChild(sep2);
  const campaignGold = LEVELS.filter((l) => save.records[`c${l.id}`]?.medal === 'gold').length;
  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.innerHTML = t('shelf.gold', { a: campaignGold, b: LEVELS.length });
  shelf.appendChild(pct);
  return shelf;
}

// Boot a daily — today's or a logged past one. The seed IS the identity: it
// regenerates the same mountain and doubles as the save-record key, so a replay
// scores against the same personal best.
function bootDaily(d: { seed: string; label: string; difficulty: number }): void {
  const data = generateVerifiedLevel({ seed: d.seed, difficulty: d.difficulty });
  data.id = d.seed; // stable id so completion sticks
  data.name = t('daily.title', { label: d.label });
  startCustomLevel(data, {});
}

// ---- level previews ----------------------------------------------------------------
// The picture on a level's popover: that level's starting map, drawn once and
// kept for the session. Lazy on purpose — rendering every level when the world
// map opens would cost a Game and an offscreen draw apiece for pictures nobody
// asked to see, and the map is opened far more often than any single node.
//
// No seed is passed, so Game falls back to the level's own id and the *world* is
// identical every time. The picture is not quite: Renderer seeds its clouds from
// Math.random() per instance, so the sky differs between sessions — the cache is
// what holds a preview still within one.
//
// Keyed by String(def.id) and never evicted: 17 campaign levels at SHOT_THUMB is
// a few megabytes of backing store at worst. If custom levels ever get previews,
// this needs a namespaced key — their ids are strings and could collide with a
// campaign level's number — and probably an eviction policy.
const previewCache = new Map<string, HTMLCanvasElement | null>();

function levelPreview(def: LevelDef): HTMLCanvasElement | null {
  const key = String(def.id);
  let shot = previewCache.get(key);
  if (shot === undefined) {
    try {
      shot = renderMapShot(new Game(def), SHOT_THUMB);
    } catch {
      // A level whose build() throws is a broken level, not a broken map screen:
      // the popover simply shows no picture and Play still works.
      shot = null;
    }
    previewCache.set(key, shot);
  }
  return shot;
}

function showLevelSelect(): void {
  clearOverlay();
  running = false;
  inLevel = false;
  syncMusic();
  // Leaving the sim: the HUD stays mounted underneath (the run may resume), so
  // its floaters — parked touch aim, confirm bar, hints, toasts — must not
  // linger on top of the world map.
  clearTouchPlace();
  hud?.hideBuildingHint();
  hud?.hidePlacementNeeds();
  hud?.hideRunCost();
  hud?.clearToasts();

  // Campaign/unlock state — the gating rules live in game/progress.ts; the
  // dev-mode flag unlocks every level for local testing.
  const campaigns = computeCampaignStates(LEVELS, save.completed, devUnlock);

  const daily = dailySeed();
  // The logbook is pure derivation over the records already on disk — no new save
  // state, so a player's whole daily history shows up the first time they open it.
  const log = dailyLog(save.records);
  const ov = buildWorldMap({
    campaigns,
    daily: { ...daily, done: save.completedCustom.includes(daily.seed) },
    dailyLog: log,
    dailyStats: dailyStats(log, daily.label),
    dailyStrip: dailyStrip(log, daily.label),
    customLevels,
    shelf: buildShelf(),
    resumeLabel: gameInProgress() ? t('btn.resume', { name: t(game!.level.name) }) : null,
    bestMedal: (key) => save.records[key]?.medal ?? null,
    addMedalBits,
    levelPreview,
    customDone: (id) => save.completedCustom.includes(id),
    click: () => audio.click(),
    onPlayLevel: (i) =>
      confirmIfInProgress(
        t('confirm.abandonNamed', { name: t(game?.level.name ?? '') }),
        t('btn.abandon'),
        () => startLevel(i)
      ),
    onPlayDaily: () => confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => bootDaily(daily)),
    // replaying a logged day regenerates from the same seed, so it is the same
    // mountain and the same record key — a better time overwrites the old best
    onPlayPastDaily: (entry: DailyLogEntry) =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => bootDaily(entry)),
    onPlayCustom: (lvl) =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => startCustomLevel(lvl, {})),
    onEditCustom: (lvl) =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => openEditor(lvl)),
    onCopyCustom: (lvl) => {
      const code = encodeShareCode(lvl);
      navigator.clipboard?.writeText(code).catch(() => window.prompt(t('ed.copyPrompt'), code));
    },
    onDeleteCustom: (lvl) =>
      showConfirm(t('confirm.delete', { name: lvl.name }), t('btn.delete'), () => {
        customLevels = deleteCustomLevel(customLevels, lvl.id);
        showLevelSelect();
      }),
    onGenerate: showGenerateDialog,
    onEditor: () => confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => openEditor()),
    onImport: () => {
      const code = window.prompt(t('import.prompt'));
      if (!code) return;
      const data = decodeShareCode(code);
      if (!data) {
        window.alert(t('import.error'));
        return;
      }
      customLevels = upsertCustomLevel(customLevels, data);
      showLevelSelect();
    },
    onResume: resumeGame,
    onTitle: showTitle,
    onOptions: () => showOptions(showLevelSelect),
  });
  if (devUnlock) {
    // make the bypassed gating impossible to mistake for real progress
    const badge = document.createElement('div');
    badge.className = 'dev-badge';
    badge.textContent = t('dev.badge');
    (ov.querySelector('.map-topbar') ?? ov).appendChild(badge);
  }
  uiRoot.appendChild(ov);
}

function showGenerateDialog(): void {
  const ov = document.createElement('div');
  ov.className = 'overlay confirm-overlay';
  const box = document.createElement('div');
  box.className = 'panel confirm-box gen-box';
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  msg.innerHTML = t('gen.title');
  box.appendChild(msg);

  const seedRow = document.createElement('div');
  seedRow.className = 'gen-row';
  const seedIn = document.createElement('input');
  seedIn.className = 'ed-input';
  seedIn.value = randomSeed();
  seedIn.maxLength = 40;
  seedRow.appendChild(seedIn);
  const reroll = document.createElement('button');
  reroll.className = 'ed-btn';
  reroll.textContent = '↻';
  reroll.title = t('gen.reroll');
  reroll.onclick = () => {
    seedIn.value = randomSeed();
    audio.click();
  };
  seedRow.appendChild(reroll);
  box.appendChild(seedRow);

  const diffRow = document.createElement('div');
  diffRow.className = 'gen-row';
  const diffLbl = document.createElement('span');
  diffLbl.textContent = t('gen.difficulty');
  diffRow.appendChild(diffLbl);
  const diffSel = document.createElement('select');
  diffSel.className = 'ed-input ed-select';
  const names = [1, 2, 3, 4, 5].map((n) => t(`diff.${n}`));
  names.forEach((n, i) => {
    const opt = document.createElement('option');
    opt.value = String(i + 1);
    opt.textContent = n;
    diffSel.appendChild(opt);
  });
  diffSel.value = '2';
  diffRow.appendChild(diffSel);
  box.appendChild(diffRow);

  // Biome override. Defaults to '' = whatever the seed picked, so the seed →
  // biome mapping is untouched unless you deliberately override it. This is
  // also the only way to reach a biome the generator doesn't draw from (see
  // GENERATED_BIOMES) — without it, such a biome is unreachable in-game.
  const biomeRow = document.createElement('div');
  biomeRow.className = 'gen-row';
  const biomeLbl = document.createElement('span');
  biomeLbl.textContent = t('gen.biome');
  biomeRow.appendChild(biomeLbl);
  const biomeSel = document.createElement('select');
  biomeSel.className = 'ed-input ed-select';
  const fromSeed = document.createElement('option');
  fromSeed.value = '';
  fromSeed.textContent = t('gen.biomeSeeded');
  biomeSel.appendChild(fromSeed);
  for (const b of BIOMES) {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = t(`biome.${b}`);
    biomeSel.appendChild(opt);
  }
  biomeSel.value = '';
  biomeRow.appendChild(biomeSel);
  box.appendChild(biomeRow);

  const row = document.createElement('div');
  row.className = 'btn-row';
  const gen = (openInEditor: boolean) => {
    const seed = seedIn.value.trim() || randomSeed();
    const data = generateVerifiedLevel({ seed, difficulty: Number(diffSel.value) });
    if (biomeSel.value) data.biome = biomeSel.value as Biome;
    ov.remove();
    if (openInEditor) openEditor(data);
    else startCustomLevel(data, {});
  };
  const play = document.createElement('button');
  play.className = 'big-btn';
  play.textContent = t('gen.play');
  play.onclick = () => {
    audio.click();
    confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => gen(false));
  };
  row.appendChild(play);
  const edit = document.createElement('button');
  edit.className = 'big-btn secondary';
  edit.textContent = t('gen.openEditor');
  edit.onclick = () => {
    audio.click();
    confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => gen(true));
  };
  row.appendChild(edit);
  const cancel = document.createElement('button');
  cancel.className = 'big-btn secondary';
  cancel.textContent = t('btn.cancel');
  cancel.onclick = () => {
    audio.click();
    ov.remove();
  };
  row.appendChild(cancel);
  box.appendChild(row);
  ov.appendChild(box);
  ov.addEventListener('pointerdown', (e) => {
    if (e.target === ov) ov.remove();
  });
  uiRoot.appendChild(ov);
  seedIn.focus();
}

// The medal ceremony: stamp-in medal, honest time gauge, feat reveals.
function buildCeremony(ov: HTMLElement): void {
  const g = game!;
  const win = lastWin;
  const cer = document.createElement('div');
  cer.className = 'panel ceremony';
  ov.appendChild(cer);

  const line = document.createElement('div');
  line.className = 'cer-line';
  const nm = document.createElement('b');
  nm.textContent = t(g.level.name);
  line.appendChild(nm);
  line.appendChild(document.createTextNode(t('cer.line', { time: fmtTime(g.time), n: g.workers.length, m: g.thLevel })));
  cer.appendChild(line);

  const medal = win?.medal ?? null;
  const big = document.createElement('div');
  big.className = 'big-medal';
  if (medal) {
    const c = mkIcon(`medal_${medal}`, 112);
    c.className = 'px-icon stamp';
    big.appendChild(c);
  } else {
    const none = document.createElement('span');
    none.className = 'mslot big-empty';
    none.title = t('win.beatBronze');
    big.appendChild(none);
  }
  cer.appendChild(big);

  const name = document.createElement('div');
  name.className = 'medal-name' + (medal ? ` ${medal}` : '');
  name.textContent = medal ? t(`medalname.${medal}`) : t('win.orderDelivered');
  cer.appendChild(name);

  if (win && !playtesting && (win.newRecord || win.firstClear)) {
    const chip = document.createElement('span');
    chip.className = 'newrec';
    chip.textContent = win.firstClear ? t('win.firstClear') : t('win.newRecord');
    cer.appendChild(chip);
  }

  // time gauge with the medal thresholds
  const medals = g.level.medals;
  if (medals) {
    const max = medals.bronze * 1.2;
    const pct = (v: number) => `${Math.min(100, (v / max) * 100).toFixed(1)}%`;
    const gauge = document.createElement('div');
    gauge.className = 'gauge';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.background = `linear-gradient(90deg, #ffd76e 0 ${pct(medals.gold)}, #dfe7f2 ${pct(medals.gold)} ${pct(medals.silver)}, #e0a06a ${pct(medals.silver)} ${pct(medals.bronze)}, #3b4a63 ${pct(medals.bronze)})`;
    for (const t of [medals.gold, medals.silver, medals.bronze]) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.left = pct(t);
      bar.appendChild(tick);
    }
    const you = document.createElement('span');
    you.className = 'you';
    you.style.left = pct(g.time);
    you.title = `Your time: ${fmtTime(g.time)}`;
    bar.appendChild(you);
    gauge.appendChild(bar);
    const labels = document.createElement('div');
    labels.className = 'labels';
    labels.innerHTML =
      `<span style="width:${pct(medals.gold)}"><b>${t('medal.gold')}</b> ${fmtTime(medals.gold)}</span>` +
      `<span style="width:${(((medals.silver - medals.gold) / max) * 100).toFixed(1)}%"><b>${t('medal.silver')}</b> ${fmtTime(medals.silver)}</span>` +
      `<span><b>${t('medal.bronze')}</b> ${fmtTime(medals.bronze)}</span>`;
    gauge.appendChild(labels);
    cer.appendChild(gauge);
  }

  // feats — earned and missed alike; the miss is the hook
  const feats = document.createElement('div');
  feats.className = 'feats';
  for (const def of FEATS) {
    const got = win?.feats.includes(def.id) ?? false;
    const f = document.createElement('div');
    f.className = 'feat ' + (got ? 'got' : 'miss');
    f.appendChild(mkIcon('pin_feat', 24));
    const txt = document.createElement('div');
    const t1 = document.createElement('span');
    t1.textContent = t(`feat.${def.id}.name`);
    const t2 = document.createElement('small');
    const fdesc = t(`feat.${def.id}.desc`);
    t2.textContent = got ? t('feat.done', { desc: fdesc }) : fdesc;
    txt.appendChild(t1);
    txt.appendChild(t2);
    f.appendChild(txt);
    feats.appendChild(f);
  }
  cer.appendChild(feats);

  // the finished map, framed — the one thing worth keeping from the run
  buildSolutionShot(cer);

  // a little confetti over the ceremony
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const colors = ['#ffc94d', '#a878c8', '#6fd66f', '#5aa2e8'];
    for (let i = 0; i < 22; i++) {
      const p = document.createElement('span');
      p.className = 'confetti';
      p.style.left = `${8 + Math.random() * 84}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 0.9}s`;
      p.style.animationDuration = `${1.3 + Math.random() * 0.9}s`;
      cer.appendChild(p);
    }
    setTimeout(() => cer.querySelectorAll('.confetti').forEach((e) => e.remove()), 3400);
  }
}

// The solution snapshot: a photo of the map the player just finished, hung at
// the end of the ceremony with the three ways to take it with them.
//
// Safe to render here rather than at the win instant: Game.tick short-circuits
// on `won` after the particle pass, so terrain, buildings and workers are
// already frozen exactly as they were when the last delivery landed. Particles
// are the one thing still moving, and the shot leaves them out — the win burst
// is a moment, not a structure.
function buildSolutionShot(cer: HTMLElement): void {
  const g = game!;
  const shotOpts = { hideParticles: true };
  const canvasShot = renderMapShot(g, { ...SHOT_CARD, ...shotOpts });
  if (!canvasShot) return;

  const fig = document.createElement('div');
  fig.className = 'win-shot';
  // The <figure> is the framed plate itself, so the caption stays a direct child
  // of it — a figcaption nested one div deeper is invalid and buys nothing over
  // two plain divs. The export buttons live outside the figure: they are chrome
  // for the picture, not part of it.
  const frame = document.createElement('figure');
  frame.className = 'ws-frame';
  canvasShot.className = 'ws-img';
  canvasShot.setAttribute('role', 'img');
  canvasShot.setAttribute('aria-label', t('win.shot.aria', { name: t(g.level.name) }));
  frame.appendChild(canvasShot);
  const cap = document.createElement('figcaption');
  cap.className = 'ws-cap';
  cap.textContent = t('win.shot.cap', { name: t(g.level.name), time: fmtTime(g.time) });
  frame.appendChild(cap);
  fig.appendChild(frame);

  const status = document.createElement('div');
  status.className = 'ws-status';
  status.setAttribute('role', 'status');

  const row = document.createElement('div');
  row.className = 'ws-actions';
  const act = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `seg-btn ws-btn ${cls}`;
    b.textContent = label;
    b.onclick = () => {
      audio.click();
      // Each action speaks for itself. Otherwise the previous one's line stands
      // while this one is still in flight — a "Sent to your downloads." sitting
      // next to a share the player just cancelled, since a cancelled share
      // deliberately says nothing — and re-assigning identical text is not
      // reliably re-announced, so clearing is what makes a second Save audible.
      status.textContent = '';
      fn();
    };
    row.appendChild(b);
    return b;
  };

  // Exported at full size, not at the size the overlay happens to show — the
  // file is the artefact, the on-screen frame is only a preview of it. Drawn on
  // the first export and not before: `g` is captured and its world is frozen
  // (Game.tick short-circuits on `won`), so the picture is the same whenever it
  // is taken, and the player who just hits Next Level never pays for it.
  //
  // Then encoded at most once — on a big map toDataURL plus dataUrlToBlob's
  // per-character walk over a multi-megabyte base64 string is real work to be
  // doing synchronously inside a click — and the full-size canvas is dropped as
  // soon as its pixels live in the blob, so a second Save is instant and holds
  // a few hundred kB rather than ten megabytes. A failed encode keeps the canvas
  // for a retry: memory pressure passes.
  const stem = () => fileStem('solution', t(g.level.name), new Date().toISOString());
  let full: HTMLCanvasElement | null = null;
  let blob: Blob | null = null;
  const png = (): Blob | null => {
    if (blob) return blob;
    full ??= renderMapShot(g, { ...SHOT_FULL, ...shotOpts });
    if (!full) return null;
    const url = canvasDataUrl(full);
    if (!url) return null;
    blob = dataUrlToBlob(url);
    full = null;
    return blob;
  };

  if (CAN_DOWNLOAD) {
    // Stays synchronous inside the click: deferring past the gesture is what
    // gets a generated download blocked.
    act(t('win.shot.save'), 'ws-save', () => {
      const body = png();
      if (!body) {
        status.textContent = t('win.shot.failed');
        return;
      }
      downloadAll([{ name: `${stem()}.png`, body }]);
      // "Sent", not "saved": the page issues the download and cannot observe
      // whether the browser accepted it.
      status.textContent = t('win.shot.saved');
    });
  }

  if (CAN_COPY_IMAGE) {
    act(t('win.shot.copy'), 'ws-copy', () => {
      const body = png();
      void (async () => {
        // A failed encode is not a failed clipboard: "use Save PNG instead"
        // would send the player to a button that fails identically.
        if (!body) {
          status.textContent = t('win.shot.failed');
          return;
        }
        // the copy-failed line sends the player to Save PNG, so only say it
        // when that button is actually on screen
        status.textContent = (await copyImage(body))
          ? t('win.shot.copied')
          : t(CAN_DOWNLOAD ? 'win.shot.copyFailed' : 'win.shot.failed');
      })();
    });
  }

  // Mostly a phone affordance, and only offered when this browser will actually
  // take a file through the share sheet — a Share button that opens nothing is
  // worse than no Share button.
  if (typeof File !== 'undefined') {
    // canShare() judges the file's *type*, not its bytes, so a one-byte stand-in
    // answers the question without paying for a toDataURL of the real shot.
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    if (canShareFiles([probe])) {
      act(t('win.shot.share'), 'ws-share', () => {
        const body = png();
        void (async () => {
          if (!body) {
            status.textContent = t('win.shot.failed');
            return;
          }
          const file = new File([body], `${stem()}.png`, { type: 'image/png' });
          const res = await shareFiles([file], {
            title: t('win.shot.shareTitle'),
            text: t('win.shot.cap', { name: t(g.level.name), time: fmtTime(g.time) }),
          });
          // Dismissing the sheet is a choice, not an error — say nothing.
          if (res === 'shared') status.textContent = t('win.shot.shared');
          else if (res === 'failed' || res === 'unsupported') status.textContent = t('win.shot.failed');
        })();
      });
    }
  }

  if (row.childElementCount) fig.appendChild(row);
  fig.appendChild(status);
  cer.appendChild(fig);
}

function showWin(): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const ov = document.createElement('div');
  ov.className = 'overlay win-overlay';
  const title = document.createElement('div');
  title.className = 'win-title';
  title.textContent = t('win.title');
  ov.appendChild(title);
  buildCeremony(ov);
  const row = document.createElement('div');
  row.className = 'btn-row';
  if (playtesting && currentCustom) {
    const back = document.createElement('button');
    back.className = 'big-btn';
    back.textContent = t('win.backToEditor');
    back.onclick = () => {
      audio.click();
      openEditor(currentCustom!);
    };
    row.appendChild(back);
  } else if (!currentCustom) {
    const next = LEVELS[currentLevelIdx + 1];
    if (next) {
      const cur = LEVELS[currentLevelIdx];
      if ((next.campaign ?? 1) !== (cur.campaign ?? 1)) {
        const unlock = document.createElement('div');
        unlock.className = 'win-stats camp-unlock';
        const campKey = { 2: 'win.campaign2', 3: 'win.campaign3', 4: 'win.campaign4' }[next.campaign ?? 1] ?? 'win.campaign2';
        unlock.innerHTML = t(campKey);
        ov.appendChild(unlock);
      }
      const nb = document.createElement('button');
      nb.className = 'big-btn';
      nb.textContent = t('win.next', { name: t(next.name) });
      nb.onclick = () => {
        audio.click();
        startLevel(currentLevelIdx + 1);
      };
      row.appendChild(nb);
    } else {
      const done = document.createElement('div');
      done.className = 'win-stats';
      done.innerHTML = t('win.allDone');
      ov.appendChild(done);
    }
  } else {
    const again = document.createElement('button');
    again.className = 'big-btn';
    again.textContent = t('win.again');
    again.onclick = () => {
      audio.click();
      showGenerateDialog();
    };
    row.appendChild(again);
  }
  const lv = document.createElement('button');
  lv.className = 'big-btn secondary';
  lv.textContent = t('btn.levels');
  lv.onclick = () => showLevelSelect();
  row.appendChild(lv);
  ov.appendChild(row);
  uiRoot.appendChild(ov);
}

// ---- level lifecycle -----------------------------------------------------------

function startLevel(idx: number): void {
  currentLevelIdx = idx;
  currentCustom = null;
  playtesting = false;
  startGame(LEVELS[idx]);
}

function startCustomLevel(data: CustomLevelData, opts: { playtest?: boolean }): void {
  currentCustom = data;
  playtesting = opts.playtest ?? false;
  startGame(levelDefFromData(data));
}

// Build (or rebuild, e.g. after a language change) the HUD for the running game.
function attachHud(): void {
  hud = new Hud(uiRoot, game!, {
    onTool: setTool,
    onSpeed: (s) => setSpeed(s),
    onTogglePause: () => togglePause(),
    onZoom: (dir) => zoomStep(dir),
    onLocate: (item) => {
      if (!game || !running) return;
      const r = game.locateItem(item);
      if (!r) {
        hud?.toast(t('locate.none', { name: t(`item.${item}`) }));
        return;
      }
      // A spent source and a store-only answer both still get the ring and the
      // pan, but neither reads as an answer without a line of copy — a silent
      // ring on rubble or on your own town hall is the same "is this level
      // broken?" confusion as the old "no source on this map" (card #57). The
      // name comes off the result, not the request: a spear whose iron is mined
      // out must say Iron.
      if (r.kind === 'spent') hud?.toast(t('locate.spent', { name: t(`item.${r.item}`) }));
      else if (r.kind === 'store') hud?.toast(t('locate.inStore', { name: t(`item.${r.item}`) }));
      const avw = renderer.viewW - cam.rightInset;
      const tx = (r.x + 0.5) * TILE * cam.zoom - avw / 2;
      const ty = (r.y + 0.5) * TILE * cam.zoom - renderer.viewH / 2;
      renderer.locateRing = { x: r.x, y: r.y, bornAt: performance.now() / 1000 };
      if (reduceMotion() || renderer.effectsReduced) {
        cam.x = tx; cam.y = ty;
        cam.clamp(game, renderer.viewW, renderer.viewH);
        panTarget = null;
      } else {
        panTarget = { x: tx, y: ty };
      }
      // the pill answers in its own material: tapping Iron should not sound like
      // tapping Logs. The name comes off the *result* for the same reason the
      // toast above does — a spear whose iron is mined out is still a spear.
      audio.click(ITEM_MATERIAL[item]);
    },
    onRole: (r, d) => {
      game!.setDesired(r, game!.desiredRoles[r] + d);
      audio.click();
    },
    onUpgrade: () => game!.startThUpgrade(),
    onMenu: () => {
      if (playtesting && currentCustom) {
        openEditor(currentCustom);
        return;
      }
      prevSpeed = speed;
      setSpeed(0);
      showLevelSelect();
    },
    onOptions: () => {
      prevSpeed = speed;
      setSpeed(0);
      running = false;
      showOptions(resumeGame);
    },
    onReport: async () => {
      // Same pause contract as the options overlay: freeze the run so the
      // snapshot in the report matches what the player is looking at, and let
      // resumeGame put the speed back on close.
      prevSpeed = speed;
      setSpeed(0);
      running = false;
      clearOverlay();
      // Loaded on demand. The offscreen renderer itself is no longer the saving
      // — mapshot.ts is in the main chunk now that previews and the win shot
      // need it — but the report's own overlay, form and markdown formatter are
      // still dead weight for every player who never files one, and this is a
      // menu click with no frame budget to protect.
      const { showReportOverlay } = await import('./game/report-ui');
      // Two fast clicks can both get here while the chunk loads; without this
      // the second stacks a duplicate overlay on the first.
      if (uiRoot.querySelector('.report-box')) return;
      showReportOverlay({
        game: game!,
        canvas,
        levelLabel: reportLevelLabel(),
        levelName: t(game!.level.name),
        originCode: currentCustom ? encodeShareCode(currentCustom) : undefined,
        speed: prevSpeed,
        build: __BUILD__,
        onClose: resumeGame,
      });
    },
    onRestart: () =>
      confirmIfInProgress(
        t('confirm.restart', { name: t(game!.level.name) }),
        t('btn.restart'),
        () => {
          if (currentCustom) startCustomLevel(currentCustom, { playtest: playtesting });
          else startLevel(currentLevelIdx);
        }
      ),
  });
  hud.setSpeed(speed);
  hud.setActiveTool(hover.tool);
}

function startGame(def: LevelDef): void {
  clearOverlay();
  editor.close();
  cam.rightInset = 0;
  // Fresh seed per attempt: the sim's randomness is seeded (card #65) so tests can
  // replay a run exactly, but a real play session should still feel different every
  // time — two runs of the same level get different idle strolls and particle fans.
  game = new Game(def, randomSeed());
  speed = 1;
  cam.zoom = defaultZoom();
  const c = def.camera ?? { x: 0, y: 0 };
  cam.x = c.x * TILE * cam.zoom - renderer.viewW / 3;
  cam.y = c.y * TILE * cam.zoom - renderer.viewH / 2;
  cam.clamp(game, renderer.viewW, renderer.viewH);
  cancelPan();
  renderer.locateRing = null;

  attachHud();
  setTool('select');
  hud!.setSpeed(speed);

  game.onEvent = handleEvent;
  running = true;
  inLevel = true;
  syncMusic();

  // one gentle, once-per-session nudge: the worlds are wide, landscape shows more
  if (COARSE && window.innerHeight > window.innerWidth && !rotateHintShown) {
    rotateHintShown = true;
    hud!.toast(t('hud.rotateHint'), false, 7);
  }

  // debug/testing hook
  (window as unknown as Record<string, unknown>).__smallhands = {
    game,
    cam,
    // exposed so cues can be auditioned by ear at runtime, which is the only way
    // an audio change can be judged: `audio.click('metal')`, `audio.harvest(…)`,
    // `music.padOn`, `music.setVolume(…)`
    audio,
    music,
    startLevel,
    setSpeed,
    setTool,
    findPath,
    editor,
    generateVerifiedLevel,
    startCustomLevel,
    verifyLevel,
    encodeShareCode,
    decodeShareCode,
    blankLevelData,
  };
}

// What each resource sounds like. Both tables live here rather than in `audio.ts`
// because the engine describes sounds, not game entities — nothing in it should
// need to know what a `vein` is. Each is a full `Record`, so a fourth resource or a
// seventh item is a build error here rather than a silent fallback to wood, which
// is the one failure this feature exists to prevent: resources that all sound the
// same is indistinguishable from the cue never having been wired up.
const HARVEST_MATERIAL: Record<NodeKind, Material> = {
  tree: 'wood',
  boulder: 'stone',
  vein: 'metal',
};

// The crafted tools go with their working end, not their handle: a shovel is a
// wooden shaft, but what you hear when one is set down is the blade.
const ITEM_MATERIAL: Record<ItemType, Material> = {
  log: 'wood',
  plank: 'wood',
  stone: 'stone',
  iron: 'metal',
  spear: 'metal',
  shovel: 'metal',
};

function handleEvent(e: GameEvent): void {
  const h = hud!;
  switch (e.type) {
    case 'place':
      // a blueprint lands like a crate; a harvest flag answers in the resource's
      // own material; a bare tile or order stays light
      if (e.what === 'building') audio.placeBuilding();
      else if (e.node) audio.click(HARVEST_MATERIAL[e.node.kind]);
      else audio.place();
      break;
    case 'invalid':
      audio.invalid();
      break;
    case 'chop':
      audio.harvest(HARVEST_MATERIAL[e.node.kind]);
      break;
    case 'deposit':
      if (e.sink === 'goal') audio.goalDeposit();
      else audio.deposit();
      if (e.sink === 'stock') h.flashResource(e.item);
      break;
    case 'built':
      audio.built();
      break;
    case 'upgraded': {
      audio.upgraded();
      h.toast(t('toast.upgraded', { n: e.level }), false, 6);
      const th = game!.townhall;
      renderer.addUpgradeEffect((th.x + 2) * TILE, th.y * TILE + 4, e.level);
      break;
    }
    case 'produce':
      break;
    case 'hoistCycle':
      audio.hoistCycle();
      break;
    case 'weather': {
      const flood = !!game!.level.flood;
      // spell the rules out in the toast, from the same table the sim obeys —
      // the flood step is a level property, so it is filtered out of the list
      // here (the headline already shouts it) and folded into the wording
      const eff = weatherEffects(e.kind, false)
        .filter((x) => x.id !== 'none')
        .map((x) => t(`wx.eff.${x.id}`, { p: x.pct ?? 0 }))
        .join(' · ');
      const msgs = {
        clear: t('toast.wx.clear'),
        rain: flood ? t('toast.wx.rainFlood', { e: eff }) : t('toast.wx.rain', { e: eff }),
        storm: t('toast.wx.storm', { e: eff }),
      } as const;
      audio.hint();
      h.toast(msgs[e.kind], e.kind !== 'clear', 5);
      break;
    }
    case 'convoy': {
      audio.hint();
      const n = Math.max(0, Math.ceil(game!.convoyRemaining));
      h.toast(t(e.open ? 'toast.convoy.docked' : 'toast.convoy.away', { n }), !e.open, 5);
      break;
    }
    case 'flood':
      audio.splash();
      if (e.rescued > 0) {
        h.toast(e.rescued > 1 ? t('toast.flood.many', { n: e.rescued }) : t('toast.flood.one'), true, 6);
      }
      break;
    case 'splash':
      audio.splash();
      break;
    case 'spawn':
      audio.spawn();
      break;
    case 'demolish':
      audio.demolish();
      break;
    case 'dug':
      audio.dig();
      break;
    case 'hint':
      audio.hint();
      h.toast(t(e.text));
      break;
    case 'win': {
      audio.win();
      syncMusic(); // level solved — let the music fade under the win jingle
      // medal, feats & personal best
      {
        const g = game!;
        const medal = g.level.medals ? medalFor(g.level.medals, g.time) : null;
        const feats = g.earnedFeats();
        let newRecord = false;
        // "First clear" reflects completion history, not whether a record exists —
        // levels finished before records shipped must not read as first clears.
        // Checked before the completion lists are updated just below.
        const firstClear = currentCustom
          ? !save.completedCustom.includes(currentCustom.id)
          : !save.completed.includes(g.level.id);
        if (!playtesting) {
          const key = recordKey();
          const rec = save.records[key];
          newRecord = !rec || g.time < rec.bestTime;
          save.records[key] = {
            bestTime: rec ? Math.min(rec.bestTime, g.time) : g.time,
            medal: bestTier(rec?.medal ?? null, medal),
            feats: [...new Set([...(rec?.feats ?? []), ...feats])],
          };
        }
        lastWin = { time: g.time, medal, feats, newRecord, firstClear };
      }
      if (currentCustom) {
        if (!playtesting && !save.completedCustom.includes(currentCustom.id)) {
          save.completedCustom.push(currentCustom.id);
        }
        if (!playtesting) persistSave(save);
      } else if (!save.completed.includes(game!.level.id)) {
        save.completed.push(game!.level.id);
        persistSave(save);
      } else {
        persistSave(save);
      }
      // celebrate, then show the win screen
      const g = game!;
      const goal = g.goal;
      if (goal) {
        for (let i = 0; i < 40; i++) {
          g.spawnBurst(goal.x + Math.random() * 4, goal.y + Math.random() * 2, ['#ffc94d', '#a878c8', '#6fd66f'][i % 3], 2);
        }
      }
      setTimeout(showWin, 1600);
      break;
    }
    case 'itemSpawn':
      break;
  }
}

// ---- cursors: the pointer becomes the tool you're holding ------------------------
// Each tool's toolbar icon is rendered once to a data-URI and used as the OS cursor,
// so Harvest literally hands you the hoe. Inspect keeps the native grab/grabbing
// pointer to advertise panning.
const CURSOR_SIZE = 28;
const CURSOR_HOTSPOT: Partial<Record<Tool, [number, number]>> = {
  harvest: [5, 3], // the hoe's blade, so it points at the tile it will mark
};
const cursorCache = new Map<Tool, string>();
function toolCursorCss(tool: Tool): string {
  if (tool === 'select') return 'grab';
  const icon = TOOL_ICON[tool];
  if (!icon) return 'default';
  let css = cursorCache.get(tool);
  if (!css) {
    const c = document.createElement('canvas');
    drawIconTo(c, icon, CURSOR_SIZE);
    const [hx, hy] = CURSOR_HOTSPOT[tool] ?? [CURSOR_SIZE / 2, CURSOR_SIZE / 2];
    css = `url(${c.toDataURL()}) ${hx} ${hy}, auto`;
    cursorCache.set(tool, css);
  }
  return css;
}
function applyToolCursor(): void {
  canvas.style.cursor = editor.active ? 'crosshair' : toolCursorCss(hover.tool);
}

function setTool(tool: Tool): void {
  if (!game || !hud) return;
  const def = TOOL_DEFS.find((d) => d.id === tool)!;
  if (def.thLevel && game.thLevel < def.thLevel) {
    hud.toast(t('toast.locked', { label: t(`tool.${def.id}.label`), n: def.thLevel }), true, 4);
    audio.invalid();
    return;
  }
  hover.tool = tool;
  hud.setActiveTool(tool);
  runAnchor = null;
  // switching tools drops any parked touch aim + inspect tooltip + pinned
  // inspector, re-arms the hint (Escape routes here too, so it dismisses a pin)
  touchInspect = null;
  hud.hideBuildingHint();
  hud.unpinInspector();
  if (COARSE) {
    clearTouchPlace(false);
    armTouchTool(tool);
  } else {
    hud.hideConfirmBar();
  }
  applyToolCursor();
  audio.click();
}

function setSpeed(s: number): void {
  speed = s;
  if (s > 0) lastRate = s;
  if (game) game.paused = s === 0;
  hud?.setSpeed(s);
  audio.click();
}

// ⏸/▶ — both the island's play button and Space land here, so resuming always
// returns to the rate you were running at rather than snapping back to 1×.
function togglePause(): void {
  setSpeed(speed === 0 ? lastRate : 0);
}

// ---- touch placement: tap to aim, one big ✓ to commit ------------------------------
// On a phone the finger hides the very tile it touches, so on touch no costly
// tool fires on the tap itself. A tap AIMS: the ghost parks on the tile, the
// confirm bar spells out what will be built and what it costs, and the ✓
// commits. Buildings even park their ghost the moment the tool is selected
// (see setTool), so positioning starts from a visible draft. Run tools
// (ladder/ramp/bridge) grow tap by tap from the first aimed tile. A wrong tap
// costs nothing — tap again to move the aim, or ✕ to drop it. Harvest is the
// exception: marking is free and reversible, so the tap toggles it directly.
// One-finger drags always pan; mouse and pen keep the desktop click/drag
// behavior.

// Coarse-pointer detection guides defaults (initial zoom, aim hints); per-event
// pointerType gates behavior, so a mouse on a touch laptop stays desktop-feeling.
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
let rotateHintShown = false;

interface TouchPlaceState {
  tool: Tool;
  aim: { x: number; y: number }; // the aimed tile; run tools: the run's start
  end: { x: number; y: number } | null; // run tools: the run's current end
}
let touchPlace: TouchPlaceState | null = null;
// tap-to-inspect target for controls-less things (resource node / stranded
// item), re-rendered each frame so its readout stays live. Buildings don't go
// here — a building tap pins the interactive inspector instead (see touchTap).
let touchInspect: { kind: 'n' | 'si'; id: number; cx: number; cy: number } | null = null;

function clearTouchPlace(hideBar = true): void {
  touchPlace = null;
  hover.visible = false;
  if (hideBar) hud?.hideConfirmBar();
}

// Single-tile buildings whose ghost can be parked and repositioned before the ✓
// commits them. Run tools grow tap by tap instead, and harvest fires instantly.
const isGhostBuildTool = (t: Tool) =>
  t === 'sawmill' || t === 'forge' || t === 'workshop' || t === 'lantern' ||
  t === 'lift' || t === 'rope' || t === 'hoist';

// Arm a tool for touch. A building parks its translucent ghost at the viewport
// centre right away — tap to reposition, ✓ to build, no blind first tap — so it
// never shows the aim hint: it has no unaimed state to hint about. Everything
// else has one, and waits there for the first aiming tap.
function armTouchTool(tool: Tool): void {
  if (isGhostBuildTool(tool) && running) parkTouchAim(tool);
  else showAimHint();
}

// Park a touch aim (ghost + confirm bar) on the tile at the viewport centre —
// the "draft building" a touch user drags around by tapping before approving.
function parkTouchAim(tool: Tool): void {
  if (!game) return;
  const c = cam.screenToTile((renderer.viewW - cam.rightInset) / 2, renderer.viewH / 2);
  const tx = Math.max(0, Math.min(game.world.w - 1, c.x));
  const ty = Math.max(0, Math.min(game.world.h - 1, c.y));
  touchPlace = { tool, aim: { x: tx, y: ty }, end: null };
  hover.tx = tx;
  hover.ty = ty;
  hover.visible = true;
  refreshTouchUi();
}

// the ✓ label names the action, not the mechanism: Build / Mark / Demolish
function confirmCta(tool: Tool): string {
  if (tool === 'harvest') {
    const n = touchPlace ? game?.nodeAt(touchPlace.aim.x, touchPlace.aim.y) : null;
    return n?.marked ? t('hud.ctaUnmark') : t('hud.ctaMark');
  }
  if (tool === 'demolish') return t('hud.ctaDemolish');
  if (tool === 'dig') return t('hud.ctaDig');
  return t('hud.ctaBuild');
}

// Standing CTA while a touch user holds a placing tool but hasn't aimed yet.
// ✕ here means "never mind" and hands back the Inspect tool.
function showAimHint(): void {
  if (!game || !hud || !running) return;
  if (hover.tool === 'select') {
    hud.hideConfirmBar();
    return;
  }
  hud.showConfirmBar({
    tool: hover.tool,
    cta: null,
    // harvest acts on the tap itself (no ✓ step), so its hint says so
    hint: hover.tool === 'harvest' ? t('hud.tapMark') : t('hud.tapToAim'),
    rows: [],
    count: null,
    confirmDisabled: true,
    onConfirm: () => {},
    onCancel: () => setTool('select'),
  });
}

// Refreshed every frame while an aim is parked (stock changes under a still
// finger); the HUD only touches the DOM when the signature changes.
function refreshTouchUi(): void {
  if (!touchPlace || !game || !hud || !running) return;
  const tp = touchPlace;
  if (tp.end) {
    const plan = game.runPlan(tp.tool, tp.aim.x, tp.aim.y, tp.end.x, tp.end.y);
    // Anchored on an unlit cell at night, a dark-gated run can't be laid.
    const dark = game.darkBlocks(tp.tool, tp.aim.x, tp.aim.y);
    hud.showConfirmBar({
      tool: tp.tool,
      cta: confirmCta(tp.tool),
      hint: dark ? t('hud.tooDark') : t('hud.tapExtend'),
      rows: plan.rows,
      count: { a: plan.affordable, b: plan.cells.length },
      confirmDisabled: plan.affordable === 0 || dark,
      onConfirm: commitTouchPlace,
      onCancel: () => {
        audio.click();
        clearTouchPlace(false);
        showAimHint();
      },
    });
  } else {
    const ghost = isGhostBuildTool(tp.tool);
    // Aimed on an unlit cell at night, a dark-gated build (its ghost is already
    // red) can't be raised — say why and block ✓, matching the run branch and
    // the desktop cursor note. Exempt tools (lantern) return false here.
    const dark = game.darkBlocks(tp.tool, tp.aim.x, tp.aim.y);
    hud.showConfirmBar({
      tool: tp.tool,
      cta: confirmCta(tp.tool),
      hint: dark ? t('hud.tooDark') : ghost ? t('hud.tapMove') : null,
      rows: game.placementShortfall(tp.tool),
      count: null,
      confirmDisabled: dark,
      onConfirm: commitTouchPlace,
      onCancel: () => {
        // A building is armed and aimed in one step, so ✕ has no half-armed
        // state to fall back to — it means never mind, and hands back Inspect.
        if (ghost) {
          setTool('select');
          return;
        }
        audio.click();
        clearTouchPlace(false);
        showAimHint();
      },
    });
  }
}

function commitTouchPlace(): void {
  if (!touchPlace || !game || !running) return;
  const tp = touchPlace;
  if (tp.end) {
    if (tp.tool === 'ramp') game.placeRampRun(tp.aim.x, tp.aim.y, tp.end.x, tp.end.y);
    else if (tp.tool === 'ladder') game.placeLadderRun(tp.aim.x, tp.aim.y, tp.end.x, tp.end.y);
    else if (tp.tool === 'dig') game.paintDigRun(tp.aim.x, tp.aim.y, tp.end.x, tp.end.y);
    else game.placeBridgeRun(tp.aim.x, tp.aim.y, tp.end.x, tp.end.y);
  } else {
    applyTool(tp.aim.x, tp.aim.y);
  }
  clearTouchPlace(false);
  armTouchTool(tp.tool); // the tool stays armed: tap → ✓ → tap → ✓ chains
}

// A confirmed-clean tap on the map (no drag, no pinch) from a touch pointer.
function touchTap(tx: number, ty: number, clientX: number, clientY: number): void {
  const g = game!;
  if (hover.tool === 'select') {
    // tap-to-inspect. A building pins the interactive inspector (storage +
    // controls, sticky) right where it was tapped; tapping it again closes it.
    // Stranded items and resource nodes have no controls, so they keep the
    // lightweight parked hover hint.
    const si = g.strandedItemAt(tx, ty);
    const b = si ? undefined : g.buildingAt(tx, ty);
    if (b) {
      touchInspect = null;
      hud!.pinInspector(b, clientX, clientY);
      return;
    }
    const n = si ? undefined : g.nodeAt(tx, ty);
    if (si) touchInspect = { kind: 'si', id: si.id, cx: clientX, cy: clientY };
    else if (n) touchInspect = { kind: 'n', id: n.id, cx: clientX, cy: clientY };
    else {
      touchInspect = null;
      hud!.hideBuildingHint();
      hud!.unpinInspector(); // tapping empty ground dismisses a pinned inspector
    }
    if (touchInspect) refreshTouchInspect();
    return;
  }
  audio.click();
  // Harvest needs no approve step: the flag is free and reversible, and the
  // planted flag itself is the feedback — the tap toggles the mark directly.
  if (hover.tool === 'harvest') {
    applyTool(tx, ty);
    return;
  }
  if (isRunTool(hover.tool)) {
    if (touchPlace && touchPlace.tool === hover.tool) {
      touchPlace.end = { x: tx, y: ty }; // grow or redirect the run
    } else {
      touchPlace = { tool: hover.tool, aim: { x: tx, y: ty }, end: { x: tx, y: ty } };
    }
  } else {
    touchPlace = { tool: hover.tool, aim: { x: tx, y: ty }, end: null };
  }
  // park the ghost on the aimed tile
  hover.tx = touchPlace.end?.x ?? tx;
  hover.ty = touchPlace.end?.y ?? ty;
  hover.visible = true;
  refreshTouchUi();
}

// Keep the tap-to-inspect tooltip live (build %, lift status, goal counts); it
// dismisses on the next empty tap or tool switch, or when its target vanishes.
function refreshTouchInspect(): void {
  if (!touchInspect || !game || !hud || !running) return;
  if (touchInspect.kind === 'si') {
    const si = game.groundItems.find((gi) => gi.id === touchInspect!.id);
    if (si && si.stranded) hud.showStrandedHint(si, touchInspect.cx, touchInspect.cy);
    else {
      touchInspect = null;
      hud.hideBuildingHint();
    }
  } else {
    const n = game.nodes.find((nd) => nd.id === touchInspect!.id);
    if (n) hud.showNodeHint(n, touchInspect.cx, touchInspect.cy);
    else {
      touchInspect = null;
      hud.hideBuildingHint();
    }
  }
}

// ---- input -----------------------------------------------------------------------

let dragging = false;
let dragMoved = false;
let painting = false; // editor drag-paint stroke in progress
let lastMx = 0;
let lastMy = 0;
let downX = 0; // pointer-down position: taps are judged against total travel,
let downY = 0; // with a wider tolerance for wobbly fingers than for mice
const keys = new Set<string>();
let runAnchor: { x: number; y: number; tool: Tool } | null = null; // build-run start tile
const isRunTool = (t: Tool) => t === 'ramp' || t === 'platform' || t === 'ladder' || t === 'dig';

function canvasDpr(): number {
  return canvas.width / canvas.clientWidth || 1;
}

// ---- touch camera: two-finger pan + pinch zoom -------------------------------------
// Touch pointers are tracked by id; the moment a second finger lands, whatever
// gesture was forming becomes camera control — no accidental taps, paints or
// build-runs from a pinch.
const touchPts = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; x: number; y: number } | null = null;

function pinchGeom(): { dist: number; x: number; y: number } {
  const [a, b] = [...touchPts.values()];
  return {
    dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2) {
      pinch = pinchGeom();
      dragging = false;
      dragMoved = true; // neither finger's release may read as a tap
      if (painting) {
        painting = false;
        editor.endStroke();
      }
      runAnchor = null;
      return;
    }
    if (touchPts.size > 2) return;
  }
  dragging = true;
  dragMoved = false;
  downX = e.clientX;
  downY = e.clientY;
  lastMx = e.clientX;
  lastMy = e.clientY;
  if (editor.active && e.button === 0 && editor.toolDef().drag) {
    const dpr = canvasDpr();
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    painting = true;
    editor.applyAt(t.x, t.y, false);
  }
  // desktop drag-runs only: on touch, runs grow tap by tap (see touchTap)
  if (!editor.active && e.button === 0 && game && running && isRunTool(hover.tool) && e.pointerType !== 'touch') {
    const dpr = canvasDpr();
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    runAnchor = { x: t.x, y: t.y, tool: hover.tool };
  }
});

// The cursor cost readout under the hovered cell: the tool's shortfall badge, or
// the "too dark to build here" note when darkness is what reddens the ghost.
//
// Driven from pointermove AND from frame(), because the thing it reports on moves
// on its own: the player parks the cursor over the spot and waits for the crew to
// deliver, and a badge that only re-reads stock on pointermove keeps saying "3/5
// planks" long after the fifth plank landed. The ghost overlay already recomputes
// per frame, so the pair would also disagree — a green outline over a red badge.
// The drag-run total is refreshed the same way, for the same reason (see frame()).
// Both readouts dedup on a content signature, so a per-frame call rebuilds no DOM
// unless the numbers actually changed.
function refreshPlacementReadout(): void {
  // touch has no hover: the parked aim ghost reports through the confirm bar
  if (touchPlace) return;
  if (runAnchor && game && running) {
    hud?.hidePlacementNeeds(); // a run drag shows its running total instead
    return;
  }
  hud?.hideRunCost();
  if (!dragging && game && running && hover.visible) {
    // Darkness trumps the resource readout: if the ghost is red for being unlit,
    // say so — otherwise spell out any shortfall.
    if (game.darkBlocks(hover.tool, hover.tx, hover.ty)) hud?.showDarkNeed(lastMx, lastMy);
    else hud?.showPlacementNeeds(lastMx, lastMy, hover.tool);
  } else hud?.hidePlacementNeeds();
}

canvas.addEventListener('pointermove', (e) => {
  const dpr = canvasDpr();
  if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  // two fingers: pan with the midpoint, step the zoom on pinch thresholds
  if (pinch && touchPts.size >= 2) {
    if (e.pointerType !== 'touch') return;
    const g = editor.active ? editor.game : running ? game : null;
    const now = pinchGeom();
    if (g) {
      cancelPan();
      cam.x -= (now.x - pinch.x) * dpr;
      cam.y -= (now.y - pinch.y) * dpr;
      const ratio = now.dist / pinch.dist;
      if (ratio > 1.3) {
        zoomStep(1, now.x * dpr, now.y * dpr);
        pinch.dist = now.dist;
      } else if (ratio < 1 / 1.3) {
        zoomStep(-1, now.x * dpr, now.y * dpr);
        pinch.dist = now.dist;
      }
      cam.clamp(g, renderer.viewW, renderer.viewH);
    }
    pinch.x = now.x;
    pinch.y = now.y;
    return;
  }
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  if (painting) {
    editor.applyAt(t.x, t.y, true);
  } else if (dragging && !runAnchor) {
    const dx = e.clientX - lastMx;
    const dy = e.clientY - lastMy;
    const slack = e.pointerType === 'touch' ? 9 : 3; // fingers wobble; mice don't
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > slack) dragMoved = true;
    if (dragMoved) {
      // pan with any non-painting drag; taps still place
      cancelPan();
      canvas.style.cursor = 'grabbing';
      cam.x -= dx * dpr;
      cam.y -= dy * dpr;
      const g = editor.active ? editor.game : game;
      if (g) cam.clamp(g, renderer.viewW, renderer.viewH);
    }
  }
  // last known cursor position — the pan delta above reads the previous value,
  // and the frame loop uses it to place the drag-run cost readout at the cursor.
  lastMx = e.clientX;
  lastMy = e.clientY;

  // No hover on touch: the ghost stays parked where the last tap aimed, and the
  // hover-driven tooltips/badges stay out of the way of the panning finger.
  if (e.pointerType === 'touch') return;

  hover.tx = t.x;
  hover.ty = t.y;
  hover.visible = true;

  // hover-to-inspect: a live tooltip for any building or resource node under
  // the cursor (Inspect tool only, and not while panning)
  if (!dragging && game && running && hover.tool === 'select') {
    const si = game.strandedItemAt(t.x, t.y);
    const b = si ? undefined : game.buildingAt(t.x, t.y);
    const n = si || b ? undefined : game.nodeAt(t.x, t.y);
    if (si) hud?.showStrandedHint(si, e.clientX, e.clientY);
    else if (b) hud?.showBuildingHint(b, e.clientX, e.clientY);
    else if (n) hud?.showNodeHint(n, e.clientX, e.clientY);
    else hud?.hideBuildingHint();
  } else {
    hud?.hideBuildingHint();
  }
  refreshPlacementReadout();
  if (editor.active) editor.setHover(t.x, t.y, true);
});

canvas.addEventListener('pointerleave', () => {
  if (touchPlace) return; // the parked aim ghost survives the finger lifting
  hover.visible = false;
  hud?.hideBuildingHint();
  hud?.hidePlacementNeeds();
  hud?.hideRunCost();
  editor.setHover(0, 0, false);
});

canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') {
    touchPts.delete(e.pointerId);
    if (touchPts.size < 2) pinch = null;
  }
  dragging = false;
  runAnchor = null;
  hud?.hideRunCost();
  applyToolCursor();
});

canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') {
    touchPts.delete(e.pointerId);
    if (touchPts.size < 2) pinch = null;
  }
  dragging = false;
  hud?.hideRunCost();
  applyToolCursor(); // drop the grabbing hand back to the tool cursor
  if (painting) {
    painting = false;
    editor.endStroke();
    return;
  }
  if (runAnchor) {
    const a = runAnchor;
    runAnchor = null;
    const dpr = canvasDpr();
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    if (game && running) {
      if (a.tool === 'ramp') game.placeRampRun(a.x, a.y, t.x, t.y);
      else if (a.tool === 'ladder') game.placeLadderRun(a.x, a.y, t.x, t.y);
      else if (a.tool === 'dig') game.paintDigRun(a.x, a.y, t.x, t.y);
      else game.placeBridgeRun(a.x, a.y, t.x, t.y);
    }
    return;
  }
  if (dragMoved || e.button !== 0) return;
  const dpr = canvasDpr();
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  if (editor.active) {
    editor.applyAt(t.x, t.y, false);
    return;
  }
  if (!game || !running) return;
  if (e.pointerType === 'touch') {
    touchTap(t.x, t.y, e.clientX, e.clientY);
    return;
  }
  applyTool(t.x, t.y, e.clientX, e.clientY);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Step the zoom one level toward an anchor point given in device pixels.
// Defaults to the centre of the usable viewport, which is what the +/- keys
// and the on-screen buttons want; the pinch handler passes the cursor instead.
// Integer zoom steps stay pixel-perfect. A high-DPI screen draws each step at
// half the CSS size, so it gets two extra steps on top — and starts play two
// steps in — landing at the same apparent tile size a desktop sees at 2×.
function maxZoom(): number {
  return (window.devicePixelRatio || 1) >= 2 ? 6 : 4;
}
function defaultZoom(): number {
  return COARSE && (window.devicePixelRatio || 1) >= 2 ? 4 : 2;
}

function zoomStep(dir: number, ax?: number, ay?: number): void {
  const g = editor.active ? editor.game : running ? game : null;
  if (!g) return;
  const oldZoom = cam.zoom;
  const next = Math.max(1, Math.min(maxZoom(), oldZoom + dir));
  if (next === oldZoom) return;
  const anchorX = ax ?? (renderer.viewW - cam.rightInset) / 2;
  const anchorY = ay ?? renderer.viewH / 2;
  const wx = (cam.x + anchorX) / oldZoom;
  const wy = (cam.y + anchorY) / oldZoom;
  cam.zoom = next;
  cam.x = wx * next - anchorX;
  cam.y = wy * next - anchorY;
  cam.clamp(g, renderer.viewW, renderer.viewH);
}

// Wheel: a plain scroll pans the map freely on both axes, so scrolling up/down
// moves the view up/down just like scrolling sideways moves it left/right.
// Zoom lives on pinch (ctrl+wheel), the +/- keys, and the on-screen buttons.
// Pinch arrives as a stream of small ctrl+wheel deltas, so accumulate them into
// one step per gesture; shift+wheel keeps the classic "scroll sideways" gesture
// for mouse users whose wheel only emits a vertical delta.
let pinchAcc = 0;
let pinchAt = 0;
let pinchConsumed = false;

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const g = editor.active ? editor.game : running ? game : null;
    if (!g) return;
    cancelPan();
    const dpr = canvas.width / canvas.clientWidth;

    // pinch-to-zoom (ctrl+wheel): one step per gesture, aimed at the cursor
    if (e.ctrlKey) {
      const now = performance.now();
      if (now - pinchAt > 250) {
        // 250ms without wheel events = the previous gesture ended
        pinchAcc = 0;
        pinchConsumed = false;
      }
      pinchAt = now;
      if (pinchConsumed) return;
      pinchAcc += e.deltaY;
      if (Math.abs(pinchAcc) < 25) return;
      const dir = pinchAcc < 0 ? 1 : -1;
      pinchAcc = 0;
      pinchConsumed = true;
      zoomStep(dir, e.clientX * dpr, e.clientY * dpr);
      return;
    }

    // shift+wheel: pan sideways from a purely vertical wheel (mouse convention)
    if (e.shiftKey) {
      cam.x += e.deltaY * dpr;
      cam.clamp(g, renderer.viewW, renderer.viewH);
      return;
    }

    // plain scroll: pan on whichever axes the gesture moved
    cam.x += e.deltaX * dpr;
    cam.y += e.deltaY * dpr;
    cam.clamp(g, renderer.viewW, renderer.viewH);
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
  keys.add(e.key.toLowerCase());
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    zoomStep(1);
    return;
  }
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomStep(-1);
    return;
  }
  if (editor.active) {
    if (editor.setToolByKey(e.key)) return;
    return;
  }
  if (e.key === 'Escape' && !running) {
    // close a confirm dialog first; otherwise resume the paused level
    const confirm = document.querySelector('.confirm-overlay');
    if (confirm) {
      confirm.remove();
      return;
    }
    if (gameInProgress() && document.querySelector('.overlay')) {
      resumeGame();
      return;
    }
  }
  if (!game || !running) return;
  // The resume-after-focus dialog is modal: the sim stays paused until the
  // player clicks Resume. Swallow the game shortcuts (Space toggles speed, tool
  // keys) so nothing runs or retools behind the overlay — the pointer overlay
  // alone doesn't block the keyboard.
  if (uiRoot.querySelector('.resume-overlay')) return;
  const def = TOOL_DEFS.find((d) => d.key === e.key);
  if (def && (!game.level.allowedTools || game.level.allowedTools.includes(def.id))) {
    setTool(def.id);
  }
  if (e.key === ' ') {
    e.preventDefault();
    togglePause();
  }
  if (e.key === 'Escape') setTool('select');
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function applyTool(tx: number, ty: number, clientX = 0, clientY = 0): void {
  const g = game!;
  switch (hover.tool) {
    case 'select': {
      // Hover shows the live tooltip; a click pins the interactive inspector
      // (storage + pause/upgrade/routing controls) to the building. Clicking
      // the same building again toggles it off; clicking empty ground dismisses.
      const b = g.buildingAt(tx, ty);
      if (b) hud!.pinInspector(b, clientX, clientY);
      else hud!.unpinInspector();
      break;
    }
    case 'harvest': {
      if (g.toggleMark(tx, ty)) {
        const n = g.nodeAt(tx, ty);
        if (n) {
          const cx = n.x + 0.5;
          const cy = n.kind === 'tree' ? n.y - 1.2 : n.y + 0.3;
          if (n.marked) {
            // the order lands with authority: a kick + a gold spark burst tinted
            // by the material under the flag
            n.wobble = 0.35;
            g.spawnBurst(cx, cy, '#ffd94d', 10);
            g.spawnBurst(cx, cy, n.kind === 'tree' ? '#6fd66f' : '#c9d2e0', 5);
          } else {
            // order rescinded — a small, cool puff
            g.spawnBurst(cx, cy, 'rgba(180,196,220,0.9)', 3);
          }
        }
      }
      break;
    }
    case 'dig':
      g.paintDigRun(tx, ty, tx, ty);
      break;
    case 'ladder':
      g.placeLadderRun(tx, ty, tx, ty);
      break;
    case 'platform':
      g.placeBridgeRun(tx, ty, tx, ty);
      break;
    case 'ramp':
      g.placeRampRun(tx, ty, tx, ty);
      break;
    case 'sawmill':
      g.placeBuilding('sawmill', tx, ty);
      break;
    case 'forge':
      g.placeBuilding('forge', tx, ty);
      break;
    case 'workshop':
      g.placeBuilding('workshop', tx, ty);
      break;
    case 'lantern':
      g.placeBuilding('lantern', tx, ty);
      break;
    case 'lift':
      g.placeLift(tx, ty);
      break;
    case 'rope':
      g.placeRope(tx, ty);
      break;
    case 'hoist':
      g.placeHoist(tx, ty);
      break;
    case 'demolish':
      g.demolish(tx, ty);
      break;
  }
}

// ---- idle backdrop for the title screen ----------------------------------------

let idleGame: Game | null = null;

function drawIdleBackdrop(): void {
  if (!idleGame) {
    idleGame = new Game(LEVELS[0], randomSeed());
    for (const n of idleGame.nodes) n.marked = true;
  }
}

// ---- main loop --------------------------------------------------------------------

let last = performance.now();
const FIXED = 1 / 60;
let acc = 0;
let idleStaticTime: number | null = null;

const RUN_SPRITE: Partial<Record<Tool, string>> = {
  ramp: 'tile_ramp',
  platform: 'tile_platform',
  ladder: 'tile_ladder',
};

const runOverlay = (ctx: CanvasRenderingContext2D) => {
  if (!game) return;
  // desktop: the live drag; touch: the tap-grown run parked by the confirm bar
  let tool: Tool, ax: number, ay: number, ex: number, ey: number;
  if (runAnchor) {
    tool = runAnchor.tool;
    ax = runAnchor.x;
    ay = runAnchor.y;
    ex = hover.tx;
    ey = hover.ty;
  } else if (touchPlace?.end) {
    tool = touchPlace.tool;
    ax = touchPlace.aim.x;
    ay = touchPlace.aim.y;
    ex = touchPlace.end.x;
    ey = touchPlace.end.y;
  } else {
    return;
  }
  const plan = game.runPlan(tool, ax, ay, ex, ey);
  // A dark-gated run anchored on an unlit cell can't be laid — paint the whole
  // ghost red so the block reads at a glance (ladders stay exempt).
  const dark = game.darkBlocks(tool, ax, ay);
  // Dig has no tile sprite — preview each cell to be carved as an amber overlay
  // (red when the run is blocked for being too dark).
  if (tool === 'dig') {
    ctx.fillStyle = dark ? 'rgba(255,122,107,0.32)' : 'rgba(230,150,60,0.32)';
    ctx.strokeStyle = dark ? 'rgba(255,122,107,0.9)' : 'rgba(255,170,80,0.9)';
    ctx.lineWidth = 1;
    for (const c of plan.cells) {
      ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
      ctx.strokeRect(c.x * TILE + 0.5, c.y * TILE + 0.5, TILE - 1, TILE - 1);
    }
    return;
  }
  const spriteName = RUN_SPRITE[tool];
  if (!spriteName) return; // only the run tools have a ghost sprite
  const spr = sprite(spriteName).canvas;
  // A ramp run previews with the same facing it will settle into once laid, so it
  // never flips on release — read off the run's actual cells (which may truncate
  // to a lone tile against a wall), matching what the renderer draws per tile.
  const flipRamp = tool === 'ramp' && rampCellsFaceLeft(game.world, plan.cells);
  plan.cells.forEach((c, i) => {
    const affordable = !dark && i < plan.affordable;
    ctx.globalAlpha = affordable ? 0.6 : 0.35;
    if (flipRamp) {
      ctx.save();
      ctx.translate(c.x * TILE + TILE, c.y * TILE);
      ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(spr, c.x * TILE, c.y * TILE);
    }
    if (!affordable) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,122,107,0.35)';
      ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
    }
  });
  ctx.globalAlpha = 1;
};

// Honour the OS "reduce motion" preference for the decorative idle backdrop.
const reduceMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  // keyboard camera pan
  if ((game && running) || editor.active) {
    if (keys.has('a') || keys.has('d') || keys.has('w') || keys.has('s') ||
        keys.has('arrowleft') || keys.has('arrowright') || keys.has('arrowup') || keys.has('arrowdown')) cancelPan();
    const panSpeed = 700 * dtReal;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= panSpeed;
    if (keys.has('d') || keys.has('arrowright')) cam.x += panSpeed;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= panSpeed;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += panSpeed;
    const g = editor.active ? editor.game : game;
    if (g) cam.clamp(g, renderer.viewW, renderer.viewH);
  }

  // locate-on-map: ease the camera toward a pending target, then clamp
  if (panTarget && game && running) {
    const k = 1 - Math.pow(0.0002, dtReal); // frame-rate-independent ease (~0.35s)
    cam.x += (panTarget.x - cam.x) * k;
    cam.y += (panTarget.y - cam.y) * k;
    if (Math.abs(panTarget.x - cam.x) < 0.5 && Math.abs(panTarget.y - cam.y) < 0.5) {
      cam.x = panTarget.x; cam.y = panTarget.y; panTarget = null;
    }
    cam.clamp(game, renderer.viewW, renderer.viewH);
  }

  if (editor.active) {
    renderer.draw(editor.game, cam, noHover, now / 1000, (ctx) => editor.drawOverlay(ctx));
    requestAnimationFrame(frame);
    return;
  }

  const active = running && game ? game : idleGame;
  if (active) {
    // The idle backdrop is decorative: skip it entirely when it can't be seen
    // (front-door scrolled past the hero, or the tab is hidden) and freeze it
    // to a static frame under prefers-reduced-motion.
    const isIdle = active === idleGame;
    const idleHidden =
      isIdle &&
      (document.hidden ||
        (document.body.classList.contains('front-door') && window.scrollY >= window.innerHeight));
    const idleStatic = isIdle && reduceMotion();

    if (!idleHidden) {
      if (!idleStatic) {
        acc += dtReal * (active === game ? speed : 1);
        let iter = 0;
        while (acc >= FIXED && iter < 8) {
          active.tick(FIXED);
          acc -= FIXED;
          iter++;
        }
        if (acc >= FIXED) acc = 0; // drop time if we can't keep up
      }

      if (isIdle) {
        // slow auto-pan across the idle scene (fixed camera under reduced motion).
        // Base zoom is 2, but on viewports wider than the world at that zoom the
        // terrain would end mid-screen (sky-filled void on the right) — so scale
        // up just enough to always span the full width. When the world already
        // overflows the width, zoom stays 2 and the auto-pan is preserved.
        const worldPxW = idleGame!.world.w * TILE;
        cam.zoom = Math.max(2, renderer.viewW / worldPxW);
        const maxX = worldPxW * cam.zoom - renderer.viewW;
        cam.x = idleStatic ? 0 : (Math.sin(now / 9000) * 0.5 + 0.5) * Math.max(0, maxX);
        cam.y = idleGame!.world.h * TILE * cam.zoom - renderer.viewH + 20;
      }

      // Under reduced motion, freeze the clock fed to the renderer too, so
      // time-driven decoration (clouds, wind sway, smoke, flags) holds still —
      // not just the camera pan and the sim.
      if (isIdle && idleStatic) {
        idleStaticTime ??= now;
      } else {
        idleStaticTime = null;
      }
      const drawTime = idleStaticTime ?? now;

      renderer.draw(active, cam, running ? hover : { ...hover, visible: false }, drawTime / 1000, runOverlay);
    }
  }

  // Refresh the drag-run cost readout against live stock every frame — the same
  // clock the ghost overlay uses — so it never goes stale under a still cursor
  // while resources change. Placed at the last known cursor position.
  if (running && game && runAnchor && hover.visible) {
    const plan = game.runPlan(runAnchor.tool, runAnchor.x, runAnchor.y, hover.tx, hover.ty);
    hud?.showRunCost(lastMx, lastMy, plan.rows, runAnchor.tool);
  }
  // …and the hover readout the same way, so a shortfall badge under a still
  // cursor clears itself the moment the crew delivers what it was asking for.
  refreshPlacementReadout();

  // Touch surfaces track live state the same way: the confirm bar's costs and
  // the tap-to-inspect tooltip re-render only when their signatures change.
  if (running && game) {
    if (touchPlace) refreshTouchUi();
    if (touchInspect) refreshTouchInspect();
  }

  hud?.update();
  requestAnimationFrame(frame);
}

function onResize(): void {
  renderer.resize();
  if (editor.active) {
    const dpr = canvas.width / canvas.clientWidth;
    cam.rightInset = editor.panelRightInset() * dpr;
  }
  const g = editor.active ? editor.game : game;
  if (g) cam.clamp(g, renderer.viewW, renderer.viewH);
}

window.addEventListener('resize', onResize);
// Device rotation can change the canvas's CSS size without a window resize
// event, or fire the event before the new layout has settled (iOS) — the
// stale backing store then gets stretched by CSS. A ResizeObserver reports
// the element's real post-layout size, so the backing store always matches.
new ResizeObserver(onResize).observe(canvas);
onResize();
showTitle();
requestAnimationFrame(frame);
