"use client";

import { ContactShadows, MeshReflectorMaterial, Sparkles } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CourtState } from "@/lib/engine/reduce";
import type { Lawyer } from "@/lib/engine/types";

const C = {
  night: "#0c1020",
  floor: "#141a2e",
  wall: "#10162a",
  wood: "#263052",
  robe: "#1b2340",
  aegis: "#4c8dff",
  nemesis: "#ff5a5a",
  gold: "#f2c14e",
  paper: "#e9ecf5",
};

/** When each reaction last fired, in seconds on the performance clock. */
type Cues = { hit: Record<Lawyer, number>; objection: number; verdict: number };
const now = () => performance.now() / 1000;
const since = (t: number) => (t ? now() - t : Infinity);

/**
 * The courtroom in 3D: the same court state the 2D view shows, staged with low-poly figures.
 * AEGIS stands left with a shield, NEMESIS right, the blindfolded ARBITER at the raised bench.
 */
export default function Courtroom3D({ state, reduced }: { state: CourtState; reduced: boolean }) {
  const cues = useRef<Cues>({ hit: { AEGIS: 0, NEMESIS: 0 }, objection: 0, verdict: 0 });
  const prev = useRef({ hp: state.hp, objections: state.objections.length, verdict: !!state.verdict });

  // Turn state changes into one-off reactions. Rewinding backwards only lowers the counts, so it stays quiet.
  useEffect(() => {
    const p = prev.current;
    const c = cues.current;
    for (const l of ["AEGIS", "NEMESIS"] as const) if (state.hp[l] < p.hp[l]) c.hit[l] = now();
    if (state.objections.length > p.objections) c.objection = now();
    if (state.verdict && !p.verdict) c.verdict = now();
    prev.current = { hp: state.hp, objections: state.objections.length, verdict: !!state.verdict };
  }, [state]);

  const speaker = state.current !== undefined && !state.verdict ? state.turns[state.current]?.lawyer : undefined;
  const diff = state.hp.AEGIS - state.hp.NEMESIS;
  const tilt = THREE.MathUtils.degToRad(Math.max(-14, Math.min(14, diff * 2.5)));
  const aberration = useRef<{ offset: THREE.Vector2 }>(null);
  const caOffset = useMemo(() => new THREE.Vector2(0, 0), []);

  return (
    <Canvas shadows="percentage" dpr={[1, 1.75]} camera={{ position: [0, 3.6, 8.5], fov: 38 }} gl={{ antialias: false }}>
      <color attach="background" args={[C.night]} />
      <fog attach="fog" args={["#0a0e1c", 9, 21]} />
      <hemisphereLight args={["#8fa6ff", "#0c1020", 0.6]} />
      <directionalLight position={[3, 7, 6]} intensity={1.3} castShadow shadow-mapSize={[1024, 1024]} />

      <Room />
      <Bench tilt={tilt} cues={cues} verdict={!!state.verdict} reduced={reduced} />
      <Figure who="AEGIS" x={-2.4} hp={state.hp.AEGIS} speaking={speaker === "AEGIS"} out={state.knockout === "AEGIS"} cues={cues} reduced={reduced} />
      <Figure who="NEMESIS" x={2.4} hp={state.hp.NEMESIS} speaking={speaker === "NEMESIS"} out={state.knockout === "NEMESIS"} cues={cues} reduced={reduced} />
      <ContactShadows position={[0, 0.012, 0]} scale={14} opacity={0.6} blur={2.2} far={4} resolution={512} />
      <Rail />
      {!reduced && <Sparkles count={70} scale={[12, 5, 9]} position={[0, 2.6, -0.5]} size={2.2} speed={0.25} opacity={0.5} color={C.gold} />}
      <Rig speaker={speaker} verdict={!!state.verdict} cues={cues} reduced={reduced} aberration={aberration} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.75} luminanceSmoothing={0.2} />
        <ChromaticAberration ref={aberration as never} offset={caOffset} radialModulation={false} modulationOffset={0} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}

function Room() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <MeshReflectorMaterial color={C.floor} roughness={0.9} metalness={0.4} mirror={0.4} mixStrength={2.2} blur={[400, 120]} resolution={512} mixBlur={1} depthScale={0.6} minDepthThreshold={0.4} maxDepthThreshold={1.2} />
      </mesh>
      {/* aisle carpet */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 1.5]}>
        <planeGeometry args={[1.6, 9]} />
        <meshStandardMaterial color="#2a1830" roughness={1} />
      </mesh>
      <mesh position={[0, 4, -5.5]}>
        <planeGeometry args={[30, 8]} />
        <meshStandardMaterial color={C.wall} roughness={0.9} />
      </mesh>
      {[-5, -3.2, 3.2, 5].map((x) => (
        <mesh key={x} position={[x, 2.5, -5.2]} castShadow>
          <cylinderGeometry args={[0.32, 0.38, 5, 8]} />
          <meshStandardMaterial color={C.wood} flatShading roughness={0.7} />
        </mesh>
      ))}
      {/* the court's seal: a glowing gold ring on the back wall */}
      <mesh position={[0, 3.75, -5.45]}>
        <torusGeometry args={[0.9, 0.06, 6, 40]} />
        <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.75, -5.47]}>
        <circleGeometry args={[0.84, 40]} />
        <meshStandardMaterial color="#151c34" />
      </mesh>
    </group>
  );
}

