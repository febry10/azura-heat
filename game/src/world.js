// world.js — Port Azura itself: a sun-soaked, deliberately colourful coastal
// city on a regular road grid. Avenues and streets cross every PITCH metres;
// buildings fill the blocks between them in pastel tints with lit windows; the
// east edge of the map is a beach and an animated ocean. Landmarks the story
// needs (police HQ, hospital, Sal's Garage, Café Rosa, the Palms Hotel and the
// Pier 9 hideout) are reserved blocks with signed buildings.
'use strict';

AH.world = (function () {
  const PITCH = 52;              // distance between road centres
  const ROAD = 16;               // road width
  const CENTERS = [-156, -104, -52, 0, 52, 104, 156]; // avenues (x) and streets (z)
  const CITY = 200;              // city ground spans -CITY..CITY
  const BEACH_X = 236;           // sand runs CITY..BEACH_X, water beyond

  const colliders = [];          // {minX,maxX,minZ,maxZ} for buildings
  let ocean = null, oceanBase = null;

  // Named places the missions and respawns use. Block centres sit at ±26 ± 52k.
  const landmarks = {
    cafe:     { x: -78, z: 130, label: 'Café Rosa' },
    garage:   { x: 78,  z: -78, label: "Sal's Garage" },
    police:   { x: -78, z: -26, label: 'Port Azura Police' },
    hospital: { x: 26,  z: 78,  label: 'Azura General Hospital' },
    hotel:    { x: 130, z: -26, label: 'Palms Hotel' },
    hideout:  { x: 130, z: 130, label: 'Pier 9 Storage' },
  };
  // Street-side points (on the pavement next to each landmark block).
  const spots = {
    cafeDoor:   { x: -62, z: 118 },
    garageDoor: { x: 62,  z: -66 },
    policeDoor: { x: -62, z: -14 },
    hospitalDoor: { x: 10, z: 66 },
    hotelDoor:  { x: 114, z: -14 },
    hideoutDoor: { x: 114, z: 118 },
    marina:     { x: 214, z: 40 },
    start:      { x: -58, z: 142 },
  };

  function facadeTexture(rng, litRatio) {
    return AH.canvasTexture(128, 256, function (ctx, w, h) {
      ctx.fillStyle = '#cfc8bd'; ctx.fillRect(0, 0, w, h);
      const cols = 5, rows = 10, cw = w / cols, ch = h / rows;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const lit = rng() < litRatio;
          ctx.fillStyle = lit ? '#ffd98c' : '#3d4a57';
          ctx.fillRect(i * cw + 3, j * ch + 4, cw - 6, ch - 8);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(i * cw + 3, j * ch + 4, cw - 6, 2);
        }
      }
    });
  }

  function signTexture(text, bg, fg) {
    return AH.canvasTexture(512, 96, function (ctx, w, h) {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg;
      ctx.font = 'bold 52px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
  }

  function build(scene, seed) {
    const rng = AH.rng(seed);

    // --- light and sky -----------------------------------------------------
    scene.fog = new THREE.Fog(0xf2a56b, 160, 780);
    const skyTex = AH.canvasTexture(4, 512, function (ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2c6fd0');
      g.addColorStop(0.45, '#7fb2e8');
      g.addColorStop(0.72, '#ffb347');
      g.addColorStop(1, '#ffe3b3');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(880, 20, 14),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    scene.add(sky);

    const sun = new THREE.DirectionalLight(0xffd9a8, 1.3);
    sun.position.set(-190, 165, -95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);
    scene.userData.sun = sun;
    scene.add(new THREE.HemisphereLight(0xffe7c4, 0x54606e, 0.55));

    // A few soft clouds, high and slow.
    const cloudTex = AH.canvasTexture(256, 128, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) {
        const x = 30 + rng() * (w - 60), y = 40 + rng() * (h - 70), r = 18 + rng() * 30;
        const g = ctx.createRadialGradient(x, y, 2, x, y, r);
        g.addColorStop(0, 'rgba(255,250,240,0.55)');
        g.addColorStop(1, 'rgba(255,250,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    });
    const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 9; i++) {
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(150 + rng() * 130, 50 + rng() * 30), cloudMat);
      cl.position.set(-500 + rng() * 1000, 130 + rng() * 70, -500 + rng() * 1000);
      cl.rotation.x = -Math.PI / 2 + 0.25;
      scene.add(cl);
    }

    // --- ground, beach, ocean ---------------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY * 2 + 40, CITY * 2 + 40),
      new THREE.MeshLambertMaterial({ color: 0xb3a58d })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(BEACH_X - CITY + 26, CITY * 2 + 40),
      new THREE.MeshLambertMaterial({ color: 0xeccf9a })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((CITY + BEACH_X) / 2 + 6, 0.01, 0);
    sand.receiveShadow = true;
    scene.add(sand);

    const oceanGeo = new THREE.PlaneGeometry(300, CITY * 2 + 90, 26, 26);
    ocean = new THREE.Mesh(oceanGeo, new THREE.MeshLambertMaterial({
      color: 0x1d9ec4, transparent: true, opacity: 0.94,
    }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(BEACH_X + 148, 0.25, 0);
    oceanBase = oceanGeo.attributes.position.array.slice();
    scene.add(ocean);
    const deep = new THREE.Mesh(
      new THREE.PlaneGeometry(320, CITY * 2 + 90),
      new THREE.MeshLambertMaterial({ color: 0x0d6e99 })
    );
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(BEACH_X + 150, -0.4, 0);
    scene.add(deep);

    buildRoads(scene);
    buildBlocks(scene, rng);
    buildPalmsAndLamps(scene, rng);
    buildBillboards(scene, rng);
    return { colliders: colliders, landmarks: landmarks, spots: spots };
  }

  function buildRoads(scene) {
    const asphalt = AH.canvasTexture(128, 256, function (ctx, w, h) {
      ctx.fillStyle = '#333039'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(3, 0, 3, h); ctx.fillRect(w - 6, 0, 3, h);
      ctx.fillStyle = '#f7c948';
      for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 2, y + 10, 4, 34);
    }, [1, 26]);
    const roadMat = new THREE.MeshLambertMaterial({ map: asphalt });
    const len = CITY * 2 + 16;
    // One geometry per direction, transformed at the geometry level so the
    // asphalt texture (dashes along its length) runs correctly on both.
    const avenueGeo = new THREE.PlaneGeometry(ROAD, len);
    avenueGeo.rotateX(-Math.PI / 2);
    const streetGeo = avenueGeo.clone();
    streetGeo.rotateY(Math.PI / 2);

    CENTERS.forEach(function (c) {
      const av = new THREE.Mesh(avenueGeo, roadMat);
      av.position.set(c, 0.02, 0);
      av.receiveShadow = true;
      scene.add(av);
      const st = new THREE.Mesh(streetGeo, roadMat);
      st.position.set(0, 0.03, c);
      st.receiveShadow = true;
      scene.add(st);
    });

    // Crosswalks on every intersection.
    const crossTex = AH.canvasTexture(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#333039'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(240,238,230,0.85)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(10 + i * 24, 4, 12, 22); ctx.fillRect(10 + i * 24, h - 26, 12, 22);
        ctx.fillRect(4, 10 + i * 24, 22, 12); ctx.fillRect(w - 26, 10 + i * 24, 22, 12);
      }
    });
    const crossMat = new THREE.MeshLambertMaterial({ map: crossTex });
    CENTERS.forEach(function (x) {
      CENTERS.forEach(function (z) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, ROAD), crossMat);
        p.rotation.x = -Math.PI / 2;
        p.position.set(x, 0.045, z);
        p.receiveShadow = true;
        scene.add(p);
      });
    });
  }

  const TINTS = [0xff8a75, 0x37b8a5, 0xffd166, 0xb8a9e8, 0x7fc8e8, 0xffb59e, 0x9fe870, 0xff7bac];

  function buildBlocks(scene, rng) {
    const facades = [facadeTexture(rng, 0.4), facadeTexture(rng, 0.62), facadeTexture(rng, 0.25), facadeTexture(rng, 0.8)];
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5d54 });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0xcfc4ae });
    const blockCenters = [-130, -78, -26, 26, 78, 130];

    // Sidewalk pads, merged into one mesh.
    const padGeoms = [];
    blockCenters.forEach(function (bx) {
      blockCenters.forEach(function (bz) {
        const g = new THREE.BoxGeometry(37, 0.14, 37);
        g.translate(bx, 0.07, bz);
        padGeoms.push(g);
      });
    });
    const pads = new THREE.Mesh(AH.mergeGeoms(padGeoms), walkMat);
    pads.receiveShadow = true;
    scene.add(pads);

    const reserved = {};
    Object.keys(landmarks).forEach(function (k) {
      reserved[landmarks[k].x + ',' + landmarks[k].z] = k;
    });

    blockCenters.forEach(function (bx) {
      blockCenters.forEach(function (bz) {
        const key = bx + ',' + bz;
        if (reserved[key]) { buildLandmark(scene, reserved[key], bx, bz, rng); return; }
        const n = 2 + Math.floor(rng() * 3);
        const slots = [[-8, -8], [8, -8], [-8, 8], [8, 8]];
        for (let i = 0; i < n; i++) {
          const sx = slots[i][0] + (rng() * 3 - 1.5), sz = slots[i][1] + (rng() * 3 - 1.5);
          const w = 11 + rng() * 5, d = 11 + rng() * 5;
          const centreBoost = 1 - Math.min(1, Math.hypot(bx, bz) / 260);
          const hgt = 11 + rng() * 16 + centreBoost * 26;
          const mat = new THREE.MeshLambertMaterial({
            map: facades[Math.floor(rng() * facades.length)],
            color: TINTS[Math.floor(rng() * TINTS.length)],
          });
          const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
          b.position.set(bx + sx, hgt / 2, bz + sz);
          b.castShadow = true; b.receiveShadow = true;
          scene.add(b);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.8, d + 0.7), roofMat);
          roof.position.set(bx + sx, hgt + 0.4, bz + sz);
          scene.add(roof);
          if (rng() < 0.4) {
            const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4), roofMat);
            ac.position.set(bx + sx + (rng() * 6 - 3), hgt + 1.2, bz + sz + (rng() * 6 - 3));
            scene.add(ac);
          }
          colliders.push({ minX: bx + sx - w / 2 - 0.3, maxX: bx + sx + w / 2 + 0.3, minZ: bz + sz - d / 2 - 0.3, maxZ: bz + sz + d / 2 + 0.3 });
        }
      });
    });
  }

  function buildLandmark(scene, kind, bx, bz, rng) {
    const conf = {
      cafe:     { w: 26, d: 18, h: 9,  color: 0xffb59e, sign: 'CAFÉ ROSA', bg: '#c73e54', fg: '#ffe9ec' },
      garage:   { w: 28, d: 20, h: 10, color: 0x9fb4c7, sign: "SAL'S GARAGE", bg: '#274156', fg: '#ffd166' },
      police:   { w: 30, d: 22, h: 16, color: 0xdfe7ee, sign: 'POLICE HQ', bg: '#1d3557', fg: '#ffffff' },
      hospital: { w: 30, d: 22, h: 20, color: 0xf2f5f7, sign: 'AZURA GENERAL', bg: '#e63946', fg: '#ffffff' },
      hotel:    { w: 24, d: 20, h: 34, color: 0x7fc8e8, sign: 'PALMS HOTEL', bg: '#0f766e', fg: '#fef9c3' },
      hideout:  { w: 28, d: 20, h: 11, color: 0xc7a17a, sign: 'PIER 9 STORAGE', bg: '#57534e', fg: '#fde68a' },
    }[kind];
    const facades = facadeTexture(rng, 0.55);
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(conf.w, conf.h, conf.d),
      new THREE.MeshLambertMaterial({ map: facades, color: conf.color })
    );
    b.position.set(bx, conf.h / 2, bz);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(conf.w * 0.92, 3.2),
      new THREE.MeshBasicMaterial({ map: signTexture(conf.sign, conf.bg, conf.fg) })
    );
    // Face the sign toward the nearest road on the -z side of the block.
    sign.position.set(bx, conf.h - 2.2, bz - conf.d / 2 - 0.06);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    colliders.push({ minX: bx - conf.w / 2 - 0.3, maxX: bx + conf.w / 2 + 0.3, minZ: bz - conf.d / 2 - 0.3, maxZ: bz + conf.d / 2 + 0.3 });
  }

  function buildPalmsAndLamps(scene, rng) {
    // Palm trunks and canopies as two InstancedMeshes.
    const spots = [];
    const blockCenters = [-130, -78, -26, 26, 78, 130];
    blockCenters.forEach(function (bx) {
      blockCenters.forEach(function (bz) {
        for (let i = 0; i < 2; i++) {
          spots.push({ x: bx + (rng() * 36 - 18), z: bz + (rng() < 0.5 ? -19.5 : 19.5), s: 0.85 + rng() * 0.5 });
        }
      });
    });
    for (let z = -180; z <= 180; z += 24) spots.push({ x: 210 + rng() * 8, z: z + rng() * 6, s: 1 + rng() * 0.5 });

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6);
    trunkGeo.translate(0, 2.8, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    trunks.castShadow = true;

    const frondTex = AH.canvasTexture(256, 256, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#2e9e4f'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI - Math.PI / 2;
        const x0 = w / 2, y0 = h;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + Math.sin(a) * 70, y0 - 90, x0 + Math.sin(a) * 118, y0 - 105 + Math.abs(Math.sin(a)) * 40);
        ctx.stroke();
      }
      ctx.strokeStyle = '#43c465'; ctx.lineWidth = 4;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI - Math.PI / 2;
        const x0 = w / 2, y0 = h;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + Math.sin(a) * 60, y0 - 80, x0 + Math.sin(a) * 105, y0 - 92 + Math.abs(Math.sin(a)) * 36);
        ctx.stroke();
      }
    });
    const p1 = new THREE.PlaneGeometry(7.6, 7.6); p1.translate(0, 3.4, 0);
    const p2 = p1.clone(); p2.rotateY(Math.PI / 3);
    const p3 = p1.clone(); p3.rotateY(-Math.PI / 3);
    const canopyGeo = AH.mergeGeoms([p1, p2, p3]);
    const canopyMat = new THREE.MeshLambertMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    canopies.castShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    spots.forEach(function (s, i) {
      e.set((rng() - 0.5) * 0.14, rng() * Math.PI, (rng() - 0.5) * 0.14);
      q.setFromEuler(e);
      v.set(s.x, 0, s.z); sc.set(s.s, s.s, s.s);
      m.compose(v, q, sc);
      trunks.setMatrixAt(i, m);
      v.y = 5.4 * s.s;
      m.compose(v, q, sc);
      canopies.setMatrixAt(i, m);
    });
    scene.add(trunks); scene.add(canopies);

    // Street lamps: instanced post + glowing globe.
    const lampPts = [];
    CENTERS.forEach(function (c) {
      for (let t = -182; t <= 182; t += 36) {
        lampPts.push({ x: c + 9.4, z: t }); lampPts.push({ x: t, z: c - 9.4 });
      }
    });
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 5); postGeo.translate(0, 2.6, 0);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x3c4652 }), lampPts.length);
    const globeGeo = new THREE.SphereGeometry(0.34, 8, 6); globeGeo.translate(0, 5.3, 0);
    const globes = new THREE.InstancedMesh(globeGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampPts.length);
    lampPts.forEach(function (p, i) {
      m.compose(v.set(p.x, 0, p.z), q.identity(), sc.set(1, 1, 1));
      posts.setMatrixAt(i, m); globes.setMatrixAt(i, m);
    });
    scene.add(posts); scene.add(globes);
  }

  function buildBillboards(scene, rng) {
    const boards = [
      { text: 'AZURA COLA — TASTE THE SUNSET', bg: '#e63946', fg: '#ffffff', x: -26, z: -130, ry: 0 },
      { text: 'VISIT PORT AZURA', bg: '#0ea5b7', fg: '#fef9c3', x: 78, z: 26, ry: Math.PI / 2 },
      { text: "SAL'S — WE FIX ANYTHING", bg: '#274156', fg: '#ffd166', x: 26, z: -78, ry: 0 },
      { text: 'PALMS HOTEL — ROOF POOL', bg: '#0f766e', fg: '#ffffff', x: 104, z: -52, ry: Math.PI },
      { text: 'SUNSET FM 98.5', bg: '#7c3aed', fg: '#fde68a', x: -104, z: 52, ry: Math.PI / 2 },
      { text: 'CAFÉ ROSA — BEST EMPANADAS', bg: '#c73e54', fg: '#ffe9ec', x: -52, z: 104, ry: 0 },
    ];
    boards.forEach(function (b) {
      const tex = signTexture(b.text, b.bg, b.fg);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(17, 3.4),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      mesh.position.set(b.x, 15 + rng() * 8, b.z);
      mesh.rotation.y = b.ry;
      scene.add(mesh);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, mesh.position.y - 1.6, 6),
        new THREE.MeshLambertMaterial({ color: 0x3c4652 }));
      pole.position.set(b.x, (mesh.position.y - 1.6) / 2, b.z);
      scene.add(pole);
    });
  }

  function update(dt, t) {
    if (ocean) {
      const pos = ocean.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = oceanBase[i * 3], y = oceanBase[i * 3 + 1];
        pos.array[i * 3 + 2] = Math.sin(x * 0.055 + t * 1.3) * 0.32 + Math.cos(y * 0.045 + t * 0.9) * 0.26;
      }
      pos.needsUpdate = true;
      ocean.geometry.computeVertexNormals();
    }
    // Keep the shadow camera centred on the action.
    const sun = scene0.userData.sun, target = AH.game && AH.game.focus;
    if (sun && target) {
      sun.position.set(target.x - 190, 165, target.z - 95);
      sun.target.position.set(target.x, 0, target.z);
      sun.target.updateMatrixWorld();
    }
  }

  let scene0 = null;
  return {
    build: function (scene, seed) { scene0 = scene; return build(scene, seed); },
    update: update,
    PITCH: PITCH, ROAD: ROAD, CENTERS: CENTERS, CITY: CITY, BEACH_X: BEACH_X,
    landmarks: landmarks, spots: spots, colliders: colliders,
  };
})();
