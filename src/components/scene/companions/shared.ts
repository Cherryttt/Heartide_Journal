import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

export interface CompanionProps {
  /** 每次"戳一戳"自增;伙伴据此播放一次反应动作 */
  pokeNonce: number;
}

export const LEFT_PREVIEW_COMPANION_ANCHOR = {
  x: -3.62,
  y: 0.58,
  z: 2.58,
} as const;

/**
 * 戳一戳反应包络:戳一下把值置为 1,组件在 useFrame 里自行衰减到 0。
 * 用法:
 *   const poke = usePokeEnvelope(pokeNonce);
 *   useFrame((_, dt) => { poke.current = Math.max(0, poke.current - dt / 0.5); ...用 poke.current 做位移/缩放 });
 */
export function usePokeEnvelope(pokeNonce: number): MutableRefObject<number> {
  const env = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; } // 跳过初始挂载,避免一进页面就触发
    env.current = 1;
  }, [pokeNonce]);
  return env;
}
