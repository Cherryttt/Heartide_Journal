export type Mood =
  | '无情绪' | '积极' | '悲伤' | '愤怒' | '恐惧' | '惊奇';

export type SceneType = '森林晨光' | '海上夜空烟花' | '阳光草坪' | '蓝色大海' | '雨天窗边' | '星空夜晚' | '落日海边' | '云海日出';

export type RecordType = '吃喝' | '书摘' | '灵感' | '此刻';

export interface EmotionDistribution {
  mood: Mood;
  probability: number;
  color: string;
}

export interface Record {
  id: string;
  text: string;
  imageUrl?: string;
  type: RecordType;
  emotions: EmotionDistribution[];
  tags: string[];
  colors: string[];
  imagery: string[];
  valence: number;
  arousal: number;
  intensity: number;
  manualMood?: Mood;
  createdAt: string;
}

export interface Quote {
  id: string;
  bookId: string;
  text: string;
  highlightColor: string;
  note?: string;
  tags: string[];
  emotionWhenSaved: Mood;
  isCollected: boolean;
  source: string;
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  quoteCount: number;
  bookColor: string;
  isGlowing: boolean;
  /** 收藏时一起带上架的代表性书摘(行为驱动书架用) */
  sampleQuote?: string;
  sampleTags?: string[];
}

export interface Poem {
  id: string;
  text: string;
  sourceRecordIds: string[];
  authorStyle: string;
  layout: string;
  isCollected: boolean;
  createdAt: string;
}

export interface WordEntry {
  id: string;
  word: string;
  roman: string;
  lang: string;
  meaning: string;
  literal: string;
  why: string;
  isCoined: boolean;
  createdAt: string;
}

export interface JournalMaterial {
  id: string;
  text: string;
  sourceType: 'reading' | 'agent' | 'word' | 'bookshelf';
  sourceLabel: string;
  createdAt: string;
}

export interface Persona {
  key: string;
  avatar: string;
  color: string;
  group: '作者' | '陪伴';
  role: string;
  hello: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  source?: string;
  recommendation?: {
    quote: string;
    book: string;
  };
  timestamp: string;
}

export interface TodayMood {
  primaryMood: Mood;
  secondaryMoods: Mood[];
  scene: SceneType;
  valence: number;
  arousal: number;
  quote: string;
  imagery: string[];
  tags: string[];
}

export interface UserProfile {
  animalType: string;
  animalEmoji: string;
  description: string;
  personality: string;
  frequentImagery: string[];
  frequentMoods: { mood: Mood; score: number; percentage: number; color: string }[];
  emotionTrend: Mood[];
  readingPrefs: { category: string; percentage: number }[];
  healingCopy: string;
  recommendedAuthors: string[];
}
