// missions.js — Mama Rosa's story chain: four jobs that teach the whole game
// (drive, steal, escape, deliver against the clock) and pay in cash. A gold
// pillar of light marks the current target in the world; the HUD banner and
// minimap read the same target. Finishing the chain unlocks free roam, and
// Rosa will happily hand the whole chain out again as replays.
'use strict';

AH.missions = (function () {
  const S = AH.world.spots;
  let storyIndex = 0;          // 0..3 next mission, 4 = chain complete
  let active = null;           // { def, step } while a job is running
  let rosaCar = null, coupeCar = null;
  let marker = null, ring = null;
  let timerLeft = -1;

  const DEFS = [
    {
      title: 'First Wheels', contact: 'rosa', reward: 150,
      intro: [
        ['Rosa', 'You must be the new driver everyone is talking about. I am Rosa — this café is mine, and half of Port Azura owes me a favour.'],
        ['Rosa', 'My old sedan needs to reach Sal\'s Garage, across town. Drive her gentle — she is older than you are.'],
        ['Rosa', 'Do this right and there will be more work. Better paid. Less... legal.'],
      ],
      steps: [
        { kind: 'enterCar', car: 'rosa', label: 'Get into Rosa\'s sedan', at: function () { return rosaCar.pos; } },
        { kind: 'deliver', car: 'rosa', label: 'Drive the sedan to Sal\'s Garage', at: function () { return S.garageDoor; }, r: 8 },
      ],
      outro: [['Rosa (phone)', 'Sal says she purred like a kitten. Good driving. Come back to the café — bring your appetite for trouble.']],
    },
    {
      title: 'Hot Property', contact: 'rosa', reward: 300,
      intro: [
        ['Rosa', 'A guest at the Palms Hotel skipped out on a very large tab. His teal coupe is sitting in their lot, pretty as you please.'],
        ['Rosa', 'Take it. Bring it to Sal. And if anyone asks — you are the valet.'],
      ],
      steps: [
        { kind: 'goto', label: 'Go to the Palms Hotel', at: function () { return S.hotelDoor; }, r: 7 },
        { kind: 'enterCar', car: 'coupe', crime: 2, label: 'Steal the teal coupe', at: function () { return coupeCar.pos; } },
        { kind: 'deliver', car: 'coupe', label: 'Deliver the coupe to Sal\'s Garage', at: function () { return S.garageDoor; }, r: 8 },
      ],
      outro: [['Rosa (phone)', 'Sal already has a buyer. You drive clean and steal cleaner. I like that.']],
    },
    {
      title: 'Loose Ends', contact: 'sal', reward: 450,
      intro: [
        ['Sal', 'So you are Rosa\'s new wheel. Name\'s Sal. There is a package in the back room with your name on it. Do not ask. Do not open.'],
        ['Sal', 'Take it to Pier 9 Storage, south-east docks. And kid — if the police start sniffing around, you were never here.'],
      ],
      steps: [
        { kind: 'goto', label: 'Take the package to Pier 9 Storage', at: function () { return S.hideoutDoor; }, r: 9, ambush: true },
        { kind: 'escape', label: 'Lose the heat, then reach Pier 9 Storage', at: function () { return S.hideoutDoor; }, r: 20 },
      ],
      outro: [['Rosa (phone)', 'Package delivered, heat gone. You are officially interesting, driver.']],
    },
    {
      title: 'Cross-Town Run', contact: 'foreman', reward: 600,
      intro: [
        ['Foreman', 'You Rosa\'s driver? Got a cooler of fresh catch that needs to be at the marina before the market closes.'],
        ['Foreman', 'Two and a half minutes. Do not let it get warm, yeah?'],
      ],
      steps: [
        { kind: 'timed', label: 'Deliver the cooler to the marina', at: function () { return S.marina; }, r: 9, time: 150 },
      ],
      outro: [['Rosa (phone)', 'Every job done, driver. Port Azura is yours now — and the café is always open for you.']],
    },
  ];

  const CONTACTS = {
    rosa: function () { return S.cafeDoor; },
    sal: function () { return S.garageDoor; },
    foreman: function () { return S.hideoutDoor; },
  };

  function init(scene) {
    // The two story cars, parked where the fiction needs them.
    rosaCar = AH.vehicles.spawnSpecial(0xffd166, 'sedan', -70, 115, 0.2, "Rosa's sedan");
    coupeCar = AH.vehicles.spawnSpecial(0x12b5a5, 'sport', 118, -44, 0.3, 'Teal coupe');
    // Gold marker: a translucent pillar plus a ground ring.
    marker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 42, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
    );
    ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(marker); scene.add(ring);
  }

  function currentDef() { return storyIndex < DEFS.length ? DEFS[storyIndex] : null; }

  // What the HUD/minimap/marker should point at right now.
  function currentTarget() {
    if (active) {
      const step = active.def.steps[active.step];
      const p = step.at();
      return { x: p.x, z: p.z, label: step.label, kind: 'step' };
    }
    const def = currentDef();
    if (def) {
      const p = CONTACTS[def.contact]();
      const who = def.contact === 'rosa' ? 'Rosa' : (def.contact === 'sal' ? 'Sal' : 'the Foreman');
      return { x: p.x, z: p.z, label: 'Talk to ' + who + ' — "' + def.title + '"', kind: 'contact' };
    }
    return { x: S.cafeDoor.x, z: S.cafeDoor.z, label: 'Free roam — talk to Rosa to replay her jobs', kind: 'contact' };
  }

  function startMission() {
    const def = currentDef();
    if (!def) { // replay the chain
      storyIndex = 0;
      startMission();
      return;
    }
    AH.game.startDialogue(def.intro, function () {
      active = { def: def, step: 0 };
      armStep();
      AH.audio.blip();
    });
  }

  function armStep() {
    const step = active.def.steps[active.step];
    timerLeft = step.kind === 'timed' ? step.time : -1;
    if (step.ambush) {
      AH.police.reportCrime(3, AH.game.playerPos.x, AH.game.playerPos.z);
      AH.game.startDialogue([['Rosa (phone)', 'Heads up, sweetie — half the precinct just rolled out. Lose them, then get that package to Pier 9.']], null);
    }
  }

  function completeStep() {
    const def = active.def;
    active.step += 1;
    AH.audio.blip();
    if (active.step >= def.steps.length) {
      active = null;
      storyIndex += 1;
      AH.game.addCash(def.reward);
      AH.audio.jingle();
      AH.game.startDialogue(def.outro, null);
      AH.game.saveGame();
    } else {
      armStep();
    }
  }

  // Called by the game whenever the player gets into a car. Returns true when
  // the entry advanced a mission step (so the game skips its generic theft).
  function onEnterCar(car) {
    if (!active) return false;
    const step = active.def.steps[active.step];
    if (step.kind !== 'enterCar') return false;
    const wanted = step.car === 'rosa' ? rosaCar : coupeCar;
    if (car === wanted) {
      if (step.crime) AH.police.reportCrime(step.crime, car.pos.x, car.pos.z);
      completeStep();
      return true;
    }
    return false;
  }

  // Screenshot scenes pose the marker by hand (missions.update is not run).
  function setMarkerPos(x, z) {
    if (!marker) return;
    marker.visible = ring.visible = true;
    marker.position.set(x, 21, z);
    ring.position.set(x, 0.25, z);
  }

  function update(dt, t) {
    // Marker follows the current target, gently bobbing.
    const target = currentTarget();
    if (marker) {
      marker.visible = ring.visible = !!target;
      if (target) {
        marker.position.set(target.x, 21, target.z);
        ring.position.set(target.x, 0.25 + Math.sin(t * 2.4) * 0.08, target.z);
        const s = 1 + Math.sin(t * 2.4) * 0.1;
        ring.scale.set(s, s, 1);
      }
    }
    if (!active) return;
    const step = active.def.steps[active.step];
    const gp = AH.game;
    const p = step.at();

    if (step.kind === 'goto' || step.kind === 'escape') {
      const here = gp.playerCar ? gp.playerCar.pos : gp.playerPos;
      const near = AH.dist2(here.x, here.z, p.x, p.z) < step.r * step.r;
      if (near && (step.kind === 'goto' || AH.police.wanted === 0)) completeStep();
    } else if (step.kind === 'deliver') {
      const car = step.car === 'rosa' ? rosaCar : coupeCar;
      if (gp.playerCar === car && AH.dist2(car.pos.x, car.pos.z, p.x, p.z) < step.r * step.r && Math.abs(car.speed) < 2.5) {
        completeStep();
      }
    } else if (step.kind === 'timed') {
      timerLeft -= dt;
      if (timerLeft <= 0) {
        // Forgiving failure: a scolding, a fresh clock, try again.
        timerLeft = step.time;
        AH.game.startDialogue([['Foreman (phone)', 'Too slow! The ice is melting. Again — marina, fast!']], null);
        AH.audio.sting();
      }
      if (gp.playerCar && AH.dist2(gp.playerCar.pos.x, gp.playerCar.pos.z, p.x, p.z) < step.r * step.r && Math.abs(gp.playerCar.speed) < 3) {
        completeStep();
      }
    }
  }

  return {
    init: init,
    update: update,
    currentTarget: currentTarget,
    currentDef: currentDef,
    startMission: startMission,
    onEnterCar: onEnterCar,
    isActive: function () { return !!active; },
    setMarkerPos: setMarkerPos,
    get storyIndex() { return storyIndex; },
    set storyIndex(v) { storyIndex = v; },
    get timerLeft() { return timerLeft; },
    cars: function () { return { rosa: rosaCar, coupe: coupeCar }; },
  };
})();
