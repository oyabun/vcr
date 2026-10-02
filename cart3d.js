/* The data cartridge and the drive it loads into, as 3D models, plus the flat cartridges of the demo shelf.
   Shared by cartridge.js (landing.html, tapes-cartridge-02.html), bay.js (the player's tape bay) and drive.js
   (the empty deck). The 3D parts need window.THREE (assets/vendor/three.min.js); miniCart doesn't.
     VCRCart3D.stage(renderer)  a scene lit and reflecting a room the page's colour, kept in step with the theme
     VCRCart3D.cartridge()      the frosted cartridge: reels wound by a session's length, a label, a skeleton
     VCRCart3D.drive()          a small desktop tape drive: front slot with a flap, a dot-matrix LCD, LEDs
     VCRCart3D.miniCart(o)      the HTML of one small flat cartridge (shelf.css) */
(function () {
  'use strict';
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmtDur = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min'; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // A full cartridge holds three hours, wound by area: radius = sqrt(hub^2 + k * seconds).
  const HUB_R = 0.46, FULL_R = 0.88, CAPACITY = 3 * 3600;   // FULL_R: a full spool still clears the guides and the other spool
  const K = (FULL_R * FULL_R - HUB_R * HUB_R) / CAPACITY;
  const packR = (sec) => Math.sqrt(HUB_R * HUB_R + K * Math.min(CAPACITY, Math.max(0, sec)));
  // how far the tape travels, in hub turns: a full three-hour reel is about this many radians of tape at radius 1
  const TAPE_RAD = 600;

  /* ---------------------------------------------------------------- the flat cartridges (no 3D) */
  const pct = (v) => (v * 100).toFixed(2) + '%';
  function miniWorks(sec) {
    const rL = packR(sec), rR = HUB_R;
    // tape: left pack, over the top guide, along the top edge, down the head edge, into the right pack
    const xy = (x, y) => [(x + 2) / 4, (1.5 - y) / 3];
    const seg = (a, b) => { const [x0, y0] = xy(a[0], a[1]), [x1, y1] = xy(b[0], b[1]), dx = (x1 - x0) * 4, dy = (y1 - y0) * 3;
      return '<i class="mc-tape" style="left:' + pct(x0) + ';top:' + pct(y0) + ';width:' + (Math.hypot(dx, dy) / 4 * 100).toFixed(2) + '%;rotate:' + Math.atan2(dy, dx).toFixed(3) + 'rad"></i>'; };
    const ang = Math.atan2(-0.42 - 0.4, 1.6 - 0.6);
    return '<i class="mc-pack l" style="--r:' + rL.toFixed(3) + '"></i><i class="mc-pack r" style="--r:' + rR.toFixed(3) + '"></i>' +
      seg([-0.96, 0.4 + rL], [-0.2, 1.41]) + seg([-0.2, 1.41], [1.6, 1.43]) + seg([1.67, 1.36], [1.67, -0.42]) + seg([1.6, -0.49], [0.6 + Math.cos(ang) * rR, 0.4 + Math.sin(ang) * rR]) +
      '<i class="mc-pin" style="left:45%;top:4.67%;width:2.5%"></i><i class="mc-pin" style="left:90%;top:4.67%"></i><i class="mc-pin" style="left:90%;top:64%"></i><i class="mc-roller"></i>' +
      '<i class="mc-hub l"></i><i class="mc-hub r"></i>';
  }
  // o: { name, sec, c (a CSS colour), foot: [left, right], attrs (extra attributes on the button) }
  function miniCart(o) {
    const works = miniWorks(o.sec);
    return '<button class="mc-pick" style="--c:' + o.c + '" aria-pressed="false" aria-label="Load ' + esc(o.name) + ', ' + fmtDur(o.sec) + '" ' + (o.attrs || '') + '>' +
      '<span class="mc">' +
        '<span class="mc-works blur">' + works + '</span><i class="mc-frost"></i>' +
        '<span class="mc-win"><span class="mc-works">' + works + '</span></span>' +
        '<i class="mc-door"></i><i class="mc-flip"></i>' +
        '<i class="mc-screw" style="left:5.5%;top:7%"></i><i class="mc-screw" style="left:86%;top:7%"></i><i class="mc-screw" style="left:5.5%;top:93%"></i><i class="mc-screw" style="left:86%;top:93%"></i>' +
        '<span class="mc-label"><span class="k">DATA CARTRIDGE</span><span class="n">' + fmtDur(o.sec) + '</span><b>' + esc(o.name) + '</b></span>' +
      '</span>' +
      '<span class="mc-foot"><span>' + esc(o.foot[0]) + '</span><span>' + esc(o.foot[1]) + '</span></span>' +
    '</button>';
  }
  // the small cartridges tilt toward the pointer, in perspective, with a glare that follows it
  function tiltShelf(shelf) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shelf.addEventListener('pointermove', (e) => {
      const b = e.target.closest('.mc-pick'); if (!b) return;
      const r = b.querySelector('.mc').getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      b.style.setProperty('--ry', (x * 18).toFixed(1) + 'deg'); b.style.setProperty('--rx', (-y * 14).toFixed(1) + 'deg');
      b.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(0) + '%'); b.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(0) + '%');
    });
    shelf.addEventListener('pointerout', (e) => { const b = e.target.closest('.mc-pick'); if (b && !b.contains(e.relatedTarget)) ['--rx', '--ry'].forEach((v) => b.style.removeProperty(v)); });
  }

  /* ---------------------------------------------------------------- geometry helpers */
  let T = null;
  function roundedRect(w, h, r, cx, cy) {
    const s = new T.Shape(), x = (cx || 0) - w / 2, y = (cy || 0) - h / 2;
    r = Math.max(0.005, Math.min(r, w / 2, h / 2));
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // A bevel grows the extruded outline by its size, and shrinks its holes by the same. So outlines go in
  // shrunk by `bev` and holes enlarged by it: the finished part is exactly w x h, and no two parts end up
  // sharing a face (coplanar faces flicker as the depth test flips between them).
  const outline = (w, h, r, bev, cx, cy) => roundedRect(w - 2 * bev, h - 2 * bev, r - bev, cx, cy);
  const hole = (w, h, r, bev, cx, cy) => { const p = new T.Path(); p.curves = roundedRect(w + 2 * bev, h + 2 * bev, r + bev, cx, cy).curves; return p; };
  function extrude(shape, d, bev, z0) {
    const g = new T.ExtrudeGeometry(shape, { depth: d - 2 * bev, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 10 });
    g.translate(0, 0, z0 + bev); return g;
  }
  const cyl = (r, h, seg) => { const g = new T.CylinderGeometry(r, r, h, seg || 48); g.rotateX(Math.PI / 2); return g; };
  const add = (p, geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); p.add(o); return o; };
  const need = () => { T = window.THREE; if (!T) throw new Error('VCRCart3D needs window.THREE'); };

  /* ---------------------------------------------------------------- the stage: env, lights, the page colour */
  function stage(renderer) {
    need();
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    // No shadows: the cartridge floats, clear plastic over the page (cast and contact shadows both read wrong).
    // three r160 clears what transmissive materials see through to half-white whenever the canvas is
    // transparent, so the frosting and the window showed white instead of the page. Clear to the page's
    // own colour, opaque: the glass then sees the real background, and the canvas blends into the page.
    // (bg: the element whose background the canvas sits on; the body by default)
    const desk = new T.Color(), hooks = [];
    let bgEl = document.body;
    const syncDesk = () => { desk.setStyle(getComputedStyle(bgEl).backgroundColor); renderer.setClearColor(desk, 1); };
    syncDesk();
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(26, 1, 0.1, 100);
    camera.position.set(0, 0.4, 13); camera.lookAt(0, 0, 0);

    // A small studio to reflect in, its walls the page's own colour: the plastic then reflects the room it sits in.
    // (Cool grey walls made the frost read blue against the warm light page.) Rebuilt on a theme change.
    const pmrem = new T.PMREMGenerator(renderer);
    const envBox = new T.MeshBasicMaterial({ side: T.BackSide });
    const env = new T.Scene();
    env.add(new T.Mesh(new T.BoxGeometry(20, 20, 20), envBox));
    const panel = (w, h, x, y, z, rx, ry, k) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(k, k * 0.98, k * 0.95), side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel(12, 3, 0, 9.5, 2, Math.PI / 2, 0, 4.5); panel(4, 10, -9.5, 2, 0, 0, Math.PI / 2, 2.4); panel(4, 10, 9.5, 2, 0, 0, -Math.PI / 2, 1.4); panel(10, 5, 0, 2, 9.5, 0, Math.PI, 1.6);
    let envRT = null;
    function buildEnv() {
      envBox.color.copy(desk).multiplyScalar(0.8);
      if (envRT) envRT.dispose();
      envRT = pmrem.fromScene(env, 0.04); scene.environment = envRT.texture;
    }
    buildEnv();

    scene.add(new T.HemisphereLight(0xfff4e6, 0x8f8a80, 0.55));   // a warm sky, the floor's warm bounce
    // two lights: a key low in front that lights the face, and a fill from nearly overhead
    const sun = new T.DirectionalLight(0xffffff, 1.25); sun.position.set(-4, 7, 9); scene.add(sun);
    const top = new T.DirectionalLight(0xffffff, 0.6); top.position.set(-1.2, 12, 2.4); scene.add(top);

    // on a theme change: the page colour behind the glass, the room it reflects, and whatever else hooks in
    const onTheme = () => { syncDesk(); buildEnv(); hooks.forEach((h) => h()); };
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    return {
      scene, camera, desk, sun, top,
      onTheme: (fn) => hooks.push(fn),
      background: (el) => { bgEl = el; onTheme(); },
    };
  }

  /* ---------------------------------------------------------------- the cartridge */
  function cartridge() {
    need();
    const packTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
      g.fillStyle = '#34363a'; g.fillRect(0, 0, 1024, 1024);
      for (let r = 512; r > 0; r -= 2) { g.strokeStyle = 'rgba(255,255,255,' + (0.015 + Math.random() * 0.04) + ')'; g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); }
      for (let i = 0; i < 30000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.05)'; g.fillRect(Math.random() * 1024, Math.random() * 1024, 1.4, 1.4); }
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
    })();
    const M = {
      // heavily frosted: the works are only shapes through it; the window is where you see them
      frost: new T.MeshPhysicalMaterial({ color: 0xeeeae2, roughness: 0.48, transmission: 1, thickness: 0.8, ior: 1.5,
        attenuationColor: new T.Color(0xc9c0b0), attenuationDistance: 2.4, clearcoat: 0.3, clearcoatRoughness: 0.6, specularIntensity: 0.6 }),
      // Window glass: blended, not transmissive. r160 renders a double-sided transmissive surface's back face into the
      // very image it samples, so the old glass showed a blurred, whitened copy of itself; and transmissive surfaces can't
      // see other frosted parts at all. A faint blended pane shows everything behind it, sharp, with a reflection on top.
      glass: new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.2 }),
      hub: new T.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.42 }),
      pack: new T.MeshStandardMaterial({ map: packTex, roughness: 0.5, metalness: 0.2 }),
      packSide: new T.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.45, metalness: 0.25 }),
      tape: new T.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.3, side: T.DoubleSide }),
      metal: new T.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.26, metalness: 1 }),
      door: new T.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.36, metalness: 0.85 }),
      slot: new T.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6 }),
      roller: new T.MeshStandardMaterial({ color: 0xc2c9cf, roughness: 0.35 }),
      dial: new T.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5 }),
      flip: new T.MeshStandardMaterial({ color: 0xd9dde1, roughness: 0.4 }),
      label: new T.MeshStandardMaterial({ roughness: 0.72 }),
    };
    // the frost's tint comes from shelf.css (--cart-frost, --cart-frost-deep), so the 3D and the flat cartridges match
    function tintFrost() {
      const f = css('--cart-frost'), d = css('--cart-frost-deep');
      if (f) M.frost.color.setStyle(f);
      if (d) M.frost.attenuationColor.setStyle(d);
      // a faint glow in the frost's own colour: milky white plastic, not just the page seen through a filter
      M.frost.emissive.setStyle(f || '#ffffff').multiplyScalar(parseFloat(css('--cart-milk')) || 0);
    }
    tintFrost();

    const W = 4, H = 3, D = 0.5;
    const cart = new T.Group();
    // The shell is hollow, as a real one is: thin frosted plates front and back, each with the window cut out, and a
    // perimeter wall between them. Through the window you look into the cartridge: its inner walls, the back plate and
    // the works. The window frames the two spools (x -1.58..1.22, y -0.2..1.0); guides and the head edge stay under the frost.
    const WIN = { w: 2.8, h: 1.2, r: 0.14, x: -0.18, y: 0.4 }, SB = 0.03, PL = 0.05, WALL = 0.08;
    const plateS = outline(W, H, 0.1, SB, 0, 0);
    plateS.holes.push(hole(WIN.w, WIN.h, WIN.r, SB, WIN.x, WIN.y));
    const plateG = extrude(plateS, PL, SB, 0);
    const shell = add(cart, plateG, M.frost, 0, 0, D / 2 - PL);                                              // front plate
    add(cart, plateG, M.frost, 0, 0, -D / 2);                                                                // back plate
    // the side wall runs a hair into both plates, so where they meet no faces are shared
    const wallS = outline(W, H, 0.1, SB, 0, 0);
    wallS.holes.push(hole(W - 2 * WALL, H - 2 * WALL, 0.06, SB, 0, 0));
    add(cart, extrude(wallS, D - 2 * PL + 0.01, SB, -D / 2 + PL - 0.005), M.frost);
    // the window glass: plain see-through (blended, not transmissive), so everything behind it shows, frosted parts included
    const paneG = new T.ShapeGeometry(roundedRect(WIN.w + 0.02, WIN.h + 0.02, WIN.r, WIN.x, WIN.y));
    const paneB = paneG.clone(); paneB.rotateY(Math.PI); paneB.translate(2 * WIN.x, 0, 0);                    // the back pane faces out the back
    const panes = [add(cart, paneG, M.glass, 0, 0, D / 2 - 0.02), add(cart, paneB, M.glass, 0, 0, -D / 2 + 0.02)];
    // a moulded lip round the window, front and back
    const lipS = outline(WIN.w + 0.14, WIN.h + 0.14, WIN.r + 0.07, 0.01, WIN.x, WIN.y);
    lipS.holes.push(hole(WIN.w + 0.02, WIN.h + 0.02, WIN.r + 0.01, 0.01, WIN.x, WIN.y));
    const lipG = extrude(lipS, 0.03, 0.01, 0);
    add(cart, lipG, M.frost, 0, 0, D / 2 - 0.012); add(cart, lipG, M.frost, 0, 0, -D / 2 - 0.018);

    // the works: two spools, guides, roller, tape path
    // Spools spaced so nothing collides at any point in the tape: a full spool (0.88) ends at x 1.48, short of the
    // guides at 1.6, and the two packs together are at most 1.40 across, inside the 1.56 between centres.
    const sL = new T.Vector2(-0.96, 0.4), sR = new T.Vector2(0.6, 0.4), Z = 0;
    // A tape pack is a ring wound round the hub, not a disc: through the hub's windows you see right through the
    // reel. Its inner edge stays at the hub while the outer edge follows the tape, so the ring is rebuilt in place
    // (vertices moved, not the mesh scaled, which would grow the hole too).
    function packMesh() {
      const N = 96, HZ = 0.1, IN = HUB_R - 0.02, n = (N + 1) * 2;
      const pos = new Float32Array(n * 3 * 3), nor = new Float32Array(n * 3 * 3), uv = new Float32Array(n * 3 * 2), idx = [];
      // three strips of (inner|outer or front|back) pairs per angle: front face, back face, outer wall
      for (let k = 0; k < 3; k++) for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
        for (let j = 0; j < 2; j++) {
          const v = k * n + i * 2 + j;
          if (k < 2) nor.set([0, 0, k === 0 ? 1 : -1], v * 3); else nor.set([c, si, 0], v * 3);
        }
        if (i < N) {
          const a0 = k * n + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
          if (k === 1) idx.push(a0, a1, b0, b0, a1, b1); else idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.addGroup(0, N * 12, 1); geo.addGroup(N * 12, N * 6, 0);
      geo.boundingSphere = new T.Sphere(new T.Vector3(), FULL_R + 0.2);
      const mesh = new T.Mesh(geo, [M.packSide, M.pack]);
      let last = -1;
      mesh.setRadius = (r) => {
        if (Math.abs(r - last) < 1e-4) return; last = r;
        for (let k = 0; k < 3; k++) for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
          for (let j = 0; j < 2; j++) {
            const v = k * n + i * 2 + j;
            // faces: j picks inner/outer edge; wall: j picks front/back
            const rad = k < 2 ? (j ? r : IN) : r, z = k === 0 ? HZ : k === 1 ? -HZ : (j ? -HZ : HZ);
            pos.set([c * rad, si * rad, z], v * 3);
            // the ring texture is laid out in cartridge units, so the windings keep their size as the pack grows
            uv.set([0.5 + (c * rad) / (2 * FULL_R), 0.5 + (si * rad) / (2 * FULL_R)], v * 2);
          }
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true;
      };
      return mesh;
    }
    const hubG = (() => {
      const s = new T.Shape(); s.absarc(0, 0, 0.46, 0, Math.PI * 2, false);
      for (let i = 0; i < 3; i++) {
        const a0 = i * (Math.PI * 2 / 3) + 0.35, a1 = a0 + 1.35, p = new T.Path();
        p.absarc(0, 0, 0.39, a0, a1, false); p.absarc(0, 0, 0.18, a1, a0, true); s.holes.push(p);
      }
      const bore = new T.Path(); bore.absarc(0, 0, 0.07, 0, Math.PI * 2, true); s.holes.push(bore);
      const g = new T.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 48 });
      g.translate(0, 0, -0.11); return g;
    })();
    const spool = (c) => { const g = new T.Group(); g.position.set(c.x, c.y, Z); cart.add(g); const pack = packMesh(); g.add(pack); add(g, hubG, M.hub); return { g, pack }; };
    const L = spool(sL), R = spool(sR);
    add(cart, cyl(0.24, 0.24), M.roller, 1.3, -0.98, Z);
    add(cart, cyl(0.1, 0.03), M.metal, 1.3, -0.98, Z + 0.14);   // sits proud of the roller face, not flush with it
    // guides: one near the top edge so the tape passes over the right spool (top of a full pack: y 1.28), and two at the head edge
    const pinT = new T.Vector2(-0.2, 1.36), pinA = new T.Vector2(1.6, 1.36), pinB = new T.Vector2(1.6, -0.42), PT = 0.05, PR = 0.07;
    add(cart, cyl(PT, 0.3, 24), M.metal, pinT.x, pinT.y, Z);
    [pinA, pinB].forEach((p) => add(cart, cyl(PR, 0.3, 24), M.metal, p.x, p.y, Z));
    const unitTape = new T.BoxGeometry(1, 0.012, 0.19), tapes = [0, 1, 2, 3].map(() => add(cart, unitTape, M.tape, 0, 0, Z));
    const place = (m, a, b) => { const d = b.clone().sub(a); m.scale.x = Math.max(0.001, d.length()); m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, Z); m.rotation.z = Math.atan2(d.y, d.x); };
    function routeTape(rL, rR) {
      // left pack, up over the top guide, along the top edge above the right spool, down the head edge, into the right pack
      place(tapes[0], new T.Vector2(sL.x, sL.y + rL), new T.Vector2(pinT.x, pinT.y + PT));
      place(tapes[1], new T.Vector2(pinT.x, pinT.y + PT), new T.Vector2(pinA.x, pinA.y + PR));
      place(tapes[2], new T.Vector2(pinA.x + PR, pinA.y), new T.Vector2(pinB.x + PR, pinB.y));
      const a = Math.atan2(pinB.y - sR.y, pinB.x - sR.x);
      place(tapes[3], new T.Vector2(pinB.x, pinB.y - PR), new T.Vector2(sR.x + Math.cos(a) * rR, sR.y + Math.sin(a) * rR));
    }
    // write-protect: a plastic flip tab in a slot, right after the label
    const flip = new T.Group(); flip.position.set(1.25, -0.78, D / 2); cart.add(flip);
    add(flip, extrude(outline(0.17, 0.4, 0.04, 0.01), 0.012, 0.01, 0.002), M.dial);            // the slot, just proud of the face
    add(flip, extrude(outline(0.13, 0.17, 0.03, 0.012), 0.05, 0.012, 0.006), M.flip, 0, 0.09, 0);                  // the tab, flipped up: SAFE

    // outside: head door (standing proud of the shell edge), slot, screws front and back, the label
    const DB = 0.02;
    add(cart, extrude(outline(0.3, 2.56, 0.06, DB), D + 0.06, DB, -(D + 0.06) / 2), M.door, 1.885, 0, 0);   // x 1.735 .. 2.035
    // the head-access slit: a thin rounded inlay just proud of the door's outer face (x 2.035), not a block
    const slitG = new T.ExtrudeGeometry(roundedRect(0.1, 0.5, 0.05), { depth: 0.006, bevelEnabled: false, curveSegments: 12 });
    slitG.rotateY(Math.PI / 2);                                                                                    // face +x, along the edge
    add(cart, slitG, M.slot, 2.036, 0, 0);                                                      // x 2.036 .. 2.042
    const screwG = cyl(0.075, 0.03, 24);
    [[-1.78, 1.29], [1.44, 1.29], [-1.78, -1.29], [1.44, -1.29]].forEach(([x, y]) => {
      add(cart, screwG, M.metal, x, y, D / 2 + 0.008); add(cart, screwG, M.metal, x, y, -D / 2 - 0.008);
    });
    // the label sits just under the window (x -1.55..1.0, y -1.18..-0.38), the write-protect switch to its right
    add(cart, new T.PlaneGeometry(2.55, 0.8), M.label, -0.275, -0.78, D / 2 + 0.004);

    // o: { name, dur (big text, right), sub (small line), color, kind (the small caps, top left) }
    function labelTexture(o) {
      const color = o.color || '#FF5B1F';
      const c = document.createElement('canvas'); c.width = 1530; c.height = 480; const g = c.getContext('2d');   // 2.55 x 0.8
      const grd = g.createLinearGradient(0, 0, 0, 480); grd.addColorStop(0, '#1a1b1d'); grd.addColorStop(1, '#0d0e0f');
      g.fillStyle = grd; g.fillRect(0, 0, 1530, 480);
      g.fillStyle = color; g.fillRect(0, 0, 24, 480);
      g.font = '700 32px "JetBrains Mono"'; g.letterSpacing = '8px'; g.fillText(o.kind || 'DATA CARTRIDGE', 72, 92);
      g.letterSpacing = '0px'; g.textAlign = 'right'; g.font = '900 104px Doto'; g.fillText(o.dur || '', 1480, 132);
      g.textAlign = 'left'; g.fillStyle = '#EDE6D3'; g.font = '600 88px "Space Grotesk"';
      const name = o.name || '';
      let t = name; while (g.measureText(t).width > 1390 && t.length > 4) t = t.slice(0, -2);
      g.fillText(t === name ? t : t.trimEnd() + '…', 68, 290);
      g.fillStyle = '#9C978C'; g.font = '500 32px "JetBrains Mono"';
      let s = o.sub || ''; while (g.measureText(s).width > 1390 && s.length > 4) s = s.slice(0, -2);
      g.fillText(s, 72, 398);
      const tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 8; return tx;
    }
    let lastLabel = null;
    function setLabel(o) {
      lastLabel = o;
      if (M.label.map) M.label.map.dispose();
      M.label.map = labelTexture(o); M.label.needsUpdate = true;
    }
    // the label uses the page fonts: draw it again once they are in
    if (document.fonts) Promise.all(['700 32px "JetBrains Mono"', '500 32px "JetBrains Mono"', '900 104px Doto', '600 88px "Space Grotesk"'].map((f) => document.fonts.load(f)))
      .then(() => { if (lastLabel) setLabel(lastLabel); }).catch(() => {});

    // Packs from the share played; total tape (area) is constant. Each spool turns by the tape that
    // passed the head divided by its radius, so the emptier one spins faster, and shuttling spins both fast.
    let prev = null;
    function setReel(secs, played) {
      const rL = packR(secs * (1 - played)), rR = packR(secs * played);
      const moved = prev == null ? 0 : (played - prev) * (Math.min(secs, CAPACITY) / CAPACITY) * TAPE_RAD; prev = played;
      L.pack.setRadius(rL); R.pack.setRadius(rR);
      L.g.rotation.z -= moved / rL; R.g.rotation.z -= moved / rR;
      routeTape(rL, rR);
    }
    const resetReel = () => { prev = null; };
    setReel(0, 0);

    // The skeleton: the cartridge's edges as glowing lines, for a tape that isn't there yet. Built on demand, from the
    // parts as they stand (reels near empty), in the cartridge's own space so it can stand in for it.
    let skel = null;
    function skeleton() {
      if (skel) return skel;
      setReel(1200, 0.5);
      cart.updateMatrixWorld(true);
      const mat = new T.LineBasicMaterial({ color: new T.Color(css('--orange') || '#FF5B1F'), transparent: true, opacity: 0.9, depthWrite: false });
      skel = new T.Group(); skel.material = mat;
      const inv = new T.Matrix4().copy(cart.matrixWorld).invert();
      cart.traverse((o) => {
        if (!o.isMesh || panes.includes(o) || tapes.includes(o)) return;
        const ln = new T.LineSegments(new T.EdgesGeometry(o.geometry, 35), mat);
        ln.matrixAutoUpdate = false; ln.matrix.multiplyMatrices(inv, o.matrixWorld);
        skel.add(ln);
      });
      resetReel(); setReel(0, 0);
      return skel;
    }
    return { group: cart, shell, M, L, R, tintFrost, setLabel, setReel, resetReel, skeleton, packR, fmtDur };
  }

  /* ---------------------------------------------------------------- the drive */
  // A desktop cartridge deck, front-loading like a VCR: the slot on the left (the cartridge goes in lying flat,
  // label up, top edge first), a VFD display and the transport keys on the right. A brushed graphite cover over a
  // satin black front panel, printed with its labels. The front face is at z = 0; the slot's centre is at
  // (SLOT_X, SLOT_Y). keys: the transport keys, for picking ({ name, mesh }); press(name) pushes one in.
  function drive() {
    need();
    const BW = 7.6, BH = 1.6, BD = 5.0, SLOT_X = -1.25, SLOT_Y = 0.2, SLOT_W = 4.5, SLOT_H = 0.66;
    const VFD = { x: 2.42, y: 0.25, w: 2.1, h: 0.58 }, KEY_Y = -0.4, BZ = 0.12;   // BZ: the front panel's thickness
    const g = new T.Group();
    const canvasTex = (c, srgb) => { const t = new T.CanvasTexture(c); if (srgb !== false) t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t; };
    // brushed metal: fine horizontal streaks, as colour and as roughness (the streaks catch the light differently)
    const brushed = (() => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
      x.fillStyle = '#808080'; x.fillRect(0, 0, 1024, 512);
      for (let i = 0; i < 2600; i++) {
        const y = Math.random() * 512, l = 80 + Math.random() * 600, v = 110 + Math.random() * 40 | 0;
        x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.1 + Math.random() * 0.25) + ')'; x.fillRect(Math.random() * 1024 - 100, y, l, 1 + Math.random());
      }
      const t = canvasTex(c, false); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(0.35, 0.6); return t;
    })();
    const grain = (() => {   // the satin plastic's fine grain
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) { const v = 100 + Math.random() * 70 | 0; x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
      const t = canvasTex(c, false); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 3); return t;
    })();
    const M = {
      cover: new T.MeshStandardMaterial({ color: 0x5b5d62, metalness: 0.75, roughness: 0.42, roughnessMap: brushed, map: brushed, envMapIntensity: 0.9 }),
      chassis: new T.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.4, roughness: 0.55 }),
      face: new T.MeshPhysicalMaterial({ color: 0x151618, roughness: 0.62, roughnessMap: grain, metalness: 0.05, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
      mouth: new T.MeshBasicMaterial({ color: 0x030304 }),
      flap: new T.MeshPhysicalMaterial({ color: 0x0c0d0f, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.92 }),
      chrome: new T.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.18 }),
      key: new T.MeshPhysicalMaterial({ color: 0x232427, roughness: 0.45, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
      keyPlay: new T.MeshPhysicalMaterial({ color: 0x2b2c30, roughness: 0.4, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
      rubber: new T.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 }),
      vent: new T.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.8 }),
      vfd: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      glass: new T.MeshPhysicalMaterial({ color: 0x0d1416, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false, envMapIntensity: 1.6 }),
      print: new T.MeshStandardMaterial({ transparent: true, roughness: 0.6, metalness: 0, depthWrite: false }),
    };
    const ledMat = () => new T.MeshBasicMaterial({ color: 0x2a2826, toneMapped: false });
    M.led = ledMat(); M.led2 = ledMat(); M.power = ledMat(); M.power.color.setHex(0x7df04a);
    const retint = () => {};   // hardware black in both themes: nothing follows the page colour but the room it reflects

    // ---- case: a black chassis tray, and the brushed cover over it (top and sides), a shade inside it
    add(g, extrude(outline(BW, BH, 0.1, 0.04), BD, 0.04, -BD), M.chassis);
    const coverS = outline(BW + 0.02, BH * 0.62, 0.12, 0.05, 0, BH / 2 - BH * 0.31 + 0.01);
    add(g, extrude(coverS, BD - 0.06, 0.05, -BD - 0.02), M.cover);
    // vents on the top, toward the back: dark slots let into the cover
    for (let i = 0; i < 9; i++) add(g, new T.BoxGeometry(3.4, 0.006, 0.07), M.vent, 1.1, BH / 2 + 0.012, -2.9 - i * 0.17);
    // feet
    [[-3.3, -0.5], [3.3, -0.5], [-3.3, -4.5], [3.3, -4.5]].forEach(([x, z]) => add(g, new T.CylinderGeometry(0.24, 0.27, 0.1, 28), M.rubber, x, -BH / 2 - 0.05, z));

    // ---- the front panel: satin black, the slot and the display window cut through it
    const faceS = outline(BW - 0.08, BH - 0.06, 0.08, 0.025);
    faceS.holes.push(hole(SLOT_W, SLOT_H, 0.07, 0.025, SLOT_X, SLOT_Y));
    faceS.holes.push(hole(VFD.w, VFD.h, 0.05, 0.025, VFD.x, VFD.y));
    add(g, extrude(faceS, BZ, 0.025, 0), M.face);
    // a chrome strip under the slot and the display, the full width of the panel
    add(g, new T.BoxGeometry(BW - 0.4, 0.025, 0.02), M.chrome, 0, -0.18, BZ + 0.005);
    // the slot: a chrome lip round it, black inside, and the smoked dust flap, hinged at the top, swinging in
    const lipS = outline(SLOT_W + 0.1, SLOT_H + 0.1, 0.11, 0.01, SLOT_X, SLOT_Y); lipS.holes.push(hole(SLOT_W, SLOT_H, 0.07, 0.01, SLOT_X, SLOT_Y));
    add(g, extrude(lipS, 0.025, 0.01, BZ - 0.005), M.chrome);
    const mouth = add(g, new T.PlaneGeometry(SLOT_W, SLOT_H), M.mouth, SLOT_X, SLOT_Y, 0.004);
    const hinge = new T.Group(); hinge.position.set(SLOT_X, SLOT_Y + SLOT_H / 2 - 0.03, 0.07); g.add(hinge);
    const flapM = add(hinge, new T.BoxGeometry(SLOT_W - 0.06, SLOT_H - 0.05, 0.02), M.flap, 0, -(SLOT_H - 0.05) / 2, 0);
    // the display: the VFD behind smoked glass, in a recess
    add(g, new T.PlaneGeometry(VFD.w, VFD.h), M.vfd, VFD.x, VFD.y, 0.03);
    add(g, new T.PlaneGeometry(VFD.w, VFD.h), M.glass, VFD.x, VFD.y, BZ - 0.02);

    // ---- transport keys under the display: REW, PLAY, FF, STOP, EJECT. A key is a rounded cap with its icon printed on it.
    const KEYS = [['rew', 'rew'], ['play', 'play'], ['ff', 'ff'], ['stop', 'stop'], ['eject', 'eject']];
    const KW = 0.38, KH = 0.24, KG = 0.055;
    function iconTex(name) {
      const c = document.createElement('canvas'); c.width = 152; c.height = 96; const x = c.getContext('2d');
      x.fillStyle = name === 'play' ? '#FF6A2A' : '#C9C6BE'; x.strokeStyle = x.fillStyle; x.lineWidth = 5;
      const tri = (x0, dir) => { x.beginPath(); x.moveTo(x0, 30); x.lineTo(x0 + dir * 26, 48); x.lineTo(x0, 66); x.closePath(); x.fill(); };
      if (name === 'play') tri(64, 1);
      if (name === 'ff') { tri(50, 1); tri(76, 1); }
      if (name === 'rew') { tri(102, -1); tri(76, -1); }
      if (name === 'stop') x.fillRect(58, 30, 36, 36);
      if (name === 'eject') { x.beginPath(); x.moveTo(52, 56); x.lineTo(100, 56); x.lineTo(76, 28); x.closePath(); x.fill(); x.fillRect(52, 62, 48, 7); }
      return canvasTex(c);
    }
    const keyG = extrude(outline(KW, KH, 0.05, 0.022), 0.08, 0.022, 0);
    const iconG = new T.PlaneGeometry(KW - 0.06, KH - 0.06);
    const keys = KEYS.map(([name], i) => {
      const x = VFD.x + (i - 2) * (KW + KG);
      const k = new T.Group(); k.position.set(x, KEY_Y, BZ - 0.03); g.add(k);
      const cap = add(k, keyG, (name === 'play' ? M.keyPlay : M.key).clone());   // its own, so it can light up alone
      add(k, iconG, new T.MeshStandardMaterial({ map: iconTex(name), transparent: true, roughness: 0.5 }), 0, 0, 0.0805);
      add(g, extrude(outline(KW + 0.05, KH + 0.05, 0.07, 0.01), 0.03, 0.01, 0), M.mouth, x, KEY_Y, BZ - 0.02);   // the dark well it sits in
      cap.userData.key = name;
      return { name, mesh: cap, group: k, down: 0 };
    });
    const pressKey = (name, t) => { const k = keys.find((x) => x.name === name); if (k) k.group.position.z = BZ - 0.03 - t * 0.05; };

    // ---- power key and LEDs, under the slot, at the left
    const pwr = add(g, cyl(0.11, 0.08, 32), M.key, -3.35, -0.45, BZ + 0.01);
    add(g, cyl(0.135, 0.03, 32), M.mouth, -3.35, -0.45, BZ - 0.005);
    const ledG = new T.SphereGeometry(0.032, 16, 12);
    add(g, ledG, M.power, -3.08, -0.45, BZ + 0.005);
    add(g, ledG, M.led, -1.16, -0.45, BZ + 0.005); add(g, ledG, M.led2, -0.66, -0.45, BZ + 0.005);
    // a glow round each LED (additive sprites), so a lit one reads as lit
    const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = r; x.fillRect(0, 0, 64, 64); return canvasTex(c); })();
    const glow = (mat, x) => { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: mat.color, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })); s.scale.set(0.26, 0.26, 1); s.position.set(x, -0.45, BZ + 0.04); g.add(s); return s; };
    const glows = [glow(M.power, -3.08), glow(M.led, -1.16), glow(M.led2, -0.66)];

    // ---- printing on the front panel: the name, what the keys and LEDs are (printed again once the fonts are in)
    {
      const PW = 2432, PH = 512, px = (x) => (x + BW / 2) / BW * PW, py = (y) => (BH / 2 - y) / BH * PH;
      const c = document.createElement('canvas'); c.width = PW; c.height = PH; const x = c.getContext('2d');
      const ink = '#A9A59C';
      const small = (t, cx, cy) => { x.font = '600 21px "JetBrains Mono", monospace'; x.letterSpacing = '4px'; x.textAlign = 'center'; x.fillText(t, px(cx), py(cy)); };
      const print = () => {
        x.clearRect(0, 0, PW, PH); x.fillStyle = ink; x.textBaseline = 'middle';
        small('POWER', -3.35, -0.66); small('BUSY', -1.16, -0.66); small('TAPE', -0.66, -0.66);
        KEYS.forEach(([n], i) => small(n.toUpperCase(), VFD.x + (i - 2) * (KW + KG), -0.64));
        small('▲ LABEL UP · THIS EDGE FIRST', SLOT_X, SLOT_Y + SLOT_H / 2 + 0.11);
        // the brand, between the LEDs and the keys
        x.textAlign = 'left'; x.font = '700 46px "Space Grotesk", sans-serif'; x.letterSpacing = '-1px'; x.fillStyle = '#E4E0D6'; x.fillText('vcr', px(-0.25), py(-0.45));
        x.font = '600 19px "JetBrains Mono", monospace'; x.letterSpacing = '5px'; x.fillStyle = ink;
        x.fillText('DATA CARTRIDGE DECK', px(0.27), py(-0.40)); x.fillStyle = '#FF6A2A'; x.fillText('QIC · 3H', px(0.27), py(-0.51));
        if (M.print.map) M.print.map.needsUpdate = true;
      };
      print();
      M.print.map = canvasTex(c);
      if (document.fonts) Promise.all(['600 21px "JetBrains Mono"', '700 46px "Space Grotesk"'].map((f) => document.fonts.load(f))).then(print).catch(() => {});
      add(g, new T.PlaneGeometry(BW, BH), M.print, 0, 0, BZ + 0.001).userData.noPick = true;
    }

    // ---- the VFD: amber-orange segments on near black, a dot grid behind; a status row of indicators, the message,
    // and a tape counter. setLCD(text, dim, { mode: 'play'|'stop'|'ff'|'rew'|'', tape: bool, counter: '0:00:00' })
    const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 284;
    const lg = lc.getContext('2d'), lcdTex = canvasTex(lc);
    M.vfd.map = lcdTex;
    let lcdKey = '';
    function setLCD(text, dim, o) {
      o = o || {};
      const key = [text, !!dim, o.mode || '', !!o.tape, o.counter || ''].join('|');
      if (key === lcdKey) return; lcdKey = key;
      const ON = '#FF7A35', OFF = 'rgba(255,122,53,.07)';
      lg.fillStyle = '#060707'; lg.fillRect(0, 0, 1024, 284);
      lg.fillStyle = 'rgba(255,255,255,.025)';
      for (let y = 4; y < 284; y += 7) for (let x2 = 4; x2 < 1024; x2 += 7) lg.fillRect(x2, y, 4, 4);
      const lit = (on, f) => { lg.fillStyle = on ? ON : OFF; lg.shadowColor = on ? 'rgba(255,110,40,.9)' : 'transparent'; lg.shadowBlur = on ? 18 : 0; f(); lg.shadowBlur = 0; };
      // indicators: ◀◀ ▶ ■ ▶▶ and a TAPE box
      lg.font = '700 30px "JetBrains Mono", monospace'; lg.textBaseline = 'middle'; lg.textAlign = 'left';
      [['rew', '◀◀', 46], ['play', '▶', 128], ['stop', '■', 186], ['ff', '▶▶', 240]].forEach(([m, s, x2]) => lit(o.mode === m, () => lg.fillText(s, x2, 48)));
      lit(!!o.tape, () => { lg.strokeStyle = lg.fillStyle; lg.lineWidth = 3; lg.strokeRect(830, 28, 150, 42); lg.fillText('TAPE', 856, 50); });
      // the message: big enough to read, with room around it
      lg.font = '900 78px Doto, monospace';
      let t = text || ''; while (lg.measureText(t).width > 940 && t.length > 3) t = t.slice(0, -1);
      lit(!dim, () => lg.fillText(t, 44, 150));
      // the counter
      lg.font = '900 50px Doto, monospace'; lg.textAlign = 'right';
      lit(!!o.counter, () => lg.fillText(o.counter || '-:--:--', 980, 238));
      lg.font = '700 22px "JetBrains Mono", monospace'; lg.textAlign = 'left';
      lit(false, () => lg.fillText('COUNTER', 46, 238));
      lcdTex.needsUpdate = true;
    }
    if (document.fonts) Promise.all(['900 78px Doto', '700 30px "JetBrains Mono"', '700 46px "Space Grotesk"']
      .map((f) => document.fonts.load(f))).then(() => { const k = lcdKey; lcdKey = ''; const [a, b, c2, d, e] = k.split('|'); setLCD(a, b === 'true', { mode: c2, tape: d === 'true', counter: e }); }).catch(() => {});
    setLCD('', false);
    // LEDs: 'off', 'amber', 'green', 'red'; which: 1 busy, 2 tape
    const LED = { off: 0x2a2826, amber: 0xffa21f, green: 0x8ef03a, red: 0xff2e3a };
    function setLED(k, which) {
      const m = which === 2 ? M.led2 : M.led; m.color.setHex(LED[k] || LED.off);
      glows[which === 2 ? 2 : 1].visible = k && k !== 'off';
    }
    const flap = (t) => { hinge.rotation.x = t * 1.35; };
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    [mouth, flapM].forEach((m) => { m.castShadow = false; });
    return { group: g, M, retint, setLCD, setLED, flap, keys, pressKey, pwr, mouth, flapMesh: flapM, SLOT_X, SLOT_Y, BW, BH, BD };
  }

  window.VCRCart3D = { stage, cartridge, drive, miniCart, tiltShelf, packR, fmtDur, HUB_R, FULL_R, CAPACITY };
})();
