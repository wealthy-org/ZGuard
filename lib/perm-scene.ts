import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

export type SceneStop = { n: string; label: string; p: number; a: number };
export type SceneController = {
  stops: SceneStop[];
  setTarget(progress: number): void;
  dispose(): void;
};

type SceneOptions = { onReady?: () => void };
type CameraKey = { at: number; position: THREE.Vector3; look: THREE.Vector3 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

/**
 * Perm's light architectural journey. The scene is built entirely from
 * procedural geometry and textures: a marble exchange causeway, four product
 * monuments, route packets, reflective water, and a circular settlement agora.
 */
export function createPermScene(canvas: HTMLCanvasElement, options: SceneOptions = {}): SceneController {
  const mobile = matchMedia("(max-width: 840px)").matches;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.35 : 1.7);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.94;

  const palette = {
    sky: new THREE.Color(0x8eb5df),
    horizon: new THREE.Color(0xe9f0ef),
    sun: new THREE.Color(0xffe6b7),
    water: new THREE.Color(0x6b9fc0),
    waterDeep: new THREE.Color(0x376f8f),
    marble: 0xf1eee7,
    mint: new THREE.Color(0x39c987),
    cyan: new THREE.Color(0x68ded5),
    ice: new THREE.Color(0xa9f2dc),
    ink: "#17322c",
  };

  const scene = new THREE.Scene();
  const sceneFog = new THREE.Fog(palette.horizon, 4, 62);
  scene.fog = sceneFog;
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 1500);
  const clock = new THREE.Clock();
  const animated: Array<(time: number) => void> = [];
  const textures: THREE.Texture[] = [];

  // ---------- sky and light ----------
  const sunDirection = new THREE.Vector3(0.48, 0.15, -1).normalize();
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: palette.sky },
      uHorizon: { value: palette.horizon },
      uSun: { value: palette.sun },
      uSunDirection: { value: sunDirection },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform vec3 uSunDirection;
      void main() {
        vec3 d = normalize(vDirection);
        float heightMix = pow(max(d.y, 0.0), 0.48);
        vec3 color = mix(uHorizon, uTop, heightMix);
        float sunAmount = max(dot(d, uSunDirection), 0.0);
        color += uSun * (pow(sunAmount, 700.0) * 1.9 + pow(sunAmount, 12.0) * .2 + pow(sunAmount, 3.0) * .035);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(780, 32, 18), skyMaterial);
  sky.renderOrder = -5;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x83979d, 1.08));
  const sunLight = new THREE.DirectionalLight(0xfff2d8, 2.35);
  sunLight.position.set(42, 44, 10);
  scene.add(sunLight);
  const fillLight = new THREE.DirectionalLight(0xb8ffdf, 0.55);
  fillLight.position.set(-25, 18, -70);
  scene.add(fillLight);

  // ---------- procedural material textures ----------
  function createMarbleTexture() {
    const size = mobile ? 256 : 512;
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = textureCanvas.height = size;
    const context = textureCanvas.getContext("2d")!;
    const image = context.createImageData(size, size);
    const data = image.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const warp = Math.sin(x * 0.025 + Math.sin(y * 0.018) * 2.1) + Math.sin((x + y) * 0.011) * 0.5;
        const fine = Math.sin(x * 0.083 - y * 0.037) * 0.5 + 0.5;
        const vein = Math.pow(Math.max(0, 1 - Math.abs(warp) * 2.8), 3) * 17 + fine * 2.2;
        const index = (y * size + x) * 4;
        data[index] = 244 - vein;
        data[index + 1] = 241 - vein * 0.95;
        data[index + 2] = 234 - vein * 0.82;
        data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    textures.push(texture);
    return texture;
  }

  function createCloudTexture() {
    const size = 256;
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = cloudCanvas.height = size;
    const context = cloudCanvas.getContext("2d")!;
    for (let i = 0; i < 24; i++) {
      const x = size * (0.25 + Math.random() * 0.5);
      const y = size * (0.36 + Math.random() * 0.28);
      const radius = size * (0.13 + Math.random() * 0.2);
      const cloud = context.createRadialGradient(x, y, 0, x, y, radius);
      cloud.addColorStop(0, "rgba(255,255,255,.48)");
      cloud.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = cloud;
      context.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(cloudCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    return texture;
  }

  const marbleTexture = createMarbleTexture();
  const marble = new THREE.MeshStandardMaterial({ map: marbleTexture, color: palette.marble, roughness: 0.48, metalness: 0.02 });
  const floorTexture = marbleTexture.clone();
  floorTexture.repeat.set(2.2, 36);
  floorTexture.needsUpdate = true;
  textures.push(floorTexture);
  const marbleFloor = new THREE.MeshStandardMaterial({ map: floorTexture, color: 0xf4f1e9, roughness: 0.58, metalness: 0 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc9fff0,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glow = (color: THREE.ColorRepresentation, intensity = 1.35) => new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.28,
    metalness: 0.04,
  });

  // ---------- water ----------
  // Planar reflection with a rippled, distance-faded lookup. The reflection
  // fades into a view-angle water colour well before the horizon, so the dark
  // grazing-angle seam of a raw planar reflection never reaches the screen.
  const reflectionScale = mobile ? 0.4 : 0.6;
  const reflectionSize = () => ({
    width: Math.max(256, Math.round(innerWidth * dpr * reflectionScale)),
    height: Math.max(256, Math.round(innerHeight * dpr * reflectionScale)),
  });
  const initialReflectionSize = reflectionSize();
  const waterReflector = new Reflector(new THREE.PlaneGeometry(5000, 5000), {
    textureWidth: initialReflectionSize.width,
    textureHeight: initialReflectionSize.height,
    color: 0xffffff,
    clipBias: 0.003,
    multisample: 0,
    shader: {
      name: "PermWaterReflector",
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color(0x1d5f78) },
          uShallow: { value: new THREE.Color(0x6aa9bb) },
          uSunColor: { value: new THREE.Color(0xfff1d6) },
          uSunDirection: { value: sunDirection.clone() },
          uRipple: { value: reducedMotion ? 0.55 : 1 },
        },
      ]),
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vReflectUv;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vReflectUv = textureMatrix * vec4(position, 1.0);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSunColor;
        uniform vec3 uSunDirection;
        uniform float uRipple;
        varying vec4 vReflectUv;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>

        // Analytic slope of a few travelling sine waves: cheap, seamless ripples.
        vec2 waveSlope(vec2 p, float t) {
          vec2 s = vec2(0.0);
          s += vec2(0.62, 0.24) * cos(dot(p, vec2(0.62, 0.24)) + t * 1.05);
          s += vec2(-0.30, 0.86) * cos(dot(p, vec2(-0.30, 0.86)) - t * 0.88);
          s += vec2(1.70, -1.10) * 0.32 * cos(dot(p, vec2(1.70, -1.10)) + t * 1.62);
          s += vec2(0.95, 2.30) * 0.22 * cos(dot(p, vec2(0.95, 2.30)) - t * 1.94);
          s += vec2(0.11, 0.07) * 4.0 * cos(dot(p, vec2(0.11, 0.07)) + t * 0.32);
          return s;
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec3 toCamera = cameraPosition - vWorld;
          float dist = length(toCamera);
          vec3 viewDir = toCamera / dist;

          vec2 slope = waveSlope(vWorld.xz, uTime) * uRipple;
          vec3 normal = normalize(vec3(-slope.x * 0.07, 1.0, -slope.y * 0.07));

          // Reflection: ripple the projected lookup, less with distance.
          float distortion = 0.042 / (1.0 + dist * 0.03);
          vec4 reflectUv = vReflectUv;
          // Horizontal wobble reads as rippled, vertically stretched reflections.
          reflectUv.x += slope.x * distortion * 1.7 * reflectUv.w;
          reflectUv.y += slope.y * distortion * 0.7 * reflectUv.w;
          vec3 reflection = texture2DProj(tDiffuse, reflectUv).rgb;
          // Water absorbs the pale sky: tint it blue and push contrast so the
          // colonnade and causeway reflections read as darker shapes.
          reflection = pow(reflection, vec3(1.35)) * vec3(0.62, 0.84, 0.94);

          float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
          float fresnel = 0.2 + 0.8 * pow(1.0 - facing, 3.0);
          vec3 body = mix(uDeep, uShallow, smoothstep(0.0, 0.85, 1.0 - viewDir.y));
          float fade = 1.0 - smoothstep(140.0, 460.0, dist);
          vec3 waterColor = mix(body, reflection, clamp(mix(0.5, 0.86, fresnel), 0.0, 0.86) * fade);

          // Sun glints and soft ripple highlights.
          vec3 halfVector = normalize(uSunDirection + viewDir);
          float glint = pow(max(dot(normal, halfVector), 0.0), 260.0);
          waterColor += uSunColor * glint * 1.6 * fade;
          // Fine sparkle along the sun path.
          vec2 fine = waveSlope(vWorld.xz * 3.1 + 17.0, uTime * 1.7) * uRipple;
          vec3 fineNormal = normalize(vec3(-(slope.x + fine.x) * 0.09, 1.0, -(slope.y + fine.y) * 0.09));
          float sparkle = pow(max(dot(fineNormal, halfVector), 0.0), 900.0);
          waterColor += uSunColor * sparkle * 1.2 * fade;
          float band = sin(vWorld.z * 1.45 + sin(vWorld.x * 0.62 + uTime * 0.55) * 1.9 + uTime * 0.7);
          waterColor += vec3(0.92, 1.0, 0.98) * smoothstep(0.978, 1.0, band) * 0.11 * fade * uRipple;

          gl_FragColor = vec4(waterColor * color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    },
  });
  const waterReflectorMaterial = waterReflector.material as THREE.ShaderMaterial;
  waterReflectorMaterial.fog = true;
  waterReflector.rotation.x = -Math.PI / 2;
  waterReflector.position.set(0, -0.04, -100);
  scene.add(waterReflector);

  const waterOverlayMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uMint: { value: palette.mint }, uCyan: { value: palette.cyan } },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uMint;
      uniform vec3 uCyan;
      void main() {
        float waveA = sin(vWorld.x * .34 + vWorld.z * .12 + uTime * .78) * .5 + .5;
        float waveB = sin(vWorld.z * .42 - vWorld.x * .08 - uTime * .62) * .5 + .5;
        float crestA = smoothstep(.965, 1.0, waveA);
        float crestB = smoothstep(.975, 1.0, waveB);
        float crest = max(crestA, crestB);
        float alpha = .012 + crest * .07;
        vec3 color = mix(uCyan, uMint, waveB * .45);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const waterOverlay = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), waterOverlayMaterial);
  waterOverlay.rotation.x = -Math.PI / 2;
  waterOverlay.position.set(0, 0.015, -100);
  scene.add(waterOverlay);

  // ---------- causeway and colonnade ----------
  const deckHeight = 0.72;
  const routeStart = 36;
  const routeEnd = -202;
  const routeLength = routeStart - routeEnd;
  const routeMiddle = (routeStart + routeEnd) / 2;

  const lowerDeck = new THREE.Mesh(new THREE.BoxGeometry(11.3, 0.32, routeLength + 1.5), marble);
  lowerDeck.position.set(0, 0.16, routeMiddle);
  scene.add(lowerDeck);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10.1, deckHeight, routeLength), [marble, marble, marbleFloor, marble, marble, marble]);
  deck.position.set(0, deckHeight / 2, routeMiddle);
  scene.add(deck);
  const routeInlayMaterial = glow(palette.mint, 1.9);
  const routeInlay = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, routeLength - 3), routeInlayMaterial);
  routeInlay.position.set(0, deckHeight + 0.025, routeMiddle + 0.5);
  scene.add(routeInlay);
  animated.push((time) => {
    routeInlayMaterial.emissiveIntensity = 1.45 + Math.sin(time * 2.15) * 0.48;
  });

  const lanePacketCount = mobile ? 18 : 30;
  const lanePacketPositions = new Float32Array(lanePacketCount * 3);
  const lanePacketGeometry = new THREE.BufferGeometry();
  lanePacketGeometry.setAttribute("position", new THREE.BufferAttribute(lanePacketPositions, 3));
  const lanePackets = new THREE.Points(
    lanePacketGeometry,
    new THREE.PointsMaterial({ color: palette.mint, size: mobile ? 0.16 : 0.13, transparent: true, opacity: 0.86, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(lanePackets);
  animated.push((time) => {
    for (let index = 0; index < lanePacketCount; index++) {
      const travel = (time * 0.074 + index / lanePacketCount) % 1;
      lanePacketPositions[index * 3] = Math.sin(index * 2.37) * 0.16;
      lanePacketPositions[index * 3 + 1] = deckHeight + 0.12 + Math.sin(time * 2 + index) * 0.025;
      lanePacketPositions[index * 3 + 2] = routeStart - 2 - travel * (routeLength - 4);
    }
    lanePacketGeometry.attributes.position.needsUpdate = true;
  });

  const stationSpecs = [
    { z: -39, side: 1 },
    { z: -79, side: -1 },
    { z: -119, side: 1 },
    { z: -159, side: -1 },
  ];
  const nearStation = (x: number, z: number) => stationSpecs.some((station) => Math.sign(x) === station.side && Math.abs(z - station.z) < 9.1);
  const columnPlacements: Array<[number, number]> = [];
  for (let z = routeStart - 3; z > routeEnd + 1; z -= 4.7) {
    for (const x of [-4.35, 4.35]) if (!nearStation(x, z)) columnPlacements.push([x, z]);
  }

  const shaftGeometry = new THREE.CylinderGeometry(0.37, 0.47, 6.35, mobile ? 18 : 28, 4, true);
  const baseGeometry = new THREE.CylinderGeometry(0.59, 0.65, 0.32, 28);
  const capitalGeometry = new THREE.CylinderGeometry(0.68, 0.42, 0.38, 28);
  const abacusGeometry = new THREE.BoxGeometry(1.38, 0.24, 1.38);
  const plinthGeometry = new THREE.BoxGeometry(1.2, 0.2, 1.2);
  const shafts = new THREE.InstancedMesh(shaftGeometry, marble, columnPlacements.length);
  const bases = new THREE.InstancedMesh(baseGeometry, marble, columnPlacements.length);
  const capitals = new THREE.InstancedMesh(capitalGeometry, marble, columnPlacements.length);
  const abaci = new THREE.InstancedMesh(abacusGeometry, marble, columnPlacements.length);
  const plinths = new THREE.InstancedMesh(plinthGeometry, marble, columnPlacements.length);
  const matrix = new THREE.Matrix4();
  columnPlacements.forEach(([x, z], index) => {
    matrix.makeTranslation(x, deckHeight + 0.36 + 6.35 / 2, z); shafts.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, deckHeight + 0.28, z); bases.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, deckHeight + 6.35 + 0.55, z); capitals.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, deckHeight + 6.35 + 0.85, z); abaci.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, deckHeight + 0.1, z); plinths.setMatrixAt(index, matrix);
  });
  [shafts, bases, capitals, abaci, plinths].forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });

  const colonnadeTop = deckHeight + 7.33;
  const sideBeamLength = routeLength + 2;
  for (const side of [-1, 1]) {
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.58, sideBeamLength), marble);
    lower.position.set(side * 4.35, colonnadeTop, routeMiddle);
    scene.add(lower);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.22, sideBeamLength + 0.3), marble);
    upper.position.set(side * 4.35, colonnadeTop + 0.42, routeMiddle);
    scene.add(upper);
  }
  const crossBeamGeometry = new THREE.BoxGeometry(8.1, 0.22, 0.38);
  const crossBeamCount = Math.floor(routeLength / 4.7);
  const crossBeams = new THREE.InstancedMesh(crossBeamGeometry, marble, crossBeamCount);
  for (let index = 0; index < crossBeamCount; index++) {
    matrix.makeTranslation(0, colonnadeTop + 0.66, routeStart - 3 - index * 4.7);
    crossBeams.setMatrixAt(index, matrix);
  }
  crossBeams.instanceMatrix.needsUpdate = true;
  scene.add(crossBeams);

  // ---------- reusable station pieces ----------
  const sharedColumnGeometries = { shaftGeometry, baseGeometry, capitalGeometry, abacusGeometry, plinthGeometry };
  function addColumn(parent: THREE.Group, x: number, z: number, scale = 0.7) {
    const shaft = new THREE.Mesh(sharedColumnGeometries.shaftGeometry, marble);
    shaft.scale.setScalar(scale); shaft.position.set(x, deckHeight + 0.36 * scale + 6.35 * scale / 2, z); parent.add(shaft);
    const base = new THREE.Mesh(sharedColumnGeometries.baseGeometry, marble);
    base.scale.setScalar(scale); base.position.set(x, deckHeight + 0.28 * scale, z); parent.add(base);
    const capital = new THREE.Mesh(sharedColumnGeometries.capitalGeometry, marble);
    capital.scale.setScalar(scale); capital.position.set(x, deckHeight + (6.35 + 0.55) * scale, z); parent.add(capital);
    const abacus = new THREE.Mesh(sharedColumnGeometries.abacusGeometry, marble);
    abacus.scale.setScalar(scale); abacus.position.set(x, deckHeight + (6.35 + 0.85) * scale, z); parent.add(abacus);
    const plinth = new THREE.Mesh(sharedColumnGeometries.plinthGeometry, marble);
    plinth.scale.setScalar(scale); plinth.position.set(x, deckHeight + 0.1 * scale, z); parent.add(plinth);
  }

  function createPlatform(side: number, z: number) {
    const group = new THREE.Group();
    group.position.set(side * 13, 0, z);
    scene.add(group);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 5.1, deckHeight, 52), marble);
    base.position.y = deckHeight / 2; group.add(base);
    const step = new THREE.Mesh(new THREE.CylinderGeometry(5.25, 5.4, 0.28, 52), marble);
    step.position.y = 0.14; group.add(step);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(5.6, deckHeight, 2.7), marble);
    bridge.position.set(-side * 6.6, deckHeight / 2, 0); group.add(bridge);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(3, 1.55, 3), marble);
    pedestal.position.y = deckHeight + 0.78; group.add(pedestal);
    const pedestalTop = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.22, 3.35), marble);
    pedestalTop.position.y = deckHeight + 1.66; group.add(pedestalTop);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.35, 0.045, 8, 72), glow(palette.mint, 1.25));
    rim.rotation.x = Math.PI / 2; rim.position.y = deckHeight + 0.04; group.add(rim);
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2 + Math.PI / 5;
      const x = Math.cos(angle) * 3.85;
      const zz = Math.sin(angle) * 3.85;
      if (Math.sign(x || 1) === -side && Math.abs(zz) < 1.4) continue;
      addColumn(group, x, zz, 0.53);
    }
    return group;
  }

  function createCoinTexture(label: string) {
    const size = 512;
    const coinCanvas = document.createElement("canvas");
    coinCanvas.width = coinCanvas.height = size;
    const context = coinCanvas.getContext("2d")!;
    const fill = context.createRadialGradient(size * 0.35, size * 0.28, 10, size / 2, size / 2, size / 2);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(1, "#dff3ea");
    context.fillStyle = fill;
    context.beginPath(); context.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2); context.fill();
    context.lineWidth = 22; context.strokeStyle = "#2fc786";
    context.beginPath(); context.arc(size / 2, size / 2, size / 2 - 22, 0, Math.PI * 2); context.stroke();
    context.lineWidth = 5; context.strokeStyle = "rgba(42,141,102,.35)";
    context.beginPath(); context.arc(size / 2, size / 2, size / 2 - 55, 0, Math.PI * 2); context.stroke();
    context.fillStyle = palette.ink;
    context.font = `${label.length > 6 ? 66 : 86}px Marcellus, Georgia, serif`;
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(label, size / 2, size / 2 + 4);
    const texture = new THREE.CanvasTexture(coinCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    return texture;
  }

  function addCoin(parent: THREE.Group, y: number, label: string, side: number) {
    const coinTexture = createCoinTexture(label);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: coinTexture, transparent: true, depthWrite: false, fog: true }));
    sprite.scale.set(2.75, 2.75, 1); sprite.position.y = y; parent.add(sprite);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.07, 8, 64), glow(palette.cyan, 1.7));
    halo.rotation.x = Math.PI / 2; halo.position.y = y - 1.65; parent.add(halo);
    animated.push((time) => {
      sprite.position.y = y + Math.sin(time * 0.85 + side) * 0.18;
      sprite.material.rotation = Math.sin(time * 0.34 + side) * 0.035;
      halo.scale.setScalar(1 + Math.sin(time * 1.5 + side) * 0.055);
    });
  }

  // I — route comparison monument.
  {
    const group = createPlatform(1, -39);
    const baseY = deckHeight + 1.78;
    const height = 7;
    const radius = 1.08;
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 48, 1, true), glass);
    cylinder.position.y = baseY + height / 2; group.add(cylinder);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.26, radius + 0.12, 0.3, 48), marble);
    cap.position.y = baseY + height + 0.15; group.add(cap);
    const makeHalf = (start: number, color: THREE.Color) => {
      const geometry = new THREE.CylinderGeometry(radius * 0.87, radius * 0.87, 1, 40, 1, false, start, Math.PI);
      geometry.translate(0, 0.5, 0);
      const mesh = new THREE.Mesh(geometry, glow(color, 1.1));
      mesh.position.y = baseY + 0.04; group.add(mesh); return mesh;
    };
    const first = makeHalf(0, palette.mint);
    const second = makeHalf(Math.PI, palette.cyan);
    for (let index = 1; index < 7; index++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.015, 0.014, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = baseY + index; group.add(ring);
    }
    addCoin(group, baseY + height + 2.3, "ROUTES", 1);
    animated.push((time) => {
      first.scale.y = 3.6 + Math.sin(time * 0.9) * 1.1;
      second.scale.y = 3.25 + Math.sin(time * 0.82 + 2.1) * 1.05;
    });
  }

  // II — platform fee rebate monument.
  {
    const group = createPlatform(-1, -79);
    const baseY = deckHeight + 1.78;
    const rings: THREE.Mesh[] = [];
    let y = baseY;
    for (let index = 0; index < 6; index++) {
      const radius = 1.38 - index * 0.095;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.04, 0.92, 48), marble);
      drum.position.y = y + 0.46; group.add(drum);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.02, 0.072, 10, 64), glow(index % 2 ? palette.cyan : palette.mint, 0.32));
      ring.rotation.x = Math.PI / 2; ring.position.y = y + 0.94; group.add(ring); rings.push(ring);
      y += 1.02;
    }
    addCoin(group, y + 2.05, "REBATE", -1);
    animated.push((time) => rings.forEach((ring, index) => {
      const pulse = Math.max(0, Math.sin(time * 2.05 - index * 0.72));
      (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + pulse * pulse * 2.4;
    }));
  }

  // III — settlement proof monument.
  {
    const group = createPlatform(1, -119);
    const baseY = deckHeight + 1.78;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.78, 5.2, 40), marble);
    shaft.position.y = baseY + 2.6; group.add(shaft);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.12), new THREE.MeshPhysicalMaterial({ color: 0xa6f1d4, transparent: true, opacity: 0.55, roughness: 0.08, clearcoat: 1, depthWrite: false }));
    crystal.position.y = baseY + 6.35; crystal.scale.y = 1.35; group.add(crystal);
    const orbitItems: Array<{ pivot: THREE.Group; node: THREE.Mesh; radius: number; speed: number; phase: number }> = [];
    [[2.2, 0.8, 0], [2.7, 1.05, 1.8], [3.15, 1.28, 3.3]].forEach(([radius, speed, phase], index) => {
      const pivot = new THREE.Group(); pivot.position.y = baseY + 2.3 + index * 1.25; pivot.rotation.x = (index - 1) * 0.33; group.add(pivot);
      const orbit = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.02, 6, 96), new THREE.MeshBasicMaterial({ color: index === 1 ? palette.cyan : palette.mint, transparent: true, opacity: 0.7 }));
      orbit.rotation.x = Math.PI / 2; pivot.add(orbit);
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 12), glow(index === 1 ? palette.cyan : palette.mint, 2.4));
      pivot.add(node); orbitItems.push({ pivot, node, radius, speed, phase });
    });
    addCoin(group, baseY + 9.6, "PROOF", 1);
    animated.push((time) => {
      crystal.rotation.y = time * 0.42;
      orbitItems.forEach((item) => {
        const angle = time * item.speed + item.phase;
        item.node.position.set(Math.cos(angle) * item.radius, 0, Math.sin(angle) * item.radius);
      });
    });
  }

  // IV — verified hook building blocks.
  {
    const group = createPlatform(-1, -159);
    const baseY = deckHeight + 1.78;
    const litBlocks: THREE.Mesh[] = [];
    for (let level = 0; level < 7; level++) {
      const rotate = level % 2 ? Math.PI / 2 : 0;
      for (let block = -1; block <= 1; block++) {
        if (level === 6 && block !== 0) continue;
        const active = (level * 3 + block + 8) % 4 === 0;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 2.78), active ? glow(level % 2 ? palette.cyan : palette.mint, 0.35) : marble);
        mesh.rotation.y = rotate;
        mesh.position.set(rotate ? 0 : block * 0.94, baseY + 0.33 + level * 0.65, rotate ? block * 0.94 : 0);
        if (level === 6) mesh.scale.z = 0.35;
        group.add(mesh); if (active) litBlocks.push(mesh);
      }
    }
    const hookCurve = new THREE.CatmullRomCurve3([V(-1.8, baseY + 6.4, 0), V(0, baseY + 7.15, 0), V(1.65, baseY + 6.2, 0), V(1.35, baseY + 4.9, 0), V(0.4, baseY + 4.65, 0)]);
    const hook = new THREE.Mesh(new THREE.TubeGeometry(hookCurve, 48, 0.08, 8, false), glow(palette.cyan, 1.8));
    group.add(hook);
    addCoin(group, baseY + 8.1, "HOOKS", -1);
    animated.push((time) => litBlocks.forEach((block, index) => {
      const pulse = Math.max(0, Math.sin(time * 1.65 - index * 1.12));
      (block.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + pulse * 1.8;
    }));
  }

  // ---------- settlement agora ----------
  const agoraZ = -219;
  const agora = new THREE.Group(); agora.position.z = agoraZ; scene.add(agora);
  const agoraFloor = new THREE.Mesh(new THREE.CylinderGeometry(17.2, 17.7, deckHeight, 72), [marble, marbleFloor, marble]);
  agoraFloor.position.y = deckHeight / 2; agora.add(agoraFloor);
  const agoraStep = new THREE.Mesh(new THREE.CylinderGeometry(18.3, 18.55, 0.3, 72), marble);
  agoraStep.position.y = 0.15; agora.add(agoraStep);
  for (const radius of [6, 9.2, 14.8]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.055, radius + 0.055, 128), new THREE.MeshBasicMaterial({ color: radius === 14.8 ? palette.cyan : palette.mint, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = deckHeight + 0.015; agora.add(ring);
  }
  const agoraColumns = 16;
  for (let index = 0; index < agoraColumns; index++) {
    const angle = index / agoraColumns * Math.PI * 2 + Math.PI / 2;
    if (Math.abs(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))) < 0.28) continue;
    const x = Math.cos(angle) * 12.8;
    const z = Math.sin(angle) * 12.8;
    addColumn(agora, x, z, 1.03);
    const nextAngle = (index + 1) / agoraColumns * Math.PI * 2 + Math.PI / 2;
    const mid = (angle + nextAngle) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.25, 0.5, 1.2), marble);
    beam.position.set(Math.cos(mid) * 12.55, colonnadeTop + 0.1, Math.sin(mid) * 12.55);
    beam.rotation.y = -mid;
    agora.add(beam);
  }
  let monumentY = deckHeight;
  [[4.3, 0.48], [3.5, 0.48], [2.65, 0.58]].forEach(([width, height]) => {
    const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), marble);
    block.position.y = monumentY + height / 2; monumentY += height; agora.add(block);
  });
  const coreHeight = 9.4;
  const coreShell = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.58, coreHeight, 56, 1, true), glass);
  coreShell.position.y = monumentY + coreHeight / 2; agora.add(coreShell);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, coreHeight, 32), glow(palette.mint, 1.2));
  core.position.y = monumentY + coreHeight / 2; agora.add(core);
  const coreRings: THREE.Mesh[] = [];
  for (let index = 0; index < 5; index++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.035, 8, 64), new THREE.MeshBasicMaterial({ color: index % 2 ? palette.cyan : palette.mint, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2; agora.add(ring); coreRings.push(ring);
  }
  const logoTexture = new THREE.TextureLoader().load("/perm-mark.png");
  logoTexture.colorSpace = THREE.SRGBColorSpace; textures.push(logoTexture);
  const logoSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: logoTexture, transparent: true, depthWrite: false, fog: false }));
  logoSprite.scale.set(5.6, 5.6, 1); logoSprite.position.y = monumentY + coreHeight + 3.4; agora.add(logoSprite);
  const logoHalo = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.06, 8, 96), glow(palette.cyan, 1.6));
  logoHalo.rotation.x = Math.PI / 2; logoHalo.position.y = monumentY + coreHeight + 0.55; agora.add(logoHalo);
  animated.push((time) => {
    logoSprite.position.y = monumentY + coreHeight + 3.4 + Math.sin(time * 0.78) * 0.22;
    logoHalo.scale.setScalar(1 + Math.sin(time * 1.45) * 0.05);
    coreRings.forEach((ring, index) => {
      const travel = (time * 0.19 + index / coreRings.length) % 1;
      ring.position.y = monumentY + travel * coreHeight;
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.sin(travel * Math.PI) * 0.82;
    });
  });

  // ---------- route arcs and packets ----------
  const packetMeshes: Array<{ mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; offset: number; speed: number }> = [];
  stationSpecs.forEach((station, index) => {
    const start = V(station.side * 13, deckHeight + 9, station.z);
    const end = V(0, deckHeight + 13.2, agoraZ);
    const midpoint = start.clone().lerp(end, 0.52);
    midpoint.y += 17 + index * 2.2;
    midpoint.x *= 0.58;
    const curve = new THREE.CatmullRomCurve3([start, midpoint, end]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, 0.055 + index * 0.008, 7, false),
      new THREE.MeshBasicMaterial({ color: index % 2 ? palette.cyan : palette.mint, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    scene.add(tube);
    for (let packet = 0; packet < 2; packet++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), glow(index % 2 ? palette.cyan : palette.mint, 2.6));
      scene.add(mesh);
      packetMeshes.push({ mesh, curve, offset: packet * 0.48 + index * 0.09, speed: 0.065 + index * 0.008 });
    }
  });
  animated.push((time) => packetMeshes.forEach((packet) => packet.mesh.position.copy(packet.curve.getPointAt((time * packet.speed + packet.offset) % 1))));

  // ---------- clouds and atmospheric particles ----------
  const cloudTexture = createCloudTexture();
  const cloudCount = mobile ? 34 : 72;
  const driftingClouds: Array<{ cloud: THREE.Sprite; material: THREE.SpriteMaterial; baseOpacity: number; startX: number; startY: number; speed: number }> = [];
  for (let index = 0; index < cloudCount; index++) {
    const baseOpacity = 0.34 + Math.random() * 0.3;
    const material = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false, opacity: baseOpacity, fog: true });
    const cloud = new THREE.Sprite(material);
    const scale = 24 + Math.random() * 45;
    const startX = (Math.random() - 0.5) * 280;
    const startY = 20 + Math.random() * 26;
    cloud.scale.set(scale * 1.75, scale, 1);
    cloud.position.set(startX, startY, 70 - Math.random() * 390);
    driftingClouds.push({ cloud, material, baseOpacity, startX, startY, speed: 0.34 + Math.random() * 0.34 });
    scene.add(cloud);
  }
  animated.push((time) => driftingClouds.forEach(({ cloud, startX, startY, speed }, index) => {
    cloud.position.x = ((startX + time * speed + 170) % 340) - 170;
    cloud.position.y = startY + Math.sin(time * 0.08 + index) * 0.14;
  }));
  const moteCount = mobile ? 110 : 230;
  const motePositions = new Float32Array(moteCount * 3);
  for (let index = 0; index < moteCount; index++) {
    motePositions[index * 3] = (Math.random() - 0.5) * 90;
    motePositions[index * 3 + 1] = 1 + Math.random() * 30;
    motePositions[index * 3 + 2] = 45 - Math.random() * 310;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({ color: 0xc7fff0, size: 0.08, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(motes);
  animated.push((time) => {
    motes.rotation.y = Math.sin(time * 0.035) * 0.018;
    motes.position.y = Math.sin(time * 0.24) * 0.12;
  });

  // ---------- camera journey ----------
  const cameraKeys: CameraKey[] = [
    { at: 0, position: V(0, 8.5, 108), look: V(0, 8.5, -250) },
    { at: 0.09, position: V(0, 8.5, 108), look: V(0, 8.5, -250) },
    { at: 0.12, position: V(0, 24, 98), look: V(0, 0.8, -170) },
    { at: 0.15, position: V(0, 26, 76), look: V(0, 0.8, -132) },
    { at: 0.18, position: V(0, 17, 50), look: V(0, 1.8, -88) },
    { at: 0.21, position: V(-0.1, 7.2, 28), look: V(0, 3.8, -58) },
    { at: 0.23, position: V(-0.2, 4.1, 23), look: V(0, 4.5, -45) },
    { at: 0.30, position: V(-1.1, 4.0, -30), look: V(13, 6.4, -39) },
    { at: 0.43, position: V(1.1, 4.0, -70), look: V(-13, 6.4, -79) },
    { at: 0.56, position: V(-1.1, 4.0, -110), look: V(13, 6.4, -119) },
    { at: 0.69, position: V(1.1, 4.0, -150), look: V(-13, 6.4, -159) },
    { at: 0.80, position: V(44, 42, -65), look: V(0, 2.2, -130) },
    { at: 0.90, position: V(0, 4.4, -174), look: V(0, 7, agoraZ) },
    { at: 1, position: V(0, 4.0, -191), look: V(0, 8.3, agoraZ) },
  ];
  const cameraPosition = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  function readCamera(progress: number) {
    let upper = 1;
    while (upper < cameraKeys.length && progress > cameraKeys[upper].at) upper++;
    upper = Math.min(upper, cameraKeys.length - 1);
    const lower = Math.max(0, upper - 1);
    const first = cameraKeys[lower];
    const second = cameraKeys[upper];
    const span = Math.max(0.0001, second.at - first.at);
    const amount = upper === lower ? 0 : smooth(clamp01((progress - first.at) / span));
    cameraPosition.lerpVectors(first.position, second.position, amount);
    cameraLook.lerpVectors(first.look, second.look, amount);
  }

  const stops: SceneStop[] = [
    { n: "I", label: "Route", p: 0.30, a: 0.24 },
    { n: "II", label: "Rebate", p: 0.43, a: 0.37 },
    { n: "III", label: "Proof", p: 0.56, a: 0.50 },
    { n: "IV", label: "Hooks", p: 0.69, a: 0.63 },
    { n: "V", label: "Settle", p: 0.97, a: 0.88 },
  ];

  let target = 0;
  let current = 0;
  let disposed = false;
  let frameId = 0;
  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (event: PointerEvent) => {
    pointerX = (event.clientX / innerWidth - 0.5) * 2;
    pointerY = (event.clientY / innerHeight - 0.5) * 2;
  };
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerWidth / innerHeight < 0.78 ? 61 : 46;
    camera.updateProjectionMatrix();
    const size = reflectionSize();
    waterReflector.getRenderTarget().setSize(size.width, size.height);
  };
  addEventListener("pointermove", onPointer, { passive: true });
  addEventListener("resize", resize, { passive: true });
  resize();

  function render() {
    if (disposed) return;
    const delta = Math.min(clock.getDelta(), 0.12);
    const elapsed = clock.elapsedTime;
    current += (target - current) * (1 - Math.exp(-delta * (reducedMotion ? 24 : 12)));
    if (Math.abs(target - current) < 0.00001) current = target;
    readCamera(current);
    const fogReveal = smooth(clamp01((current - 0.10) / 0.10));
    const routeClarity = smooth(clamp01((current - 0.24) / 0.14));
    sceneFog.near = THREE.MathUtils.lerp(4, 220, fogReveal) + routeClarity * 100;
    sceneFog.far = THREE.MathUtils.lerp(62, 980, fogReveal) + routeClarity * 420;
    // Keep the opening cloud reveal intact, then clear the camera's path once
    // it enters the causeway so the columns, stations, and route remain legible.
    const cloudClearance = smooth(clamp01((current - 0.18) / 0.14));
    const cloudOpacityScale = THREE.MathUtils.lerp(1, 0.14, cloudClearance);
    driftingClouds.forEach(({ material, baseOpacity }) => { material.opacity = baseOpacity * cloudOpacityScale; });
    const motion = reducedMotion ? 0 : 1;
    camera.position.set(
      cameraPosition.x + pointerX * 0.16 * motion,
      cameraPosition.y - pointerY * 0.07 * motion + Math.sin(elapsed * 0.42) * 0.045 * motion,
      cameraPosition.z,
    );
    camera.lookAt(cameraLook);
    sky.position.copy(camera.position);
    waterOverlayMaterial.uniforms.uTime.value = elapsed;
    waterReflectorMaterial.uniforms.uTime.value = elapsed;
    if (!reducedMotion) animated.forEach((animate) => animate(elapsed));
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(render);
  }

  options.onReady?.();
  frameId = requestAnimationFrame(render);

  return {
    stops,
    setTarget(progress: number) { target = clamp01(progress); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      removeEventListener("pointermove", onPointer);
      removeEventListener("resize", resize);
      scene.traverse((object) => {
        const candidate = object as THREE.Mesh;
        candidate.geometry?.dispose?.();
        const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
        materials.forEach((material) => material?.dispose?.());
      });
      textures.forEach((texture) => texture.dispose());
      waterReflector.dispose();
      renderer.dispose();
    },
  };
}
