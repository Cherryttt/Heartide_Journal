import { Suspense, type CSSProperties, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, DepthOfField, HueSaturation } from '@react-three/postprocessing';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import * as THREE from 'three';
import { useStore } from '../store';
import { getApproximateWeather, getMe, getReadingRecommendations } from '../api';
import { APP_NAME } from '../brand';
import { topRecommendation } from '../data/readingFeed';
import type { FeedItem } from '../data/readingFeed';
import type { TodayMood } from '../types';
import SceneBackground from '../components/scene/SceneBackground';
import SceneCompanion from '../components/scene/companions/SceneCompanion';
import {
  type SceneBase,
  type TimeOfDay,
  type WeatherKind as SceneWeatherKind,
  isLightScene,
} from '../components/scene/sceneAssets';

// ============================================================
// 3D 场景组件
// ============================================================

// 日落天空渐变
type SceneVariant = '森林' | '烟花' | '草坪' | '海洋' | '雨窗' | '星空' | '落日' | '云海';
type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog';

// sky = [天顶, 高空, 近地, 地平线] —— 自上而下,顶部偏冷、地平线暖,营造治愈系晨昏氛围。
// fog 取地平线附近的雾色,让远处物体柔和地融进薄雾里(纵深感)。
const SCENE_PALETTES: Record<SceneVariant, { sky: string[]; ground: number; fog: number; water: number; sparkle: string; sun: string; key: number }> = {
  森林: { sky: ['#a8cfe8', '#c6dde4', '#e6ead7', '#f8eccf'], ground: 0x86ab63, fog: 0xdde7d6, water: 0x6aa0c0, sparkle: '#fff2ba', sun: '#fff3d6', key: 0xffe9c4 },
  烟花: { sky: ['#101730', '#202a4e', '#3a3c64', '#5d5079'], ground: 0x2a3a30, fog: 0x222d4e, water: 0x243861, sparkle: '#ffd6a8', sun: '#ffd6a8', key: 0x8fa0d6 },
  草坪: { sky: ['#9ccdf2', '#c2e0ec', '#e8eed5', '#faecc5'], ground: 0x95c06d, fog: 0xe4ebd2, water: 0x6aa0c0, sparkle: '#fff2ba', sun: '#fff3cf', key: 0xfff0c8 },
  海洋: { sky: ['#aedcf0', '#bfe0ea', '#d8e7dd', '#f2e8cc'], ground: 0x4f7e6a, fog: 0xcfe3e2, water: 0x4f9fd2, sparkle: '#eaf7ff', sun: '#fff1d0', key: 0xfff0d0 },
  雨窗: { sky: ['#9fb2bf', '#90a2af', '#7c8e9b', '#6c7e8b'], ground: 0x4a5a52, fog: 0x8595a0, water: 0x5a7486, sparkle: '#d9e7ee', sun: '#e8eef0', key: 0xc4d2da },
  星空: { sky: ['#0e1736', '#1c2750', '#33406e', '#52527f'], ground: 0x1a2a3a, fog: 0x1d2848, water: 0x213a64, sparkle: '#d8e6ff', sun: '#dfeaff', key: 0x9fb4e0 },
  落日: { sky: ['#54618f', '#a86f96', '#ef9d8f', '#ffd79b'], ground: 0x6a5a6a, fog: 0xf0b389, water: 0x5a76a8, sparkle: '#ffe2b4', sun: '#ffd49a', key: 0xffc488 },
  云海: { sky: ['#6fa9e2', '#9ec8ee', '#cfe2f1', '#fde6c8'], ground: 0xc4d0e8, fog: 0xdce7f3, water: 0x9fb6d8, sparkle: '#fff4d6', sun: '#fff1cc', key: 0xfff0d6 },
};

function SkyGradient({ variant, weatherKind, dusk = false, night = false }: { variant: SceneVariant; weatherKind: WeatherKind; dusk?: boolean; night?: boolean }) {
  const { scene } = useThree();
  useMemo(() => {
    // 夜:任何基底都换上星空天幕(暗蓝)
    const palette = SCENE_PALETTES[night ? '星空' : variant];
    const c = document.createElement('canvas');
    c.width = 8; c.height = 512;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, palette.sky[0]);
    g.addColorStop(0.36, palette.sky[1]);
    g.addColorStop(0.72, palette.sky[2]);
    g.addColorStop(1, palette.sky[3]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 512);
    const weatherOverlay: Partial<Record<WeatherKind, string>> = {
      cloudy: 'rgba(185, 198, 205, .2)',
      overcast: 'rgba(105, 123, 136, .42)',
      rain: 'rgba(70, 94, 112, .42)',
      storm: 'rgba(38, 52, 70, .58)',
      snow: 'rgba(226, 238, 244, .22)',
      fog: 'rgba(210, 220, 218, .42)',
    };
    if (weatherOverlay[weatherKind]) {
      ctx.fillStyle = weatherOverlay[weatherKind]!;
      ctx.fillRect(0, 0, 8, 512);
    }
    // 黄昏暖调:任何场景都能罩上一层夕照(紫→玫瑰→暖橙);夜晚不叠暖调
    if (dusk && !night) {
      const wg = ctx.createLinearGradient(0, 0, 0, 512);
      wg.addColorStop(0, 'rgba(74, 56, 100, 0.42)');
      wg.addColorStop(0.46, 'rgba(206, 120, 122, 0.34)');
      wg.addColorStop(0.78, 'rgba(244, 150, 96, 0.42)');
      wg.addColorStop(1, 'rgba(255, 188, 108, 0.52)');
      ctx.fillStyle = wg;
      ctx.fillRect(0, 0, 8, 512);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    const density = weatherKind === 'fog' ? 0.03 : weatherKind === 'storm' ? 0.017 : weatherKind === 'rain' || weatherKind === 'overcast' ? 0.012 : 0.0088;
    scene.fog = new THREE.FogExp2(night ? SCENE_PALETTES['星空'].fog : dusk ? 0xe6a878 : palette.fog, density);
  }, [scene, variant, weatherKind, dusk, night]);
  return null;
}

// 太阳
function Sun({ color = '#ffe3a8', glow = '#ffd9a0' }: { color?: string; glow?: string }) {
  const sunRef = useRef<THREE.Mesh>(null);
  const glowTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, '#fff8e8');
    g.addColorStop(0.26, glow + 'b4');
    g.addColorStop(0.62, glow + '44');
    g.addColorStop(1, glow + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, [glow]);

  return (
    <group>
      <mesh ref={sunRef} position={[-2, 4.6, -72]}>
        <circleGeometry args={[3.6, 48]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <sprite position={[-2, 4.6, -72]} scale={[22, 22, 1]}>
        <spriteMaterial map={glowTex} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
    </group>
  );
}

