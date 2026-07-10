import { ApiError, getCloudState, saveCloudState } from './api';
import type { CloudState } from './api';
import type { Book, JournalMaterial } from './types';

export const LOCAL_STATE_CHANGED_EVENT = 'heartide-local-state-changed';

const BOOKS_KEY = 'moodgarden-books';
const SEEN_KEY = 'moodgarden-seen-books';
const MATERIALS_KEY = 'heartide-journal-materials';
const FEEDBACK_KEY = 'moodgarden-reading-feedback';
const JOURNAL_PREFIX = 'heartide-journal-';
const JOURNAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_KEY = 'heartide-active-account';
const SYNC_VERSION_KEY = 'heartide-sync-version';

type SyncState = Omit<CloudState, 'updated_at'>;

const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
};

const timestamp = (value: unknown) => {
  if (!value || typeof value !== 'object') return 0;
  const candidate = value as { updatedAt?: string; createdAt?: string };
  return Date.parse(candidate.updatedAt || candidate.createdAt || '') || 0;
};

const mergeBooks = (local: Book[], remote: Book[]) => {
  const merged = new Map<string, Book>();
  [...remote, ...local].forEach((book) => {
    const key = `${book.title || ''}::${book.author || ''}`.toLowerCase();
    const current = merged.get(key);
    if (!current || (book.quoteCount || 0) >= (current.quoteCount || 0)) merged.set(key, book);
  });
  return [...merged.values()].slice(0, 500);
};

const mergeMaterials = (local: JournalMaterial[], remote: JournalMaterial[]) => {
  const merged = new Map<string, JournalMaterial>();
  [...remote, ...local].forEach((material) => {
    const key = `${material.text || ''}::${material.sourceLabel || ''}`;
    const current = merged.get(key);
    if (!current || timestamp(material) >= timestamp(current)) merged.set(key, material);
  });
  return [...merged.values()].sort((a, b) => timestamp(b) - timestamp(a)).slice(0, 500);
};

const mergeJournals = (
  local: Record<string, Record<string, unknown>>,
  remote: Record<string, Record<string, unknown>>,
) => {
  const result = { ...remote };
  Object.entries(local).forEach(([date, journal]) => {
    if (!result[date] || timestamp(journal) >= timestamp(result[date])) result[date] = journal;
  });
  return result;
};

const mergeFeedback = (
  local: Record<string, Record<string, number>>,
  remote: Record<string, Record<string, number>>,
) => {
  const result = { ...remote };
  Object.entries(local).forEach(([itemId, actions]) => {
    result[itemId] = { ...(result[itemId] || {}) };
    Object.entries(actions).forEach(([action, count]) => {
      result[itemId][action] = Math.max(count || 0, result[itemId][action] || 0);
    });
  });
  return result;
};

export const collectLocalState = (): SyncState => {
  const journals: Record<string, Record<string, unknown>> = {};
  Object.keys(localStorage)
    .filter((key) => key.startsWith(JOURNAL_PREFIX))
    .forEach((key) => {
      const date = key.slice(JOURNAL_PREFIX.length);
      if (!JOURNAL_DATE_RE.test(date)) return;
      const journal = readJSON<Record<string, unknown> | null>(key, null);
      if (journal) journals[date] = journal;
    });
  return {
    books: readJSON<Book[]>(BOOKS_KEY, []),
    seen_book_ids: readJSON<string[]>(SEEN_KEY, []),
    journal_materials: readJSON<JournalMaterial[]>(MATERIALS_KEY, []),
    journals,
    reading_feedback: readJSON<Record<string, Record<string, number>>>(FEEDBACK_KEY, {}),
  };
};

export const mergeCloudState = (local: SyncState, remote: CloudState): SyncState => ({
  books: mergeBooks(local.books, remote.books),
  seen_book_ids: [...new Set([...remote.seen_book_ids, ...local.seen_book_ids])],
  journal_materials: mergeMaterials(local.journal_materials, remote.journal_materials),
  journals: mergeJournals(local.journals, remote.journals),
  reading_feedback: mergeFeedback(local.reading_feedback, remote.reading_feedback),
});

export const applyCloudState = (state: SyncState) => {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(state.books));
  localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen_book_ids));
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(state.journal_materials));
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(state.reading_feedback));
  Object.entries(state.journals).forEach(([date, journal]) => {
    if (!JOURNAL_DATE_RE.test(date)) return;
    localStorage.setItem(`${JOURNAL_PREFIX}${date}`, JSON.stringify(journal));
  });
};

export const clearSynchronizedLocalState = () => {
  localStorage.removeItem(BOOKS_KEY);
  localStorage.removeItem(SEEN_KEY);
  localStorage.removeItem(MATERIALS_KEY);
  localStorage.removeItem(FEEDBACK_KEY);
  localStorage.removeItem(SYNC_VERSION_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  Object.keys(localStorage)
    .filter((key) => key.startsWith(JOURNAL_PREFIX))
    .filter((key) => JOURNAL_DATE_RE.test(key.slice(JOURNAL_PREFIX.length)))
    .forEach((key) => localStorage.removeItem(key));
};

export const prepareAccountStorage = (userId: string) => {
  const previousAccount = localStorage.getItem(ACCOUNT_KEY);
  if (previousAccount && previousAccount !== userId) clearSynchronizedLocalState();
  localStorage.setItem(ACCOUNT_KEY, userId);
};

const rememberVersion = (state: CloudState) => {
  if (state.updated_at) localStorage.setItem(SYNC_VERSION_KEY, state.updated_at);
};

export const hydrateCloudState = async () => {
  const remote = await getCloudState();
  const merged = mergeCloudState(collectLocalState(), remote);
  applyCloudState(merged);
  rememberVersion(await saveCloudState({ ...merged, updated_at: remote.updated_at }));
  return merged;
};

export const pushCloudState = async () => {
  const local = collectLocalState();
  try {
    const saved = await saveCloudState({ ...local, updated_at: localStorage.getItem(SYNC_VERSION_KEY) });
    rememberVersion(saved);
    return saved;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const remote = await getCloudState();
    const merged = mergeCloudState(local, remote);
    applyCloudState(merged);
    const saved = await saveCloudState({ ...merged, updated_at: remote.updated_at });
    rememberVersion(saved);
    return saved;
  }
};

export const notifyLocalStateChanged = () => {
  window.dispatchEvent(new Event(LOCAL_STATE_CHANGED_EVENT));
};
