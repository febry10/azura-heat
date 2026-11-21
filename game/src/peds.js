// peds.js — the people of Port Azura. Simple articulated figures (legs and arms
// swing as they walk) who stroll the pavements between waypoints, and who run
// screaming when a crime or a fast car comes too close. Mama Rosa, Sal and the
// dock foreman are special named peds the missions talk through.
'use strict';

AH.peds = (function () {
  const peds = [];
  const SKIN = [0xf2c79b, 0xc68863, 0x8d5a3b, 0xffe0bd];
  const SHIRTS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xff8c42, 0xffffff, 0x8ac926];
  const PANTS = [0x2b3a4a, 0x5b4a68, 0x71563f, 0x274156, 0x803e97];

  // Build one articulated figure. Returns {group, legL, legR, armL, armR, head}.
  function buildFigure(shirt, pants, skin, capColor) {
    const g = new THREE.Group();
    const mat = function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.19);
    legGeo.translate(0, -0.39, 0);
    const legL = new THREE.Mesh(legGeo, mat(pants)); legL.position.set(-0.11, 0.8, 0);
    const legR = new THREE.Mesh(legGeo, mat(pants)); legR.position.set(0.11, 0.8, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.26), mat(shirt));
    torso.position.y = 1.13; torso.castShadow = true;
    const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.15);
    armGeo.translate(0, -0.28, 0);
    const armL = new THREE.Mesh(armGeo, mat(shirt)); armL.position.set(-0.34, 1.42, 0);
    const armR = new THREE.Mesh(armGeo, mat(shirt)); armR.position.set(0.34, 1.42, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), mat(skin));
    head.position.y = 1.66; head.castShadow = true;
    g.add(legL, legR, torso, armL, armR, head);
    if (capColor !== null && capColor !== undefined) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), mat(capColor));
      cap.position.y = 1.86;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.22), mat(capColor));
      brim.position.set(0, 1.82, 0.26); // figures face +z; heading dir is (sin h, cos h)
      g.add(cap, brim);
    }
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR };
  }

  function nameSprite(text) {
    const tex = AH.canvasTexture(256, 56, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.font = 'bold 30px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,16,24,0.85)';
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(text, w / 2, h / 2);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(4.6, 1.0, 1);
    sp.position.y = 2.25;
    return sp;
  }

  function addPed(x, z, opts) {
    opts = opts || {};
    const fig = buildFigure(opts.shirt, opts.pants, opts.skin, opts.cap);
    fig.group.position.set(x, 0, z);
    const ped = {
      fig: fig, group: fig.group, pos: fig.group.position,
      heading: opts.heading || 0, speed: 0, walkSpeed: 1.5 + Math.random() * 0.9,
      phase: Math.random() * 6, state: 'walk', target: null, fleeT: 0,
      name: opts.name || null, down: false, downT: 0,
    };
    if (opts.name) fig.group.add(nameSprite(opts.name));
    fig.group.rotation.y = ped.heading;
    peds.push(ped);
    return ped;
  }

  function spawnCrowd(scene, seed) {
    const rng = AH.rng(seed + 999);
    const CENTERS = AH.world.CENTERS;
    for (let i = 0; i < 24; i++) {
      const onAvenue = rng() < 0.5;
      const c = CENTERS[Math.floor(rng() * CENTERS.length)];
      const along = -185 + rng() * 370;
      const side = (rng() < 0.5 ? -1 : 1) * (AH.world.ROAD / 2 + 2.2);
      const x = onAvenue ? c + side : along;
      const z = onAvenue ? along : c + side;
      const ped = addPed(x, z, {
        shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
        pants: PANTS[Math.floor(rng() * PANTS.length)],
        skin: SKIN[Math.floor(rng() * SKIN.length)],
        cap: rng() < 0.4 ? SHIRTS[Math.floor(rng() * SHIRTS.length)] : null,
        heading: rng() * Math.PI * 2,
      });
      ped.rngState = rng;
      scene.add(ped.group);
    }
  }

  function spawnNamed(scene, name, x, z, heading, shirt) {
    const ped = addPed(x, z, {
      name: name, heading: heading,
      shirt: shirt, pants: 0x2b3a4a, skin: SKIN[1], cap: null,
    });
    ped.state = 'stand';
    scene.add(ped.group);
    return ped;
  }

  function pickTarget(ped) {
    // Wander: pick a point up to 60m away, biased to stay near pavements.
    const a = Math.random() * Math.PI * 2;
    const d = 18 + Math.random() * 42;
    ped.target = {
      x: AH.clamp(ped.pos.x + Math.sin(a) * d, -196, 226),
      z: AH.clamp(ped.pos.z + Math.cos(a) * d, -192, 192),
    };
  }

  function animate(ped, dt) {
    const swing = Math.sin(ped.phase) * (ped.state === 'flee' ? 0.85 : 0.55);
    ped.fig.legL.rotation.x = swing;
    ped.fig.legR.rotation.x = -swing;
    ped.fig.armL.rotation.x = -swing * 0.8;
    ped.fig.armR.rotation.x = swing * 0.8;
    ped.group.position.y = Math.abs(Math.sin(ped.phase)) * 0.045;
  }

  function update(dt) {
    const gp = AH.game;
    for (const ped of peds) {
      if (ped.down) {
        ped.downT -= dt;
        ped.group.rotation.x = -Math.PI / 2 * Math.min(1, (1.2 - ped.downT) * 3 + 0.4);
        if (ped.downT <= 0) { ped.down = false; ped.group.rotation.x = 0; ped.state = 'flee'; ped.fleeT = 2; }
        continue;
      }
      if (ped.state === 'stand') { ped.phase += dt * 1.2; animate(ped, dt); continue; }

      // Flee from the player's car when it is fast and close, or from a shout point.
      let fleeFrom = null;
      if (gp.playerCar && Math.abs(gp.playerCar.speed) > 7) {
        if (AH.dist2(ped.pos.x, ped.pos.z, gp.playerCar.pos.x, gp.playerCar.pos.z) < 110) fleeFrom = gp.playerCar.pos;
      }
      if (ped.fleeFrom && ped.fleeT > 0) { fleeFrom = ped.fleeFrom; ped.fleeT -= dt; }
      if (fleeFrom) ped.state = 'flee'; else if (ped.state === 'flee') ped.state = 'walk';

      if (ped.state === 'flee') {
        const a = Math.atan2(ped.pos.x - fleeFrom.x, ped.pos.z - fleeFrom.z);
        ped.heading = AH.turnToward(ped.heading, a, dt * 8);
        ped.speed = 4.6;
      } else {
        if (!ped.target || AH.dist2(ped.pos.x, ped.pos.z, ped.target.x, ped.target.z) < 2.5) pickTarget(ped);
        const a = Math.atan2(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z);
        ped.heading = AH.turnToward(ped.heading, a, dt * 3);
        ped.speed = ped.walkSpeed;
      }
      ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
      ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
      for (const box of AH.world.colliders) AH.pushOutOfBox(ped.pos, 0.45, box);
      ped.pos.x = AH.clamp(ped.pos.x, -205, 232);
      ped.pos.z = AH.clamp(ped.pos.z, -195, 195);
      ped.group.rotation.y = ped.heading;
      ped.phase += dt * ped.speed * 2.6;
      animate(ped, dt);

      // Hit by the player's car?
      if (gp.playerCar && Math.abs(gp.playerCar.speed) > 3.5) {
        if (AH.dist2(ped.pos.x, ped.pos.z, gp.playerCar.pos.x, gp.playerCar.pos.z) < 2.1 * 2.1) {
          ped.down = true; ped.downT = 2.6;
          ped.group.rotation.x = -Math.PI / 2;
          gp.onPedHit(ped);
        }
      }
    }
  }

  // Everyone near a point panics and runs from it.
  function scare(x, z, radius) {
    for (const ped of peds) {
      if (AH.dist2(ped.pos.x, ped.pos.z, x, z) < radius * radius) {
        ped.fleeFrom = { x: x, z: z };
        ped.fleeT = 1.6;
      }
    }
  }

  return {
    buildFigure: buildFigure,
    spawnCrowd: spawnCrowd,
    spawnNamed: spawnNamed,
    update: update,
    scare: scare,
    all: peds,
  };
})();
