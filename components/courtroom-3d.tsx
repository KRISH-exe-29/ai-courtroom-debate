"use client";

import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
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

  return (
    <Canvas shadows="percentage" dpr={[1, 1.75]} camera={{ position: [0, 3.4, 8], fov: 42 }} gl={{ antialias: false }}>
      <color attach="background" args={[C.night]} />
      <fog attach="fog" args={[C.night, 11, 22]} />
      <hemisphereLight args={["#8fa6ff", "#0c1020", 0.8]} />
      <directionalLight position={[3, 7, 6]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />

      <Room />
      <Bench tilt={tilt} cues={cues} verdict={!!state.verdict} reduced={reduced} />
      <Figure who="AEGIS" x={-2.4} hp={state.hp.AEGIS} speaking={speaker === "AEGIS"} out={state.knockout === "AEGIS"} cues={cues} reduced={reduced} />
      <Figure who="NEMESIS" x={2.4} hp={state.hp.NEMESIS} speaking={speaker === "NEMESIS"} out={state.knockout === "NEMESIS"} cues={cues} reduced={reduced} />
      <ContactShadows position={[0, 0.01, 0]} scale={14} opacity={0.55} blur={2.2} far={4} resolution={512} />
      <Rig speaker={speaker} verdict={!!state.verdict} cues={cues} reduced={reduced} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.75} luminanceSmoothing={0.2} />
        <Vignette offset={0.3} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}

function Room() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color={C.floor} roughness={0.85} />
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
      <mesh position={[0, 4.4, -5.45]}>
        <torusGeometry args={[0.9, 0.06, 6, 40]} />
        <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 4.4, -5.47]}>
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
  const spot = useRef<THREE.PointLight>(null);
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
    spot.current.intensity += ((speaking ? 26 : 4) - spot.current.intensity) * k;

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
      <pointLight ref={spot} position={[0, 4, 1.2]} color={color} intensity={4} distance={7} />

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

/** The camera: leans toward whoever is speaking, shakes on an objection, moves in for the verdict. */
function Rig({ speaker, verdict, cues, reduced }: { speaker?: Lawyer; verdict: boolean; cues: React.RefObject<Cues>; reduced: boolean }) {
  const look = useMemo(() => new THREE.Vector3(0, 1.5, -1), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const lookGoal = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const lean = speaker === "AEGIS" ? -1 : speaker === "NEMESIS" ? 1 : 0;
    if (verdict) {
      goal.set(0, 3.3, 5.6);
      lookGoal.set(0, 2, -3.4);
    } else {
      goal.set(lean * 1.1, 3.4, 8 - Math.abs(lean) * 0.6);
      lookGoal.set(lean * 1.4, 1.5, -1);
    }
    const k = reduced ? 1 : 1 - Math.exp(-delta * 1.6);
    state.camera.position.lerp(goal, k);
    look.lerp(lookGoal, k);

    const o = since(cues.current.objection);
    if (o < 0.5 && !reduced) {
      const a = 0.12 * (1 - o / 0.5);
      state.camera.position.x += Math.sin(o * 90) * a;
      state.camera.position.y += Math.cos(o * 75) * a;
    }
    state.camera.lookAt(look);
  });
  return null;
}
