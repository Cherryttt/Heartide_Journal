import type { Mood, SceneType } from './types';

export const EMOTION_LIST = ['无情绪', '积极', '悲伤', '愤怒', '恐惧', '惊奇'] as const satisfies readonly Mood[];

export const EMOTION_META: Record<Mood, {
  display: string;
  color: string;
  emoji: string;
  scene: SceneType;
  quote: string;
}> = {
  无情绪: {
    display: '无波',
    color: '#8d9398',
    emoji: '○',
    scene: '星空夜晚',
    quote: '无波也是一种状态，先让自己安静地停一会儿。',
  },
  积极: {
    display: '欣然',
    color: '#d79b45',
    emoji: '✦',
    scene: '森林晨光',
    quote: '今天有一点光，正好落在你愿意向前的地方。',
  },
  悲伤: {
    display: '低落',
    color: '#6f86a6',
    emoji: '☔',
    scene: '雨天窗边',
    quote: '低落可以慢慢经过你，不必急着把它赶走。',
  },
  愤怒: {
    display: '愠怒',
    color: '#c85f4a',
    emoji: '◇',
    scene: '落日海边',
    quote: '这份愠怒也许在提醒你：有些边界值得被看见。',
  },
  恐惧: {
    display: '惶然',
    color: '#8b78a6',
    emoji: '◆',
    scene: '星空夜晚',
    quote: '惶然的时候，先把脚下这一小步照亮。',
  },
  惊奇: {
    display: '惊奇',
    color: '#5f9fb4',
    emoji: '✧',
    scene: '云海日出',
    quote: '意外忽然推开门，世界露出另一种纹理。',
  },
};

export function isCanonicalMood(value: unknown): value is Mood {
  return typeof value === 'string' && EMOTION_LIST.includes(value as Mood);
}

export function getEmotionMeta(value: unknown) {
  return isCanonicalMood(value) ? EMOTION_META[value] : undefined;
}

export function getEmotionDisplay(value: unknown) {
  const meta = getEmotionMeta(value);
  return meta?.display ?? (value ? `${String(value)}（旧）` : '未知');
}
