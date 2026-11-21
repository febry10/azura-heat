// main.js — boot, input, the game loop and every mode transition for AZURA
// HEAT: menu, on foot, driving, pause, busted/wasted, plus the deterministic
// ?shot= scenes the screenshots are taken from and a ?test= self-play harness.
// AH.game is the shared state object the other modules read and call back into.
'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const SHOT = params.get('shot');
  const SEED = parseInt(params.get('seed') || '1', 10) || 1;
  const TEST = params.get('test') === '1';
  const SAVE_KEY = 'azuraHeatSaveV1';

  const errors = [];
  window.addEventListener('error', function (e) { errors.push(String(e.message || e.error)); });

  // --- renderer / scene -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(SHOT ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.getElementById('stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(-40, 26, 190);

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- shared game state ---------------------------------------------------------
  const game = {
    mode: 'menu',               // menu | foot | car | pause | end | shot
    cash: 0, health: 100,
    playerCar: null,
    playerPos: null,            // wired to AH.player.pos after init
    playerHeading: 0,
    playerSpeed: 0,
    focus: { x: 0, z: 0 },
    time: 0,
  };
  AH.game = game;

  // --- world building --------------------------------------------------------------
  AH.vehicles.init(scene);
  const worldInfo = AH.world.build(scene, SEED);
  void worldInfo;
  AH.vehicles.spawnTraffic(SEED);
  AH.vehicles.spawnParked(SEED);
  AH.peds.spawnCrowd(scene, SEED);
  const rosaNPC = AH.peds.spawnNamed(scene, 'Mama Rosa', -64, 120, Math.PI * 0.85, 0xc73e54);
  const salNPC = AH.peds.spawnNamed(scene, "Sal", 60, -64, Math.PI * 1.1, 0x274156);
  const foremanNPC = AH.peds.spawnNamed(scene, 'Foreman', 112, 116, Math.PI * 0.9, 0xff8c42);
  void rosaNPC; void salNPC; void foremanNPC;
  AH.missions.init(scene);
  AH.player.init(scene, AH.world.spots.start.x, AH.world.spots.start.z, Math.PI);
  game.playerPos = AH.player.pos;
  AH.hud.init();

  // --- input ----------------------------------------------------------------------
  const keys = new Set();
  let punchPulse = false;
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyF' && game.mode === 'car') exitCar();
    if (e.code === 'KeyM') {
      const m = AH.audio.toggleMute();
      AH.hud.toast(m ? 'SOUND OFF' : 'SOUND ON', 900);
    }
    if ((e.code === 'KeyP' || e.code === 'Escape') && (game.mode === 'foot' || game.mode === 'car')) pauseGame();
    else if (e.code === 'Escape' && game.mode === 'pause') resumeGame();
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys.delete(e.code); });

  let dragging = false, lastPX = 0, lastPY = 0, carCamOffset = 0;
  const cvs = renderer.domElement;
  cvs.addEventListener('pointerdown', function (e) {
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    if (game.mode === 'foot') punchPulse = true;
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    if (game.mode === 'foot') AH.player.orbit(-dx * 0.0052, dy * 0.004);
    else if (game.mode === 'car') carCamOffset += -dx * 0.0052;
  });
  window.addEventListener('pointerup', function () { dragging = false; });
  cvs.addEventListener('wheel', function (e) {
    if (game.mode === 'foot') AH.player.zoom(e.deltaY * 0.01);
  }, { passive: true });

  function inputFoot() {
    return {
      f: keys.has('KeyW') || keys.has('ArrowUp'),
      b: keys.has('KeyS') || keys.has('ArrowDown'),
      l: keys.has('KeyA') || keys.has('ArrowLeft'),
      r: keys.has('KeyD') || keys.has('ArrowRight'),
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      jump: keys.has('Space'),
      punch: punchPulse || keys.has('KeyJ'),
    };
  }
  function inputCar() {
    return {
      up: keys.has('KeyW') || keys.has('ArrowUp'),
      down: keys.has('KeyS') || keys.has('ArrowDown'),
      left: keys.has('KeyA') || keys.has('ArrowLeft'),
      right: keys.has('KeyD') || keys.has('ArrowRight'),
      handbrake: keys.has('Space'),
    };
  }

  // --- interaction ------------------------------------------------------------------
  let hotwire = null; // {car, t}
  function interact() {
    if (game.mode !== 'foot' && game.mode !== 'car') return;
    if (AH.hud.dialogueOpen()) { AH.hud.advanceDialogue(); return; }
    if (game.mode !== 'foot' || hotwire) return;
    // Talk to a contact?
    const target = AH.missions.currentTarget();
    if (target && target.kind === 'contact' &&
        AH.dist2(game.playerPos.x, game.playerPos.z, target.x, target.z) < 3.6 * 3.6) {
      AH.missions.startMission();
      return;
    }
    const car = AH.vehicles.nearestCar(game.playerPos.x, game.playerPos.z, 3.6);
    if (car) enterCar(car);
  }

  function enterCar(car) {
    if (car.mode === 'traffic' && car.speed > 2.5) { AH.hud.toast('TOO FAST TO GRAB', 1100); return; }
    const mc = AH.missions.cars();
    if (car === mc.rosa) { beginDriving(car); return; }  // Rosa hands over the keys
    hotwire = { car: car, t: 0.75 };
    AH.audio.hotwire();
  }

  function beginDriving(car) {
    // Leave the traffic/parked populations.
    const ti = AH.vehicles.traffic.indexOf(car); if (ti >= 0) AH.vehicles.traffic.splice(ti, 1);
    const pi = AH.vehicles.parked.indexOf(car); if (pi >= 0) AH.vehicles.parked.splice(pi, 1);
    const wasParked = car.mode === 'parked';
    car.mode = 'player';
    game.playerCar = car;
    game.mode = 'car';
    AH.player.setVisible(false);
    AH.audio.door();
    const consumed = AH.missions.onEnterCar(car);
    if (!consumed && wasParked) {
      // Theft: worse when somebody sees it.
      let seen = false;
      for (const ped of AH.peds.all) {
        if (AH.dist2(ped.pos.x, ped.pos.z, car.pos.x, car.pos.z) < 22 * 22) { seen = true; break; }
      }
      if (AH.police.activeCops().length && AH.police.nearest < 45) seen = true;
      AH.police.reportCrime(seen ? 2 : 1, car.pos.x, car.pos.z);
      AH.hud.toast(seen ? 'CAR STOLEN — THEY SAW YOU!' : 'CAR STOLEN', 1500);
    }
    carCamOffset = 0;
  }

  function exitCar() {
    const car = game.playerCar;
    if (!car) return;
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading); // car's right side
    AH.player.teleport(car.pos.x + rx * 2.4, car.pos.z + rz * 2.4, car.heading);
    AH.player.camYaw = car.heading + Math.PI;
    car.mode = 'parked'; car.speed = 0;
    if (!AH.vehicles.parked.includes(car)) AH.vehicles.parked.push(car);
    game.playerCar = null;
    game.mode = 'foot';
    AH.player.setVisible(true);
    AH.audio.door();
  }

  // --- callbacks used by other modules -----------------------------------------------
  let ramCd = 0, lastDamageT = -99;
  game.onPlayerCrash = function (speed) {
    if (speed > 11) { damage((speed - 10) * 0.55); }
  };
  game.onPlayerRam = function (other) {
    if (game.time - ramCd < 2.5) return;
    ramCd = game.time;
    if (other.isPolice) AH.police.reportCrime(1, other.pos.x, other.pos.z);
    else AH.police.reportCrime(1, other.pos.x, other.pos.z);
  };
  game.onPedHit = function (ped) {
    void ped;
    AH.police.reportCrime(2, game.playerCar ? game.playerCar.pos.x : game.playerPos.x,
      game.playerCar ? game.playerCar.pos.z : game.playerPos.z);
    AH.audio.hit();
    damage(2);
  };
  game.onPlayerPunch = function () {
    const p = game.playerPos, h = AH.player.heading;
    const fx = p.x + Math.sin(h) * 1.5, fz = p.z + Math.cos(h) * 1.5;
    for (const ped of AH.peds.all) {
      if (ped.down) continue;
      if (AH.dist2(ped.pos.x, ped.pos.z, fx, fz) < 1.3 * 1.3) {
        ped.down = true; ped.downT = 2.6;
        let witnessed = false;
        for (const other of AH.peds.all) {
          if (other !== ped && AH.dist2(other.pos.x, other.pos.z, p.x, p.z) < 20 * 20) witnessed = true;
        }
        if (AH.police.nearest < 40) witnessed = true;
        if (witnessed) AH.police.reportCrime(1, p.x, p.z); else AH.peds.scare(p.x, p.z, 9);
        AH.audio.hit();
        return;
      }
    }
  };
  function damage(n) {
    game.health -= n;
    lastDamageT = game.time;
    if (game.health <= 0) { game.health = 0; wasted(); }
  }
  game.addCash = function (n) {
    game.cash += n;
    AH.hud.toast('+$' + n, 2200);
    AH.audio.cash();
  };
  game.startDialogue = function (lines, cb) { AH.hud.showDialogue(lines, cb); };

  game.busted = function () {
    if (game.mode === 'end') return;
    game.mode = 'end';
    AH.audio.sting();
    document.getElementById('end-title').textContent = 'BUSTED';
    const fine = Math.min(game.cash, 150);
    document.getElementById('end-text').textContent =
      'Port Azura PD pins you down. The fine costs you $' + fine + ', and you walk out of the station with a warning.';
    game.pendingFine = fine;
    game.respawnAt = AH.world.spots.policeDoor;
    document.getElementById('end').style.display = 'flex';
  };
  function wasted() {
    if (game.mode === 'end') return;
    game.mode = 'end';
    AH.audio.sting();
    document.getElementById('end-title').textContent = 'WASTED';
    const fine = Math.min(game.cash, 100);
    document.getElementById('end-text').textContent =
      'You wake up at Azura General. The hospital bill is $' + fine + '. Port Azura is still out there.';
    game.pendingFine = fine;
    game.respawnAt = AH.world.spots.hospitalDoor;
    document.getElementById('end').style.display = 'flex';
  }
  game.wasted = wasted;

  function respawn() {
    game.cash -= game.pendingFine || 0;
    if (game.playerCar) {
      const car = game.playerCar;
      car.mode = 'parked'; car.speed = 0;
      if (!AH.vehicles.parked.includes(car)) AH.vehicles.parked.push(car);
      game.playerCar = null;
    }
    AH.police.reset();
    game.health = 100;
    AH.player.setVisible(true);
    AH.player.teleport(game.respawnAt.x, game.respawnAt.z, Math.PI * 0.25);
    game.mode = 'foot';
    document.getElementById('end').style.display = 'none';
    saveGame();
  }

  // --- save / load ----------------------------------------------------------------------
  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: game.cash, story: AH.missions.storyIndex,
        x: game.playerPos.x, z: game.playerPos.z,
      }));
    } catch (e) { /* private mode etc. */ }
  }
  game.saveGame = saveGame;
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // --- screens ----------------------------------------------------------------------------
  function startGame(useSave) {
    AH.audio.unlock();
    const save = useSave ? loadSave() : null;
    if (save) {
      game.cash = save.cash || 0;
      AH.missions.storyIndex = save.story || 0;
      AH.player.teleport(save.x, save.z, Math.PI);
    } else {
      game.cash = 0;
      AH.missions.storyIndex = 0;
      AH.player.teleport(AH.world.spots.start.x, AH.world.spots.start.z, Math.PI);
      saveGame();
    }
    game.health = 100;
    document.getElementById('menu').style.display = 'none';
    AH.hud.setVisible(true);
    game.mode = 'foot';
  }
  function pauseGame() {
    game.prevMode = game.mode;
    game.mode = 'pause';
    document.getElementById('pause').style.display = 'flex';
  }
  function resumeGame() {
    game.mode = game.prevMode || 'foot';
    document.getElementById('pause').style.display = 'none';
  }
  document.getElementById('btn-start').addEventListener('click', function () { startGame(false); });
  document.getElementById('btn-continue').addEventListener('click', function () { startGame(true); });
  document.getElementById('btn-resume').addEventListener('click', resumeGame);
  document.getElementById('btn-quit').addEventListener('click', function () { location.reload(); });
  document.getElementById('btn-respawn').addEventListener('click', respawn);
  if (loadSave()) document.getElementById('btn-continue').style.display = 'inline-block';

  // --- prompt + objective ---------------------------------------------------------------------
  function currentPrompt() {
    if (AH.hud.dialogueOpen()) return '';
    if (hotwire) return 'HOTWIRING…';
    if (game.mode === 'car') {
      return Math.abs(game.playerCar.speed) < 3 ? 'F — Exit car' : '';
    }
    if (game.mode !== 'foot') return '';
    const target = AH.missions.currentTarget();
    if (target && target.kind === 'contact' &&
        AH.dist2(game.playerPos.x, game.playerPos.z, target.x, target.z) < 3.6 * 3.6) return 'E — Talk';
    const car = AH.vehicles.nearestCar(game.playerPos.x, game.playerPos.z, 3.6);
    if (car) return 'E — Enter ' + (car.name || 'car');
    return '';
  }

  // --- driving camera ----------------------------------------------------------------------------
  const carCamPos = new THREE.Vector3(0, 5, 12);
  let carCamAngle = 0;
  function updateCarCamera(dt) {
    const car = game.playerCar;
    const targetAngle = car.heading + carCamOffset;
    carCamAngle += AH.wrapAngle(targetAngle - carCamAngle) * Math.min(1, dt * 4.5);
    carCamOffset *= Math.pow(0.4, dt); // drift back behind the car
    const dist = 10.5, h = 4.1;
    const cx = car.pos.x + Math.sin(carCamAngle) * dist;
    const cz = car.pos.z + Math.cos(carCamAngle) * dist;
    const k = Math.min(1, dt * 6);
    carCamPos.x = AH.lerp(carCamPos.x, cx, k);
    carCamPos.y = AH.lerp(carCamPos.y, h, k);
    carCamPos.z = AH.lerp(carCamPos.z, cz, k);
    camera.position.copy(carCamPos);
    camera.lookAt(car.pos.x - Math.sin(car.heading) * 5, 1.3, car.pos.z - Math.cos(car.heading) * 5);
  }

  // --- menu backdrop camera -------------------------------------------------------------------------
  function menuCamera(t) {
    const a = t * 0.045;
    camera.position.set(Math.sin(a) * 120, 42 + Math.sin(t * 0.11) * 6, Math.cos(a) * 120);
    camera.lookAt(0, 6, 0);
    game.focus.x = 0; game.focus.z = 0;
  }

  // ================= SHOT MODE =================
  const shotState = { speedKmh: null, objective: '', cash: 0, wanted: 0 };
  function setupShot(name) {
    game.mode = 'shot';
    document.getElementById('menu').style.display = 'none';
    AH.hud.setVisible(true);
    const V = AH.vehicles, P = AH.police;
    const poseCar = function (car, x, z, heading, speed) {
      V.placeCar(car, x, z, heading); car.speed = speed || 0; return car;
    };
    if (name === 'cover') {
      const h = -Math.PI / 2 + 0.25;
      const fx = -Math.sin(h), fz = -Math.cos(h); // hero forward (0.97, -0.25)
      const hero = V.spawnSpecial(0xe63946, 'sport', 8, 10, h, 'Hero');
      hero.mode = 'player'; game.playerCar = hero; hero.speed = 13;
      poseCar(V.spawnSpecial(0xffd166, 'sedan', 0, 0, h), 8 + fx * 24, 10 + fz * 24, h, 9);
      poseCar(V.spawnSpecial(0x00bbf9, 'hatch', 0, 0, Math.PI), 55.4, -13, Math.PI, 8);
      const cop = P.deployAt(8 - fx * 7 + fz * 2.8, 10 - fz * 7 - fx * 2.8, h);
      if (cop) cop.speed = 13;
      const cop2 = P.deployAt(8 - fx * 10.5 - fz * 3.2, 10 - fz * 10.5 + fx * 3.2, h);
      if (cop2) cop2.speed = 13;
      P.wanted = 2;
      shotState.cash = 1250; shotState.wanted = 2; shotState.speedKmh = 48;
      shotState.objective = 'Deliver the coupe to Sal\'s Garage';
      AH.missions.setMarkerPos(AH.world.spots.garageDoor.x, AH.world.spots.garageDoor.z);
      game.shotTarget = AH.world.spots.garageDoor;
      camera.position.set(8 - fx * 16.5, 4.6, 10 - fz * 16.5);
      camera.lookAt(8 + fx * 8, 1.1, 10 + fz * 8);
      game.focus.x = 8; game.focus.z = 10;
    } else if (name === 'foot') {
      AH.player.teleport(-57, 133, Math.PI * 0.92);
      AH.player.camYaw = Math.PI * 0.92 + Math.PI;
      shotState.cash = 150; shotState.wanted = 0; shotState.speedKmh = null;
      shotState.objective = 'Talk to Rosa — "First Wheels"';
      AH.missions.setMarkerPos(AH.world.spots.cafeDoor.x, AH.world.spots.cafeDoor.z);
      game.shotTarget = AH.world.spots.cafeDoor;
      camera.position.set(-57 + 5.5, 3.1, 133 + 6.5);
      camera.lookAt(-60, 1.4, 122);
      game.focus.x = -57; game.focus.z = 130;
    } else if (name === 'chase') {
      // On the z=0 street (it spans z -8..8), eastbound in the +x lane.
      const h = -Math.PI / 2 + 0.15;
      const fx = -Math.sin(h), fz = -Math.cos(h); // (0.99, -0.15)
      const HX = 30, HZ = 3.4;
      const hero = V.spawnSpecial(0x118ab2, 'sedan', HX, HZ, h, 'Hero');
      hero.mode = 'player'; game.playerCar = hero; hero.speed = 24;
      P.deployAt(HX - fx * 6.5 + fz * 2, HZ - fz * 6.5 - fx * 2, h);
      P.deployAt(HX - fx * 9 - fz * 3, HZ - fz * 9 + fx * 3, h + 0.08);
      P.deployAt(HX - fx * 11.5 + fz * 0.5, HZ - fz * 11.5 - fx * 0.5, h - 0.06);
      P.wanted = 4;
      shotState.cash = 900; shotState.wanted = 4; shotState.speedKmh = 86;
      shotState.objective = 'Lose the heat, then reach Pier 9 Storage';
      AH.missions.setMarkerPos(AH.world.spots.hideoutDoor.x, AH.world.spots.hideoutDoor.z);
      game.shotTarget = AH.world.spots.hideoutDoor;
      camera.position.set(HX - fx * 14.5, 4.6, HZ - fz * 14.5);
      camera.lookAt(HX + fx * 7, 1.1, HZ + fz * 7);
      game.focus.x = HX; game.focus.z = HZ;
    } else if (name === 'mission') {
      const mc = AH.missions.cars();
      AH.player.teleport(114.5, -40, Math.PI * 0.8);
      AH.player.camYaw = Math.PI * 0.8 + Math.PI;
      shotState.cash = 450; shotState.wanted = 1; shotState.speedKmh = null;
      shotState.objective = 'Steal the teal coupe';
      AH.missions.setMarkerPos(mc.coupe.pos.x, mc.coupe.pos.z);
      game.shotTarget = mc.coupe.pos;
      AH.hud.showDialogue([['Rosa (phone)', 'That teal coupe by the Palms Hotel — bring it to Sal, and do not scratch it.']], null);
      camera.position.set(111, 2.7, -53);
      camera.lookAt(118, 1.4, -42);
      game.focus.x = 116; game.focus.z = -42;
    }
    // Freeze a composed world: hide the player's loose figure when "driving".
    if (game.playerCar) AH.player.setVisible(false);
  }

  // Flash police light bars in shot mode (police.update is not running).
  function shotAnimate(t) {
    for (const cop of AH.police.cops) {
      if (!cop.active || !cop.lightbar) continue;
      const phase = Math.floor(t * 2.6 + cop.pos.x) % 2 === 0;
      cop.lightbar.userData.red.material.color.setHex(phase ? 0xff2233 : 0x4d0d14);
      cop.lightbar.userData.blue.material.color.setHex(phase ? 0x0d1c4d : 0x2266ff);
    }
  }

  // ================= main loop =================
  const clock = new THREE.Clock();
  let saveTimer = 0, prevPlayerPos = { x: 0, z: 0 };

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    game.time += dt;
    const t = game.time;

    if (game.mode === 'shot') {
      AH.world.update(dt, t);
      shotAnimate(t);
      AH.hud.update({
        cash: shotState.cash, health: 100, wanted: shotState.wanted,
        speedKmh: shotState.speedKmh, objective: shotState.objective,
        prompt: '', pinRatio: 0, timerLeft: -1,
      }, t);
      renderer.render(scene, camera);
      return;
    }

    if (game.mode === 'menu') {
      menuCamera(t);
      AH.vehicles.update(dt);
      AH.peds.update(dt);
      AH.world.update(dt, t);
      renderer.render(scene, camera);
      return;
    }
    if (game.mode === 'pause' || game.mode === 'end') {
      renderer.render(scene, camera);
      return;
    }

    // Playing (foot or car).
    if (hotwire) {
      hotwire.t -= dt;
      if (hotwire.t <= 0) { const c = hotwire.car; hotwire = null; beginDriving(c); }
    }
    if (game.mode === 'foot') {
      const before = { x: game.playerPos.x, z: game.playerPos.z };
      AH.player.update(dt, inputFoot());
      game.playerSpeed = dt > 0 ? Math.hypot(game.playerPos.x - before.x, game.playerPos.z - before.z) / dt : 0;
      game.playerHeading = AH.player.heading;
      AH.player.updateCamera(camera, dt);
      game.focus.x = game.playerPos.x; game.focus.z = game.playerPos.z;
    } else if (game.mode === 'car') {
      const car = game.playerCar;
      AH.vehicles.updateDriving(car, dt, inputCar());
      game.playerSpeed = Math.abs(car.speed);
      game.playerHeading = car.heading;
      game.playerPos.set(car.pos.x, 0, car.pos.z);
      updateCarCamera(dt);
      game.focus.x = car.pos.x; game.focus.z = car.pos.z;
      if (car.health <= 0) { // wrecked: bail out and take a beating
        car.health = 25;
        damage(18);
        exitCar();
        AH.hud.toast('TOTALLED!', 1600);
      }
    }
    punchPulse = false;

    if (game.health < 100 && game.time - lastDamageT > 6) {
      game.health = Math.min(100, game.health + dt * 3);
    }

    AH.vehicles.update(dt);
    AH.peds.update(dt);
    AH.police.update(dt, t);
    AH.missions.update(dt, t);
    AH.world.update(dt, t);

    const siren = AH.police.wanted > 0 ? AH.clamp(1 - AH.police.nearest / 70, 0, 1) : 0;
    AH.audio.update(dt, game.mode === 'car' ? Math.abs(game.playerCar.speed) / 36 : 0, siren);

    const target = AH.missions.currentTarget();
    AH.hud.update({
      cash: game.cash, health: game.health, wanted: AH.police.wanted,
      speedKmh: game.mode === 'car' ? Math.abs(game.playerCar.speed) * 3.6 : null,
      objective: target ? target.label : '',
      prompt: currentPrompt(), pinRatio: AH.police.pinRatio,
      timerLeft: AH.missions.timerLeft,
    }, t);

    saveTimer += dt;
    if (saveTimer > 10) { saveTimer = 0; saveGame(); }
    prevPlayerPos = { x: game.playerPos.x, z: game.playerPos.z };
    void prevPlayerPos;

    renderer.render(scene, camera);
  }

  if (SHOT) setupShot(SHOT);
  frame();

  // ================= self-test (?test=1) =================
  // Timer-driven: run it in a real-time browser (no virtual-time budget),
  // where setTimeout and requestAnimationFrame advance together.
  if (TEST) runTest();
  function runTest() {
    const log = [];
    const el = document.getElementById('testlog');
    el.style.display = 'block';
    function say(s) { log.push(s); el.textContent = log.join('\n'); console.log('TEST ' + s); }
    function key(code, down) {
      if (down) keys.add(code); else keys.delete(code);
    }
    function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
    (async function () {
      try {
        await wait(600);
        say('boot mode=' + game.mode + ' errors=' + errors.length);
        startGame(false);
        say('started mode=' + game.mode);
        const p0 = { x: game.playerPos.x, z: game.playerPos.z };
        key('KeyW', true);
        await wait(2500);
        key('KeyW', false);
        const moved = Math.hypot(game.playerPos.x - p0.x, game.playerPos.z - p0.z);
        say('walk moved=' + moved.toFixed(2) + ' (expect >1)');
        // Jump into Rosa's car via the real interact path.
        const mc = AH.missions.cars();
        AH.player.teleport(mc.rosa.pos.x + 2, mc.rosa.pos.z + 1, 0);
        interact();
        await wait(350);
        say('mode after enter=' + game.mode + ' playerCar=' + (game.playerCar ? game.playerCar.name : 'none'));
        if (game.playerCar) { // face north up the avenue for a clear run
          game.playerCar.heading = 0; game.playerCar.group.rotation.y = 0;
        }
        key('KeyW', true);
        await wait(9000); // headless SwiftShader runs ~4fps: allow ~1.5s of sim time
        key('KeyW', false);
        const car = game.playerCar;
        say('drove speed=' + (car ? Math.abs(car.speed).toFixed(1) : 'n/a') +
            ' pos=' + (car ? car.pos.x.toFixed(0) + ',' + car.pos.z.toFixed(0) : 'n/a'));
        exitCar();
        say('after exit mode=' + game.mode);
        AH.police.reportCrime(2, game.playerPos.x, game.playerPos.z);
        await wait(4000);
        say('wanted=' + AH.police.wanted + ' activeCops=' + AH.police.activeCops().length);
        AH.police.reset();
        // Talk to Rosa: teleport to the café contact and interact.
        AH.player.teleport(AH.world.spots.cafeDoor.x, AH.world.spots.cafeDoor.z, 0);
        interact();
        await wait(350);
        say('dialogueOpen=' + AH.hud.dialogueOpen());
        interact(); interact(); interact();
        await wait(350);
        say('missionActive=' + AH.missions.isActive() + ' errors=' + errors.length +
            (errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''));
        say('TEST DONE');
      } catch (err) {
        say('EXCEPTION ' + (err && err.stack || err));
      }
    })();
  }
})();
