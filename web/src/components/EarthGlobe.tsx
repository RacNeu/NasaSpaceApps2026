import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface GlobeSat {
  id: string;
  name: string;
  color: string;
  altKm: number;
  incl: number; // degrees
  raan: number; // degrees, orientation of the orbit plane
  phase: number; // 0..1 around the orbit
  periodMin: number;
}

interface Props {
  sats: GlobeSat[];
  selected: string;
  onSelect: (id: string) => void;
  active: boolean;
}

const R_EARTH = 6371;
const EXAGGERATE = 3.4; // orbit heights are exaggerated so the rings do not sit on the surface
// NASA Blue Marble (day) and VIIRS Black Marble (night), bundled with the site so the globe never
// depends on an outside server at view time. Source: NASA GIBS.
const DAY_URL = `${import.meta.env.BASE_URL}textures/earth_day.jpg`;
const NIGHT_URL = `${import.meta.env.BASE_URL}textures/earth_night.jpg`;

/** three.js maps longitude 0 to +x and 90E to -z on a SphereGeometry. */
const lonLat = (lon: number, lat: number, r = 1) => {
  const phi = (0.5 + lon / 360) * Math.PI * 2;
  const la = (lat * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(phi) * Math.cos(la) * r);
};

const glowTexture = (color: string) => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.45, color + "55");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float ndl = dot(n, normalize(sunDir));
    float dayMix = smoothstep(-0.14, 0.2, ndl);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 dayLit = day * (0.35 + 0.95 * max(ndl, 0.0));
    vec3 nightLit = night * vec3(1.9, 1.55, 1.1) + day * 0.03;
    vec3 col = mix(nightLit, dayLit, dayMix);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.12, 0.46, 0.72) * fres * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }
`;
const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ATMO_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float i = pow(max(0.0, 0.6 - dot(vN, vV)), 3.4);
    gl_FragColor = vec4(0.22, 0.58, 0.85, 1.0) * i * 1.15;
  }
`;

