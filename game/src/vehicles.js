// vehicles.js — every car in Port Azura. One factory builds low-poly cars from
// boxes (body, cabin, spinning/steering wheels, a light bar for police). Three
// populations share the model: traffic that follows the road grid in lanes and
// pauses at junctions, parked cars waiting to be stolen, and the car the player
// is driving, which uses simple arcade physics.
'use strict';

AH.vehicles = (function () {
  const CAR_COLORS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xff8c42, 0xe63946, 0x8ac926];
  const TYPES = {
    sedan: { len: 4.4, wid: 1.85, bodyH: 0.62, cabinH: 0.55, top: 30 },
    hatch: { len: 3.9, wid: 1.8, bodyH: 0.66, cabinH: 0.62, top: 27 },
    sport: { len: 4.5, wid: 1.9, bodyH: 0.5, cabinH: 0.42, top: 38 },
    van:   { len: 5.2, wid: 2.0, bodyH: 1.05, cabinH: 0.75, top: 24 },
  };
  const cars = [];        // all car records
  const traffic = [];
  const parked = [];
  let scene = null, rng = null;

  const bodyMat = function (color) { return new THREE.MeshLambertMaterial({ color: color }); };
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1d2b38 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x17181c });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xb9c2cc });

  function makeCarMesh(color, type, isPolice) {
    const t = TYPES[type];
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.bodyH, t.len), bodyMat(isPolice ? 0xf2f4f6 : color));
    body.position.y = 0.38 + t.bodyH / 2;
    body.castShadow = true;
    g.add(body);
    if (isPolice) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.04, 0.3, t.len * 0.5), bodyMat(0x1d3557));
      stripe.position.y = body.position.y;
      g.add(stripe);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.82, t.cabinH, t.len * 0.48), glassMat);
    cabin.position.set(0, body.position.y + t.bodyH / 2 + t.cabinH / 2 - 0.04, -t.len * 0.04);
    cabin.castShadow = true;
    g.add(cabin);
    if (type === 'sport') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.9, 0.07, 0.42), bodyMat(isPolice ? 0xf2f4f6 : color));
      spoiler.position.set(0, body.position.y + t.bodyH / 2 + 0.28, t.len / 2 - 0.25);
      g.add(spoiler);
    }
    const wheels = {};
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
    wg.rotateZ(Math.PI / 2);
    const hg = new THREE.CylinderGeometry(0.19, 0.19, 0.28, 8);
    hg.rotateZ(Math.PI / 2);
    [['fl', -1, -1], ['fr', 1, -1], ['rl', -1, 1], ['rr', 1, 1]].forEach(function (w) {
      const pivot = new THREE.Group();
      pivot.position.set(w[1] * (t.wid / 2 - 0.05), 0.36, w[2] * (t.len / 2 - 0.95));
      const tyre = new THREE.Mesh(wg, tyreMat);
      const hub = new THREE.Mesh(hg, hubMat);
      pivot.add(tyre); pivot.add(hub);
      g.add(pivot);
      wheels[w[0]] = pivot;
    });
    let lightbar = null;
    if (isPolice) {
      lightbar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xff2233 }));
      red.position.x = -0.3;
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x2266ff }));
      blue.position.x = 0.3;
      lightbar.add(red); lightbar.add(blue);
      lightbar.position.set(0, cabin.position.y + t.cabinH / 2 + 0.1, cabin.position.z);
      lightbar.userData = { red: red, blue: blue };
      g.add(lightbar);
    }
    // Headlights: two small emissive discs at the front (-z is forward).
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
    [-0.55, 0.55].forEach(function (x) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.05), hl);
      lamp.position.set(x * t.wid * 0.62, body.position.y + 0.08, -t.len / 2 - 0.02);
      g.add(lamp);
    });
    return { group: g, wheels: wheels, lightbar: lightbar, spec: t };
  }

  function addCar(color, type, isPolice) {
    const built = makeCarMesh(color, type, isPolice);
    scene.add(built.group);
    const car = {
      group: built.group, wheels: built.wheels, lightbar: built.lightbar, spec: built.spec,
      type: type, isPolice: !!isPolice, mode: 'parked',
      heading: 0, speed: 0, health: 100, marked: false, name: '',
      // traffic state
      axis: 'x', fixed: 0, s: 0, dir: 1, cruise: 10, decidedAt: '',
      radius: 2.3,
    };
    car.pos = built.group.position;
    cars.push(car);
    return car;
  }

  function placeCar(car, x, z, heading) {
    car.pos.set(x, 0, z);
    car.heading = heading;
    car.group.rotation.y = heading;
  }

  // --- traffic ---------------------------------------------------------------
  // Cars drive on the right: the lane offset flips with the heading.
  function laneFixed(axis, dir, roadCentre) {
    // heading +x -> lane is +z of centre; +z -> lane is -x of centre.
    if (axis === 'x') return roadCentre + (dir > 0 ? 3.4 : -3.4);
    return roadCentre + (dir > 0 ? -3.4 : 3.4);
  }

  function spawnTraffic(seed) {
    rng = AH.rng(seed + 77);
    const typeNames = Object.keys(TYPES);
    for (let i = 0; i < 16; i++) {
      const car = addCar(CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], typeNames[Math.floor(rng() * 3)], false);
      car.mode = 'traffic';
      car.axis = rng() < 0.5 ? 'x' : 'z';
      car.dir = rng() < 0.5 ? 1 : -1;
      const centre = AH.world.CENTERS[Math.floor(rng() * AH.world.CENTERS.length)];
      car.fixed = laneFixed(car.axis, car.dir, centre);
      car.s = -190 + rng() * 380;
      car.cruise = 8.5 + rng() * 4.5;
      car.speed = car.cruise;
      traffic.push(car);
      syncTrafficTransform(car);
    }
  }

  function syncTrafficTransform(car) {
    if (car.axis === 'x') {
      car.pos.set(car.s, 0, car.fixed);
      // Forward is (-sin h, -cos h): +x travel needs h = -PI/2, -x needs +PI/2.
      car.heading = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      car.pos.set(car.fixed, 0, car.s);
      car.heading = car.dir > 0 ? Math.PI : 0;
    }
    // Model forward is -z; heading 0 faces -z (north).
    car.group.rotation.y = car.heading;
  }

  function updateTraffic(dt) {
    const CENTERS = AH.world.CENTERS;
    for (const car of traffic) {
      if (car.mode !== 'traffic') continue;
      // Slow for a car ahead in the same lane.
      let target = car.cruise;
      for (const other of traffic) {
        if (other === car || other.mode !== 'traffic') continue;
        if (other.axis === car.axis && Math.abs(other.fixed - car.fixed) < 1) {
          const gap = (other.s - car.s) * car.dir;
          if (gap > 0 && gap < 9) target = Math.min(target, gap < 5 ? 0 : other.speed);
        }
      }
      // Also stop for the player's car when it blocks the lane.
      const pc = AH.game.playerCar;
      if (pc) {
        const ahead = (car.axis === 'x')
          ? (pc.pos.x - car.s) * car.dir > 0 && Math.abs(pc.pos.z - car.fixed) < 2.6 && Math.abs(pc.pos.x - car.s) < 8
          : (pc.pos.z - car.s) * car.dir > 0 && Math.abs(pc.pos.x - car.fixed) < 2.6 && Math.abs(pc.pos.z - car.s) < 8;
        if (ahead) target = 0;
      }
      car.speed = AH.lerp(car.speed, target, Math.min(1, dt * 3));
      car.s += car.dir * car.speed * dt;
      if (car.s > 196) car.s = -196;
      if (car.s < -196) car.s = 196;

      // Junctions: maybe turn onto the crossing road.
      const cross = car.axis === 'x' ? car.pos.x : car.pos.z;
      for (const c of CENTERS) {
        if (Math.abs(cross - c) < 1.1 && car.decidedAt !== (car.axis + ':' + c + ':' + Math.round(car.fixed))) {
          car.decidedAt = car.axis + ':' + c + ':' + Math.round(car.fixed);
          if (rng() < 0.32) {
            const turnDir = rng() < 0.5 ? 1 : -1;
            const along = car.axis === 'x' ? car.pos.z : car.pos.x;
            const newAxis = car.axis === 'x' ? 'z' : 'x';
            car.fixed = laneFixed(newAxis, turnDir, c);
            car.s = along;
            car.axis = newAxis;
            car.dir = turnDir;
          }
        }
      }
      syncTrafficTransform(car);
      spinWheels(car, dt);
    }
  }

  // --- parked ----------------------------------------------------------------
  function spawnParked(seed) {
    const r = AH.rng(seed + 131);
    const typeNames = Object.keys(TYPES);
    const CENTERS = AH.world.CENTERS;
    for (let i = 0; i < 14; i++) {
      const car = addCar(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)], typeNames[Math.floor(r() * 4)], false);
      const along = -170 + r() * 340;
      if (r() < 0.5) {
        const c = CENTERS[Math.floor(r() * CENTERS.length)];
        const side = r() < 0.5 ? -6.9 : 6.9;
        placeCar(car, c + side, along, side < 0 ? Math.PI : 0);
      } else {
        const c = CENTERS[Math.floor(r() * CENTERS.length)];
        const side = r() < 0.5 ? -6.9 : 6.9;
        placeCar(car, along, c + side, side < 0 ? -Math.PI / 2 : Math.PI / 2);
      }
      parked.push(car);
    }
  }

  // A named car placed by the missions (Rosa's sedan, the hotel coupe...).
  function spawnSpecial(color, type, x, z, heading, name) {
    const car = addCar(color, type, false);
    placeCar(car, x, z, heading);
    car.name = name;
    parked.push(car);
    return car;
  }

  function makePoliceCar() {
    const car = addCar(0xf2f4f6, 'sedan', true);
    car.mode = 'police';
    return car;
  }

  // --- player driving ----------------------------------------------------------
  function spinWheels(car, dt) {
    const w = car.speed * dt / 0.36;
    car.wheels.fl.rotation.x += w; car.wheels.fr.rotation.x += w;
    car.wheels.rl.rotation.x += w; car.wheels.rr.rotation.x += w;
  }

  function updateDriving(car, dt, input) {
    const spec = car.spec;
    const fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const maxF = spec.top, maxR = -9;
    if (fwd > 0) car.speed += 13.5 * dt * (1 - Math.max(0, car.speed) / (maxF * 1.25));
    else if (fwd < 0) car.speed += (car.speed > 0.5 ? -26 : -8) * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4.5 * dt);
    if (input.handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 16 * dt);
    car.speed = AH.clamp(car.speed, maxR, maxF);
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const steerMax = 0.62 / (1 + Math.abs(car.speed) * 0.055);
    car.steer = AH.lerp(car.steer || 0, steerIn * steerMax, Math.min(1, dt * 9));
    if (Math.abs(car.speed) > 0.05) {
      car.heading += car.steer * (car.speed / 2.6) * dt * (input.handbrake ? 1.5 : 1);
    }
    car.pos.x += -Math.sin(car.heading) * car.speed * dt;
    car.pos.z += -Math.cos(car.heading) * car.speed * dt;
    car.pos.x = AH.clamp(car.pos.x, -208, 262);
    car.pos.z = AH.clamp(car.pos.z, -196, 196);
    car.group.rotation.y = car.heading;
    car.wheels.fl.rotation.y = car.steer * 1.4;
    car.wheels.fr.rotation.y = car.steer * 1.4;
    spinWheels(car, dt);

    // Building collisions: push out, bleed speed, take damage.
    let hitWall = false;
    for (const box of AH.world.colliders) {
      const before = { x: car.pos.x, z: car.pos.z };
      if (AH.pushOutOfBox(car.pos, 1.9, box)) {
        if (Math.abs(car.speed) > 6) {
          car.health -= Math.abs(car.speed) * 0.55;
          AH.audio.crash();
          AH.game.onPlayerCrash(Math.abs(car.speed));
        }
        car.speed *= 0.35;
        hitWall = true;
        void before;
      }
    }
    // Car-to-car bumps.
    for (const other of cars) {
      if (other === car || other.mode === 'player') continue;
      const d2 = AH.dist2(car.pos.x, car.pos.z, other.pos.x, other.pos.z);
      if (d2 < 4.4 * 4.4 && d2 > 0.001) {
        const d = Math.sqrt(d2);
        const nx = (other.pos.x - car.pos.x) / d, nz = (other.pos.z - car.pos.z) / d;
        const overlap = 4.4 - d;
        other.pos.x += nx * overlap * 0.55; other.pos.z += nz * overlap * 0.55;
        car.pos.x -= nx * overlap * 0.45; car.pos.z -= nz * overlap * 0.45;
        if (Math.abs(car.speed) > 7) {
          other.health -= 12; car.health -= 6;
          AH.audio.crash();
          AH.game.onPlayerRam(other);
          car.speed *= 0.55;
        } else car.speed *= 0.8;
        if (other.mode === 'traffic') { other.mode = 'flee'; other.fleeT = 0; }
      }
    }
    return hitWall;
  }

  // A traffic car whose driver bails and runs after being rammed / stolen from.
  function updateFleeing(car, dt) {
    car.fleeT += dt;
    car.speed = Math.min(car.speed + 20 * dt, 17);
    car.s += 0; // fleeing cars drive straight ahead in world space
    car.pos.x += -Math.sin(car.heading) * car.speed * dt;
    car.pos.z += -Math.cos(car.heading) * car.speed * dt;
    spinWheels(car, dt);
    if (car.fleeT > 4 || Math.abs(car.pos.x) > 260 || Math.abs(car.pos.z) > 240) {
      car.mode = 'parked'; car.speed = 0;
      if (!parked.includes(car)) parked.push(car);
      const ti = traffic.indexOf(car); if (ti >= 0) traffic.splice(ti, 1);
    }
  }

  function update(dt) {
    updateTraffic(dt);
    for (const car of cars) if (car.mode === 'flee') updateFleeing(car, dt);
  }

  function nearestCar(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const car of cars) {
      if (car.mode === 'player' || car.mode === 'police') continue;
      const d2 = AH.dist2(x, z, car.pos.x, car.pos.z);
      if (d2 < bd) { bd = d2; best = car; }
    }
    return best;
  }

  return {
    init: function (sc) { scene = sc; },
    spawnTraffic: spawnTraffic,
    spawnParked: spawnParked,
    spawnSpecial: spawnSpecial,
    makePoliceCar: makePoliceCar,
    update: update,
    updateDriving: updateDriving,
    nearestCar: nearestCar,
    placeCar: placeCar,
    cars: cars, traffic: traffic, parked: parked,
    TYPES: TYPES,
  };
})();
