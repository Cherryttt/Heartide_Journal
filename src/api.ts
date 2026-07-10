/**
 * MoodGarden API 客户端
 * 封装所有后端 API 调用
 */

import type { Book, JournalMaterial, Mood } from './types';
import { Capacitor } from '@capacitor/core';

const BASE_URL = import.meta.env.VITE_API_URL
  || (Capacitor.isNativePlatform() ? localStorage.getItem('heartide-api-url') || 'http://10.0.2.2:8000' : '');
const TOKEN_KEY = 'moodgarden-auth-token';

export const getApiBaseUrl = () => BASE_URL;
export const setNativeApiUrl = (url: string) => localStorage.setItem('heartide-api-url', url.replace(/\/$/, ''));
export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);
export const setAuthToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error('无法连接后端，请确认后端已启动后再试');
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({ detail: res.statusText }));
  const detail = typeof err.detail === 'string' ? err.detail : err.detail?.message;
  if (res.status === 401) return '登录已过期，请重新登录';
  if (res.status === 429) return '操作太频繁了，请稍等一会儿再试';
  if (res.status >= 500) return '后端暂时没有回应，请稍后重试';
  return detail || `HTTP ${res.status}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await safeFetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    if (res.status === 401 && getAuthToken()) {
      clearAuthToken();
      window.location.reload();
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<{ access_token: string }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export async function register(email: string, password: string, display_name: string): Promise<{ access_token: string }> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) });
}

export interface MeResponse { id: string; email: string; display_name: string; }
/** 当前登录用户(用于主页问候等) */
export async function getMe(): Promise<MeResponse> {
  return request('/api/auth/me');
}

export async function deleteAccount(password: string): Promise<{ deleted: boolean }> {
  return request('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) });
}

// ============================================================
// 类型
// ============================================================
export interface EmotionItem {
  mood: Mood;
  probability: number;
  color: string;
}

export interface EmotionAnalysis {
  emotions: EmotionItem[];
  valence: number;
  arousal: number;
  tags: string[];
  colors: string[];
  imagery: string[];
  confidence: number;
  model_source: string;
  calibrated: boolean;
  risk_level: 'none' | 'elevated' | 'high';
  safety_message?: string;
}

export interface RecordResponse {
  id: string;
  text: string;
  record_type: string;
  emotions: EmotionItem[];
  valence: number;
  arousal: number;
  tags: string[];
  colors: string[];
  imagery: string[];
  manual_mood?: string;
  image_url?: string;
  created_at: string;
  confidence?: number;
  model_source?: string;
  calibrated?: boolean;
  risk_level?: 'none' | 'elevated' | 'high';
  safety_message?: string;
}

export interface ChatResponse {
  reply: string;
  source?: string;
}

export interface PoemResponse {
  poem_text: string;
  style: string;
  source_records: string[];
}

export interface WordResponse {
  word: string;
  language: string;
  roman: string;
  meaning: string;
  literal: string;
  is_coined: boolean;
  reason: string;
}

export interface LibrarySearchResponse {
  books: { id: string; title: string; author: string; category: string; cover: string; collect_count: number }[];
  quotes: { id: string; text: string; note: string; source: string; book_id: string; book_title: string; author: string }[];
}

export interface WeReadBookResult {
  searchIdx: number;
  readingCount?: number;
  bookInfo: {
    bookId: string;
    title: string;
    author: string;
    cover?: string;
    intro?: string;
    category?: string;
    soldout?: number;
    newRating?: number;
    newRatingCount?: number;
    newRatingDetail?: { title?: string };
  };
}

export interface WeReadSearchResponse {
  sid?: string;
  hasMore?: number;
  results: {
    title: string;
    scope: number;
    scopeCount: number;
    currentCount: number;
    books: WeReadBookResult[];
  }[];
}

export interface ReadingRecommendationItem {
  id: string;
  quote: string;
  book: string;
  author: string;
  cover: string;
  reason: string;
  bg_color: string;
  text_color: string;
  passage: string;
  tags: string[];
  score: number;
}

export interface ReadingRecommendationResponse {
  items: ReadingRecommendationItem[];
  profile_summary: string[];
}

export interface CloudState {
  books: Book[];
  seen_book_ids: string[];
  journal_materials: JournalMaterial[];
  journals: Record<string, Record<string, unknown>>;
  reading_feedback: Record<string, Record<string, number>>;
  updated_at?: string | null;
}

export interface HealthResponse {
  status: string;
  version?: string;
  database?: string;
  database_backend?: string;
  llm_configured: boolean;
  image_generation_configured?: boolean;
  image_model?: string;
  weread_configured?: boolean;
  object_storage_configured?: boolean;
  embedding_model?: string;
  emotion_model_loaded?: boolean;
  emotion_model_calibrated?: boolean;
  emotion_model_metrics?: Record<string, unknown>;
}

// ============================================================
// API 方法
// ============================================================

/** 情绪分析 */
export async function analyzeEmotion(text: string): Promise<EmotionAnalysis> {
  return request<EmotionAnalysis>(`/api/analyze?text=${encodeURIComponent(text)}`);
}

/** 创建记录 */
export async function createRecord(data: {
  text: string;
  record_type?: string;
  image_url?: string;
  manual_mood?: string;
}): Promise<RecordResponse> {
  return request<RecordResponse>('/api/records', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 获取记录列表 */
export async function listRecords(): Promise<RecordResponse[]> {
  return request<RecordResponse[]>('/api/records');
}

/** 删除记录 */
export async function deleteRecord(id: string): Promise<void> {
  return request('/api/records/' + id, { method: 'DELETE' });
}

/** Agent 对话 */
export async function chat(data: {
  message: string;
  persona_key: string;
  history: { role: string; text: string }[];
}): Promise<ChatResponse> {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function streamChat(
  data: {
    message: string;
    persona_key: string;
    history: { role: string; text: string }[];
  },
  onChunk: (chunk: string) => void,
): Promise<void> {
  const res = await safeFetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok || !res.body) {
    throw new Error(await readErrorMessage(res));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) onChunk(chunk);
  }
  const finalChunk = decoder.decode();
  if (finalChunk) onChunk(finalChunk);
}

export async function uploadAsset(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await safeFetch(`${BASE_URL}/api/assets/upload`, {
    method: 'POST',
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const result = await res.json();
  return { url: result.url?.startsWith('/') ? `${BASE_URL}${result.url}` : result.url };
}

export async function describeImage(file: File): Promise<{ description: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await safeFetch(`${BASE_URL}/api/images/describe`, {
    method: 'POST',
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res.json();
}

/** 生成拼贴诗 */
export async function generatePoem(data: {
  style: string;
  records?: string[];
}): Promise<PoemResponse> {
  return request<PoemResponse>('/api/poem/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rewriteFragments(texts: string[], style = '保留原声'): Promise<{ lines: string[] }> {
  return request('/api/journal/rewrite-fragments', { method: 'POST', body: JSON.stringify({ texts, style }) });
}

export async function generateJournalImage(prompt: string): Promise<{ url: string }> {
  return request('/api/journal/image', { method: 'POST', body: JSON.stringify({ prompt }) });
}

/** 拾词 */
export async function findWord(text: string, avoidWords: string[] = []): Promise<WordResponse> {
  return request<WordResponse>('/api/word/find', {
    method: 'POST',
    body: JSON.stringify({ feeling_text: text, avoid_words: avoidWords }),
  });
}

/** 收藏拾到的词 */
export async function saveWord(word: WordResponse, sourceRecordId?: string): Promise<{ id: string; saved: boolean }> {
  return request('/api/words', {
    method: 'POST',
    body: JSON.stringify({ ...word, source_record_id: sourceRecordId }),
  });
}

export async function listWords(): Promise<(WordResponse & { id: string; created_at: string })[]> {
  return request('/api/words');
}

/** 搜索书架与摘录 */
export async function searchLibrary(keyword: string): Promise<LibrarySearchResponse> {
  return request(`/api/library/search?keyword=${encodeURIComponent(keyword)}`);
}

export async function getReadingRecommendations(count = 12, offset = 0): Promise<ReadingRecommendationResponse> {
  return request(`/api/recommendations/reading?count=${count}&offset=${offset}`);
}

export async function saveReadingFeedback(data: {
  item_id: string;
  action: 'favorite' | 'highlight' | 'dislike';
  book_title: string;
  author: string;
  category?: string;
  tags: string[];
}): Promise<{ saved: boolean }> {
  return request('/api/recommendations/reading/feedback', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getCloudState(): Promise<CloudState> {
  return request('/api/sync/state');
}

export async function saveCloudState(state: CloudState): Promise<CloudState> {
  return request('/api/sync/state', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
}

/** 微信读书连接状态 */
export async function getWeReadStatus(): Promise<{ connected: boolean; message: string }> {
  return request('/api/wechat-read/status');
}

/** 搜索微信读书书城 */
export async function searchWeRead(keyword: string): Promise<WeReadSearchResponse> {
  return request(`/api/wechat-read/search?keyword=${encodeURIComponent(keyword)}&scope=0&count=20`);
}

/** 同步微信读书划线到 MoodGarden */
export async function syncWeRead(): Promise<{ imported: number; total_books: number }> {
  return request('/api/wechat-read/sync-to-moodgarden', { method: 'POST' });
}

/** 微信读书导入指南 */
export async function getImportGuide(): Promise<{ guide: string }> {
  return request('/api/quotes/import-guide');
}

/** 导入微信读书文本 */
export async function importQuotesText(text: string): Promise<{ imported: number; skipped?: number }> {
  return request('/api/quotes/import-text', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** 导入 JSON 格式书摘 */
export async function importQuotesJson(quotes: {
  quote_text: string;
  book_title: string;
  author: string;
  note?: string;
  highlight_color?: string;
}[]): Promise<{ imported: number }> {
  return request('/api/quotes/import-json', {
    method: 'POST',
    body: JSON.stringify(quotes),
  });
}

/** 健康检查 */
export async function healthCheck(): Promise<HealthResponse> {
  return request('/api/health');
}

export async function getApproximateWeather(): Promise<{ city: string; weather_code: number; temperature: number }> {
  return request('/api/weather/approx');
}
