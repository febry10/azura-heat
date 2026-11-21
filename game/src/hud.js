// hud.js — everything flat on top of the 3D view: the minimap (a 2D canvas
// drawn from the same world data the city was built from), wanted stars, cash,
// health, speedo, the objective banner, contextual prompts, dialogue boxes and
// centre-screen toasts. The DOM nodes live in index.html; this module owns
// their contents.
'use strict';

AH.hud = (function () {
  let el = {};
  let dlgQueue = null, dlgIndex = 0, dlgDone = null;
  let lastStars = -1, lastCash = -1, lastObjective = '', lastPrompt = '';
  let toastTimer = null;

  function init() {
    ['hud', 'minimap', 'stars', 'cash', 'objective', 'healthfill', 'speed', 'prompt',
     'dialogue', 'dlg-name', 'dlg-text', 'toast', 'pinwrap', 'pinfill', 'timer'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
    el.mm = el.minimap.getContext('2d');
  }

  function setVisible(v) { el.hud.style.display = v ? 'block' : 'none'; }

  // --- dialogue ---------------------------------------------------------------
  function showDialogue(lines, onDone) {
    if (!lines || !lines.length) { if (onDone) onDone(); return; }
    dlgQueue = lines; dlgIndex = 0; dlgDone = onDone || null;
    renderDialogue();
    el.dialogue.style.display = 'block';
  }
  function renderDialogue() {
    el['dlg-name'].textContent = dlgQueue[dlgIndex][0];
    el['dlg-text'].textContent = dlgQueue[dlgIndex][1];
  }
  function advanceDialogue() {
    if (!dlgQueue) return false;
    AH.audio.blip();
    dlgIndex += 1;
    if (dlgIndex >= dlgQueue.length) {
      dlgQueue = null;
      el.dialogue.style.display = 'none';
      const cb = dlgDone; dlgDone = null;
      if (cb) cb();
    } else renderDialogue();
    return true;
  }
  function dialogueOpen() { return !!dlgQueue; }

  function toast(text, ms) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, ms || 2600);
  }

  // --- minimap ------------------------------------------------------------------
  const MM = { x0: -225, x1: 285, z0: -212, z1: 212, size: 204 };
  function mmX(x) { return (x - MM.x0) / (MM.x1 - MM.x0) * MM.size; }
  function mmY(z) { return (z - MM.z0) / (MM.z1 - MM.z0) * MM.size; }

  function drawMinimap(t) {
    const ctx = el.mm, S = MM.size;
    ctx.fillStyle = '#2b9fd8'; ctx.fillRect(0, 0, S, S);                    // ocean
    ctx.fillStyle = '#e8cf9e'; ctx.fillRect(mmX(200), 0, mmX(236) - mmX(200), S); // sand
    ctx.fillStyle = '#39424e'; ctx.fillRect(0, 0, mmX(200), S);             // land
    ctx.strokeStyle = '#c8cfd6'; ctx.lineWidth = 3;
    ctx.beginPath();
    AH.world.CENTERS.forEach(function (c) {
      ctx.moveTo(mmX(c), 0); ctx.lineTo(mmX(c), S);
      ctx.moveTo(0, mmY(c)); ctx.lineTo(mmX(200), mmY(c));
    });
    ctx.stroke();
    // Mission/contact target: a pulsing gold dot. Screenshot scenes may pose
    // their own target so the map agrees with the composed picture.
    const target = (AH.game && AH.game.shotTarget) || AH.missions.currentTarget();
    if (target) {
      const r = 4 + Math.sin(t * 4) * 1.4;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(mmX(target.x), mmY(target.z), r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(20,16,24,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Police blips flash red/blue.
    const phase = Math.floor(t * 2.6) % 2 === 0;
    ctx.fillStyle = phase ? '#ff4455' : '#4488ff';
    AH.police.activeCops().forEach(function (cop) {
      ctx.beginPath(); ctx.arc(mmX(cop.pos.x), mmY(cop.pos.z), 3, 0, 7); ctx.fill();
    });
    // Player arrow.
    const gp = AH.game;
    const p = gp.playerCar ? gp.playerCar.pos : gp.playerPos;
    const dir = gp.playerCar
      ? { x: -Math.sin(gp.playerCar.heading), z: -Math.cos(gp.playerCar.heading) }
      : { x: Math.sin(gp.playerHeading), z: Math.cos(gp.playerHeading) };
    ctx.save();
    ctx.translate(mmX(p.x), mmY(p.z));
    ctx.rotate(Math.atan2(dir.z, dir.x));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,24,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  // --- per-frame refresh ----------------------------------------------------------
  function update(state, t) {
    if (state.wanted !== lastStars) {
      lastStars = state.wanted;
      let html = '';
      for (let i = 0; i < 5; i++) html += '<span class="' + (i < state.wanted ? 'on' : '') + '">★</span>';
      el.stars.innerHTML = html;
      el.stars.style.opacity = state.wanted > 0 ? '1' : '0.35';
    }
    if (state.cash !== lastCash) {
      lastCash = state.cash;
      el.cash.textContent = '$' + state.cash.toLocaleString('en-US');
    }
    el.healthfill.style.width = AH.clamp(state.health, 0, 100) + '%';
    el.healthfill.style.background = state.health > 30 ? '#43d17c' : '#e63946';
    el.speed.innerHTML = state.speedKmh === null ? '' :
      '<b>' + Math.round(state.speedKmh) + '</b><small>km/h</small>';
    if (state.objective !== lastObjective) {
      lastObjective = state.objective;
      el.objective.textContent = state.objective;
      el.objective.style.display = state.objective ? 'block' : 'none';
    }
    if (state.prompt !== lastPrompt) {
      lastPrompt = state.prompt;
      el.prompt.textContent = state.prompt;
      el.prompt.style.display = state.prompt ? 'block' : 'none';
    }
    el.pinwrap.style.display = state.pinRatio > 0.02 ? 'block' : 'none';
    if (state.pinRatio > 0.02) el.pinfill.style.width = (state.pinRatio * 100) + '%';
    if (state.timerLeft > 0) {
      el.timer.style.display = 'block';
      el.timer.textContent = '⏱ ' + Math.ceil(state.timerLeft) + 's';
      el.timer.style.color = state.timerLeft < 20 ? '#ff5566' : '#ffd166';
    } else el.timer.style.display = 'none';
    drawMinimap(t);
  }

  return {
    init: init, setVisible: setVisible, update: update,
    showDialogue: showDialogue, advanceDialogue: advanceDialogue, dialogueOpen: dialogueOpen,
    toast: toast,
  };
})();