function Bench({ tilt, cues, verdict, reduced }: { tilt: number; cues: React.RefObject<Cues>; verdict: boolean; reduced: boolean }) {
  const beam = useRef<THREE.Group>(null);
  const panL = useRef<THREE.Group>(null);
  const panR = useRef<THREE.Group>(null);
  const gavel = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);

  useFrame((_, delta) => {
    if (!beam.current || !gavel.current || !glow.current) return;
    const k = reduced ? 1 : 1 - Math.exp(-delta * 4);
    beam.current.rotation.z += (tilt - beam.current.rotation.z) * k;
    // Pans hang straight down whatever the beam does.
    panL.current!.rotation.z = -beam.current.rotation.z;
    panR.current!.rotation.z = -beam.current.rotation.z;

    // Verdict: the gavel strikes twice, and the bench floods with gold.
    const t = since(cues.current.verdict);
    const strikes = 0.42;
    gavel.current.rotation.z = !reduced && t < strikes * 2 ? -1.1 * Math.sin((Math.PI * (t % strikes)) / strikes) : 0;
    glow.current.intensity = (verdict ? 5 : 0) + (t < 3 ? 60 * Math.exp(-t * 2.2) : 0);
  });

  return (
    <group position={[0, 0, -3.4]}>
      {/* dais and bench */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 0.5, 2.2]} />
        <meshStandardMaterial color={C.wood} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.15, 0.55]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 1.3, 0.7]} />
        <meshStandardMaterial color="#2d3860" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.83, 0.55]}>
        <boxGeometry args={[3.8, 0.08, 0.85]} />
        <meshStandardMaterial color={C.gold} metalness={0.6} roughness={0.35} />
      </mesh>

      {/* ARBITER, blindfolded */}
      <group position={[0, 0.5, -0.25]}>
        <mesh position={[0, 1.15, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.7, 1.9, 7]} />
          <meshStandardMaterial color={C.robe} flatShading roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.38, 0]} castShadow>
          <icosahedronGeometry args={[0.36, 0]} />
          <meshStandardMaterial color="#c9b8a3" flatShading roughness={0.8} />
        </mesh>
        <mesh position={[0, 2.43, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.36, 0.075, 4, 14]} />
          <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={0.6} flatShading />
        </mesh>
      </group>

      {/* the scales, tilting toward whoever is ahead */}
      <group position={[-1.05, 1.87, 0.6]}>
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.03, 0.05, 0.9, 6]} />
          <meshStandardMaterial color={C.gold} metalness={0.7} roughness={0.3} />
        </mesh>
        <group ref={beam} position={[0, 0.88, 0]}>
          <mesh rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, 1, 6]} />
            <meshStandardMaterial color={C.gold} metalness={0.7} roughness={0.3} />
          </mesh>
          {([-0.5, 0.5] as const).map((x, i) => (
            <group key={x} ref={i === 0 ? panL : panR} position={[x, 0, 0]}>
              <mesh position={[0, -0.18, 0]}>
                <cylinderGeometry args={[0.006, 0.006, 0.36, 4]} />
                <meshBasicMaterial color={C.gold} />
              </mesh>
              <mesh position={[0, -0.38, 0]} rotation-x={Math.PI}>
                <coneGeometry args={[0.17, 0.08, 10, 1, true]} />
                <meshStandardMaterial color={C.gold} metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
              </mesh>
            </group>
          ))}
        </group>
      </group>

      {/* gavel */}
      <group ref={gavel} position={[1.05, 1.9, 0.6]}>
        <mesh position={[0.22, 0.04, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.025, 0.025, 0.5, 6]} />
          <meshStandardMaterial color="#6b4a2e" />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.26, 8]} />
          <meshStandardMaterial color="#4a3020" flatShading />
        </mesh>
      </group>
      <pointLight ref={glow} position={[0, 3.4, 1.4]} color={C.gold} intensity={0} distance={9} />
    </group>
  );
}

const SPARKS = 14;

