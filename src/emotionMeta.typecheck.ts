import { EMOTION_META, getEmotionDisplay, isCanonicalMood } from './emotionMeta';
import type { Mood } from './types';

const expectedDisplay: Record<Mood, string> = {
  无情绪: '无波',
  积极: '欣然',
  悲伤: '低落',
  愤怒: '愠怒',
  恐惧: '惶然',
  惊奇: '惊奇',
};

for (const mood of Object.keys(expectedDisplay) as Mood[]) {
  if (EMOTION_META[mood].display !== expectedDisplay[mood]) {
    throw new Error(`Unexpected display label for ${mood}`);
  }
}

const label: string = getEmotionDisplay('惊奇');
if (label !== '惊奇') throw new Error('surprise display must stay neutral');
if (isCanonicalMood('惊喜')) throw new Error('惊喜 is not a canonical v2 emotion label');