export function EarthGlobe({ sats, selected, onSelect, active }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selRef = useRef(selected);
  const activeRef = useRef(active);
  const onSelectRef = useRef(onSelect);
  selRef.current = selected;
  activeRef.current = active;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.className = "globe-canvas";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    const start = lonLat(112, 14, 1).multiplyScalar(3.7);
    camera.position.copy(start);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.rotateSpeed = 0.5;

    // Earth with day and night textures
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const blank = new THREE.DataTexture(new Uint8Array([8, 24, 44, 255]), 1, 1);
    blank.needsUpdate = true;
    const uniforms = {
      dayMap: { value: blank as THREE.Texture },
      nightMap: { value: blank as THREE.Texture },
      // sun placed over the Indian Ocean so Southeast Asia is in daylight with the terminator in view
      sunDir: { value: lonLat(52, 14, 1).normalize() },
    };
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
    );
    scene.add(earth);
    const load = (url: string, key: "dayMap" | "nightMap") =>
      loader.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
          uniforms[key].value = t;
        },
        undefined,
        () => undefined,
      );
    load(DAY_URL, "dayMap");
    load(NIGHT_URL, "nightMap");

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 96, 64),
      new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    scene.add(atmo);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 20);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe6ff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false })));

    // study-area marker (pulsing ring on the surface)
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.068, 64),
      new THREE.MeshBasicMaterial({ color: 0xff9d43, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    const mp = lonLat(110, 0, 1.004);
    marker.position.copy(mp);
    marker.lookAt(mp.clone().multiplyScalar(2));
    scene.add(marker);

    // orbits and satellites
    interface Live {
      sat: GlobeSat;
      inner: THREE.Group;
      dot: THREE.Sprite;
      trail: THREE.Line;
      trailPos: Float32Array;
      ring: THREE.LineLoop;
      radius: number;
      rate: number;
    }
    const live: Live[] = sats.map((s) => {
      const radius = 1 + (s.altKm / R_EARTH) * EXAGGERATE;
      const outer = new THREE.Group();
      outer.rotation.y = (s.raan * Math.PI) / 180;
      const inner = new THREE.Group();
      inner.rotation.x = (s.incl * Math.PI) / 180;
      outer.add(inner);
      scene.add(outer);

      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color(s.color), transparent: true, opacity: 0.22, depthWrite: false }),
      );
      inner.add(ring);

      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(s.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      dot.scale.setScalar(0.12);
      inner.add(dot);

      const N = 48;
      const trailPos = new Float32Array(N * 3);
      const trailCol = new Float32Array(N * 3);
      const c = new THREE.Color(s.color);
      for (let i = 0; i < N; i++) {
        const f = 1 - i / (N - 1);
        trailCol.set([c.r * f, c.g * f, c.b * f], i * 3);
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
      tg.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      inner.add(trail);
      return { sat: s, inner, dot, trail, trailPos, ring, radius, rate: (Math.PI * 2) / 26 / (s.periodMin / 98.8) };
    });

    const size = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    // click to select the nearest satellite on screen
    const onClick = (ev: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      let best: { id: string; d: number } | null = null;
      const v = new THREE.Vector3();
      for (const l of live) {
        l.dot.getWorldPosition(v);
        v.project(camera);
        const sx = ((v.x + 1) / 2) * r.width;
        const sy = ((1 - v.y) / 2) * r.height;
        const d = Math.hypot(sx - x, sy - y);
        if (d < 30 && (!best || d < best.d)) best = { id: l.sat.id, d };
      }
      if (best) onSelectRef.current(best.id);
    };
    renderer.domElement.addEventListener("click", onClick);

    const clock = new THREE.Clock();
    let raf = 0;
    const worldPos = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!activeRef.current) return;
      const t = clock.getElapsedTime();
      controls.update();
      marker.scale.setScalar(1 + 0.25 * Math.sin(t * 2.2));
      (marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(t * 2.2 + 1);
      camPos.copy(camera.position);
      for (const l of live) {
        const a = (l.sat.phase * Math.PI * 2) + t * l.rate;
        l.dot.position.set(Math.cos(a) * l.radius, 0, Math.sin(a) * l.radius);
        const sel = l.sat.id === selRef.current;
        l.dot.scale.setScalar(sel ? 0.26 : 0.15);
        (l.ring.material as THREE.LineBasicMaterial).opacity = sel ? 0.85 : 0.2;
        // trail behind the satellite
        const N = l.trailPos.length / 3;
        for (let i = 0; i < N; i++) {
          const aa = a - (i / N) * 0.9;
          l.trailPos.set([Math.cos(aa) * l.radius, 0, Math.sin(aa) * l.radius], i * 3);
        }
        (l.trail.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (l.trail.material as THREE.LineBasicMaterial).opacity = sel ? 1 : 0.55;

        // label placement, hidden when the satellite is behind the Earth
        const lab = labelRefs.current[l.sat.id];
        if (lab) {
          l.dot.getWorldPosition(worldPos);
          const d = tmp.copy(worldPos).sub(camPos);
          const b = camPos.dot(d);
          const c = camPos.lengthSq() - 1;
          const disc = b * b - d.lengthSq() * c;
          let hidden = false;
          if (disc > 0) {
            const s1 = (-b - Math.sqrt(disc)) / d.lengthSq();
            hidden = s1 > 0 && s1 < 1;
          }
          const p = worldPos.clone().project(camera);
          const w = renderer.domElement.clientWidth;
          const h = renderer.domElement.clientHeight;
          lab.style.transform = `translate(${((p.x + 1) / 2) * w + 12}px, ${((1 - p.y) / 2) * h - 10}px)`;
          lab.style.opacity = hidden ? "0" : sel ? "1" : "0.7";
          lab.style.pointerEvents = hidden ? "none" : "auto";
        }
      }
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="globe-host" ref={host}>
      <div className="globe-labels" aria-hidden={false}>
        {sats.map((s) => (
          <button
            key={s.id}
            ref={(e) => {
              labelRefs.current[s.id] = e;
            }}
            className={`globe-label mono ${selected === s.id ? "on" : ""}`}
            style={{ color: s.color, borderColor: s.color }}
            onClick={() => onSelect(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
