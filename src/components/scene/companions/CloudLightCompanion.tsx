import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { LEFT_PREVIEW_COMPANION_ANCHOR, type CompanionProps, usePokeEnvelope } from './shared';

const PUFFS = [
  { position: [0, -0.1, 0] as [number, number, number], scale: [0.7, 0.24, 0.28] as [number, number, number], color: '#f8fcff' },
  { position: [-0.38, -0.08, 0.04] as [number, number, number], scale: [0.34, 0.23, 0.25] as [number, number, number], color: '#f4faff' },
  { position: [0.38, -0.08, 0.03] as [number, number, number], scale: [0.32, 0.22, 0.24] as [number, number, number], color: '#eef7ff' },
  { position: [0.05, 0.1, 0.04] as [number, number, number], scale: [0.36, 0.28, 0.28] as [number, number, number], color: '#ffffff' },
  { position: [-0.16, 0.03, 0.12] as [number, number, number], scale: [0.28, 0.22, 0.2] as [number, number, number], color: '#f9fdff' },
];

const PEARLS = [
  { position: [-0.58, -0.28, 0.16] as [number, number, number], size: 0.032 },
  { position: [-0.28, -0.34, 0.2] as [number, number, number], size: 0.026 },
  { position: [0.08, -0.32, 0.22] as [number, number, number], size: 0.03 },
  { position: [0.46, -0.27, 0.17] as [number, number, number], size: 0.024 },
];

export default function CloudLightCompanion({ pokeNonce }: CompanionProps) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const orbit = useRef<THREE.Group>(null);
  const poke = usePokeEnvelope(pokeNonce);

  const glowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 248, 205, 0.95)');
    gradient.addColorStop(0.28, 'rgba(255, 229, 157, 0.42)');
    gradient.addColorStop(0.68, 'rgba(202, 226, 255, 0.14)');
    gradient.addColorStop(1, 'rgba(202, 226, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  const orbitCurves = useMemo(() => [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.66, -0.05, 0.22),
      new THREE.Vector3(-0.25, 0.2, 0.32),
      new THREE.Vector3(0.24, 0.18, 0.34),
      new THREE.Vector3(0.68, -0.06, 0.24),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.5, -0.24, 0.26),
      new THREE.Vector3(-0.08, -0.14, 0.36),
      new THREE.Vector3(0.34, -0.16, 0.34),
      new THREE.Vector3(0.58, -0.3, 0.24),
    ]),
  ], []);

  useFrame((state, dt) => {
    const companion = group.current;
    if (!companion) return;
    poke.current = Math.max(0, poke.current - dt / 0.5);
    const t = state.clock.getElapsedTime();
    const breathe = 1 + Math.sin(t * 0.95) * 0.025 + poke.current * 0.14;

    companion.position.set(LEFT_PREVIEW_COMPANION_ANCHOR.x, LEFT_PREVIEW_COMPANION_ANCHOR.y + 0.16 + Math.sin(t * 0.72) * 0.055 + poke.current * 0.13, LEFT_PREVIEW_COMPANION_ANCHOR.z);
    companion.scale.setScalar(0.64 * breathe);
    companion.rotation.y = -0.2 + Math.sin(t * 0.32) * 0.08;
    companion.rotation.z = Math.sin(t * 0.45) * 0.025;

    if (core.current) {
      const mat = core.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.22 + Math.sin(t * 1.35) * 0.18 + poke.current * 1.1;
    }
    if (halo.current) {
      const mat = halo.current.material as THREE.SpriteMaterial;
      mat.opacity = 0.34 + Math.sin(t * 1.1) * 0.035 + poke.current * 0.16;
    }
    if (orbit.current) {
      orbit.current.rotation.z = Math.sin(t * 0.38) * 0.045 + poke.current * 0.18;
      orbit.current.rotation.y = Math.sin(t * 0.26) * 0.08;
    }
  });

  return (
    <group ref={group} dispose={null}>
      <sprite ref={halo} position={[0, 0.02, 0.06]} scale={[1.85, 1.85, 1]}>
        <spriteMaterial map={glowTexture} transparent opacity={0.36} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      <group rotation={[0.06, -0.12, 0]}>
        {PUFFS.map((puff, index) => (
          <mesh key={index} position={puff.position} scale={puff.scale}>
            <sphereGeometry args={[1, 40, 22]} />
            <meshStandardMaterial color={puff.color} emissive="#dcecff" emissiveIntensity={0.08} transparent opacity={0.88} roughness={0.74} />
          </mesh>
        ))}
      </group>

      <mesh ref={core} position={[0.02, -0.02, 0.34]} scale={[1, 1, 0.86]}>
        <sphereGeometry args={[0.18, 36, 24]} />
        <meshStandardMaterial color="#fff4c8" emissive="#ffe19a" emissiveIntensity={1.25} roughness={0.28} transparent opacity={0.96} />
      </mesh>

      <mesh position={[0.02, -0.02, 0.38]} rotation={[0.08, 0.16, 0.02]}>
        <torusGeometry args={[0.27, 0.006, 12, 96]} />
        <meshBasicMaterial color="#fff0b7" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <group ref={orbit}>
        {orbitCurves.map((curve, index) => (
          <mesh key={index}>
            <tubeGeometry args={[curve, 48, index === 0 ? 0.006 : 0.0045, 8, false]} />
            <meshBasicMaterial color={index === 0 ? '#ffe9a8' : '#dceeff'} transparent opacity={index === 0 ? 0.48 : 0.36} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {PEARLS.map((pearl, index) => (
        <mesh key={index} position={pearl.position}>
          <sphereGeometry args={[pearl.size, 18, 12]} />
          <meshStandardMaterial color="#fff5ca" emissive="#ffe39a" emissiveIntensity={0.8} roughness={0.2} />
        </mesh>
      ))}

      <pointLight color="#ffe7a3" intensity={0.9} distance={2.4} position={[0.02, -0.02, 0.5]} />
      <Sparkles count={18} scale={[1.3, 0.86, 1.15]} size={1.55} speed={0.16} color="#fff0bd" opacity={0.58} />
    </group>
  );
}