function Figure({
  who,
  x,
  hp,
  speaking,
  out,
  cues,
  reduced,
}: {
  who: Lawyer;
  x: number;
  hp: number;
  speaking: boolean;
  out: boolean;
  cues: React.RefObject<Cues>;
  reduced: boolean;
}) {
  const color = who === "AEGIS" ? C.aegis : C.nemesis;
  const body = useRef<THREE.Group>(null);
  const skin = useRef<THREE.MeshStandardMaterial>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const shaft = useRef<THREE.MeshBasicMaterial>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const fade = useMemo(() => shaftTexture(), []);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const velocities = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => {
        const a = (i / SPARKS) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * (1 + (i % 3) * 0.5), 2 + (i % 4) * 0.7, Math.sin(a) * 1.2);
      }),
    [],
  );
  const facing = who === "AEGIS" ? 0.45 : -0.45;

  useFrame((state, delta) => {
    if (!body.current || !skin.current || !spot.current || !sparks.current) return;
    const k = reduced ? 1 : 1 - Math.exp(-delta * 5);
    const t = state.clock.elapsedTime;
    const hit = since(cues.current.hit[who]);

    // Knocked out: topple backwards. Otherwise stand, with a little life while speaking.
    const fall = out ? -1.35 : 0;
    body.current.rotation.x += (fall - body.current.rotation.x) * k;
    const bob = speaking && !reduced ? Math.sin(t * 6) * 0.04 : 0;
    const shake = hit < 0.45 && !reduced ? Math.sin(hit * 70) * 0.09 * (1 - hit / 0.45) : 0;
    body.current.position.set(shake, bob, 0);

    skin.current.emissiveIntensity = 0.35 + (speaking ? 0.5 : 0) + (hit < 0.6 ? 3 * (1 - hit / 0.6) : 0);
    spot.current.intensity += ((speaking ? 90 : 10) - spot.current.intensity) * k;
    if (shaft.current) shaft.current.opacity += ((speaking ? 0.2 : 0.035) - shaft.current.opacity) * k;

    // Sparks burst out of the figure when it loses points.
    const st = hit;
    for (let i = 0; i < SPARKS; i++) {
      if (st < 0.9 && !reduced) {
        const v = velocities[i];
        dummy.position.set(v.x * st * 0.9, 1.9 + v.y * st - 4.5 * st * st, v.z * st * 0.9);
        dummy.scale.setScalar(0.07 * (1 - st / 0.9));
        dummy.rotation.set(st * 9 + i, st * 7, 0);
      } else dummy.scale.setScalar(0);
      dummy.updateMatrix();
      sparks.current.setMatrixAt(i, dummy.matrix);
    }
    sparks.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[x, 0, 0.6]} rotation-y={facing}>
      {/* a stage spotlight from above, with a visible shaft of light */}
      <primitive object={target} position={[0, 1, 0]} />
      <spotLight ref={spot} position={[0, 5.4, 0.4]} target={target} color={color} intensity={10} angle={0.42} penumbra={0.7} distance={10} castShadow />
      <mesh position={[0, 2.75, 0.2]}>
        <cylinderGeometry args={[0.12, 1.25, 5.3, 32, 1, true]} />
        <meshBasicMaterial ref={shaft} color={color} alphaMap={fade} transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* podium with the HP meter on its front */}
      <mesh position={[0, 0.55, 0.75]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 1.1, 0.6]} />
        <meshStandardMaterial color={C.wood} roughness={0.7} />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const on = i < hp;
        return (
          <mesh key={i} position={[-0.585 + i * 0.13, 0.75, 1.06]}>
            <boxGeometry args={[0.1, 0.16, 0.02]} />
            <meshStandardMaterial
              color={on ? color : "#1c2238"}
              emissive={on ? color : "#000000"}
              emissiveIntensity={on ? 2.4 : 0}
              toneMapped={!on}
            />
          </mesh>
        );
      })}

      <group ref={body}>
        {who === "AEGIS" ? (
          <>
            <mesh position={[0, 0.95, 0]} castShadow>
              <cylinderGeometry args={[0.32, 0.5, 1.9, 6]} />
              <meshStandardMaterial ref={skin} color={color} emissive={color} emissiveIntensity={0.35} flatShading roughness={0.5} />
            </mesh>
            <mesh position={[0, 2.2, 0]} castShadow>
              <icosahedronGeometry args={[0.3, 0]} />
              <meshStandardMaterial color="#dfe6ff" flatShading />
            </mesh>
            {/* shield */}
            <group position={[0.55, 1.25, 0.25]} rotation-y={-0.4}>
              <mesh rotation-x={Math.PI / 2} castShadow>
                <cylinderGeometry args={[0.42, 0.42, 0.08, 6]} />
                <meshStandardMaterial color="#20335e" metalness={0.5} roughness={0.4} flatShading />
              </mesh>
              <mesh position={[0, 0, 0.05]}>
                <torusGeometry args={[0.36, 0.035, 4, 6]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} />
              </mesh>
            </group>
          </>
        ) : (
          <>
            <mesh position={[0, 0.95, 0]} castShadow>
              <cylinderGeometry args={[0.46, 0.24, 1.9, 4]} />
              <meshStandardMaterial ref={skin} color={color} emissive={color} emissiveIntensity={0.35} flatShading roughness={0.5} />
            </mesh>
            <mesh position={[0, 2.22, 0]} castShadow>
              <octahedronGeometry args={[0.32, 0]} />
              <meshStandardMaterial color="#ffd9d9" flatShading />
            </mesh>
            {([-1, 1] as const).map((s) => (
              <mesh key={s} position={[0.5 * s, 1.85, 0]} rotation-z={-0.6 * s}>
                <tetrahedronGeometry args={[0.2, 0]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} flatShading toneMapped={false} />
              </mesh>
            ))}
          </>
        )}
      </group>

      <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <tetrahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={who === "AEGIS" ? "#ffd27a" : "#ffb0b0"} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** Fades a light shaft from bright at the lamp to nothing at the floor. */
