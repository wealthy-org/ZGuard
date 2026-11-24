import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function HeroScene3D() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.045);

    const camera = new THREE.PerspectiveCamera(
      38,
      el.clientWidth / Math.max(el.clientHeight, 1),
      0.1,
      80
    );
    camera.position.set(0, 0.2, 7.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const p1 = new THREE.PointLight(0xffffff, 3.2, 24);
    p1.position.set(4, 5, 6);
    scene.add(p1);
    const p2 = new THREE.PointLight(0xa1a1aa, 1.8, 20);
    p2.position.set(-5, -2, 3);
    scene.add(p2);

    const deg = (d: number) => (d * Math.PI) / 180;
    const polar = (r: number, a: number, z: number) =>
      new THREE.Vector3(r * Math.cos(deg(a)), -r * Math.sin(deg(a)), z);

    const S = 0.028;
    const R1 = 48 * S;
    const R2 = 59.5 * S;
    const R3 = 71 * S;
    const R4 = 82.5 * S;
    const theta = -50;
    const delta = (Math.asin(8.4 / 48) * 180) / Math.PI;

    const arcPts = (r: number, a0: number, a1: number, z: number, n = 48) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        pts.push(polar(r, a, z));
      }
      return pts;
    };

    const zGroup = new THREE.Group();
    root.add(zGroup);

    const depths = [-0.28, -0.14, 0, 0.14, 0.28];
    depths.forEach((z, idx) => {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: idx === 2 ? 1 : idx === 1 || idx === 3 ? 0.45 : 0.16,
      });
      const up = arcPts(R1, -134, theta + delta, z, 36);
      up.push(polar(R1, theta + 180 - delta, z));
      zGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(up), mat));

      const lo = arcPts(R1, 46, theta + 180 + delta, z, 36);
      lo.push(polar(R1, theta - delta, z));
      zGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lo), mat));

      zGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            polar(R1, theta, z),
            polar(R1, theta + 180, z),
          ]),
          mat
        )
      );
    });

    const radarMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
    });
    [
      { r: R2, ts: -134.5, te: -45.5, bs: 45.5, be: 134.5 },
      { r: R3, ts: -135, te: -45, bs: 45, be: 135 },
      { r: R4, ts: -136, te: -44, bs: 44, be: 136 },
    ].forEach((w) => {
      zGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(arcPts(w.r, w.ts, w.te, 0, 40)),
          radarMat
        )
      );
      zGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(arcPts(w.r, w.bs, w.be, 0, 40)),
          radarMat
        )
      );
    });

    const makeRing = (radius: number, dash: boolean, op: number) => {
      const c = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2, false, 0);
      const g = new THREE.BufferGeometry().setFromPoints(
        c.getPoints(160).map((p) => new THREE.Vector3(p.x, p.y, 0))
      );
      if (dash) {
        const m = new THREE.LineDashedMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: op,
          dashSize: 0.12,
          gapSize: 0.08,
        });
        const l = new THREE.Line(g, m);
        l.computeLineDistances();
        return l;
      }
      return new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op })
      );
    };

    const r1 = makeRing(2.35, true, 0.28);
    r1.rotation.x = 1.15;
    const r2 = makeRing(2.7, false, 0.16);
    r2.rotation.x = -0.85;
    r2.rotation.y = 0.4;
    const r3 = makeRing(3.1, true, 0.12);
    r3.rotation.y = 1.1;
    root.add(r1, r2, r3);

    const knot = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.TorusKnotGeometry(1.55, 0.055, 180, 12, 2, 3)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })
    );
    root.add(knot);

    // Floor grid
    const grid = new THREE.GridHelper(18, 28, 0x3f3f46, 0x1a1a1c);
    grid.position.y = -2.4;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);

    // Dust
    const n = 280;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.022,
        transparent: true,
        opacity: 0.45,
      })
    );
    scene.add(dust);

    // Packets
    const packetGeo = new THREE.OctahedronGeometry(0.045, 0);
    const packets: { mesh: THREE.Mesh; speed: number }[] = [];
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(
        packetGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
      );
      mesh.position.set(-4 + Math.random() * 8, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.4);
      root.add(mesh);
      packets.push({ mesh, speed: 0.012 + Math.random() * 0.02 });
    }

    let hoverX = 0;
    let hoverY = 0;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      hoverX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.6;
      hoverY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.4;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const onResize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let visible = true;
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    io.observe(el);

    const clock = new THREE.Clock();
    let id = 0;
    const animate = () => {
      id = requestAnimationFrame(animate);
      if (!visible) return;
      const t = clock.getElapsedTime();
      root.rotation.y += (hoverX * 0.8 + t * 0.08 - root.rotation.y) * 0.04;
      root.rotation.x += (hoverY * 0.5 + 0.12 - root.rotation.x) * 0.04;
      zGroup.rotation.z = Math.sin(t * 0.4) * 0.04;
      r1.rotation.z += 0.004;
      r2.rotation.z -= 0.003;
      r3.rotation.x += 0.0025;
      knot.rotation.x = t * 0.22;
      knot.rotation.y = -t * 0.28;
      dust.rotation.y = t * 0.02;
      packets.forEach((p) => {
        p.mesh.position.x += p.speed;
        if (p.mesh.position.x > 4.2) p.mesh.position.x = -4.2;
        p.mesh.rotation.x += 0.03;
        p.mesh.rotation.y += 0.04;
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(id);
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0 w-full h-full" />;
}
