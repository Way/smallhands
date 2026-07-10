import './style.css';
import { TILE, TOOL_DEFS } from './game/types';
import type { Tool } from './game/types';
import { buildAtlas, drawIconTo } from './engine/sprites';
import { audio } from './engine/audio';
import { loadSave, persistSave } from './engine/save';
import { Game } from './game/sim';
import { findPath } from './game/nav';
import type { GameEvent } from './game/sim';
import { LEVELS } from './game/levels';
import { Camera, Renderer } from './game/render';
import type { HoverState } from './game/render';
import { Hud } from './game/ui';

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
audio.muted = save.muted;

const renderer = new Renderer(canvas);
const cam = new Camera();

let game: Game | null = null;
let hud: Hud | null = null;
let currentLevelIdx = 0;
let speed = 1;
let running = false;

const hover: HoverState = { tool: 'select', tx: 0, ty: 0, visible: false };

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

function showLevelSelect(): void {
  clearOverlay();
  running = false;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const h = document.createElement('div');
  h.className = 'title-logo';
  h.style.fontSize = '38px';
  h.textContent = 'Choose a level';
  ov.appendChild(h);
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
      <div class="lv-status ${done ? 'done' : ''}">${done ? '✓ Complete' : unlocked ? 'Ready' : 'Locked'}</div>
    `;
    if (unlocked) {
      card.onclick = () => {
        audio.click();
        startLevel(i);
      };
    }
    grid.appendChild(card);
  });
  ov.appendChild(grid);
  const row = document.createElement('div');
  row.className = 'btn-row';
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

function showWin(): void {
  const g = game!;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const title = document.createElement('div');
  title.className = 'win-title';
  title.textContent = 'Level complete!';
  ov.appendChild(title);
  const mins = Math.floor(g.time / 60);
  const secs = Math.floor(g.time % 60);
  const stats = document.createElement('div');
  stats.className = 'win-stats';
  stats.innerHTML = `<b>${g.level.name}</b> cleared in ${mins}:${String(secs).padStart(2, '0')}<br/>Crew size: ${g.workers.length} smallhands · Town Hall level ${g.thLevel}`;
  ov.appendChild(stats);
  const row = document.createElement('div');
  row.className = 'btn-row';
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
    done.innerHTML = '<b>You have finished every level — thanks for playing!</b>';
    ov.appendChild(done);
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
  clearOverlay();
  currentLevelIdx = idx;
  const def = LEVELS[idx];
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
    onRole: (r, d) => {
      game!.setDesired(r, game!.desiredRoles[r] + d);
      audio.click();
    },
    onUpgrade: () => game!.startThUpgrade(),
    onMenu: () => {
      setSpeed(0);
      showLevelSelect();
    },
    onRestart: () => startLevel(currentLevelIdx),
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
    case 'upgraded':
      audio.upgraded();
      h.toast(`<b>Town Hall level ${e.level}!</b> New buildings unlocked and a bigger crew.`, false, 6);
      break;
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
      if (!save.completed.includes(game!.level.id)) {
        save.completed.push(game!.level.id);
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
let lastMx = 0;
let lastMy = 0;
const keys = new Set<string>();

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  dragging = true;
  dragMoved = false;
  lastMx = e.clientX;
  lastMy = e.clientY;
});

canvas.addEventListener('pointermove', (e) => {
  const dpr = canvas.width / canvas.clientWidth;
  if (dragging) {
    const dx = e.clientX - lastMx;
    const dy = e.clientY - lastMy;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    if (dragMoved && (hover.tool === 'select' || e.buttons === 4 || e.buttons === 2 || dragMoved)) {
      // pan with any tool while dragging; taps still place
      cam.x -= dx * dpr;
      cam.y -= dy * dpr;
      if (game) cam.clamp(game, renderer.viewW, renderer.viewH);
    }
    lastMx = e.clientX;
    lastMy = e.clientY;
  }
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  hover.tx = t.x;
  hover.ty = t.y;
  hover.visible = true;
});

canvas.addEventListener('pointerleave', () => {
  hover.visible = false;
});

canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  if (dragMoved || !game || !running) return;
  if (e.button !== 0) return;
  const dpr = canvas.width / canvas.clientWidth;
  const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
  applyTool(t.x, t.y);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!game) return;
    const dpr = canvas.width / canvas.clientWidth;
    const oldZoom = cam.zoom;
    const next = e.deltaY < 0 ? Math.min(4, cam.zoom + 1) : Math.max(1, cam.zoom - 1);
    if (next === oldZoom) return;
    // zoom toward the cursor
    const mx = e.clientX * dpr;
    const my = e.clientY * dpr;
    const wx = (cam.x + mx) / oldZoom;
    const wy = (cam.y + my) / oldZoom;
    cam.zoom = next;
    cam.x = wx * next - mx;
    cam.y = wy * next - my;
    cam.clamp(game, renderer.viewW, renderer.viewH);
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.key.toLowerCase());
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
        hud!.toast(`<b>${b.kind === 'goal' ? 'Delivery target' : b.kind[0].toUpperCase() + b.kind.slice(1)}</b>${b.state === 'blueprint' ? ' (under construction)' : ''}`, false, 4);
      }
      break;
    }
    case 'harvest':
      g.toggleMark(tx, ty);
      break;
    case 'ladder':
      g.placeLadder(tx, ty);
      break;
    case 'platform':
      g.placePlatform(tx, ty);
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

function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  // keyboard camera pan
  if (game && running) {
    const panSpeed = 700 * dtReal;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= panSpeed;
    if (keys.has('d') || keys.has('arrowright')) cam.x += panSpeed;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= panSpeed;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += panSpeed;
    cam.clamp(game, renderer.viewW, renderer.viewH);
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

    renderer.draw(active, cam, running ? hover : { ...hover, visible: false }, now / 1000);
  }

  hud?.update();
  requestAnimationFrame(frame);
}

function onResize(): void {
  renderer.resize();
  if (game) cam.clamp(game, renderer.viewW, renderer.viewH);
}

window.addEventListener('resize', onResize);
onResize();
showTitle();
requestAnimationFrame(frame);