// 低多边形海水
function Ocean({ variant }: { variant: SceneVariant }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const uT = useRef({ value: 0 });

  const waterMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: SCENE_PALETTES[variant].water,
      metalness: 0.18,
      roughness: 0.46,
      emissive: 0x0a2238,
      emissiveIntensity: 0.3,
    });
    // 平滑着色:顶点位移做波浪,并解析地算出法线 → 圆润起伏而非硬棱面
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uT = uT.current;
      shader.vertexShader =
        'uniform float uT;\n' +
        shader.vertexShader
          .replace('#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
             float dX = 0.5 * cos(position.x * 0.5 + uT * 1.1) * 0.16
                      + 0.4 * cos((position.x + position.y) * 0.4 + uT * 0.8) * 0.10;
             float dY = 0.62 * cos(position.y * 0.62 + uT * 1.5) * 0.12
                      + 0.4 * cos((position.x + position.y) * 0.4 + uT * 0.8) * 0.10;
             objectNormal = normalize(vec3(-dX, -dY, 1.0));`)
          .replace('#include <begin_vertex>',
            `#include <begin_vertex>
             float w = sin(position.x * 0.5 + uT * 1.1) * 0.16
                     + sin(position.y * 0.62 + uT * 1.5) * 0.12
                     + sin((position.x + position.y) * 0.4 + uT * 0.8) * 0.10;
             transformed.z += w;`);
    };
    return mat;
  }, [variant]);

  useFrame(({ clock }) => {
    uT.current.value = clock.getElapsedTime();
  });

  return (
    <mesh ref={meshRef} material={waterMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[200, 200, 90, 90]} />
    </mesh>
  );
}

// 低多边形岛屿 / 礁石
function Islands() {
  const islands = useMemo(() => [
    { x: -26, z: -58, s: 7,  c: 0x5d6a82 },
    { x: 24, z: -66, s: 9,  c: 0x515d76 },
    { x: 40, z: -54, s: 5,  c: 0x66728a },
    { x: -18, z: -38, s: 3.5, c: 0x6a7a88 },
    { x: 32, z: -42, s: 4,  c: 0x5a6a78 },
  ], []);

  return (
    <group>
      {islands.map((isl, i) => (
        <mesh
          key={i}
          position={[isl.x, 0.2 + isl.s * 0.05, isl.z]}
          rotation={[0, Math.random() * 3, 0]}
        >
          <coneGeometry args={[isl.s, isl.s * 0.62, 10]} />
          <meshStandardMaterial color={isl.c} roughness={0.92} />
        </mesh>
      ))}
    </group>
  );
}

// 海鸥
function Seagulls() {
  const gullTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 72; c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#3f3a48';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(6, 22);
    ctx.quadraticCurveTo(20, 6, 36, 20);
    ctx.quadraticCurveTo(52, 6, 66, 22);
    ctx.stroke();
    return new THREE.CanvasTexture(c);
  }, []);

  const gulls = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 4; i++) {
      arr.push({
        x: -20 + Math.random() * 40,
        y: 8 + Math.random() * 4,
        z: -30 - Math.random() * 10,
        speed: 0.5 + Math.random() * 0.6,
        scale: 0.7 + Math.random() * 0.6,
      });
    }
    return arr;
  }, []);

  const groupRef = useRef<(THREE.Sprite | null)[]>([]);

  useFrame(() => {
    groupRef.current.forEach((g, i) => {
      if (!g) return;
      g.position.x += gulls[i].speed * 0.02;
      if (g.position.x > 30) g.position.x = -30;
    });
  });

  return (
    <group>
      {gulls.map((g, i) => (
        <sprite
          key={i}
          ref={(el) => { groupRef.current[i] = el; }}
          position={[g.x, g.y, g.z]}
          scale={[g.scale * 3.5, g.scale * 1.6, 1]}
        >
          <spriteMaterial map={gullTex} transparent opacity={0.7} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ============================================================
// 低多边形 3D 小鹿
// ============================================================
function Deer() {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftEarRef = useRef<THREE.Mesh>(null);
  const rightEarRef = useRef<THREE.Mesh>(null);
  const tailRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const flLeg = useRef<THREE.Group>(null);
  const frLeg = useRef<THREE.Group>(null);
  const blLeg = useRef<THREE.Group>(null);
  const brLeg = useRef<THREE.Group>(null);
  const facing = useRef(-Math.PI / 2);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const grp = groupRef.current;
    if (!grp) return;

    // —— 沿岸边来回漫步 ——
    const range = 3.0;
    const vel = Math.cos(t * 0.16);              // 行进方向(速度)
    grp.position.x = -0.4 + Math.sin(t * 0.16) * range;
    grp.position.z = 2.4 + Math.cos(t * 0.16) * 0.3;

    // 平滑转身,朝向行进方向(头朝 +z,故 +x 行进时转 -90°)
    const target = vel >= 0 ? -Math.PI / 2 : Math.PI / 2;
    let d = target - facing.current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    facing.current += d * 0.05;
    grp.rotation.y = facing.current;

    // —— 步态:对角腿交替摆动(转身时放慢) ——
    const moving = Math.min(Math.abs(vel) * 1.5, 1);
    const gait = t * 6.5;
    const sw = 0.55 * moving;
    if (flLeg.current) flLeg.current.rotation.x = Math.sin(gait) * sw;
    if (brLeg.current) brLeg.current.rotation.x = Math.sin(gait) * sw;
    if (frLeg.current) frLeg.current.rotation.x = Math.sin(gait + Math.PI) * sw;
    if (blLeg.current) blLeg.current.rotation.x = Math.sin(gait + Math.PI) * sw;

    // 身体随步伐起伏 + 呼吸
    const bob = Math.abs(Math.sin(gait)) * 0.05 * moving;
    const breathe = Math.sin(t * 1.2) * 0.03;
    grp.position.y = 0.15 + bob;
    if (bodyRef.current) bodyRef.current.scale.set(1, 1 + breathe, 1);

    // 头/耳/尾 idle
    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(t * 0.5) * 0.15;
      headRef.current.rotation.x = Math.sin(t * 0.4 + 1) * 0.07;
    }
    const earFlick = Math.sin(t * 3.7) > 0.95 ? Math.sin(t * 18) * 0.15 : 0;
    if (leftEarRef.current) leftEarRef.current.rotation.z = -0.4 + earFlick;
    if (rightEarRef.current) rightEarRef.current.rotation.z = 0.4 - earFlick;
    if (tailRef.current) tailRef.current.rotation.x = Math.sin(t * 4) * 0.25 * moving + Math.sin(t * 2) * 0.08;
  });

  const furColor = '#c49a6c';
  const bellyColor = '#e8c9a0';
  const antlerColor = '#5a4a3a';
  const legColor = '#b08060';
  const noseColor = '#3a2a1a';

  return (
    <group ref={groupRef} position={[-0.4, 0.15, 2.4]} rotation={[0, -Math.PI / 2, 0]}>
      {/* 身体(横向胶囊 —— 关键:之前是竖着的,所以像熊) */}
      <mesh ref={bodyRef} position={[0, 0.74, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.22, 0.58, 6, 14]} />
        <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
      </mesh>

      {/* 胸前饱满过渡 */}
      <mesh position={[0, 0.72, 0.3]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
      </mesh>

      {/* 脖子(上扬) */}
      <mesh position={[0, 0.9, 0.36]} rotation={[-0.5, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.42, 10]} />
        <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
      </mesh>

      {/* 头部 */}
      <group ref={headRef} position={[0, 1.12, 0.52]}>
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.16, 8, 8]} />
          <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
        </mesh>
        {/* 口鼻部 */}
        <mesh position={[0, -0.04, 0.13]} scale={[0.7, 0.55, 0.5]}>
          <sphereGeometry args={[0.12, 6, 6]} />
          <meshStandardMaterial color={bellyColor} flatShading roughness={0.8} />
        </mesh>
        {/* 鼻子 */}
        <mesh position={[0, -0.06, 0.2]}>
          <sphereGeometry args={[0.03, 4, 4]} />
          <meshStandardMaterial color={noseColor} roughness={0.5} />
        </mesh>
        {/* 左耳 */}
        <mesh ref={leftEarRef} position={[-0.1, 0.12, 0]} rotation={[0, 0, -0.3]}>
          <coneGeometry args={[0.04, 0.14, 4]} />
          <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
        </mesh>
        {/* 右耳 */}
        <mesh ref={rightEarRef} position={[0.1, 0.12, 0]} rotation={[0, 0, 0.3]}>
          <coneGeometry args={[0.04, 0.14, 4]} />
          <meshStandardMaterial color={furColor} flatShading roughness={0.7} />
        </mesh>
        {/* 眼睛 */}
        <mesh position={[-0.06, 0.04, 0.14]}>
          <sphereGeometry args={[0.025, 4, 4]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.06, 0.04, 0.14]}>
          <sphereGeometry args={[0.025, 4, 4]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
        {/* 鹿角 - 左 */}
        <group position={[-0.07, 0.14, 0]}>
          <mesh rotation={[0.2, 0, -0.3]}>
            <cylinderGeometry args={[0.015, 0.02, 0.22, 6]} />
            <meshStandardMaterial color={antlerColor} flatShading roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.1, 0]} rotation={[0.2, 0.3, -0.5]}>
            <cylinderGeometry args={[0.01, 0.015, 0.12, 6]} />
            <meshStandardMaterial color={antlerColor} flatShading roughness={0.6} />
          </mesh>
        </group>
        {/* 鹿角 - 右 */}
        <group position={[0.07, 0.14, 0]}>
          <mesh rotation={[0.2, 0, 0.3]}>
            <cylinderGeometry args={[0.015, 0.02, 0.22, 6]} />
            <meshStandardMaterial color={antlerColor} flatShading roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.1, 0]} rotation={[0.2, -0.3, 0.5]}>
            <cylinderGeometry args={[0.01, 0.015, 0.12, 6]} />
            <meshStandardMaterial color={antlerColor} flatShading roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* 四条长腿(group 在髋部,绕髋摆动) */}
      <group ref={flLeg} position={[-0.13, 0.56, 0.22]}>
        <mesh position={[0, -0.28, 0]}><cylinderGeometry args={[0.05, 0.032, 0.56, 6]} /><meshStandardMaterial color={legColor} flatShading roughness={0.7} /></mesh>
      </group>
      <group ref={frLeg} position={[0.13, 0.56, 0.22]}>
        <mesh position={[0, -0.28, 0]}><cylinderGeometry args={[0.05, 0.032, 0.56, 6]} /><meshStandardMaterial color={legColor} flatShading roughness={0.7} /></mesh>
      </group>
      <group ref={blLeg} position={[-0.13, 0.56, -0.24]}>
        <mesh position={[0, -0.28, 0]}><cylinderGeometry args={[0.05, 0.032, 0.56, 6]} /><meshStandardMaterial color={legColor} flatShading roughness={0.7} /></mesh>
      </group>
      <group ref={brLeg} position={[0.13, 0.56, -0.24]}>
        <mesh position={[0, -0.28, 0]}><cylinderGeometry args={[0.05, 0.032, 0.56, 6]} /><meshStandardMaterial color={legColor} flatShading roughness={0.7} /></mesh>
      </group>

      {/* 尾巴 */}
      <mesh ref={tailRef} position={[0, 0.78, -0.34]}>
        <coneGeometry args={[0.055, 0.16, 6]} />
        <meshStandardMaterial color={bellyColor} flatShading roughness={0.8} />
      </mesh>
    </group>
  );
}

function SceneAccents({ variant }: { variant: SceneVariant }) {
  if (variant === '雨窗') return null;
  if (variant === '星空') {
    return <Sparkles count={85} scale={[18, 8, 35]} size={2.2} speed={0.12} color="#d8e6ff" opacity={0.65} />;
  }
  if (variant === '森林' || variant === '草坪') {
    // 自然地散落在两侧近景草地上的小野花(细茎 + 柔光花头),不再是密集的彩色珠子
    const flowers = [[2.7, 2.5], [3.4, 1.9], [4.0, 2.9], [3.0, 3.4], [4.5, 2.3], [3.7, 3.7], [-3.1, 2.7], [-2.5, 3.4], [-3.9, 2.1], [-3.3, 3.6]];
    const colors = ['#ffd6e0', '#fff1b8', '#ffc9d6', '#fdfdfd', '#ffe3a0'];
    return (
      <group>
        {flowers.map((f, index) => (
          <group key={index} position={[f[0], 0, f[1]]}>
            <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.012, 0.012, 0.24, 4]} /><meshStandardMaterial color="#5f7d4e" /></mesh>
            <mesh position={[0, 0.27, 0]}><sphereGeometry args={[0.05, 8, 8]} /><meshStandardMaterial color={colors[index % colors.length]} emissive={colors[index % colors.length]} emissiveIntensity={0.28} /></mesh>
          </group>
        ))}
      </group>
    );
  }
  return (
    <group position={[-4.6, 0.8, -8]}>
      <mesh><cylinderGeometry args={[0.3, 0.45, 2.5, 8]} /><meshStandardMaterial color="#f2e6cf" /></mesh>
      <mesh position={[0, 1.45, 0]}><cylinderGeometry args={[0.42, 0.42, 0.45, 8]} /><meshStandardMaterial color="#b96f65" emissive="#ffcf8b" emissiveIntensity={0.45} /></mesh>
    </group>
  );
}

// 细粒度草地:成百上千根 InstancedMesh 草叶,随机高矮/朝向/色差 —— 让地面不再是死平面
function GrassField({ count = 700, area = [42, 28], z0 = -3, groundY = -0.45, colorA = '#5f8a4e', colorB = '#82a861', height = 0.5 }: { count?: number; area?: [number, number]; z0?: number; groundY?: number; colorA?: string; colorB?: string; height?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const ca = new THREE.Color(colorA), cb = new THREE.Color(colorB), c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * area[0];
      const z = z0 + (Math.random() - 0.5) * area[1];
      const s = 0.55 + Math.random() * 0.95;
      dummy.position.set(x, groundY + (height * s) / 2, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.45, Math.random() * Math.PI, (Math.random() - 0.5) * 0.45);
      dummy.scale.set(0.8 + Math.random() * 0.5, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.copy(Math.random() < 0.5 ? ca : cb).offsetHSL(0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.1);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, area, z0, groundY, colorA, colorB, height]);
  return (
    <instancedMesh ref={ref} args={[null as unknown as THREE.BufferGeometry, null as unknown as THREE.Material, count]} frustumCulled={false}>
      <coneGeometry args={[0.03, height, 3]} />
      <meshStandardMaterial roughness={0.92} />
    </instancedMesh>
  );
}

// 细粒度花海:成片彩色花冠(InstancedMesh 微球),高低错落、色彩斑斓 —— 把开阔草坪变成花的海洋
function FlowerField({ count = 1000, area = [46, 30], z0 = -3, groundY = -0.45 }: { count?: number; area?: [number, number]; z0?: number; groundY?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const palette = useMemo(
    () => ['#ff8fb1', '#ff6f91', '#ffd36e', '#fff3ea', '#c79bf0', '#ff9e6d', '#ffe08a', '#f5a3c7'].map((c) => new THREE.Color(c)),
    [],
  );
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * area[0];
      const z = z0 + (Math.random() - 0.5) * area[1];
      const stem = 0.3 + Math.random() * 0.52; // 抬到草尖之上
      const s = 0.55 + Math.random() * 0.8;
      dummy.position.set(x, groundY + stem, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
      dummy.scale.set(s, s * 0.62, s); // 压扁成花冠
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.copy(palette[(Math.random() * palette.length) | 0]).offsetHSL(0, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, area, z0, groundY, palette]);
  return (
    <instancedMesh ref={ref} args={[null as unknown as THREE.BufferGeometry, null as unknown as THREE.Material, count]} frustumCulled={false}>
      <sphereGeometry args={[0.08, 7, 6]} />
      <meshStandardMaterial roughness={0.62} emissiveIntensity={0.12} />
    </instancedMesh>
  );
}

// 近景的小草洲:水景里让潮汐小狐站在岛上,而不是"在海上走"
function FoxIslet() {
  return (
    <group position={[-1, 0, 2.4]}>
      <mesh position={[0, -0.13, 0]} scale={[1, 1, 0.6]}>
        <cylinderGeometry args={[3.4, 3.9, 0.5, 22]} />
        <meshStandardMaterial color="#62794e" roughness={0.95} />
      </mesh>
      <GrassField count={170} area={[6, 3.2]} z0={0} groundY={0.12} colorA="#5e7d4c" colorB="#7c9e5b" height={0.34} />
    </group>
  );
}

// 云海:脚下翻涌的云毯 + 远处探出云层的雪峰(梦幻写实的高空场景)
function CloudSea({ night = false }: { night?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const COUNT = 360;
  const puffs = useMemo(
    () => Array.from({ length: COUNT }, () => ({
      x: (Math.random() - 0.5) * 78,
      y: -0.85 + Math.random() * 0.7,
      z: 5 - Math.random() * 54,
      s: 1.6 + Math.random() * 3.6,
      tone: Math.random(),
    })),
    [],
  );
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    const top = new THREE.Color(night ? '#cdd6f2' : '#ffffff');
    const bot = new THREE.Color(night ? '#5f6aa0' : '#d8def0');
    const c = new THREE.Color();
    puffs.forEach((p, i) => {
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, Math.random() * Math.PI, 0);
      d.scale.set(p.s, p.s * 0.46, p.s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      c.copy(bot).lerp(top, p.tone).offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [puffs, night]);
  const peaks = [
    { x: -17, z: -36, h: 13, w: 5.2 },
    { x: -6, z: -42, h: 17, w: 6 },
    { x: 9, z: -38, h: 14, w: 5.6 },
    { x: 20, z: -44, h: 19, w: 6.8 },
    { x: 3, z: -32, h: 10, w: 4.2 },
  ];
  const rock = night ? '#3a4068' : '#7c84a6';
  const snow = night ? '#c7d0ec' : '#f4f6ff';
  return (
    <group>
      {/* 远山雪峰,从云海里探出 */}
      {peaks.map((m, i) => (
        <group key={i} position={[m.x, -1.4, m.z]}>
          <mesh position={[0, m.h / 2, 0]}><coneGeometry args={[m.w, m.h, 8]} /><meshStandardMaterial color={rock} roughness={0.95} /></mesh>
          <mesh position={[0, m.h - m.h * 0.17, 0]}><coneGeometry args={[m.w * 0.36, m.h * 0.34, 8]} /><meshStandardMaterial color={snow} roughness={0.72} /></mesh>
        </group>
      ))}
      {/* 翻涌的云毯 */}
      <instancedMesh ref={ref} args={[null as unknown as THREE.BufferGeometry, null as unknown as THREE.Material, COUNT]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshStandardMaterial roughness={0.96} metalness={0} />
      </instancedMesh>
    </group>
  );
}

function MeadowGround({ variant }: { variant: SceneVariant }) {
  const forest = variant === '森林';
  const groundColor = SCENE_PALETTES[variant].ground;
  // 森林:茂密(44 棵、多排错落);草坪:开阔无树,靠草+花
  const trees = useMemo(() => (forest ? Array.from({ length: 44 }, (_, index) => ({
    x: -15 + (index % 9) * 3.2 + Math.sin(index * 2.3) * 1.2,
    z: -15 + Math.floor(index / 9) * 2.7 + Math.cos(index * 1.7) * 1.0,
    scale: 0.58 + (index % 6) * 0.12,
    tint: index % 3,
  })) : []), [forest]);
  const foliage = ['#3c6347', '#487452', '#33583f'];
  return (
    <group>
      <mesh position={[0, -0.45, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[80, 80, 1, 1]} />
        <meshStandardMaterial color={groundColor} roughness={1} />
      </mesh>
      {/* 细粒度草地(草坪更密更亮;森林是偏暗的林下草) */}
      <GrassField
        count={forest ? 820 : 1300}
        area={[44, 30]}
        z0={-3}
        colorA={forest ? '#3f6a45' : '#6fa455'}
        colorB={forest ? '#4f7d50' : '#8ec46a'}
        height={forest ? 0.4 : 0.56}
      />
      {/* 花海:开阔草坪铺满彩色花冠;森林:林下点缀少量野花 */}
      <FlowerField count={forest ? 220 : 1100} />
      {/* 远处几丛点景树,避免一望无际的空旷(花海保留疏朗) */}
      {!forest && Array.from({ length: 7 }, (_, i) => ({
        x: -20 + i * 6.4 + Math.sin(i * 2.1) * 1.6,
        z: -22 - (i % 3) * 4 + Math.cos(i * 1.3) * 2,
        scale: 0.5 + (i % 4) * 0.1,
        tint: i % 3,
      })).map((t, i) => (
        <group key={`bt-${i}`} position={[t.x, 0, t.z]} scale={t.scale}>
          <mesh position={[0, 0.58, 0]}><cylinderGeometry args={[0.1, 0.14, 1.18, 7]} /><meshStandardMaterial color="#6e503a" roughness={0.9} /></mesh>
          <mesh position={[0, 1.32, 0]}><coneGeometry args={[0.82, 1.55, 12]} /><meshStandardMaterial color={foliage[t.tint]} roughness={0.85} /></mesh>
          <mesh position={[0, 2.12, 0]}><coneGeometry args={[0.58, 1.16, 12]} /><meshStandardMaterial color={foliage[t.tint]} roughness={0.85} /></mesh>
        </group>
      ))}
      {trees.map((tree, index) => (
        <group key={index} position={[tree.x, 0, tree.z]} scale={tree.scale}>
          <mesh position={[0, 0.58, 0]}><cylinderGeometry args={[0.1, 0.14, 1.18, 7]} /><meshStandardMaterial color="#6e503a" roughness={0.9} /></mesh>
          <mesh position={[0, 1.32, 0]}><coneGeometry args={[0.82, 1.55, 12]} /><meshStandardMaterial color={foliage[tree.tint]} roughness={0.85} /></mesh>
          <mesh position={[0, 2.12, 0]}><coneGeometry args={[0.58, 1.16, 12]} /><meshStandardMaterial color={foliage[tree.tint]} roughness={0.85} /></mesh>
        </group>
      ))}
    </group>
  );
}

// 半开的白色窗扇(向内敞开,像参考图那种敞亮的窗,而非一排竖栏=监狱)
function CasementLeaf({ hingeX, cy, z, w, h, dir, angle }: { hingeX: number; cy: number; z: number; w: number; h: number; dir: 1 | -1; angle: number }) {
  const c = '#ece3d0';
  const t = 0.16;
  return (
    <group position={[hingeX, cy, z]} rotation={[0, dir === 1 ? -angle : angle, 0]}>
      <group position={[(dir * w) / 2, 0, 0]}>
        <mesh position={[0, 0, -0.03]}><planeGeometry args={[w - t, h - t]} /><meshStandardMaterial color={0xd6e4e6} transparent opacity={0.16} roughness={0.05} metalness={0.12} side={THREE.DoubleSide} /></mesh>
        <mesh position={[-w / 2 + t / 2, 0, 0]}><boxGeometry args={[t, h, 0.28]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
        <mesh position={[w / 2 - t / 2, 0, 0]}><boxGeometry args={[t, h, 0.28]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
        <mesh position={[0, h / 2 - t / 2, 0]}><boxGeometry args={[w, t, 0.28]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
        <mesh position={[0, -h / 2 + t / 2, 0]}><boxGeometry args={[w, t, 0.28]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
        <mesh position={[0, h / 6, 0]}><boxGeometry args={[w, t * 0.6, 0.24]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
        <mesh position={[0, -h / 6, 0]}><boxGeometry args={[w, t * 0.6, 0.24]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
      </group>
    </group>
  );
}

// 窗台上一束白色雏菊 + 几枚果子(呼应参考图)
function SillStill({ scale = 1 }: { scale?: number }) {
  const flowers = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    a: (i / 8) * Math.PI * 2,
    r: 0.05 + (i % 3) * 0.07,
    h: 0.45 + (i % 4) * 0.13,
    tx: Math.sin(i * 1.7) * 0.42,
    tz: Math.cos(i * 2.3) * 0.42,
  })), []);
  return (
    <group scale={scale}>
      {/* 白瓷花瓶 */}
      <mesh position={[0, 0.21, 0]}><cylinderGeometry args={[0.17, 0.12, 0.42, 14]} /><meshStandardMaterial color="#eef2f4" roughness={0.35} metalness={0.08} /></mesh>
      {flowers.map((f, i) => (
        <group key={i} position={[Math.cos(f.a) * f.r, 0.4, Math.sin(f.a) * f.r]} rotation={[f.tx, 0, f.tz]}>
          <mesh position={[0, f.h / 2, 0]}><cylinderGeometry args={[0.012, 0.012, f.h, 4]} /><meshStandardMaterial color="#6a9152" /></mesh>
          <mesh position={[0, f.h, 0]}><sphereGeometry args={[0.085, 8, 7]} /><meshStandardMaterial color="#fbf7ee" roughness={0.6} /></mesh>
          <mesh position={[0, f.h, 0.02]}><sphereGeometry args={[0.034, 7, 6]} /><meshStandardMaterial color="#ffce4a" emissive="#c79a22" emissiveIntensity={0.25} toneMapped={false} /></mesh>
        </group>
      ))}
      {/* 几枚果子 */}
      <mesh position={[0.62, 0.12, 0.18]}><sphereGeometry args={[0.13, 10, 9]} /><meshStandardMaterial color="#e0913f" roughness={0.6} /></mesh>
      <mesh position={[0.86, 0.11, 0.0]}><sphereGeometry args={[0.12, 10, 9]} /><meshStandardMaterial color="#cf5b46" roughness={0.6} /></mesh>
      <mesh position={[-0.5, 0.1, 0.2]}><sphereGeometry args={[0.11, 10, 9]} /><meshStandardMaterial color="#e7c24a" roughness={0.6} /></mesh>
    </group>
  );
}

function RainWindow({ weatherKind }: { weatherKind: WeatherKind }) {
  const { viewport, camera } = useThree();
  const outRainRef = useRef<THREE.Group>(null);

  // 让窗框始终贴合可视范围(手机竖屏 / 桌面宽屏都框满整屏)
  const FZ = 6.4;                       // 窗框所在 z 平面
  const cyf = 3.2 * FZ / 15;            // 相机看向原点 → 屏幕中心在该平面的 y
  const v = viewport.getCurrentViewport(camera, [0, cyf, FZ]);
  const halfW = v.width / 2;
  const halfH = v.height / 2;
  const sillY = cyf - halfH + 0.55;
  const leafW = Math.min(halfW * 0.94, 3.0);
  const leafH = halfH * 2 - 0.5;
  const rainy = weatherKind === 'rain' || weatherKind === 'storm';  // 只有真下雨才落雨,化解"晴天却下雨"的矛盾

  // 白色蕾丝窗帘纹理(半透白布 + 镂空小孔 + 扇贝下摆)
  const lace = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(0, 0, 128, 256);
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = 12; y < 234; y += 17) for (let x = 8; x < 128; x += 17) { ctx.beginPath(); ctx.arc(x + (Math.floor(y / 17) % 2 ? 8 : 0), y, 3, 0, 7); ctx.fill(); }
    for (let x = -4; x < 132; x += 22) { ctx.beginPath(); ctx.arc(x + 11, 252, 12, 0, 7); ctx.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);

  const drops = useMemo(() => Array.from({ length: 170 }, (_, i) => ({
    x: -halfW - 2 + ((i * 0.97) % (halfW * 2 + 6)),
    y: 1 + ((i * 1.7) % 13),
    z: -13 + ((i * 2.3) % 12),
    speed: 0.09 + (i % 5) * 0.02,
    len: 0.18 + (i % 3) * 0.08,
  })), [halfW]);
  // 更柔、更亮的远山(平滑着色)
  const hills = useMemo(() => [
    { x: -13, z: -34, s: 9, c: 0x9fabb4 },
    { x: 2, z: -40, s: 12, c: 0x93a0ac },
    { x: 15, z: -31, s: 7.5, c: 0xaab4bc },
  ], []);

  useFrame(() => {
    if (!rainy) return;
    outRainRef.current?.children.forEach((d, i) => {
      d.position.y -= drops[i].speed;
      d.position.x -= drops[i].speed * 0.5;
      if (d.position.y < -0.8) { d.position.y = 13; d.position.x += drops[i].speed * 0.5 * 150; }
    });
  });

  const fc = '#f6f2ea';   // 纯白窗框
  return (
    <group>
      {/* —— 窗外:平滑远山 + 几棵远树 + 雾化湿地平线 + 两层薄雾(配景深虚化 → 柔和梦幻) —— */}
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, -0.5, h.z]}>
          <coneGeometry args={[h.s, h.s * 0.6, 12]} />
          <meshStandardMaterial color={h.c} roughness={1} />
        </mesh>
      ))}
      {[[-8, -29], [7, -32], [-3, -35], [12, -34]].map(([x, z], i) => (
        <group key={i} position={[x, -0.3, z]}>
          <mesh position={[0, 0.9, 0]}><coneGeometry args={[0.85, 2.1, 10]} /><meshStandardMaterial color="#74917a" roughness={0.9} /></mesh>
          <mesh position={[0, 1.7, 0]}><coneGeometry args={[0.6, 1.5, 10]} /><meshStandardMaterial color="#7c9a80" roughness={0.9} /></mesh>
        </group>
      ))}
      <mesh position={[0, -1.8, -18]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[120, 50]} />
        <meshStandardMaterial color={0xacb6ad} roughness={1} />
      </mesh>
      {[-9, -20].map((z, i) => (
        <mesh key={i} position={[0, 2, z]}>
          <planeGeometry args={[80, 26]} />
          <meshBasicMaterial color="#dfe6e3" transparent opacity={i ? 0.2 : 0.13} depthWrite={false} />
        </mesh>
      ))}
      {rainy && (
        <group ref={outRainRef}>
          {drops.map((d, i) => (
            <mesh key={i} position={[d.x, d.y, d.z]} rotation={[0, 0, 0.42]}>
              <capsuleGeometry args={[0.009, d.len, 2, 4]} />
              <meshBasicMaterial color="#eaf2f7" transparent opacity={0.34} />
            </mesh>
          ))}
        </group>
      )}

      {/* —— 纯白外框 —— */}
      <mesh position={[0, cyf + halfH - 0.22, FZ]}><boxGeometry args={[halfW * 2 + 0.6, 0.5, 0.55]} /><meshStandardMaterial color={fc} roughness={0.6} /></mesh>
      <mesh position={[-halfW + 0.16, cyf, FZ]}><boxGeometry args={[0.42, halfH * 2 + 1.2, 0.55]} /><meshStandardMaterial color={fc} roughness={0.6} /></mesh>
      <mesh position={[halfW - 0.16, cyf, FZ]}><boxGeometry args={[0.42, halfH * 2 + 1.2, 0.55]} /><meshStandardMaterial color={fc} roughness={0.6} /></mesh>

      {/* —— 两扇微开的白窗 —— */}
      <CasementLeaf hingeX={-halfW + 0.16} cy={cyf} z={FZ} w={leafW} h={leafH} dir={1} angle={1.16} />
      <CasementLeaf hingeX={halfW - 0.16} cy={cyf} z={FZ} w={leafW} h={leafH} dir={-1} angle={1.16} />

      {/* —— 白色蕾丝窗帘:顶部帘幔 + 左右两幅垂帘 —— */}
      <mesh position={[0, cyf + halfH - 0.7, FZ + 0.34]}>
        <planeGeometry args={[halfW * 2 - 0.5, 0.95]} />
        <meshStandardMaterial map={lace} transparent opacity={0.9} side={THREE.DoubleSide} roughness={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[-halfW + 1.0, cyf + 0.2, FZ + 0.32]} rotation={[0, 0.14, 0.05]}>
        <planeGeometry args={[1.8, halfH * 2 - 0.5]} />
        <meshStandardMaterial map={lace} transparent opacity={0.88} side={THREE.DoubleSide} roughness={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[halfW - 1.0, cyf + 0.2, FZ + 0.32]} rotation={[0, -0.14, -0.05]}>
        <planeGeometry args={[1.8, halfH * 2 - 0.5]} />
        <meshStandardMaterial map={lace} transparent opacity={0.88} side={THREE.DoubleSide} roughness={0.9} depthWrite={false} />
      </mesh>

      {/* —— 窗台 + 白雏菊花瓶 + 果子 —— */}
      <mesh position={[0, sillY - 0.3, FZ + 0.45]}><boxGeometry args={[halfW * 2 + 0.6, 0.5, 1.6]} /><meshStandardMaterial color="#efe7d6" roughness={0.75} /></mesh>
      <group position={[-1.0, sillY - 0.05, FZ + 0.55]}>
        <SillStill scale={1.05} />
      </group>
    </group>
  );
}

// 真·烟花:几束焰火周期性从夜空炸开 —— 粒子径向扩散 + 渐隐 + 轻微下坠
function Fireworks() {
  const COLORS = ['#ffd28a', '#ff9bb0', '#9ad0ff', '#c8a8ff', '#fff0a0'];
  const bursts = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    cx: -8 + i * 3.6 + Math.sin(i * 1.3) * 1.6,
    cy: 4.4 + (i % 3) * 1.7,
    cz: -11 - (i % 2) * 6,
    color: COLORS[i % COLORS.length],
    period: 2.6 + i * 0.55,
    offset: i * 0.9,
    parts: Array.from({ length: 26 }, () => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      return {
        dir: [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)] as [number, number, number],
        sp: 0.6 + Math.random() * 0.55,
      };
    }),
  })), []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    bursts.forEach((b, bi) => {
      const g = refs.current[bi];
      if (!g) return;
      const local = ((t + b.offset) % b.period) / b.period;       // 0..1
      const expand = 1 - Math.pow(1 - local, 2);                  // ease-out 扩散
      const radius = expand * 2.7;
      const fade = local < 0.1 ? local / 0.1 : Math.max(0, 1 - (local - 0.1) / 0.9);
      g.children.forEach((c, pi) => {
        const p = b.parts[pi];
        c.position.set(p.dir[0] * radius * p.sp, p.dir[1] * radius * p.sp - expand * expand * 1.2, p.dir[2] * radius * p.sp);
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade;
      });
    });
  });
  return (
    <group>
      {bursts.map((b, bi) => (
        <group key={bi} ref={(el) => { refs.current[bi] = el; }} position={[b.cx, b.cy, b.cz]}>
          {b.parts.map((_, pi) => (
            <mesh key={pi}>
              <sphereGeometry args={[0.05, 6, 6]} />
              <meshBasicMaterial color={b.color} transparent opacity={0} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// 月亮(冷白盘 + 柔光晕)+ 偶尔划过的流星 —— 给星空夜晚
function Moon() {
  const halo = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, '#f2f6ffcc');
    g.addColorStop(0.3, '#cdd9ff66');
    g.addColorStop(1, '#cdd9ff00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <group position={[5.6, 8.4, -46]}>
      <mesh><circleGeometry args={[2.3, 48]} /><meshBasicMaterial color="#eef2ff" toneMapped={false} /></mesh>
      <mesh position={[-0.7, 0.5, 0.01]}><circleGeometry args={[0.4, 20]} /><meshBasicMaterial color="#dde6fb" toneMapped={false} /></mesh>
      <mesh position={[0.6, -0.5, 0.01]}><circleGeometry args={[0.3, 18]} /><meshBasicMaterial color="#dde6fb" toneMapped={false} /></mesh>
      <sprite scale={[15, 15, 1]}><spriteMaterial map={halo} transparent blending={THREE.AdditiveBlending} depthWrite={false} /></sprite>
    </group>
  );
}

// 流星:亮头 + 顺运动方向渐隐的拖尾(对齐方向,不再是横着的竖棒);两颗错峰、出现更勤
function ShootingStar() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const stars = useMemo(() => [
    { cycle: 5.5, offset: 0.5, fromX: -13, fromY: 9.6, dx: 26, dy: -7, z: -16 },
    { cycle: 8.5, offset: 3.6, fromX: -8, fromY: 11.2, dx: 21, dy: -5.2, z: -22 },
  ], []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    stars.forEach((s, i) => {
      const g = refs.current[i];
      if (!g) return;
      const local = ((t + s.offset) % s.cycle) / s.cycle;
      const active = local < 0.13;
      g.visible = active;
      if (!active) return;
      const p = local / 0.13;
      g.position.set(s.fromX + s.dx * p, s.fromY + s.dy * p, s.z);
      const op = Math.sin(p * Math.PI);
      g.children.forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = op * (c.name === 'head' ? 1 : 0.6);
      });
    });
  });
  return (
    <>
      {stars.map((s, i) => {
        const ang = Math.atan2(s.dy, s.dx);
        return (
          <group key={i} ref={(el) => { refs.current[i] = el; }} visible={false}>
            <mesh rotation={[0, 0, ang + Math.PI / 2]} position={[-Math.cos(ang) * 0.95, -Math.sin(ang) * 0.95, 0]}>
              <coneGeometry args={[0.07, 1.9, 6]} />
              <meshBasicMaterial color="#cfe0ff" transparent opacity={0} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh name="head"><sphereGeometry args={[0.09, 12, 12]} /><meshBasicMaterial color="#ffffff" transparent opacity={0} toneMapped={false} /></mesh>
          </group>
        );
      })}
    </>
  );
}

// 日/月在水面上随波荡漾的粼粼倒影(光路)
function WaterShine({ color = '#ffd9a0', x = -2 }: { color?: string; x?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, color + 'ee'); g.addColorStop(0.4, color + 'aa'); g.addColorStop(0.75, color + '44'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    const hg = ctx.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, '#00000000'); hg.addColorStop(0.5, '#000000ff'); hg.addColorStop(1, '#00000000');
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = hg; ctx.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [color]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 1.6) * 0.12;
    ref.current.scale.x = 1 + Math.sin(t * 0.9) * 0.12;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.06, -16]}>
      <planeGeometry args={[5.5, 42]} />
      <meshBasicMaterial map={tex} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// 远处水面上的小帆船剪影,轻轻起伏 —— 给海洋/落日添一点故事感
function Sailboat({ tint = '#52606e' }: { tint?: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!ref.current) return;
    ref.current.position.x = -6 + Math.sin(t * 0.045) * 4.5;
    ref.current.position.y = 0.12 + Math.sin(t * 0.6) * 0.06;
    ref.current.rotation.z = Math.sin(t * 0.6) * 0.03;
  });
  return (
    <group ref={ref} position={[-6, 0.12, -27]} scale={1.25}>
      <mesh><boxGeometry args={[1.5, 0.2, 0.42]} /><meshStandardMaterial color={tint} roughness={0.85} /></mesh>
      <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.022, 0.022, 1.25, 5]} /><meshStandardMaterial color={tint} roughness={0.85} /></mesh>
      <mesh position={[0.14, 0.64, 0]} rotation={[0, 0, -0.05]} scale={[1, 1, 0.12]}><coneGeometry args={[0.46, 1.16, 3]} /><meshStandardMaterial color={tint} flatShading roughness={0.85} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

type CloudTone = 'light' | 'rain' | 'storm';

function WeatherClouds({ tone = 'light', dense = false }: { tone?: CloudTone; dense?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const clouds = useMemo(() => Array.from({ length: dense ? 5 : 3 }, (_, index) => ({
    x: [-18, 4, 22, -5, 15][index],
    y: 12.8 + (index % 2) * 1.4,
    z: -48 - index * 8,
    scale: 0.95 + (index % 3) * 0.22,
    drift: 0.35 + (index % 3) * 0.18,
  })), [dense]);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.position.x = Math.sin(clock.getElapsedTime() * 0.018) * 1.4;
  });
  const cloudTone: Record<CloudTone, { color: string; opacity: number }> = {
    light: { color: '#f4fbfb', opacity: 0.28 },
    rain: { color: '#d5e0e3', opacity: 0.26 },
    storm: { color: '#b9c5cc', opacity: 0.22 },
  };
  const { color, opacity } = cloudTone[tone];
  const puffs: [number, number, number, number][] = [
    [-1.8, -0.06, 1.7, 0.72],
    [-0.55, 0.18, 1.95, 0.9],
    [0.82, 0.2, 1.8, 0.84],
    [1.92, -0.08, 1.34, 0.62],
  ];
  return (
    <group ref={groupRef}>
      {clouds.map((cloud, index) => (
        <group key={index} position={[cloud.x, cloud.y, cloud.z]} scale={cloud.scale}>
          {puffs.map((p, part) => (
            <mesh key={part} position={[p[0], p[1], 0]} scale={[p[2], p[3], 0.36]}>
              <sphereGeometry args={[1.05, 16, 10]} />
              <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function WeatherHaze({ kind }: { kind: 'overcast' | 'fog' }) {
  const groupRef = useRef<THREE.Group>(null);
  const hazeTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(160, 80, 12, 160, 80, 150);
    gradient.addColorStop(0, 'rgba(255,255,255,0.62)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 160);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const wisps = useMemo(() => Array.from({ length: kind === 'fog' ? 9 : 6 }, (_, index) => ({
    x: -10 + (index % 3) * 10 + Math.sin(index * 1.9) * 1.4,
    y: kind === 'fog' ? 4.6 + (index % 3) * 1.1 : 8.2 + (index % 2) * 1.1,
    z: -16 - index * 4.2,
    width: kind === 'fog' ? 9 + (index % 3) * 1.4 : 7.5 + (index % 2) * 1.6,
    height: kind === 'fog' ? 2.2 : 1.55,
    phase: index * 1.13,
    opacity: kind === 'fog' ? 0.18 + (index % 3) * 0.025 : 0.13 + (index % 2) * 0.025,
  })), [kind]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    groupRef.current?.children.forEach((child, index) => {
      const wisp = wisps[index];
      child.position.x = wisp.x + Math.sin(t * 0.08 + wisp.phase) * 0.7;
    });
  });

  return (
    <group ref={groupRef}>
      {wisps.map((wisp, index) => (
        <sprite key={index} position={[wisp.x, wisp.y, wisp.z]} scale={[wisp.width, wisp.height, 1]}>
          <spriteMaterial
            map={hazeTex}
            color={kind === 'fog' ? '#eef4f1' : '#dfe8e7'}
            transparent
            opacity={wisp.opacity}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}

function WeatherRain({ storm = false }: { storm?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const drops = useMemo(() => Array.from({ length: storm ? 120 : 70 }, (_, index) => ({
    x: -9 + (index % 20) * 0.95,
    y: 1 + ((index * 1.73) % 10),
    z: -8 + ((index * 2.17) % 18),
    speed: 0.11 + (index % 5) * 0.025,
  })), [storm]);
  useFrame(() => {
    groupRef.current?.children.forEach((drop, index) => {
      drop.position.y -= drops[index].speed;
      drop.position.x -= drops[index].speed * 0.18;
      if (drop.position.y < -0.4) drop.position.y = 10;
    });
  });
  return (
    <group ref={groupRef}>
      {drops.map((drop, index) => (
        <mesh key={index} position={[drop.x, drop.y, drop.z]} rotation={[0, 0, 0.18]}>
          <capsuleGeometry args={[0.012, storm ? 0.32 : 0.2, 2, 3]} />
          <meshBasicMaterial color="#dceef5" transparent opacity={storm ? 0.62 : 0.42} />
        </mesh>
      ))}
    </group>
  );
}

function WeatherAtmosphere({ kind }: { kind: WeatherKind }) {
  if (kind === 'clear') return <Sparkles count={24} scale={[16, 7, 24]} size={2.5} speed={0.08} color="#fff0ae" opacity={0.34} />;
  if (kind === 'cloudy') return <WeatherClouds />;
  if (kind === 'overcast' || kind === 'fog') return <WeatherHaze kind={kind} />;
  if (kind === 'rain') return <><WeatherClouds dense tone="rain" /><WeatherRain /></>;
  if (kind === 'storm') return <><WeatherClouds dense tone="storm" /><WeatherRain storm /><pointLight position={[0, 9, -8]} color="#dce8ff" intensity={1.1} /></>;
  return <Sparkles count={90} scale={[18, 10, 26]} size={3.4} speed={0.16} color="#f2fbff" opacity={0.72} />;
}

// 岸边草地
function ShoreGrass() {
  const patches = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 18; i++) {
      arr.push({
        x: -4 + Math.random() * 8,
        z: 1.5 + Math.random() * 3.5,
        s: 0.06 + Math.random() * 0.1,
        h: 0.15 + Math.random() * 0.35,
        rot: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }, []);

  return (
    <group>
      {patches.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.h * 0.3, p.z]}
          rotation={[0.1, p.rot, 0.1]}
        >
          <coneGeometry args={[p.s, p.h, 4]} />
          <meshStandardMaterial color={0x7a9a5a} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// 近岸小木栈桥(木板路面 + 成对支撑柱),代替原来孤零零的小木桩
function DockPosts() {
  const planks = [0, 1, 2, 3, 4];
  return (
    <group position={[2.7, 0, 2.4]} rotation={[0, -0.32, 0]}>
      {/* 木板路面 */}
      {planks.map((i) => (
        <mesh key={i} position={[0, 0.18, -i * 0.6]}>
          <boxGeometry args={[1.05, 0.07, 0.5]} />
          <meshStandardMaterial color={i % 2 ? '#8a6a4c' : '#7a5c40'} flatShading roughness={0.85} />
        </mesh>
      ))}
      {/* 成对支撑柱 */}
      {[0, 2, 4].map((i) => [-0.44, 0.44].map((x, j) => (
        <mesh key={`${i}-${j}`} position={[x, -0.04, -i * 0.6]}>
          <cylinderGeometry args={[0.05, 0.06, 0.56, 6]} />
          <meshStandardMaterial color="#5f4632" flatShading roughness={0.9} />
        </mesh>
      )))}
    </group>
  );
}

// 萤火虫粒子
function Fireflies() {
  const groupRef = useRef<THREE.Group>(null);
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 15; i++) {
      arr.push({
        baseX: -4 + Math.random() * 8,
        baseY: 0.3 + Math.random() * 1.5,
        baseZ: 1.5 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
        amp: 0.15 + Math.random() * 0.4,
      });
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      child.position.set(
        p.baseX + Math.sin(t * p.speed + p.phase) * p.amp,
        p.baseY + Math.cos(t * p.speed * 1.3 + p.phase) * p.amp * 0.7,
        p.baseZ + Math.cos(t * p.speed * 0.7 + p.phase) * p.amp * 0.5
      );
      // 闪烁
      const opacity = 0.3 + Math.sin(t * 3 + p.phase) * 0.3 + Math.sin(t * 5.7 + p.phase * 2) * 0.2;
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0.1, opacity);
    });
  });

  return (
    <group ref={groupRef}>
      {particles.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.03, 4, 4]} />
          <meshBasicMaterial color="#ffe8a0" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// 落花飘落特效
function PetalFall() {
  const ref = useRef<THREE.Group>(null);
  const petals = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    x: -10 + Math.random() * 20,
    y: Math.random() * 13,
    z: -9 + Math.random() * 15,
    sp: 0.01 + Math.random() * 0.018,
    sway: 0.3 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
    color: ['#ffd6e0', '#ffc9d6', '#fdeef2', '#f7b8c6'][i % 4],
    s: 0.07 + Math.random() * 0.05,
    spin: (Math.random() - 0.5) * 2,
  })), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ref.current?.children.forEach((c, i) => {
      const p = petals[i];
      c.position.y -= p.sp;
      c.position.x = p.x + Math.sin(t * p.sway + p.phase) * 0.8;
      c.rotation.z = t * p.spin;
      c.rotation.x = t * p.spin * 0.7;
      if (c.position.y < -1) c.position.y = 13;
    });
  });
  return (
    <group ref={ref}>
      {petals.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 1.5, p.s]}>
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial color={p.color} side={THREE.DoubleSide} transparent opacity={0.9} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// 特效层:与基底解耦,可任意叠加(默认随情绪,亦可预览切换)
function EffectLayer({ effect }: { effect: EffectKind }) {
  if (effect === '萤火') return <Fireflies />;
  if (effect === '花瓣') return <PetalFall />;
  if (effect === '海鸥') return <Seagulls />;
  if (effect === '烟花') return <Fireworks />;
  if (effect === '流星') return <ShootingStar />;
  return null;
}

const shelteredWeather = new Set<SceneWeatherKind>(['rain', 'storm', 'overcast']);

function SanctuaryOrb({ base, time, weatherKind }: { base: SceneBase; time: TimeOfDay; weatherKind: SceneWeatherKind }) {
  const groupRef = useRef<THREE.Group>(null);
  const isNight = time === 'night';
  const isBadWeather = shelteredWeather.has(weatherKind);
  const glow = isNight ? '#d8e6ff' : isBadWeather ? '#d9e7ee' : '#fff1bc';
  const position: [number, number, number] = base === '云海' ? [-2.6, 1.9, -1.8] : [-3.35, 1.04, 2.15];
  const scale = base === '云海' ? 1.05 : 1.35;

  const glowTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,245,0.95)');
    gradient.addColorStop(0.25, `${glow}cc`);
    gradient.addColorStop(0.62, `${glow}55`);
    gradient.addColorStop(1, `${glow}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [glow]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = position[1] + Math.sin(t * 0.82) * 0.045;
    groupRef.current.rotation.y = t * 0.18;
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      <sprite scale={[2.45, 2.45, 1]}>
        <spriteMaterial map={glowTex} transparent opacity={isBadWeather ? 0.48 : 0.68} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshStandardMaterial color={glow} transparent opacity={0.34} emissive={glow} emissiveIntensity={0.55} roughness={0.22} />
      </mesh>
      <pointLight color={glow} intensity={isNight ? 1.2 : 0.72} distance={4.5} />
    </group>
  );
}


