export type TimeOfDay = 'day' | 'dusk' | 'night';
export type SceneBase = '花海' | '大海' | '窗边' | '云海';
export type SceneImageAspect = 'portrait' | 'landscape';
export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog';

export const BASE_TO_SLUG: Record<SceneBase, string> = {
  花海: 'flower',
  大海: 'sea',
  窗边: 'window',
  云海: 'clouds',
};

export const sceneImageUrl = (
  base: SceneBase,
  time: TimeOfDay,
  aspect: SceneImageAspect = 'portrait',
): string => {
  const folder = aspect === 'landscape' ? 'landscape/' : '';
  return `/scenes/${folder}${BASE_TO_SLUG[base]}-${time}.webp`;
};

export const isLightScene = (base: SceneBase, time: TimeOfDay): boolean => {
  if (time === 'night') return false;
  if (base === '大海' && time === 'dusk') return false;
  if (base === '云海' && time === 'dusk') return false;
  return true;
};

export const weatherOverlay = (weather: WeatherKind): string | null => {
  switch (weather) {
    case 'cloudy':
      return 'rgba(170,185,195,0.18)';
    case 'overcast':
      return 'rgba(90,105,120,0.32)';
    case 'rain':
      return 'rgba(40,55,75,0.34)';
    case 'storm':
      return 'rgba(20,30,45,0.50)';
    case 'fog':
      return 'rgba(225,230,232,0.40)';
    case 'snow':
      return 'rgba(235,242,248,0.20)';
    default:
      return null;
  }
};

const GRADIENTS: Record<SceneBase, Record<TimeOfDay, string>> = {
  花海: {
    day: 'linear-gradient(180deg,#bfe0f5 0%,#dcebf0 45%,#f4d8e6 100%)',
    dusk: 'linear-gradient(180deg,#8f7fb0 0%,#e08fa0 50%,#ffce9b 100%)',
    night: 'linear-gradient(180deg,#101a3a 0%,#22305a 55%,#3a3360 100%)',
  },
  大海: {
    day: 'linear-gradient(180deg,#aedcf0 0%,#cfe6ea 50%,#e9efd8 100%)',
    dusk: 'linear-gradient(180deg,#54618f 0%,#cf8f8f 50%,#ffd49a 100%)',
    night: 'linear-gradient(180deg,#0e1736 0%,#1c2750 55%,#33406e 100%)',
  },
  窗边: {
    day: 'linear-gradient(180deg,#eaf2e6 0%,#dfeadb 60%,#cbe0cf 100%)',
    dusk: 'linear-gradient(180deg,#efe0cf 0%,#e8caa6 60%,#c89a6a 100%)',
    night: 'linear-gradient(180deg,#16203c 0%,#26314f 60%,#3a3a52 100%)',
  },
  云海: {
    day: 'linear-gradient(180deg,#7fb3e6 0%,#cfe2f1 55%,#fde6c8 100%)',
    dusk: 'linear-gradient(180deg,#6f6aa0 0%,#d49bc7 50%,#ffce9b 100%)',
    night: 'linear-gradient(180deg,#101a3a 0%,#2a2f5e 55%,#4a3f6a 100%)',
  },
};

export const fallbackGradient = (base: SceneBase, time: TimeOfDay): string =>
  GRADIENTS[base][time];
