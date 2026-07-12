import './style.css';
import { FEATS, TILE, TOOL_DEFS, bestTier, medalFor } from './game/types';
import type { MedalTier, Tool } from './game/types';
import { buildAtlas, drawIconTo, sprite } from './engine/sprites';
import { audio } from './engine/audio';
import {
  deleteCustomLevel,
  loadCustomLevels,
  loadSave,
  persistSave,
  upsertCustomLevel,
} from './engine/save';
import { Game } from './game/sim';
import { findPath } from './game/nav';
import type { GameEvent } from './game/sim';
import { LEVELS } from './game/levels';
import type { LevelDef } from './game/levels';
import { Camera, Renderer } from './game/render';
import type { HoverState } from './game/render';
import { rampRunCells, bridgeRunCells } from './game/world';
import { Hud, TOOL_ICON } from './game/ui';
import { Editor } from './game/editor';
import { blankLevelData, decodeShareCode, encodeShareCode, levelDefFromData, medalTimesFor, verifyLevel } from './game/leveldata';
import type { CustomLevelData } from './game/leveldata';
import { dailySeed, generateVerifiedLevel, randomSeed } from './game/generator';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;

buildAtlas();

// favicon from our own pixel art
{
  const fav = document.createElement('canvas');
  drawIconTo(fav, 'item_plank', 32);
  (document.getElementById('favicon') as HTMLLinkElement).href = fav.toDataURL();
}

const save = loadSave();
let customLevels = loadCustomLevels();
audio.muted = save.muted;

const renderer = new Renderer(canvas);
const cam = new Camera();

let game: Game | null = null;
let hud: Hud | null = null;
let currentLevelIdx = 0;
// context of the running level: campaign index or custom data (+ playtest flag)
let currentCustom: CustomLevelData | null = null;
let playtesting = false;
let speed = 1;
let prevSpeed = 1; // speed to restore when resuming from the level-select overlay
let running = false;

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

