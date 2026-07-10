import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { LEFT_PREVIEW_COMPANION_ANCHOR, type CompanionProps, usePokeEnvelope } from './shared';

useGLTF.preload('/models/Seagull.glb');

export default function SeagullCompanion({ pokeNonce }: CompanionProps) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF('/models/Seagull.glb');
  const model = useMemo(() => scene.clone(true) as THREE.Group, [scene]);
  const parts = useMemo(() => ({
    leftWing: model.getObjectByName('LeftWing') as THREE.Group | null,
    rightWing: model.getObjectByName('RightWing') as THREE.Group | null,
    head: model.getObjectByName('Head') as THREE.Group | null,
  }), [model]);
  const poke = usePokeEnvelope(pokeNonce);

  useFrame((state, dt) => {
    const root = group.current;
    if (!root) return;
    poke.current = Math.max(0, poke.current - dt / 0.5);
    const t = state.clock.getElapsedTime();
    const flap = Math.sin(t * 2.7) * 0.2 + poke.current * 0.42;

    if (parts.leftWing) {
      parts.leftWing.rotation.z = 0.1 + flap;
      parts.leftWing.rotation.y = 0.1 + Math.sin(t * 1.25) * 0.04;
    }
    if (parts.rightWing) {
      parts.rightWing.rotation.z = -0.1 - flap;
      parts.rightWing.rotation.y = -0.1 - Math.sin(t * 1.25) * 0.04;
    }
    if (parts.head) parts.head.rotation.x = Math.sin(t * 1.45) * 0.035 + poke.current * 0.12;

    const hop = poke.current > 0 ? Math.sin((1 - poke.current) * Math.PI) * 0.32 : 0;
    root.position.set(LEFT_PREVIEW_COMPANION_ANCHOR.x, LEFT_PREVIEW_COMPANION_ANCHOR.y + 0.18 + Math.sin(t * 0.95) * 0.07 + hop * 0.58, LEFT_PREVIEW_COMPANION_ANCHOR.z);
    root.rotation.y = 0.18 + Math.sin(t * 0.32) * 0.08;
    root.rotation.z = Math.sin(t * 0.62) * 0.025;
  });

  return (
    <group ref={group} scale={0.58} dispose={null}>
      <primitive object={model} />
    </group>
  );
}