function SeaGlints({ time, weatherKind }: { time: TimeOfDay; weatherKind: SceneWeatherKind }) {
  const groupRef = useRef<THREE.Group>(null);
  const dimmed = weatherKind === 'storm' || weatherKind === 'rain' || weatherKind === 'overcast';
  const color = time === 'night' ? '#d8e6ff' : time === 'dusk' ? '#ffe0b6' : '#fff4d0';
  const glints = useMemo(() => Array.from({ length: 18 }, (_, index) => ({
    x: -5.1 + (index % 6) * 1.86,
    y: 0.1 + Math.floor(index / 6) * 0.16,
    z: 1.15 + (index % 3) * 0.52,
    scale: 0.15 + (index % 4) * 0.045,
    phase: index * 0.73,
  })), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    groupRef.current?.children.forEach((child, index) => {
      const glint = glints[index];
      const pulse = 1 + Math.sin(t * 1.45 + glint.phase) * 0.22;
      child.scale.set(glint.scale * 2.8 * pulse, glint.scale * 0.16, 1);
      child.position.x = glint.x + Math.sin(t * 0.34 + glint.phase) * 0.08;
    });
  });

  return (
    <group ref={groupRef} position={[0, -0.28, 1.65]} rotation={[-0.18, 0, 0]}>
      {glints.map((glint, index) => (
        <mesh key={index} position={[glint.x, glint.y, glint.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.12 : 0.24} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function FloatingPages({ time, weatherKind }: { time: TimeOfDay; weatherKind: SceneWeatherKind }) {
  const groupRef = useRef<THREE.Group>(null);
  const muted = shelteredWeather.has(weatherKind);
  const color = time === 'night' ? '#e4e8ff' : muted ? '#e9eee8' : '#fff7df';
  const pages = useMemo(() => Array.from({ length: 7 }, (_, index) => ({
    x: -4.2 + index * 1.35,
    y: 1.2 + (index % 3) * 0.38,
    z: 0.65 + (index % 4) * 0.28,
    rot: -0.35 + index * 0.13,
    phase: index * 0.9,
    scale: 0.34 + (index % 3) * 0.05,
  })), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    groupRef.current?.children.forEach((child, index) => {
      const page = pages[index];
      child.position.y = page.y + Math.sin(t * 0.72 + page.phase) * 0.08;
      child.rotation.z = page.rot + Math.sin(t * 0.55 + page.phase) * 0.08;
      child.rotation.y = Math.sin(t * 0.44 + page.phase) * 0.28;
    });
  });

  return (
    <group ref={groupRef} position={[0, 0.05, 1.25]}>
      {pages.map((page, index) => (
        <mesh key={index} position={[page.x, page.y, page.z]} rotation={[0.1, 0, page.rot]} scale={[page.scale, page.scale * 1.35, page.scale]}>
          <planeGeometry args={[1, 1.28]} />
          <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={muted ? 0.36 : 0.55} roughness={0.72} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

function CloudPearls({ time, weatherKind }: { time: TimeOfDay; weatherKind: SceneWeatherKind }) {
  const groupRef = useRef<THREE.Group>(null);
  const muted = shelteredWeather.has(weatherKind) || weatherKind === 'snow';
  const color = time === 'night' ? '#d8e6ff' : muted ? '#edf4f4' : '#fff0cf';
  const pearls = useMemo(() => Array.from({ length: 10 }, (_, index) => ({
    x: -4.6 + index * 1.05,
    y: 1.15 + (index % 4) * 0.24,
    z: 0.7 + (index % 5) * 0.2,
    size: 0.08 + (index % 3) * 0.03,
    phase: index * 0.68,
  })), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    groupRef.current?.children.forEach((child, index) => {
      const pearl = pearls[index];
      child.position.y = pearl.y + Math.sin(t * 0.64 + pearl.phase) * 0.1;
      child.position.x = pearl.x + Math.cos(t * 0.34 + pearl.phase) * 0.06;
      child.scale.setScalar(1 + Math.sin(t * 1.1 + pearl.phase) * 0.08);
    });
  });

  return (
    <group ref={groupRef} position={[0, 0.28, 0.9]}>
      {pearls.map((pearl, index) => (
        <mesh key={index} position={[pearl.x, pearl.y, pearl.z]}>
          <sphereGeometry args={[pearl.size, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={muted ? 0.24 : 0.42} transparent opacity={muted ? 0.36 : 0.58} roughness={0.18} />
        </mesh>
      ))}
    </group>
  );
}

function SceneCompanions({ base, time, weatherKind, pokeNonce }: { base: SceneBase; time: TimeOfDay; weatherKind: SceneWeatherKind; pokeNonce: number }) {
  return (
    <>
      {base === '花海' && (<><SanctuaryOrb base={base} time={time} weatherKind={weatherKind} />{time !== 'day' && <Fireflies />}</>)}
      {base === '大海' && (<><SeaGlints time={time} weatherKind={weatherKind} />{weatherKind !== 'storm' && <Seagulls />}</>)}
      {base === '窗边' && <FloatingPages time={time} weatherKind={weatherKind} />}
      {base === '云海' && <CloudPearls time={time} weatherKind={weatherKind} />}
      <Suspense fallback={null}>
        <SceneCompanion base={base} pokeNonce={pokeNonce} />
      </Suspense>
    </>
  );
}

// ============================================================
// 透明前景:场景化 3D 动效 + 特效 + 天气粒子 + 打光,背景与天空由图片层承担
// ============================================================
function ForegroundFX({ base, time, weatherKind, effect, pokeNonce }: { base: SceneBase; time: TimeOfDay; weatherKind: SceneWeatherKind; effect: EffectKind; pokeNonce: number }) {
  const isNight = time === 'night';
  const isDusk = time === 'dusk';
  const sparkleColor = isNight ? '#d8e6ff' : isDusk ? '#ffe2b4' : '#fff2ba';

  return (
    <>
      {isNight && <Sparkles count={70} scale={[20, 9, 38]} size={2} speed={0.12} color="#d8e6ff" opacity={0.7} />}
      <SceneCompanions base={base} time={time} weatherKind={weatherKind} pokeNonce={pokeNonce} />
      <EffectLayer effect={effect} />
      <WeatherAtmosphere kind={weatherKind} />
      <Sparkles count={26} scale={10} size={3} speed={0.3} color={sparkleColor} opacity={0.28} />
      <hemisphereLight args={[isNight ? 0x9fb4e0 : isDusk ? 0xffd2a0 : 0xffe8d0, isNight ? 0x24304e : 0x4a6a8a, isNight ? 0.55 : 0.95]} />
      <directionalLight args={[isNight ? 0xaebfe8 : isDusk ? 0xffa860 : 0xffe2b0, isNight ? 0.5 : 1.1]} position={[-4, 6, -10]} />
      <ambientLight args={[isNight ? 0x44588a : 0x6688aa, 0.32]} />
    </>
  );
}

// ============================================================
// 主页 UI
// ============================================================
const mockToday: TodayMood = {
  primaryMood: '治愈',
  secondaryMoods: ['平静', '放松'],
  scene: '蓝色大海',
  valence: 0.72,
  arousal: 0.35,
  quote: '你心里有很多潮汐，但海也一直在那里。',
  imagery: ['海', '晚霞', '窗边'],
  tags: ['治愈', '海', '晚霞', '平静'],
};

type EffectKind = '无' | '萤火' | '花瓣' | '海鸥' | '烟花' | '流星';

// 今日情绪 → {基底, 时间, 默认特效};基底×时间决定背景图,特效叠在透明画布上
const SCENE_TO_CONFIG: Record<TodayMood['scene'], { base: SceneBase; time?: TimeOfDay; effect: EffectKind }> = {
  森林晨光: { base: '花海', time: 'day', effect: '萤火' },
  阳光草坪: { base: '花海', time: 'day', effect: '花瓣' },
  蓝色大海: { base: '大海', time: 'day', effect: '海鸥' },
  落日海边: { base: '大海', time: 'dusk', effect: '海鸥' },
  雨天窗边: { base: '窗边', time: 'day', effect: '无' },
  星空夜晚: { base: '大海', time: 'night', effect: '流星' },
  海上夜空烟花: { base: '大海', time: 'night', effect: '烟花' },
  云海日出: { base: '云海', time: 'dusk', effect: '海鸥' },
};
const BASE_DEFAULT: Record<SceneBase, { time: TimeOfDay; effect: EffectKind }> = {
  花海: { time: 'day', effect: '花瓣' },
  大海: { time: 'day', effect: '海鸥' },
  窗边: { time: 'day', effect: '无' },
  云海: { time: 'dusk', effect: '海鸥' },
};
const BASE_PREVIEWS: SceneBase[] = ['花海', '大海', '窗边', '云海'];
const TIME_PREVIEWS: { key: TimeOfDay; label: string }[] = [
  { key: 'day', label: '白天' }, { key: 'dusk', label: '黄昏' }, { key: 'night', label: '夜' },
];
const EFFECT_PREVIEWS: EffectKind[] = ['萤火', '花瓣', '海鸥', '烟花', '流星', '无'];
const WEATHER_PREVIEWS: { key: SceneWeatherKind; label: string }[] = [
  { key: 'clear', label: '晴' }, { key: 'cloudy', label: '多云' }, { key: 'rain', label: '小雨' },
  { key: 'storm', label: '雷雨' }, { key: 'fog', label: '雾' }, { key: 'snow', label: '雪' },
];

const WEATHER_LABELS: Record<number, string> = {
  0: '晴朗', 1: '大致晴朗', 2: '多云', 3: '阴天',
  45: '有雾', 48: '雾凇',
  51: '毛毛雨', 53: '细雨', 55: '较强细雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  80: '阵雨', 81: '较强阵雨', 82: '强阵雨',
  95: '雷雨', 96: '雷雨伴冰雹', 99: '强雷雨伴冰雹',
};

const COMPANION_CUES: Record<SceneBase, { name: string }> = {
  花海: { name: '潮汐小狐' },
  大海: { name: '远方海鸥' },
  窗边: { name: '窗边纸页' },
  云海: { name: '云上海光' },
};

const COMPANION_QUOTES: Record<SceneBase, string[]> = {
  花海: [
    '今天也不用很努力地开心。',
    '你已经慢慢走过来了。',
    '我帮你把这阵风收起来了。',
  ],
  大海: [
    '海一直都在，不用急。',
    '如果心里很满，就让浪先替你说一会儿。',
    '今天适合把呼吸放慢一点。',
  ],
  窗边: [
    '把这页先翻轻一点，也没关系。',
    '窗外的天气会变，你也可以慢慢变。',
    '此刻适合读一点很轻的文字。',
  ],
  云海: [
    '云会散开，但不用立刻。',
    '先住在这一点微光里。',
    '你不用马上找到答案。',
  ],
};

const SCENE_MOTION_CLASS: Record<SceneBase, string> = {
  花海: 'flower',
  大海: 'sea',
  窗边: 'window',
  云海: 'clouds',
};

const PETAL_MOTION = Array.from({ length: 16 }, (_, index) => ({
  x: (index * 17 + 8) % 100,
  delay: -(index * 1.35),
  duration: 13 + (index % 5) * 2.2,
  size: 7 + (index % 4) * 2,
  drift: index % 2 === 0 ? 26 + (index % 3) * 8 : -22 - (index % 4) * 7,
  rotate: index * 29,
}));

const WISP_MOTION = Array.from({ length: 7 }, (_, index) => ({
  x: -10 + index * 18,
  y: 18 + (index % 3) * 10,
  delay: -(index * 1.8),
  duration: 20 + (index % 4) * 3,
  scale: 0.8 + (index % 3) * 0.18,
}));

const SPARK_MOTION = Array.from({ length: 18 }, (_, index) => ({
  x: (index * 23 + 11) % 100,
  y: 28 + ((index * 19) % 54),
  delay: -(index * 0.82),
  duration: 5.5 + (index % 4),
}));

const GULL_MOTION = Array.from({ length: 4 }, (_, index) => ({
  y: 22 + index * 9,
  delay: -(index * 2.1),
  duration: 18 + index * 3,
  scale: 0.76 + index * 0.14,
}));

const FIREWORK_MOTION = Array.from({ length: 3 }, (_, index) => ({
  x: [28, 58, 76][index],
  y: [24, 18, 31][index],
  delay: -(index * 1.4),
  duration: 4.8 + index * 0.7,
}));

const METEOR_MOTION = Array.from({ length: 3 }, (_, index) => ({
  x: 16 + index * 26,
  y: 16 + index * 9,
  delay: -(index * 2.6),
  duration: 7.5 + index * 1.2,
}));

const cssVars = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;

function SceneMotionOverlay({
  base,
  time,
  weather,
  effect,
}: {
  base: SceneBase;
  time: TimeOfDay;
  weather: SceneWeatherKind;
  effect: EffectKind;
}) {
  const scene = SCENE_MOTION_CLASS[base];
  const showRain = weather === 'rain' || weather === 'storm';
  const showPetals = effect === '花瓣' || (base === '花海' && (weather === 'clear' || weather === 'cloudy'));
  const showSparks = (effect === '萤火' || time === 'night') && weather !== 'storm';

  return (
    <div className={`scene-motion scene-motion--${scene} scene-motion--${time} scene-motion--${weather}`} aria-hidden="true">
      <div className="scene-motion__wash" />
      {base === '花海' && (
        <div className="motion-field">
          <div className="motion-field__wind motion-field__wind--one" />
          <div className="motion-field__wind motion-field__wind--two" />
        </div>
      )}
      {showPetals && PETAL_MOTION.map((petal, index) => (
        <span
          key={index}
          className="motion-petal"
          style={cssVars({
            '--x': `${petal.x}%`,
            '--delay': `${petal.delay}s`,
            '--duration': `${petal.duration}s`,
            '--size': `${petal.size}px`,
            '--drift': `${petal.drift}px`,
            '--rotate': `${petal.rotate}deg`,
          })}
        />
      ))}
      {(base === '云海' || base === '窗边' || weather === 'fog' || weather === 'overcast') && (
        <div className="motion-wisps">
          {WISP_MOTION.map((wisp, index) => (
            <span
              key={index}
              className="motion-wisp"
              style={cssVars({
                '--x': `${wisp.x}%`,
                '--y': `${wisp.y}%`,
                '--delay': `${wisp.delay}s`,
                '--duration': `${wisp.duration}s`,
                '--scale': wisp.scale,
              })}
            />
          ))}
        </div>
      )}
      {showSparks && (
        <div className="motion-sparks">
          {SPARK_MOTION.map((spark, index) => (
            <span
              key={index}
              className="motion-spark"
              style={cssVars({
                '--x': `${spark.x}%`,
                '--y': `${spark.y}%`,
                '--delay': `${spark.delay}s`,
                '--duration': `${spark.duration}s`,
              })}
            />
          ))}
        </div>
      )}
      {effect === '海鸥' && (
        <div className="motion-gulls">
          {GULL_MOTION.map((gull, index) => (
            <span
              key={index}
              className="motion-gull"
              style={cssVars({
                '--y': `${gull.y}%`,
                '--delay': `${gull.delay}s`,
                '--duration': `${gull.duration}s`,
                '--scale': gull.scale,
              })}
            />
          ))}
        </div>
      )}
      {effect === '烟花' && (
        <div className="motion-fireworks">
          {FIREWORK_MOTION.map((burst, index) => (
            <span
              key={index}
              className="motion-firework"
              style={cssVars({
                '--x': `${burst.x}%`,
                '--y': `${burst.y}%`,
                '--delay': `${burst.delay}s`,
                '--duration': `${burst.duration}s`,
              })}
            />
          ))}
        </div>
      )}
      {effect === '流星' && (
        <div className="motion-meteors">
          {METEOR_MOTION.map((meteor, index) => (
            <span
              key={index}
              className="motion-meteor"
              style={cssVars({
                '--x': `${meteor.x}%`,
                '--y': `${meteor.y}%`,
                '--delay': `${meteor.delay}s`,
                '--duration': `${meteor.duration}s`,
              })}
            />
          ))}
        </div>
      )}
      {showRain && <div className={`motion-rain ${weather === 'storm' ? 'is-storm' : ''}`} />}
    </div>
  );
}

const weatherKindFromCode = (code: number | null): SceneWeatherKind => {
  if (code == null || code <= 1) return 'clear';
  if (code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51 && code <= 82) return 'rain';
  return 'cloudy';
};

const formatToday = () => {
  const now = new Date();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${weekday}`;
};

// 按当前时段给「适合读」卡片换称呼:今早 / 午后 / 今天 / 今晚
const readingTimeLabel = () => {
  const h = new Date().getHours();
  if (h < 6) return '此刻适合读';
  if (h < 11) return '今早适合读';
  if (h < 14) return '午后适合读';
  if (h < 19) return '今天适合读';
  return '今晚适合读';
};

export default function HomePage() {
  const navigate = useNavigate();
  const showToast = useStore((s) => s.showToast);
  const realMood = useStore((s) => s.todayMood);
  const records = useStore((s) => s.records);
  const loadRecords = useStore((s) => s.loadRecords);
  const hasData = records.length > 0;
  const hasMoodData = hasData && Boolean(realMood); // 没有真实记录画像前,不编造今日心情/趋势/标签
  const todayMood = hasMoodData ? realMood! : mockToday;
  const [animalMsg, setAnimalMsg] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const bubbleTimerRef = useRef<number | null>(null);
  const [pokeNonce, setPokeNonce] = useState(0);
  const [weather, setWeather] = useState('天气待定位');
  const [weatherCode, setWeatherCode] = useState<number | null>(null);
  const [userName, setUserName] = useState('');
  const [topRec, setTopRec] = useState<FeedItem | null>(null);
  const [previewBase, setPreviewBase] = useState<SceneBase | null>(null);
  const [previewTime, setPreviewTime] = useState<TimeOfDay | null>(null);
  const [previewWeather, setPreviewWeather] = useState<SceneWeatherKind | null>(null);
  const [previewEffect, setPreviewEffect] = useState<EffectKind | null>(null);
  const [showScenePicker, setShowScenePicker] = useState(false);

  // 今日情绪 → 基底配置(无记录默认花海·白天·萤火),预览可临时覆盖
  const moodConfig = hasMoodData
    ? SCENE_TO_CONFIG[todayMood.scene]
    : { base: '花海' as SceneBase, time: 'day' as TimeOfDay, effect: '萤火' as EffectKind };
  const base: SceneBase = previewBase ?? moodConfig.base;
  const baseDef = BASE_DEFAULT[base];
  const time: TimeOfDay = previewTime ?? (previewBase ? baseDef.time : (moodConfig.time ?? 'day'));
  const effect: EffectKind = previewEffect ?? (previewBase ? baseDef.effect : moodConfig.effect);
  const weatherKind: SceneWeatherKind = previewWeather ?? weatherKindFromCode(weatherCode);
  const lightScene = isLightScene(base, time);
  const previewing = Boolean(previewBase || previewTime || previewWeather || previewEffect);
  const todayJournalSaved = Boolean(localStorage.getItem(`heartide-journal-${new Date().toISOString().slice(0, 10)}`));
  const companionCue = COMPANION_CUES[base];
  const companionQuotes = COMPANION_QUOTES[base];

  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => () => {
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
  }, []);

  const requestWeather = useCallback(async () => {
    const loadWeather = async (latitude: number, longitude: number, location = '') => {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,temperature_2m&timezone=auto`);
      if (!response.ok) throw new Error('weather unavailable');
      const data = await response.json();
      setWeatherCode(data.current?.weather_code ?? null);
      const label = WEATHER_LABELS[data.current?.weather_code];
      const temp = data.current?.temperature_2m;
      setWeather(`${location ? `${location} · ` : ''}${label || '天气更新中'}${temp != null ? ` ${Math.round(temp)}°` : ''}`);
    };
    const loadApproximateWeather = async () => {
      setWeather('城市天气定位中…');
      try {
        const result = await getApproximateWeather();
        setWeatherCode(result.weather_code);
        const label = WEATHER_LABELS[result.weather_code] || '天气更新中';
        setWeather(`${result.city ? `${result.city} · ` : ''}${label}${result.temperature != null ? ` ${Math.round(result.temperature)}°` : ''}`);
      } catch {
        setWeather('城市天气暂不可用，点此重试');
      }
    };

    if (Capacitor.isNativePlatform()) {
      setWeather('定位中…');
      try {
        const permission = await Geolocation.checkPermissions();
        if (permission.location !== 'granted') await Geolocation.requestPermissions();
        const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30 * 60 * 1000 });
        await loadWeather(position.coords.latitude, position.coords.longitude);
      } catch {
        showToast('精确定位不可用，已改用城市级天气');
        await loadApproximateWeather();
      }
      return;
    }
    if (!navigator.geolocation || !window.isSecureContext) {
      await loadApproximateWeather();
      return;
    }
    setWeather('定位中…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        await loadWeather(coords.latitude, coords.longitude);
      } catch {
        setWeather('天气暂不可用');
      }
    }, (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        showToast('精确定位权限关闭，已改用城市级天气');
        void loadApproximateWeather();
      } else if (error.code === error.TIMEOUT) {
        setWeather('定位超时，点此重试');
      } else {
        setWeather('定位失败，点此重试');
      }
    }, { timeout: 10000, maximumAge: 30 * 60 * 1000 });
  }, [showToast]);

  // 进页面即自动弹出定位请求(浏览器权限弹窗)
  useEffect(() => { requestWeather(); }, [requestWeather]);

  // 取登录用户名
  useEffect(() => {
    getMe().then((u) => setUserName(u.display_name)).catch(() => undefined);
  }, []);

  // 当前最高推荐(用于「适合读」卡片):没有真实记录画像前不主动推荐作者/书籍
  useEffect(() => {
    if (!hasMoodData) {
      setTopRec(null);
      return;
    }
    getReadingRecommendations(1, 0)
      .then((result) => {
        const item = result.items[0];
        if (item) setTopRec({ ...item, bgColor: item.bg_color, textColor: item.text_color });
      })
      .catch(() => setTopRec(topRecommendation()));
  }, [hasMoodData]);

  const handleAnimalClick = () => {
    const msg = companionQuotes[Math.floor(Math.random() * companionQuotes.length)];
    setAnimalMsg(msg);
    setShowBubble(true);
    setPokeNonce((n) => n + 1);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setShowBubble(false), 3200);
  };

  return (
    <div className="relative w-full h-full">
      {/* 图片化场景背景 */}
      <SceneBackground base={base} time={time} weather={weatherKind} />

      <SceneMotionOverlay base={base} time={time} weather={weatherKind} effect={effect} />

      <div
        className="home-foreground-3d"
        role="button"
        tabIndex={0}
        aria-label={`和${companionCue.name}互动`}
        onClick={handleAnimalClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleAnimalClick();
          }
        }}
      >
        <Canvas
          camera={{ position: [0, 2.45, 8.2], fov: 47 }}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true }}
        >
          <Suspense fallback={null}>
            <ForegroundFX base={base} time={time} weatherKind={weatherKind} effect={effect} pokeNonce={pokeNonce} />
          </Suspense>
        </Canvas>
      </div>

      {/* UI 浮层 */}
      <div className={`absolute inset-0 z-[4] flex flex-col pointer-events-none ${lightScene ? 'text-[#314a34]' : 'text-white'}`} style={{ textShadow: lightScene ? '0 1px 12px rgba(255,255,255,.85)' : '0 2px 10px rgba(25,35,45,.45)' }}>
        <div className="pointer-events-auto pt-[54px] px-[18px]">
          {/* 品牌标志 + 名称 · 今日心情 */}
          <div className="flex justify-between items-center">
            <div>
              <div className="font-hand text-[34px] leading-none tracking-[0.16em] font-bold">{APP_NAME}</div>
              <div className="mt-1 text-[9px] tracking-[0.35em] opacity-75">HEARTIDE JOURNAL</div>
            </div>
            <div className="flex items-center gap-1.5 glass rounded-[20px] px-3 py-1.5 text-xs">
              🌊 {hasMoodData ? <>今日 <b>{todayMood.primaryMood}</b></> : <span>待你记录</span>}
            </div>
          </div>
          {/* 日期 · 天气(点击重新定位) */}
          <div className="mt-2 text-[13px] drop-shadow-md opacity-95">
            {formatToday()} ·{' '}
            <button
              onClick={requestWeather}
              title="点击重新定位天气"
              className="border-none bg-transparent p-0 text-inherit underline decoration-dotted underline-offset-2 cursor-pointer"
            >
              {weather}
            </button>
          </div>

          {hasMoodData ? (
            <>
              {/* 文案(带用户名问候,更有交流感) */}
              <div className="mt-6 font-hand text-[22px] leading-relaxed drop-shadow-lg max-w-[78%]">
                {userName && <span>{userName}，</span>}{todayMood.quote}
              </div>

              {/* 标签 */}
              <div className="flex gap-2 mt-4 flex-wrap">
                {todayMood.tags.map((tag) => (
                  <div key={tag} className="tag-pill" onClick={() => navigate(`/records?tag=${encodeURIComponent(tag)}`)}>
                    #{tag}
                  </div>
                ))}
              </div>
              <div className={`inline-flex mt-3 rounded-full border border-current/25 px-2.5 py-1 text-[10px] ${lightScene ? 'bg-white/35 text-[#314a34]' : 'bg-black/10 text-white/80'}`}>
                {previewing ? `正在预览 · ${base}${effect !== '无' ? ' · ' + effect : ''}` : `场景由今日情绪自动生成 · ${todayMood.scene}`}
              </div>
            </>
          ) : (
            /* 新用户:探索引导,不编造心情 */
            <div className="mt-6 max-w-[82%]">
              <div className="font-hand text-[22px] leading-relaxed drop-shadow-lg">
                {userName ? `${userName}，` : ''}欢迎来到心潮手帐 🌊
              </div>
              <div className="font-hand text-[15.5px] leading-relaxed drop-shadow-lg mt-2 opacity-95">
                这片海现在还很安静——记下今天的第一件小事，或此刻的一种心情，它会读懂你，然后慢慢为你变天。
              </div>
              <button
                onClick={() => navigate('/record')}
                className="mt-4 inline-flex items-center gap-1.5 bg-white/90 text-leaf-700 font-bold text-[14px] px-5 py-2.5 rounded-[22px] shadow-lg cursor-pointer active:scale-95 transition-transform"
              >
                ✍️ 写下此刻
              </button>
            </div>
          )}
          <div className="relative z-50 mt-3 pointer-events-auto">
            <button onClick={() => setShowScenePicker((value) => !value)} className="rounded-full border border-current/25 bg-white/15 px-3 py-1.5 text-[10px] text-inherit backdrop-blur-md cursor-pointer">
              ◉ 预览场景 / 时间 / 天气 / 特效
            </button>
            {showScenePicker && (
              <div className="absolute top-9 left-0 w-[300px] rounded-2xl border border-white/25 bg-[#26362f]/85 p-3 text-white backdrop-blur-xl shadow-xl">
                <div className="text-[9px] tracking-[0.2em] opacity-60">场景</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {BASE_PREVIEWS.map((b) => <button key={b} onClick={() => setPreviewBase(b)} className={`rounded-full border-none px-2.5 py-1 text-[10px] cursor-pointer ${base === b ? 'bg-white text-leaf-700' : 'bg-white/12 text-white'}`}>{b}</button>)}
                </div>
                <div className="mt-2.5 text-[9px] tracking-[0.2em] opacity-60">时间</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TIME_PREVIEWS.map((t) => <button key={t.key} onClick={() => setPreviewTime(t.key)} className={`rounded-full border-none px-2.5 py-1 text-[10px] cursor-pointer ${time === t.key ? 'bg-white text-leaf-700' : 'bg-white/12 text-white'}`}>{t.label}</button>)}
                </div>
                <div className="mt-2.5 text-[9px] tracking-[0.2em] opacity-60">天气</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {WEATHER_PREVIEWS.map((w) => <button key={w.key} onClick={() => setPreviewWeather(w.key)} className={`rounded-full border-none px-2.5 py-1 text-[10px] cursor-pointer ${weatherKind === w.key ? 'bg-white text-leaf-700' : 'bg-white/12 text-white'}`}>{w.label}</button>)}
                </div>
                <div className="mt-2.5 text-[9px] tracking-[0.2em] opacity-60">特效</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {EFFECT_PREVIEWS.map((e) => <button key={e} onClick={() => setPreviewEffect(e)} className={`rounded-full border-none px-2.5 py-1 text-[10px] cursor-pointer ${effect === e ? 'bg-white text-leaf-700' : 'bg-white/12 text-white'}`}>{e}</button>)}
                </div>
                {previewing && <button onClick={() => { setPreviewBase(null); setPreviewTime(null); setPreviewWeather(null); setPreviewEffect(null); setShowScenePicker(false); showToast('已回到属于当下心情的场景'); }} className="mt-2.5 w-full rounded-xl border border-white/20 bg-white/15 py-1.5 text-[10px] text-white cursor-pointer">回到当下 · 接受此刻的心情</button>}
              </div>
            )}
          </div>
        </div>

        {!showScenePicker && (
          <div className={`scene-companion-bubble scene-companion-bubble--${SCENE_MOTION_CLASS[base]} ${showBubble ? 'is-visible' : ''}`}>
            {animalMsg}
          </div>
        )}

        {/* 底部卡片 */}
        <div className="home-bottom-stack pointer-events-auto mt-auto flex flex-col gap-3 pb-[154px] px-[18px]">
          {/* 趋势(有数据才显示,不对新用户编造) */}
          {hasMoodData && (
            <div className="flex items-center gap-2 glass-card py-2 px-3 text-[11px]">
              <svg width="72" height="20" viewBox="0 0 72 20">
                <polyline points="0,14 10,10 21,15 32,6 43,10 54,4 65,8 72,3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
              </svg>
              <span>本周情绪在慢慢回升 ↗</span>
            </div>
          )}

          {/* 卡片(右上角 › 提示可进入) */}
          <div className="flex gap-2.5">
            <div className="flex-1 glass-card p-3 cursor-pointer active:scale-[0.97] transition-transform" onClick={() => navigate('/collage')}>
              <div className="flex items-center justify-between">
                <div className="text-[11px] opacity-85 tracking-wider">📜 今日拼贴诗</div>
                <span className="text-[15px] opacity-80 leading-none">›</span>
              </div>
              <div className="font-hand text-sm mt-1.5 leading-relaxed">
                {todayJournalSaved
                  ? <>今天的手帐已经装订好<small className="block opacity-75 text-[10px] mt-0.5">点此翻阅或继续编辑</small></>
                  : hasMoodData
                    ? <>素材已经准备好了<small className="block opacity-75 text-[10px] mt-0.5">去装订今天的手帐</small></>
                    : '记一条，就有今天的手帐'}
              </div>
            </div>
            <div className="flex-1 glass-card p-3 cursor-pointer active:scale-[0.97] transition-transform" onClick={() => navigate('/reading')}>
              <div className="flex items-center justify-between">
                <div className="text-[11px] opacity-85 tracking-wider">📖 {readingTimeLabel()}</div>
                <span className="text-[15px] opacity-80 leading-none">›</span>
              </div>
              <div className="font-hand text-sm mt-1.5 leading-relaxed line-clamp-2">
                {hasMoodData ? `「${topRec?.quote ?? '会为你的心情挑一句话'}」` : '先写下一条心情，阅读推荐会在这里慢慢长出来'}
              </div>
              {hasMoodData && topRec && <div className="text-[10px] opacity-70 mt-1 truncate">{topRec.book} · {topRec.author}</div>}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