function shaftTexture() {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 64);
  return new THREE.CanvasTexture(c);
}

/** The bar: a dark rail close to the camera that frames the wide shot and gives it a foreground. */
function Rail() {
  return (
    <group position={[0, 0, 4.6]}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[14, 0.14, 0.18]} />
        <meshStandardMaterial color="#0a0d1a" roughness={0.6} />
      </mesh>
      {Array.from({ length: 29 }, (_, i) => (
        <mesh key={i} position={[-7 + i * 0.5, 0.5, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 1, 6]} />
          <meshStandardMaterial color="#0a0d1a" />
        </mesh>
      ))}
    </group>
  );
}

type Shot = "wide" | "AEGIS" | "NEMESIS" | "judge";
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Camera position, where it looks, and the direction it creeps while the shot holds. */
const SHOTS: Record<Shot, { pos: THREE.Vector3; look: THREE.Vector3; creep: THREE.Vector3 }> = {
  wide: { pos: v(0, 3.6, 8.5), look: v(0, 1.5, -1), creep: v(0, -0.02, -0.12) },
  AEGIS: { pos: v(1.1, 2.9, 6.8), look: v(-1.7, 1.45, 0.2), creep: v(-0.04, -0.01, -0.07) },
  NEMESIS: { pos: v(-1.1, 2.9, 6.8), look: v(1.7, 1.45, 0.2), creep: v(0.04, -0.01, -0.07) },
  judge: { pos: v(0, 2.7, 1.6), look: v(0, 2.45, -3.6), creep: v(0, 0.01, -0.05) },
};

/**
 * The director. Cuts like a televised trial: a close-up on the speaker, then the wide shot, then
 * the judge listening; a cut to whoever just lost points; the judge for the verdict. Within a shot
 * the camera creeps forward. An objection shakes the frame and a hit splits its colours.
 */
function Rig({
  speaker,
  verdict,
  cues,
  reduced,
  aberration,
}: {
  speaker?: Lawyer;
  verdict: boolean;
  cues: React.RefObject<Cues>;
  reduced: boolean;
  aberration: React.RefObject<{ offset: THREE.Vector2 } | null>;
}) {
  const last = useRef<{ speaker?: Lawyer; since: number; shot?: Shot; shotAt: number }>({ since: 0, shotAt: 0 });

  useFrame((state) => {
    const t = now();
    const l = last.current;
    if (l.speaker !== speaker) {
      l.speaker = speaker;
      l.since = t;
    }
    const c = cues.current;
    const hitBy = (["AEGIS", "NEMESIS"] as const).find((w) => since(c.hit[w]) < 1.6);
    let shot: Shot;
    if (verdict) shot = "judge";
    else if (hitBy) shot = hitBy;
    else if (since(c.objection) < 1.4) shot = "wide";
    else if (!speaker) shot = "wide";
    else {
      const phase = (t - l.since) % 14;
      shot = phase < 7 ? speaker : phase < 11 ? "wide" : "judge";
    }
    if (shot !== l.shot) {
      l.shot = shot;
      l.shotAt = t;
    }

    const s = SHOTS[shot];
    const held = reduced ? 0 : Math.min(t - l.shotAt, 12);
    state.camera.position.copy(s.pos).addScaledVector(s.creep, held);

    const o = since(c.objection);
    if (o < 0.55 && !reduced) {
      const a = 0.14 * (1 - o / 0.55);
      state.camera.position.x += Math.sin(o * 90) * a;
      state.camera.position.y += Math.cos(o * 75) * a;
    }
    state.camera.lookAt(s.look);

    if (aberration.current) {
      const h = Math.min(since(c.hit.AEGIS), since(c.hit.NEMESIS), o);
      const k = reduced || h > 0.5 ? 0 : 0.012 * (1 - h / 0.5);
      aberration.current.offset.set(k, k * 0.6);
    }
  });
  return null;
}
