import { create } from 'zustand';
import type { Record as MoodRecord, TodayMood, UserProfile, Persona, AgentMessage, Book, JournalMaterial, RecordType, Mood } from './types';
import { listRecords } from './api';
import type { RecordResponse } from './api';
import { notifyLocalStateChanged } from './cloudSync';
import { EMOTION_META, getEmotionDisplay, isCanonicalMood } from './emotionMeta';

// —— 书架持久化:行为驱动,新用户为空,收藏书摘后书会自己上架 ——
const BOOKS_KEY = 'moodgarden-books';
const SEEN_KEY = 'moodgarden-seen-books';
const MATERIALS_KEY = 'heartide-journal-materials';
const RECORDS_CACHE_KEY = 'heartide-records-cache';
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// 后端记录响应 → 前端记录模型(此前在 HomePage / RecordHistoryPage 重复了三遍)
const mapRecordResponse = (item: RecordResponse): MoodRecord => ({
  id: item.id,
  text: item.text,
  type: item.record_type as RecordType,
  emotions: item.emotions,
  tags: item.tags,
  colors: item.colors,
  imagery: item.imagery,
  valence: item.valence,
  arousal: item.arousal,
  intensity: Math.max(...item.emotions.map((emotion) => emotion.probability), 0.5),
  manualMood: isCanonicalMood(item.manual_mood) ? item.manual_mood : undefined,
  imageUrl: item.image_url,
  createdAt: item.created_at,
});

interface AddBookInput {
  title: string;
  author: string;
  color: string;
  category?: string;
  quote?: string;
  tags?: string[];
}

function deriveTodayMood(records: MoodRecord[]): TodayMood {
  const today = new Date().toDateString();
  const todaysRecords = records.filter((record) => new Date(record.createdAt).toDateString() === today);
  const source = todaysRecords.length ? todaysRecords : records.slice(0, 1);
  const scores = new Map<string, number>();
  source.forEach((record) => record.emotions.forEach((emotion) => {
    if (isCanonicalMood(emotion.mood)) scores.set(emotion.mood, (scores.get(emotion.mood) || 0) + emotion.probability);
  }));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([mood]) => mood) as TodayMood['secondaryMoods'];
  const primaryMood = ranked[0] || '无情绪';
  const imagery = [...new Set(source.flatMap((record) => record.imagery))].slice(0, 3);
  const tags = [...new Set([getEmotionDisplay(primaryMood), ...source.flatMap((record) => record.tags), ...imagery])].slice(0, 5);
  return {
    primaryMood,
    secondaryMoods: ranked.slice(1, 3),
    scene: EMOTION_META[primaryMood].scene,
    valence: source.reduce((sum, record) => sum + record.valence, 0) / Math.max(source.length, 1),
    arousal: source.reduce((sum, record) => sum + record.arousal, 0) / Math.max(source.length, 1),
    quote: EMOTION_META[primaryMood].quote,
    imagery: imagery.length ? imagery : ['风', '光'],
    tags,
  };
}

const INITIAL_RECORDS = loadJSON<MoodRecord[]>(RECORDS_CACHE_KEY, []);

const persistRecords = (records: MoodRecord[]) => {
  localStorage.setItem(RECORDS_CACHE_KEY, JSON.stringify(records.slice(0, 200)));
};

interface AppState {
  // 当前页面
  currentPage: string;
  setPage: (page: string) => void;

  // 今日情绪
  todayMood: TodayMood | null;
  setTodayMood: (mood: TodayMood) => void;

  // 记录列表
  records: MoodRecord[];
  addRecord: (record: MoodRecord) => void;
  setRecords: (records: MoodRecord[]) => void;
  /** 记录还没加载时从后端拉取一次(任何页面都可调用,已加载则直接返回) */
  loadRecords: (force?: boolean) => Promise<boolean>;

  // 书架(行为驱动:收藏书摘 → 自动上架;新用户为空)
  books: Book[];
  addBook: (input: AddBookInput) => void;
  seenBookIds: string[];
  markBookSeen: (id: string) => void;

