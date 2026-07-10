import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LEFT_PREVIEW_COMPANION_ANCHOR, type CompanionProps, usePokeEnvelope } from './shared';

const makePageGeometry = (side: -1 | 1) => {
  const width = 0.56;
  const height = 0.48;
  const cols = 10;
  const rows = 5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols;
      const x = side * u * width;
      const y = (v - 0.5) * height;
      const z = Math.sin(u * Math.PI) * 0.045 + u * 0.018;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * (cols + 1) + col;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

function PageLines({ side, color }: { side: -1 | 1; color: string }) {
  const lines = [-0.13, -0.045, 0.04, 0.125];
  return (
    <>
      {lines.map((y, index) => (
        <mesh key={y} position={[side * (0.28 + index * 0.008), y, 0.068]} rotation={[0, side * 0.1, 0]} scale={[0.31 - index * 0.025, 0.005, 1]}>
          <boxGeometry args={[1, 1, 0.006]} />
          <meshStandardMaterial color={color} roughness={0.92} transparent opacity={0.72} />
        </mesh>
      ))}
    </>
  );
}

export default function BookCompanion({ pokeNonce }: CompanionProps) {
  const group = useRef<THREE.Group>(null);
  const leftPage = useRef<THREE.Group>(null);
  const rightPage = useRef<THREE.Group>(null);
  const poke = usePokeEnvelope(pokeNonce);
  const leftPageGeometry = useMemo(() => makePageGeometry(1), []);
  const rightPageGeometry = useMemo(() => makePageGeometry(-1), []);
  const leftCoverGeometry = useMemo(() => makePageGeometry(1), []);
  const rightCoverGeometry = useMemo(() => makePageGeometry(-1), []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    poke.current = Math.max(0, poke.current - dt / 0.5);
    const t = state.clock.getElapsedTime();
    const flutter = Math.sin(t * 1.55) * 0.075 + poke.current * 0.38;
    if (leftPage.current) leftPage.current.rotation.y = 0.56 + flutter;
    if (rightPage.current) rightPage.current.rotation.y = -0.56 - flutter;
    g.position.set(LEFT_PREVIEW_COMPANION_ANCHOR.x, LEFT_PREVIEW_COMPANION_ANCHOR.y + 0.04 + Math.sin(t * 1.05) * 0.055, LEFT_PREVIEW_COMPANION_ANCHOR.z);
    g.rotation.y = Math.sin(t * 0.38) * 0.24;
    g.rotation.z = Math.sin(t * 0.68) * 0.04;
  });

  return (
    <group ref={group} scale={0.96}>
      <mesh position={[0, -0.3, -0.03]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.74, 0.2, 1]}>
        <circleGeometry args={[1, 36]} />
        <meshBasicMaterial color="#6b5644" transparent opacity={0.13} depthWrite={false} />
      </mesh>

      <group position={[0, -0.015, -0.018]}>
        <mesh rotation={[0, 0, -0.018]}>
          <primitive attach="geometry" object={leftCoverGeometry} />
          <meshStandardMaterial color="#b78366" side={THREE.DoubleSide} roughness={0.82} />
        </mesh>
        <mesh rotation={[0, 0, 0.018]}>
          <primitive attach="geometry" object={rightCoverGeometry} />
          <meshStandardMaterial color="#9d664f" side={THREE.DoubleSide} roughness={0.84} />
        </mesh>
      </group>

      <mesh position={[0, -0.01, 0.02]} scale={[0.045, 0.54, 0.08]}>
        <capsuleGeometry args={[0.5, 0.2, 6, 12]} />
        <meshStandardMaterial color="#8b5b49" roughness={0.78} />
      </mesh>

      <group ref={leftPage} position={[0.018, 0.01, 0.018]}>
        <mesh>
          <primitive attach="geometry" object={leftPageGeometry} />
          <meshStandardMaterial color="#fff6e7" side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
        <PageLines side={1} color="#d8bea0" />
      </group>

      <group ref={rightPage} position={[-0.018, 0.01, 0.018]}>
        <mesh>
          <primitive attach="geometry" object={rightPageGeometry} />
          <meshStandardMaterial color="#fff9ec" side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
        <PageLines side={-1} color="#d8bea0" />
      </group>

      <mesh position={[0, 0.245, 0.05]} scale={[0.06, 0.018, 0.018]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#ead4aa" emissive="#d5a85e" emissiveIntensity={0.15} roughness={0.65} />
      </mesh>
    </group>
  );
}
