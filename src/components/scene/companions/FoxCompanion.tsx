import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LEFT_PREVIEW_COMPANION_ANCHOR, type CompanionProps, usePokeEnvelope } from './shared';

useGLTF.preload('/models/Fox.glb');

export default function FoxCompanion({ pokeNonce }: CompanionProps) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF('/models/Fox.glb');
  const cloned = useMemo(() => cloneSkeleton(scene) as THREE.Group, [scene]);
  const { actions } = useAnimations(animations, group);
  const poke = usePokeEnvelope(pokeNonce);

  useEffect(() => {
    const idle = actions.Survey || actions.Walk || Object.values(actions)[0];
    idle?.reset().fadeIn(0.4).play();
    return () => { idle?.fadeOut(0.25); };
  }, [actions]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    poke.current = Math.max(0, poke.current - dt / 0.5);
    const t = state.clock.getElapsedTime();
    const hop = poke.current > 0 ? Math.sin((1 - poke.current) * Math.PI) * 0.6 : 0;
    g.position.set(LEFT_PREVIEW_COMPANION_ANCHOR.x, LEFT_PREVIEW_COMPANION_ANCHOR.y - 0.08 + Math.sin(t * 1.4) * 0.025 + hop * 0.36, LEFT_PREVIEW_COMPANION_ANCHOR.z);
    g.rotation.y = -0.38 + Math.sin(t * 0.5) * 0.12 + poke.current * 0.38;
  });

  return (
    <group ref={group} scale={0.0052} dispose={null}>
      <primitive object={cloned} />
    </group>
  );
}
