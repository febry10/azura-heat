// player.js — the player character on foot: a stylised figure with a swinging
// walk, a drag-orbit third-person camera, jumping, and a short-range punch.
// Driving lives in vehicles.js; this module owns the body whenever the game is
// in 'foot' mode. Facing convention for figures: forward = (sin h, cos h).
'use strict';

AH.player = (function () {
  let fig = null, group = null, pos = null;
  let heading = Math.PI;           // start facing the café (north, -z is PI here)
  let vy = 0, grounded = true, phase = 0;
  let camYaw = 0, camPitch = 0.32, camDist = 7.5;
  let punchT = -1, punchCd = 0;
  const camPos = new THREE.Vector3(0, 4, 10);

  function init(scene, x, z, faceHeading) {
    fig = AH.peds.buildFigure(0x06d6a0, 0x2b3a4a, 0xf2c79b, 0xe63946);
    group = fig.group;
    group.position.set(x, 0, z);
    pos = group.position;
    heading = faceHeading;
    group.rotation.y = heading;
    scene.add(group);
    camYaw = heading + Math.PI; // camera starts behind the player
    return api;
  }

  // input: {f, b, l, r, sprint, jump, punch} booleans; dt seconds.
  function update(dt, input) {
    // Camera-relative wish direction.
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    let wx = 0, wz = 0;
    if (input.f) { wx += -s; wz += -c; }
    if (input.b) { wx += s; wz += c; }
    if (input.r) { wx += c; wz += -s; }
    if (input.l) { wx += -c; wz += s; }
    const moving = (wx !== 0 || wz !== 0);
    let speed = 0;
    if (moving) {
      const len = Math.hypot(wx, wz); wx /= len; wz /= len;
      const targetHeading = Math.atan2(wx, wz);
      heading = AH.turnToward(heading, targetHeading, dt * 11);
      speed = input.sprint ? 8.6 : 5.2;
      pos.x += Math.sin(heading) * speed * dt;
      pos.z += Math.cos(heading) * speed * dt;
      phase += dt * speed * 1.9;
    }
    // Jumping and gravity (the ground plane is y=0 everywhere).
    if (input.jump && grounded) { vy = 4.8; grounded = false; AH.audio.blip(); }
    if (!grounded) {
      vy -= 13.5 * dt;
      pos.y += vy * dt;
      if (pos.y <= 0) { pos.y = 0; vy = 0; grounded = true; }
    }
    for (const box of AH.world.colliders) AH.pushOutOfBox(pos, 0.45, box);
    pos.x = AH.clamp(pos.x, -205, 234);
    pos.z = AH.clamp(pos.z, -195, 195);
    group.rotation.y = heading;

    // Walk cycle.
    const swing = moving ? Math.sin(phase) * 0.6 : 0;
    fig.legL.rotation.x = swing;
    fig.legR.rotation.x = -swing;
    fig.armL.rotation.x = -swing * 0.8;
    if (punchT < 0) fig.armR.rotation.x = swing * 0.8;
    if (moving) group.position.y = Math.abs(Math.sin(phase)) * 0.05 + (grounded ? 0 : pos.y);
    else group.position.y = pos.y;

    // Punch: a quick right-arm swing; the hit lands mid-swing.
    punchCd -= dt;
    if (input.punch && punchCd <= 0 && punchT < 0) {
      punchT = 0; punchCd = 0.42;
      AH.audio.punch();
    }
    if (punchT >= 0) {
      punchT += dt;
      fig.armR.rotation.x = -Math.sin(Math.min(1, punchT / 0.26) * Math.PI) * 1.7;
      if (punchT >= 0.1 && !update.hitDone) {
        update.hitDone = true;
        AH.game.onPlayerPunch();
      }
      if (punchT >= 0.26) { punchT = -1; update.hitDone = false; fig.armR.rotation.x = 0; }
    }
  }

  // Third-person camera: orbit offset from yaw/pitch, smoothed.
  function updateCamera(camera, dt) {
    const cx = pos.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    const cz = pos.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    const cy = 1.6 + Math.sin(camPitch) * camDist;
    const k = Math.min(1, dt * 7);
    camPos.x = AH.lerp(camPos.x, cx, k);
    camPos.y = AH.lerp(camPos.y, cy, k);
    camPos.z = AH.lerp(camPos.z, cz, k);
    camera.position.copy(camPos);
    camera.lookAt(pos.x, 1.55, pos.z);
  }

  function orbit(dYaw, dPitch) {
    camYaw += dYaw;
    camPitch = AH.clamp(camPitch + dPitch, 0.06, 1.15);
  }
  function zoom(d) { camDist = AH.clamp(camDist + d, 4.5, 13); }

  const api = {
    init: init,
    update: update,
    updateCamera: updateCamera,
    orbit: orbit,
    zoom: zoom,
    get pos() { return pos; },
    get group() { return group; },
    get heading() { return heading; },
    set heading(v) { heading = v; if (group) group.rotation.y = v; },
    get camYaw() { return camYaw; },
    set camYaw(v) { camYaw = v; },
    setVisible: function (v) { if (group) group.visible = v; },
    teleport: function (x, z, h) {
      pos.set(x, 0, z);
      if (h !== undefined) { heading = h; group.rotation.y = h; }
      camPos.set(x + Math.sin(camYaw) * camDist, 3, z + Math.cos(camYaw) * camDist);
    },
  };
  return api;
})();
