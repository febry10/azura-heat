// police.js — the wanted system and Port Azura's finest. Crimes reported by the
// game raise the star level (0–5); police cars spawn on the road grid and hunt
// the player, faster and in greater numbers at higher levels. Break line of
// sight long enough and the heat cools, star by star. Get pinned by a nearby
// cruiser while barely moving and you are BUSTED.
'use strict';

AH.police = (function () {
  let wanted = 0;
  let lastSeen = 0;          // seconds since a cop last had eyes on the player
  let pinTimer = 0;
  let spawnTimer = 0;
  const cops = [];           // car records with .active flag

  function ensureCops() {
    while (cops.length < 5) {
      const car = AH.vehicles.makePoliceCar();
      car.active = false;
      car.group.visible = false;
      cops.push(car);
    }
  }

  function reportCrime(points, x, z) {
    if (points > 0) {
      wanted = Math.min(5, wanted + points);
      lastSeen = 0;
      AH.peds.scare(x, z, 20);
    }
  }

  function desiredCops() { return wanted === 0 ? 0 : Math.min(5, wanted + 1); }

  function spawnCop(near) {
    const car = cops.find(function (c) { return !c.active; });
    if (!car) return;
    // Respawn on a road centre 65–85m away from the player.
    const CENTERS = AH.world.CENTERS;
    let x = near.x, z = near.z;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 65 + Math.random() * 20;
      const cx = AH.clamp(near.x + Math.sin(a) * d, -190, 230);
      const cz = AH.clamp(near.z + Math.cos(a) * d, -190, 190);
      // Snap to the nearest road crossing so they arrive by street.
      const sx = CENTERS.reduce(function (p, c) { return Math.abs(c - cx) < Math.abs(p - cx) ? c : p; }, CENTERS[0]);
      const sz = CENTERS.reduce(function (p, c) { return Math.abs(c - cz) < Math.abs(p - cz) ? c : p; }, CENTERS[0]);
      x = sx; z = sz;
      if (AH.dist2(x, z, near.x, near.z) > 45 * 45) break;
    }
    car.pos.set(x, 0, z);
    car.heading = Math.atan2(-(near.x - x), -(near.z - z));
    car.group.rotation.y = car.heading;
    car.speed = 10;
    car.active = true;
    car.group.visible = true;
  }

  function update(dt, t) {
    ensureCops();
    const gp = AH.game;
    const target = gp.playerCar ? gp.playerCar.pos : gp.playerPos;
    const playerSpeed = gp.playerCar ? Math.abs(gp.playerCar.speed) : gp.playerSpeed;

    spawnTimer -= dt;
    const active = cops.filter(function (c) { return c.active; });
    if (wanted > 0 && active.length < desiredCops() && spawnTimer <= 0) {
      spawnCop(target);
      spawnTimer = 1.1;
    }

    let anySeen = false, nearest = 1e9, pinning = false;
    for (const cop of cops) {
      if (!cop.active) continue;
      const d2 = AH.dist2(cop.pos.x, cop.pos.z, target.x, target.z);
      const d = Math.sqrt(d2);
      nearest = Math.min(nearest, d);
      if (d < 58) anySeen = true;

      if (wanted === 0) {
        // Heat is gone: cruise away and despawn.
        cop.speed = Math.min(cop.speed + 8 * dt, 14);
        cop.pos.x += -Math.sin(cop.heading) * cop.speed * dt;
        cop.pos.z += -Math.cos(cop.heading) * cop.speed * dt;
        cop.leaveT = (cop.leaveT || 0) + dt;
        if (cop.leaveT > 5 || d > 150) { cop.active = false; cop.group.visible = false; cop.leaveT = 0; }
        continue;
      }
      if (d > 175) { // too far behind: quietly re-deploy closer
        cop.active = false; cop.group.visible = false;
        spawnCop(target);
        continue;
      }
      // Chase steering: aim at the player's position, led by their velocity.
      const lead = gp.playerCar ? 0.55 : 0.2;
      const tx = target.x + (gp.playerCar ? -Math.sin(gp.playerCar.heading) * gp.playerCar.speed * lead : 0);
      const tz = target.z + (gp.playerCar ? -Math.cos(gp.playerCar.heading) * gp.playerCar.speed * lead : 0);
      const want = Math.atan2(-(tx - cop.pos.x), -(tz - cop.pos.z));
      cop.heading = AH.turnToward(cop.heading, want, dt * 2.3);
      const maxSpeed = 21.5 + wanted * 2.3;
      const goal = d > 14 ? maxSpeed : Math.max(6, maxSpeed * 0.55);
      cop.speed = AH.lerp(cop.speed, goal, Math.min(1, dt * 1.6));
      cop.pos.x += -Math.sin(cop.heading) * cop.speed * dt;
      cop.pos.z += -Math.cos(cop.heading) * cop.speed * dt;
      for (const box of AH.world.colliders) AH.pushOutOfBox(cop.pos, 1.9, box);
      cop.pos.x = AH.clamp(cop.pos.x, -208, 262);
      cop.pos.z = AH.clamp(cop.pos.z, -196, 196);
      cop.group.rotation.y = cop.heading;
      // Spin the wheels via the shared helper in vehicles (visual only).
      const w = cop.speed * dt / 0.36;
      cop.wheels.fl.rotation.x += w; cop.wheels.fr.rotation.x += w;
      cop.wheels.rl.rotation.x += w; cop.wheels.rr.rotation.x += w;

      // Pinning: close and the player nearly stopped.
      const pinRange = gp.playerCar ? 5.2 : 3.6;
      if (d < pinRange && playerSpeed < 1.3) pinning = true;

      // Light bar strobes.
      if (cop.lightbar) {
        const phase = Math.floor(t * 2.6 + cop.pos.x) % 2 === 0;
        cop.lightbar.userData.red.material.color.setHex(phase ? 0xff2233 : 0x4d0d14);
        cop.lightbar.userData.blue.material.color.setHex(phase ? 0x0d1c4d : 0x2266ff);
      }
    }

    if (anySeen) lastSeen = 0; else lastSeen += dt;
    if (wanted > 0) {
      const hideout = AH.world.spots.hideoutDoor;
      const inHideout = AH.dist2(target.x, target.z, hideout.x, hideout.z) < 26 * 26;
      const threshold = inHideout ? 4 : 10;
      if (lastSeen > threshold) { wanted -= 1; lastSeen = threshold * 0.5; }
    }
    if (pinning && wanted > 0) {
      pinTimer += dt;
      if (pinTimer >= 3) { pinTimer = 0; AH.game.busted(); }
    } else {
      pinTimer = Math.max(0, pinTimer - dt * 2);
    }
    api.nearest = nearest;
    api.pinRatio = AH.clamp(pinTimer / 3, 0, 1);
  }

  function reset() {
    wanted = 0; lastSeen = 0; pinTimer = 0;
    for (const cop of cops) { cop.active = false; cop.group.visible = false; }
  }

  // Place an inactive cruiser at a pose and switch it on (used by the
  // deterministic screenshot scenes). Returns the car, or null if none free.
  function deployAt(x, z, heading) {
    ensureCops();
    const car = cops.find(function (c) { return !c.active; });
    if (!car) return null;
    car.pos.set(x, 0, z);
    car.heading = heading;
    car.group.rotation.y = heading;
    car.speed = 0;
    car.active = true;
    car.group.visible = true;
    return car;
  }

  const api = {
    reportCrime: reportCrime,
    update: update,
    reset: reset,
    deployAt: deployAt,
    nearest: 1e9, pinRatio: 0,
    get wanted() { return wanted; },
    set wanted(v) { wanted = AH.clamp(v, 0, 5); },
    cops: cops,
    activeCops: function () { return cops.filter(function (c) { return c.active; }); },
  };
  return api;
})();