  // 跨页面统一手帐素材库
  journalMaterials: JournalMaterial[];
  addJournalMaterial: (material: Omit<JournalMaterial, 'id' | 'createdAt'>) => void;
  removeJournalMaterial: (id: string) => void;
  hydrateLocalCollections: () => void;

  // 用户画像
  profile: UserProfile | null;
  setProfile: (profile: UserProfile) => void;

  // Agent 对话
  activePersona: Persona | null;
  setActivePersona: (persona: Persona) => void;
  messages: AgentMessage[];
  addMessage: (msg: AgentMessage) => void;

  // Toast
  toast: string;
  showToast: (msg: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  currentPage: 'home',
  setPage: (page) => set({ currentPage: page }),

  todayMood: INITIAL_RECORDS.length ? deriveTodayMood(INITIAL_RECORDS) : null,
  setTodayMood: (mood) => set({ todayMood: mood }),

  records: INITIAL_RECORDS,
  addRecord: (record) => set((state) => {
    const records = [record, ...state.records.filter((item) => item.id !== record.id)].slice(0, 200);
    persistRecords(records);
    return { records, todayMood: deriveTodayMood(records) };
  }),
  setRecords: (records) => {
    persistRecords(records);
    set({ records, todayMood: records.length ? deriveTodayMood(records) : null });
  },
  loadRecords: async (force = false) => {
    if (!force && get().records.length) return true;
    try {
      const items = await listRecords();
      get().setRecords(items.map(mapRecordResponse));
      return true;
    } catch {
      return false;
    }
  },

  books: loadJSON<Book[]>(BOOKS_KEY, []),
  addBook: (input) => set((state) => {
    const existing = state.books.find((b) => b.title === input.title && b.author === input.author);
    let books: Book[];
    if (existing) {
      // 已在架:划线数 +1,重新冒泡到最前
      const updated: Book = { ...existing, quoteCount: existing.quoteCount + 1 };
      books = [updated, ...state.books.filter((b) => b !== existing)];
    } else {
      const newBook: Book = {
        id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: input.title,
        author: input.author,
        cover: input.color,
        bookColor: input.color,
        category: input.category || '其它',
        quoteCount: 1,
        isGlowing: true,
        sampleQuote: input.quote,
        sampleTags: input.tags,
      };
      books = [newBook, ...state.books];
    }
    localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
    notifyLocalStateChanged();
    return { books };
  }),
  seenBookIds: loadJSON<string[]>(SEEN_KEY, []),
  markBookSeen: (id) => set((state) => {
    if (state.seenBookIds.includes(id)) return state;
    const seenBookIds = [...state.seenBookIds, id];
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenBookIds));
    notifyLocalStateChanged();
    return { seenBookIds };
  }),

  journalMaterials: loadJSON<JournalMaterial[]>(MATERIALS_KEY, []),
  addJournalMaterial: (material) => set((state) => {
    const duplicate = state.journalMaterials.find((item) => item.text === material.text);
    if (duplicate) return state;
    const journalMaterials = [{
      ...material,
      id: `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    }, ...state.journalMaterials].slice(0, 80);
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(journalMaterials));
    notifyLocalStateChanged();
    return { journalMaterials };
  }),
  removeJournalMaterial: (id) => set((state) => {
    const journalMaterials = state.journalMaterials.filter((item) => item.id !== id);
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(journalMaterials));
    notifyLocalStateChanged();
    return { journalMaterials };
  }),
  hydrateLocalCollections: () => set({
    books: loadJSON<Book[]>(BOOKS_KEY, []),
    seenBookIds: loadJSON<string[]>(SEEN_KEY, []),
    journalMaterials: loadJSON<JournalMaterial[]>(MATERIALS_KEY, []),
  }),

  profile: null,
  setProfile: (profile) => set({ profile }),

  activePersona: null,
  setActivePersona: (persona) => set({ activePersona: persona }),

  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  toast: '',
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: '' }), 1800);
  },
}));