function fmtTime(t: number): string {
  const mins = Math.floor(t / 60);
  const secs = Math.floor(t % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

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

// medal + feat slots as shown on level cards
function medalSlotRow(key: string): HTMLElement {
  const rec = save.records[key];
  const row = document.createElement('div');
  row.className = 'medal-row';
  const medalSlot = document.createElement('span');
  medalSlot.className = 'mslot' + (rec?.medal ? ' filled' : '');
  medalSlot.title = rec?.medal ? `${rec.medal[0].toUpperCase()}${rec.medal.slice(1)} medal` : 'No medal yet';
  if (rec?.medal) medalSlot.appendChild(mkIcon(`medal_${rec.medal}`, 26));
  row.appendChild(medalSlot);
  for (const feat of FEATS) {
    const got = rec?.feats.includes(feat.id) ?? false;
    const slot = document.createElement('span');
    slot.className = 'mslot pin' + (got ? ' filled' : '');
    slot.title = `${feat.name} — ${feat.desc}`;
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
  if (rec) parts.push(`Best <b>${fmtTime(rec.bestTime)}</b>`);
  if (goldTime != null) parts.push(`Gold ${fmtTime(goldTime)}`);
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
    if (editor.dirty) showConfirm('Leave the editor? Unsaved changes will be lost.', 'Leave editor', leave);
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
  game = null;
  hud = null;
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

function showTitle(): void {
  clearOverlay();
  running = false;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="title-logo">SMALLHANDS</div>
    <div class="title-sub">Tiny workers · Big plans</div>
  `;
  const play = document.createElement('button');
  play.className = 'big-btn';
  play.textContent = save.completed.length ? 'Continue' : 'Play';
  play.onclick = () => {
    audio.click();
    showLevelSelect();
  };
  ov.appendChild(play);
  const blurb = document.createElement('div');
  blurb.className = 'win-stats';
  blurb.innerHTML =
    'You never control the smallhands directly.<br/>Shape the world — ladders, lifts, workshops — and they do the rest.';
  ov.appendChild(blurb);
  uiRoot.appendChild(ov);
  drawIdleBackdrop();
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
  no.textContent = 'Cancel';
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
  setSpeed(prevSpeed > 0 ? prevSpeed : 1);
}

function showLevelSelect(): void {
  clearOverlay();
  running = false;
  const ov = document.createElement('div');
  ov.className = 'overlay level-select';
  const h = document.createElement('div');
  h.className = 'title-logo';
  h.style.fontSize = '38px';
  h.textContent = 'Choose a level';
  ov.appendChild(h);

  // ---- trophy shelf: the collection at a glance ----
  if (Object.keys(save.records).length > 0) {
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
    pct.innerHTML = `<b>${campaignGold}/${LEVELS.length}</b> campaign gold`;
    shelf.appendChild(pct);
    ov.appendChild(shelf);
  }

  // ---- campaign ----
  const grid = document.createElement('div');
  grid.className = 'level-grid';
  LEVELS.forEach((lvl, i) => {
    const unlocked = i === 0 || save.completed.includes(LEVELS[i - 1].id);
    const done = save.completed.includes(lvl.id);
    const card = document.createElement('button');
    card.className = 'level-card' + (unlocked ? '' : ' locked');
    card.innerHTML = `
      <div class="lv-num">${unlocked ? lvl.id : '🔒'}</div>
      <div class="lv-name">${lvl.name}</div>
      <div class="lv-desc">${lvl.desc}</div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? '✓ Complete' : unlocked ? 'Ready' : 'Locked'}</div></div>
    `;
    if (unlocked && lvl.medals) {
      addMedalBits(card, `c${lvl.id}`, lvl.medals.gold);
    }
    if (unlocked) {
      card.onclick = () => {
        audio.click();
        confirmIfInProgress(
          `Abandon "${game?.level.name}"? Progress in the current level will be lost.`,
          'Abandon level',
          () => startLevel(i)
        );
      };
    }
    grid.appendChild(card);
  });
  ov.appendChild(grid);

  // ---- workshop: daily challenge, generator, editor, custom levels ----
  const sec = document.createElement('div');
  sec.className = 'section-title';
  sec.textContent = 'Workshop — endless levels, daily challenge & your own creations';
  ov.appendChild(sec);

  const wgrid = document.createElement('div');
  wgrid.className = 'level-grid workshop-grid';
  ov.appendChild(wgrid);

  // daily challenge
  {
    const daily = dailySeed();
    const done = save.completedCustom.includes(daily.seed);
    const card = document.createElement('button');
    card.className = 'level-card daily';
    card.innerHTML = `
      <div class="lv-num">📅</div>
      <div class="lv-name">Daily Challenge</div>
      <div class="lv-desc">${daily.label} · difficulty ★${daily.difficulty}. One shared seed per day — same mountain for everyone.</div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? '✓ Complete' : 'Ready'}</div></div>
    `;
    // the daily's gold time isn't known until the level is generated, so pass
    // null; the empty medal/feat slots still show as the replay magnet
    addMedalBits(card, daily.seed, null);
    card.onclick = () => {
      audio.click();
      confirmIfInProgress('Abandon the current level?', 'Abandon level', () => {
        const data = generateVerifiedLevel({ seed: daily.seed, difficulty: daily.difficulty });
        data.id = daily.seed; // stable id so completion sticks
        data.name = `Daily · ${daily.label}`;
        startCustomLevel(data, {});
      });
    };
    wgrid.appendChild(card);
  }

  // generate
  {
    const card = document.createElement('button');
    card.className = 'level-card action';
    card.innerHTML = `
      <div class="lv-num">🎲</div>
      <div class="lv-name">Generate a level</div>
      <div class="lv-desc">Roll a fresh, verified level from a seed. Pick your difficulty, share the seed with friends.</div>
      <div class="lv-foot"><div class="lv-status">Endless</div></div>
    `;
    card.onclick = () => {
      audio.click();
      showGenerateDialog();
    };
    wgrid.appendChild(card);
  }

  // new level in editor
  {
    const card = document.createElement('button');
    card.className = 'level-card action';
    card.innerHTML = `
      <div class="lv-num">✎</div>
      <div class="lv-name">Level editor</div>
      <div class="lv-desc">Sculpt terrain, plant resources, set the delivery order — then playtest and share it as a code.</div>
      <div class="lv-foot"><div class="lv-status">Create</div></div>
    `;
    card.onclick = () => {
      audio.click();
      confirmIfInProgress('Abandon the current level?', 'Abandon level', () => openEditor());
    };
    wgrid.appendChild(card);
  }

  // import code
  {
    const card = document.createElement('button');
    card.className = 'level-card action';
    card.innerHTML = `
      <div class="lv-num">⇩</div>
      <div class="lv-name">Import code</div>
      <div class="lv-desc">Paste a shared level code (SMH1.…) to add someone else's level to your list.</div>
      <div class="lv-foot"><div class="lv-status">Share</div></div>
    `;
    card.onclick = () => {
      audio.click();
      const code = window.prompt('Paste a Smallhands level code:');
      if (!code) return;
      const data = decodeShareCode(code);
      if (!data) {
        window.alert('That code could not be read — make sure the whole SMH1.… string was copied.');
        return;
      }
      customLevels = upsertCustomLevel(customLevels, data);
      showLevelSelect();
    };
    wgrid.appendChild(card);
  }

  // saved custom levels
  for (const lvl of customLevels) {
    const done = save.completedCustom.includes(lvl.id);
    const card = document.createElement('div');
    card.className = 'level-card custom';
    card.innerHTML = `
      <div class="lv-num">★</div>
      <div class="lv-name"></div>
      <div class="lv-desc"></div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? '✓ Complete' : 'Ready'}</div></div>
    `;
    (card.querySelector('.lv-name') as HTMLElement).textContent = lvl.name;
    (card.querySelector('.lv-desc') as HTMLElement).textContent = lvl.desc || 'A custom level.';
    addMedalBits(card, lvl.id, medalTimesFor(lvl).gold);
    card.onclick = () => {
      audio.click();
      confirmIfInProgress('Abandon the current level?', 'Abandon level', () => startCustomLevel(lvl, {}));
    };
    const actions = document.createElement('div');
    actions.className = 'lv-actions';
    const mkBtn = (label: string, title: string, fn: (e: Event) => void) => {
      const b = document.createElement('button');
      b.className = 'lv-action-btn';
      b.textContent = label;
      b.title = title;
      b.onclick = (e) => {
        e.stopPropagation();
        audio.click();
        fn(e);
      };
      actions.appendChild(b);
    };
    mkBtn('✎', 'Edit this level', () =>
      confirmIfInProgress('Abandon the current level?', 'Abandon level', () => openEditor(lvl))
    );
    mkBtn('⧉', 'Copy share code', () => {
      const code = encodeShareCode(lvl);
      navigator.clipboard?.writeText(code).catch(() => window.prompt('Copy this level code:', code));
    });
    mkBtn('✕', 'Delete this level', () =>
      showConfirm(`Delete "${lvl.name}"? This cannot be undone.`, 'Delete level', () => {
        customLevels = deleteCustomLevel(customLevels, lvl.id);
        showLevelSelect();
      })
    );
    card.appendChild(actions);
    wgrid.appendChild(card);
  }

  const row = document.createElement('div');
  row.className = 'btn-row';
  if (gameInProgress()) {
    const resume = document.createElement('button');
    resume.className = 'big-btn';
    resume.textContent = `▶ Resume ${game!.level.name}`;
    resume.onclick = () => {
      audio.click();
      resumeGame();
    };
    row.appendChild(resume);
  }
  const back = document.createElement('button');
  back.className = 'big-btn secondary';
  back.textContent = 'Title';
  back.onclick = () => showTitle();
  row.appendChild(back);
  const mute = document.createElement('button');
  mute.className = 'big-btn secondary';
  mute.textContent = audio.muted ? '🔇 Sound off' : '🔊 Sound on';
  mute.onclick = () => {
    audio.muted = !audio.muted;
    save.muted = audio.muted;
    persistSave(save);
    mute.textContent = audio.muted ? '🔇 Sound off' : '🔊 Sound on';
  };
  row.appendChild(mute);
  ov.appendChild(row);
  uiRoot.appendChild(ov);
}

function showGenerateDialog(): void {
  const ov = document.createElement('div');
  ov.className = 'overlay confirm-overlay';
  const box = document.createElement('div');
  box.className = 'panel confirm-box gen-box';
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  msg.innerHTML = '<b>Generate a level</b><br/>The same seed and difficulty always build the same level.';
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
  reroll.title = 'New random seed';
  reroll.onclick = () => {
    seedIn.value = randomSeed();
    audio.click();
  };
  seedRow.appendChild(reroll);
  box.appendChild(seedRow);

  const diffRow = document.createElement('div');
  diffRow.className = 'gen-row';
  const diffLbl = document.createElement('span');
  diffLbl.textContent = 'Difficulty';
  diffRow.appendChild(diffLbl);
  const diffSel = document.createElement('select');
  diffSel.className = 'ed-input ed-select';
  const names = ['★1 Stroll', '★2 Hike', '★3 Climb', '★4 Expedition', '★5 Ascent'];
  names.forEach((n, i) => {
    const opt = document.createElement('option');
    opt.value = String(i + 1);
    opt.textContent = n;
    diffSel.appendChild(opt);
  });
  diffSel.value = '2';
  diffRow.appendChild(diffSel);
  box.appendChild(diffRow);

  const row = document.createElement('div');
  row.className = 'btn-row';
  const gen = (openInEditor: boolean) => {
    const seed = seedIn.value.trim() || randomSeed();
    const data = generateVerifiedLevel({ seed, difficulty: Number(diffSel.value) });
    ov.remove();
    if (openInEditor) openEditor(data);
    else startCustomLevel(data, {});
  };
  const play = document.createElement('button');
  play.className = 'big-btn';
  play.textContent = '▶ Play';
  play.onclick = () => {
    audio.click();
    confirmIfInProgress('Abandon the current level?', 'Abandon level', () => gen(false));
  };
  row.appendChild(play);
  const edit = document.createElement('button');
  edit.className = 'big-btn secondary';
  edit.textContent = '✎ Open in editor';
  edit.onclick = () => {
    audio.click();
    confirmIfInProgress('Abandon the current level?', 'Abandon level', () => gen(true));
  };
  row.appendChild(edit);
  const cancel = document.createElement('button');
  cancel.className = 'big-btn secondary';
  cancel.textContent = 'Cancel';
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
  nm.textContent = g.level.name;
  line.appendChild(nm);
  line.appendChild(document.createTextNode(` · ${fmtTime(g.time)} · Crew ${g.workers.length} · Town Hall ${g.thLevel}`));
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
    none.title = 'Beat the bronze time for a medal';
    big.appendChild(none);
  }
  cer.appendChild(big);

  const name = document.createElement('div');
  name.className = 'medal-name' + (medal ? ` ${medal}` : '');
  name.textContent = medal ? `${medal.toUpperCase()} MEDAL` : 'ORDER DELIVERED';
  cer.appendChild(name);

  if (win && !playtesting && (win.newRecord || win.firstClear)) {
    const chip = document.createElement('span');
    chip.className = 'newrec';
    chip.textContent = win.firstClear ? '★ First clear' : '★ New record';
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
      `<span style="width:${pct(medals.gold)}"><b>Gold</b> ${fmtTime(medals.gold)}</span>` +
      `<span style="width:${(((medals.silver - medals.gold) / max) * 100).toFixed(1)}%"><b>Silver</b> ${fmtTime(medals.silver)}</span>` +
      `<span><b>Bronze</b> ${fmtTime(medals.bronze)}</span>`;
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
    t1.textContent = def.name;
    const t2 = document.createElement('small');
    t2.textContent = got ? `${def.desc} — done!` : def.desc;
    txt.appendChild(t1);
    txt.appendChild(t2);
    f.appendChild(txt);
    feats.appendChild(f);
  }
  cer.appendChild(feats);

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

function showWin(): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const title = document.createElement('div');
  title.className = 'win-title';
  title.textContent = 'Level complete!';
  ov.appendChild(title);
  buildCeremony(ov);
  const row = document.createElement('div');
  row.className = 'btn-row';
  if (playtesting && currentCustom) {
    const back = document.createElement('button');
    back.className = 'big-btn';
    back.textContent = '✎ Back to editor';
    back.onclick = () => {
      audio.click();
      openEditor(currentCustom!);
    };
    row.appendChild(back);
  } else if (!currentCustom) {
    const next = LEVELS[currentLevelIdx + 1];
    if (next) {
      const nb = document.createElement('button');
      nb.className = 'big-btn';
      nb.textContent = `Next: ${next.name} →`;
      nb.onclick = () => {
        audio.click();
        startLevel(currentLevelIdx + 1);
      };
      row.appendChild(nb);
    } else {
      const done = document.createElement('div');
      done.className = 'win-stats';
      done.innerHTML =
        '<b>You have finished every campaign level!</b><br/>The workshop awaits: daily challenges, generated mountains and your own creations.';
      ov.appendChild(done);
    }
  } else {
    const again = document.createElement('button');
    again.className = 'big-btn';
    again.textContent = '🎲 Another one';
    again.onclick = () => {
      audio.click();
      showGenerateDialog();
    };
    row.appendChild(again);
  }
  const lv = document.createElement('button');
  lv.className = 'big-btn secondary';
  lv.textContent = 'Levels';
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

function startGame(def: LevelDef): void {
  clearOverlay();
  editor.close();
  cam.rightInset = 0;
  game = new Game(def);
  speed = 1;
  cam.zoom = 2;
  const c = def.camera ?? { x: 0, y: 0 };
  cam.x = c.x * TILE * cam.zoom - renderer.viewW / 3;
  cam.y = c.y * TILE * cam.zoom - renderer.viewH / 2;
  cam.clamp(game, renderer.viewW, renderer.viewH);

  hud = new Hud(uiRoot, game, {
    onTool: setTool,
    onSpeed: (s) => setSpeed(s),
    onZoom: (dir) => zoomStep(dir),
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
    onRestart: () =>
      confirmIfInProgress(
        `Restart "${game!.level.name}"? Progress in the current level will be lost.`,
        'Restart level',
        () => {
          if (currentCustom) startCustomLevel(currentCustom, { playtest: playtesting });
          else startLevel(currentLevelIdx);
        }
      ),
  });
  setTool('select');
  hud.setSpeed(speed);

  game.onEvent = handleEvent;
  running = true;

  // debug/testing hook
  (window as unknown as Record<string, unknown>).__smallhands = {
    game,
    cam,
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

function handleEvent(e: GameEvent): void {
  const h = hud!;
  switch (e.type) {
    case 'place':
      audio.place();
      break;
    case 'invalid':
      audio.invalid();
      break;
    case 'chop':
      audio.chop();
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
      h.toast(`<b>Town Hall level ${e.level}!</b> New buildings unlocked and a bigger crew.`, false, 6);
      const th = game!.townhall;
      renderer.addUpgradeEffect((th.x + 2) * TILE, th.y * TILE + 4, e.level);
      break;
    }
    case 'produce':
      break;
    case 'spawn':
      audio.spawn();
      break;
    case 'demolish':
      audio.demolish();
      break;
    case 'hint':
      audio.hint();
      h.toast(e.text);
      break;
    case 'win': {
      audio.win();
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

function setTool(t: Tool): void {
  if (!game || !hud) return;
  const def = TOOL_DEFS.find((d) => d.id === t)!;
  if (def.thLevel && game.thLevel < def.thLevel) {
    hud.toast(`<b>${def.label}</b> unlocks at Town Hall level ${def.thLevel}.`, true, 4);
    audio.invalid();
    return;
  }
  hover.tool = t;
  hud.setActiveTool(t);
  runAnchor = null;
  applyToolCursor();
  audio.click();
}

function setSpeed(s: number): void {
  speed = s;
  if (game) game.paused = s === 0;
  hud?.setSpeed(s);
  audio.click();
}

// ---- input -----------------------------------------------------------------------

let dragging = false;
let dragMoved = false;
let painting = false; // editor drag-paint stroke in progress
let lastMx = 0;
let lastMy = 0;
const keys = new Set<string>();
let runAnchor: { x: number; y: number; tool: Tool } | null = null; // build-run start tile
const isRunTool = (t: Tool) => t === 'ramp' || t === 'platform' || t === 'ladder';

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  dragging = true;
  dragMoved = false;
  lastMx = e.clientX;
  lastMy = e.clientY;
  if (editor.active && e.button === 0 && editor.toolDef().drag) {
    const dpr = canvas.width / canvas.clientWidth;
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    painting = true;
    editor.applyAt(t.x, t.y, false);
  }
  if (!editor.active && e.button === 0 && game && running && isRunTool(hover.tool)) {
    const dpr = canvas.width / canvas.clientWidth;
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    runAnchor = { x: t.x, y: t.y, tool: hover.tool };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const dpr = canvas.width / canvas.clientWidth;
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  if (painting) {
    editor.applyAt(t.x, t.y, true);
  } else if (dragging && !runAnchor) {
    const dx = e.clientX - lastMx;
    const dy = e.clientY - lastMy;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    if (dragMoved) {
      // pan with any non-painting drag; taps still place
      canvas.style.cursor = 'grabbing';
      cam.x -= dx * dpr;
      cam.y -= dy * dpr;
      const g = editor.active ? editor.game : game;
      if (g) cam.clamp(g, renderer.viewW, renderer.viewH);
    }
    lastMx = e.clientX;
    lastMy = e.clientY;
  }
  hover.tx = t.x;
  hover.ty = t.y;
  hover.visible = true;

  // hover hint for the town hall (Select tool, not while panning)
  const th = !dragging && game && running && hover.tool === 'select' ? game.buildingAt(t.x, t.y) : undefined;
  if (th && th.kind === 'townhall') hud?.showBuildingHint(e.clientX, e.clientY);
  else hud?.hideBuildingHint();
  // cursor cost badge: while placing a cost-bearing tool, spell out which
  // resource is short so a red ghost isn't a mystery (no-op when affordable)
  if (!dragging && game && running) hud?.showPlacementNeeds(e.clientX, e.clientY, hover.tool);
  else hud?.hidePlacementNeeds();
  if (editor.active) editor.setHover(t.x, t.y, true);
});

canvas.addEventListener('pointerleave', () => {
  hover.visible = false;
  hud?.hideBuildingHint();
  hud?.hidePlacementNeeds();
  editor.setHover(0, 0, false);
});

canvas.addEventListener('pointercancel', () => {
  dragging = false;
  runAnchor = null;
  applyToolCursor();
});

canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  applyToolCursor(); // drop the grabbing hand back to the tool cursor
  if (painting) {
    painting = false;
    editor.endStroke();
    return;
  }
  if (runAnchor) {
    const a = runAnchor;
    runAnchor = null;
    const dpr = canvas.width / canvas.clientWidth;
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    if (game && running) {
      if (a.tool === 'ramp') game.placeRampRun(a.x, a.y, t.x, t.y);
      else if (a.tool === 'ladder') game.placeLadderRun(a.x, a.y, t.x, t.y);
      else game.placeBridgeRun(a.x, a.y, t.x, t.y);
    }
    return;
  }
  if (dragMoved || e.button !== 0) return;
  const dpr = canvas.width / canvas.clientWidth;
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  if (editor.active) {
    editor.applyAt(t.x, t.y, false);
    return;
  }
  if (!game || !running) return;
  applyTool(t.x, t.y);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Step the zoom one level toward an anchor point given in device pixels.
// Defaults to the centre of the usable viewport, which is what the +/- keys
// and the on-screen buttons want; the pinch handler passes the cursor instead.
function zoomStep(dir: number, ax?: number, ay?: number): void {
  const g = editor.active ? editor.game : running ? game : null;
  if (!g) return;
  const oldZoom = cam.zoom;
  const next = Math.max(1, Math.min(4, oldZoom + dir));
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
  const def = TOOL_DEFS.find((d) => d.key === e.key);
  if (def && (!game.level.allowedTools || game.level.allowedTools.includes(def.id))) {
    setTool(def.id);
  }
  if (e.key === ' ') {
    e.preventDefault();
    setSpeed(speed === 0 ? 1 : 0);
  }
  if (e.key === 'Escape') setTool('select');
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function applyTool(tx: number, ty: number): void {
  const g = game!;
  switch (hover.tool) {
    case 'select': {
      const n = g.nodeAt(tx, ty);
      const b = g.buildingAt(tx, ty);
      if (n) {
        hud!.toast(
          `<b>${n.kind === 'tree' ? 'Tree' : n.kind === 'boulder' ? 'Boulder' : 'Iron vein'}</b> — ${n.yieldLeft} left. ${n.marked ? 'Marked for harvest.' : 'Use the Harvest tool to mark it.'}`,
          false,
          4
        );
      } else if (b) {
        if (b.kind === 'townhall') {
          hud!.showTownhall();
        } else {
          hud!.toast(`<b>${b.kind === 'goal' ? 'Delivery target' : b.kind[0].toUpperCase() + b.kind.slice(1)}</b>${b.state === 'blueprint' ? ' (under construction)' : ''}`, false, 4);
        }
      }
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
    case 'lift':
      g.placeLift(tx, ty);
      break;
    case 'rope':
      g.placeRope(tx, ty);
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
    idleGame = new Game(LEVELS[0]);
    for (const n of idleGame.nodes) n.marked = true;
  }
}

// ---- main loop --------------------------------------------------------------------

let last = performance.now();
const FIXED = 1 / 60;
let acc = 0;

const runOverlay = (ctx: CanvasRenderingContext2D) => {
  if (!runAnchor || !game) return;
  const cells =
    runAnchor.tool === 'ramp'
      ? rampRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty)
      : bridgeRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty);
  const name = runAnchor.tool === 'ramp' ? 'tile_ramp' : 'tile_platform';
  ctx.globalAlpha = 0.6;
  for (const c of cells) ctx.drawImage(sprite(name).canvas, c.x * TILE, c.y * TILE);
  ctx.globalAlpha = 1;
};

function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  // keyboard camera pan
  if ((game && running) || editor.active) {
    const panSpeed = 700 * dtReal;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= panSpeed;
    if (keys.has('d') || keys.has('arrowright')) cam.x += panSpeed;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= panSpeed;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += panSpeed;
    const g = editor.active ? editor.game : game;
    if (g) cam.clamp(g, renderer.viewW, renderer.viewH);
  }

  if (editor.active) {
    renderer.draw(editor.game, cam, noHover, now / 1000, (ctx) => editor.drawOverlay(ctx));
    requestAnimationFrame(frame);
    return;
  }

  const active = running && game ? game : idleGame;
  if (active) {
    acc += dtReal * (active === game ? speed : 1);
    let iter = 0;
    while (acc >= FIXED && iter < 8) {
      active.tick(FIXED);
      acc -= FIXED;
      iter++;
    }
    if (acc >= FIXED) acc = 0; // drop time if we can't keep up

    if (active === idleGame) {
      // slow auto-pan across the idle scene
      cam.zoom = 2;
      const maxX = idleGame!.world.w * TILE * 2 - renderer.viewW;
      cam.x = (Math.sin(now / 9000) * 0.5 + 0.5) * Math.max(0, maxX);
      cam.y = idleGame!.world.h * TILE * 2 - renderer.viewH + 20;
    }

    renderer.draw(active, cam, running ? hover : { ...hover, visible: false }, now / 1000, runOverlay);
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
onResize();
showTitle();
requestAnimationFrame(frame);
