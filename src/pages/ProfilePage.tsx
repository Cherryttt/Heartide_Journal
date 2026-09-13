import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import type { Mood, UserProfile } from '../types';
import { clearAuthToken, deleteAccount, listWords } from '../api';
import { clearSynchronizedLocalState, LOCAL_STATE_CHANGED_EVENT, pushCloudState } from '../cloudSync';
import { EMOTION_META, getEmotionDisplay, isCanonicalMood } from '../emotionMeta';

const HEAT_COLORS = ['#e8e0d0', '#e0d8c0', '#d8c8a0', '#c8b080', '#b89860', '#a88040'];
const PORTRAIT_CLOSED_KEY = 'moodgarden-portrait-closed';
const MONTH_LABELS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WORD_CACHE_KEY = 'heartide-word-cache';
const MOOD_TEXT_COLORS: Record<Mood, string> = Object.fromEntries(
  Object.entries(EMOTION_META).map(([mood, meta]) => [mood, meta.color]),
) as Record<Mood, string>;

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-gradient-to-b from-[#eaf1f0] via-[#f3eee6] to-[#efe7df]">
    <div className="page-scroll-padding px-4 pt-[52px] pb-[104px]">{children}</div>
  </div>
);

export default function ProfilePage() {
  const showToast = useStore((s) => s.showToast);
  const navigate = useNavigate();
  const records = useStore((s) => s.records);
  const books = useStore((s) => s.books);
  const loadRecords = useStore((s) => s.loadRecords);
  const hasRecords = records.length > 0;
  const [closed, setClosed] = useState(() => localStorage.getItem(PORTRAIT_CLOSED_KEY) === '1');
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [savedWords, setSavedWords] = useState<{ word: string; meaning: string; language: string }[]>([]);
  const [recordsUnavailable, setRecordsUnavailable] = useState(false);
  const portraitMonth = MONTH_LABELS[new Date().getMonth()];

  const readCachedWords = () => {
    try { return JSON.parse(localStorage.getItem(WORD_CACHE_KEY) || '[]') as { word: string; meaning: string; language: string }[]; } catch { return []; }
  };

  useEffect(() => {
    let disposed = false;
    const refreshWords = async () => {
      try {
        const mapped = (await listWords()).map((w) => ({ word: w.word, meaning: w.meaning, language: w.language }));
        if (disposed) return;
        setSavedWords(mapped);
        localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(mapped));
      } catch {
        if (!disposed) setSavedWords(readCachedWords());
      }
    };
    void refreshWords();
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, refreshWords);
    return () => {
      disposed = true;
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, refreshWords);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    loadRecords().then((ok) => {
      if (!disposed) setRecordsUnavailable(!ok && useStore.getState().records.length === 0);
    });
    return () => { disposed = true; };
  }, [loadRecords]);

  const profile = useMemo<UserProfile>(() => {
    const moodScores = new Map<Mood, number>();
    records.forEach((record) => record.emotions.forEach((emotion) => {
      if (isCanonicalMood(emotion.mood)) moodScores.set(emotion.mood, (moodScores.get(emotion.mood) || 0) + emotion.probability);
    }));
    const dominantMood = [...moodScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '无情绪';
    const moodTotal = [...moodScores.values()].reduce((sum, score) => sum + score, 0);
    const frequentMoods = [...moodScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([mood, score]) => ({
        mood,
        score,
        percentage: Math.round((score / Math.max(moodTotal, 1)) * 100),
        color: MOOD_TEXT_COLORS[mood] || '#6f7b68',
      }));
    const animalByMood: Record<Mood, { name: string; emoji: string; traits: string; healing: string }> = {
      无情绪: { name: '静水型', emoji: '○', traits: '留白 · 缓慢 · 暂停', healing: '无波也是一种状态，先让自己安静地停一会儿。' },
      积极: { name: '向光型', emoji: '✦', traits: '明亮 · 开展 · 愿意靠近', healing: '把今天的光留一点给明天，你正在向前。' },
      悲伤: { name: '雨声型', emoji: '☔', traits: '细腻 · 柔软 · 感受丰沛', healing: '低落可以慢慢经过你，不必急着把它赶走。' },
      愤怒: { name: '火线型', emoji: '◇', traits: '清醒 · 有边界 · 需要表达', healing: '这份愠怒也许在提醒你：有些边界值得被看见。' },
      恐惧: { name: '雾灯型', emoji: '◆', traits: '敏锐 · 谨慎 · 渴望安稳', healing: '惶然的时候，先把脚下这一小步照亮。' },
      惊奇: { name: '星点型', emoji: '✧', traits: '开放 · 被触动 · 重新看见', healing: '意外忽然推开门，世界露出另一种纹理。' },
    };
    const animal = animalByMood[dominantMood];

    const imageryCounts = new Map<string, number>();
    records.forEach((record) => [...record.imagery, ...record.tags].forEach((item) => {
      if (item && item !== dominantMood && item !== getEmotionDisplay(dominantMood)) imageryCounts.set(item, (imageryCounts.get(item) || 0) + 1);
    }));
    const frequentImagery = [...imageryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([item]) => item);

    const emotionTrend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const sameDay = records.filter((record) => new Date(record.createdAt).toDateString() === date.toDateString());
      const scores = new Map<Mood, number>();
      sameDay.forEach((record) => record.emotions.forEach((emotion) => {
        if (isCanonicalMood(emotion.mood)) scores.set(emotion.mood, (scores.get(emotion.mood) || 0) + emotion.probability);
      }));
      return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '无情绪';
    });

    const platformCategories = new Set(['微信读书', '微信读书导入', '微信读书同步', '书架', '其它']);
    const normalizeReadingCategory = (category?: string) => {
      const value = category?.trim();
      if (!value || platformCategories.has(value)) return '文学摘录';
      return value;
    };
    const categoryCounts = new Map<string, number>();
    books.forEach((book) => {
      const category = normalizeReadingCategory(book.category);
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + book.quoteCount);
    });
    const categoryTotal = [...categoryCounts.values()].reduce((sum, count) => sum + count, 0);
    const readingPrefs = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category, percentage: Math.round((count / Math.max(categoryTotal, 1)) * 100) }));
    const recommendedAuthors = [...new Set(books.map((book) => book.author).filter(Boolean))].slice(0, 5);
    const moodText = frequentMoods.slice(0, 2).map((item) => getEmotionDisplay(item.mood)).join('」与「') || getEmotionDisplay(dominantMood);

    return {
      animalType: animal.name,
      animalEmoji: animal.emoji,
      description: `${animal.traits}\n最近最常出现的情绪是「${getEmotionDisplay(dominantMood)}」。`,
      personality: `从你的 ${records.length} 条记录里，系统常常读到「${getEmotionDisplay(dominantMood)}」，也看见「${moodText}」反复浮现。这不是给你下定义，而是此刻留下的一张情绪切片；新的记录会让它继续变化。`,
      frequentImagery,
      frequentMoods,
      emotionTrend,
      readingPrefs,
      healingCopy: animal.healing,
      recommendedAuthors,
    };
  }, [books, records]);

  const closePortrait = () => {
    localStorage.setItem(PORTRAIT_CLOSED_KEY, '1');
    setClosed(true);
    showToast('已关闭画像 · 尊重你不被定义');
  };
  const reopenPortrait = () => {
    localStorage.removeItem(PORTRAIT_CLOSED_KEY);
    setClosed(false);
    showToast('画像已重新打开');
  };

  const heatmap = useMemo(() => Array.from({ length: 28 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (27 - index));
    const dayRecords = records.filter((record) => new Date(record.createdAt).toDateString() === date.toDateString());
    const intensity = dayRecords.reduce((sum, record) => sum + record.intensity, 0) / Math.max(dayRecords.length, 1);
    return {
      date: date.toISOString().slice(0, 10),
      count: dayRecords.length,
      color: dayRecords.length ? HEAT_COLORS[Math.min(HEAT_COLORS.length - 1, Math.max(1, Math.round(intensity * (HEAT_COLORS.length - 1))))] : HEAT_COLORS[0],
    };
  }), [records]);

  const accountActions = (
    <div className="mx-auto mt-4 w-full max-w-[860px] rounded-[28px] border border-warm-200/70 bg-white/45 p-3 shadow-sm backdrop-blur-sm md:p-4">
      <div className="mb-3 flex flex-col gap-1 px-1 text-left md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[13px] font-bold text-warm-700">账号与数据</div>
          <div className="mt-0.5 text-[11px] text-warm-400">退出只清除本机登录态；注销会删除云端账号数据。</div>
        </div>
      </div>
      <div className={`grid gap-3 ${showDeleteAccount ? 'md:grid-cols-[minmax(220px,0.72fr)_minmax(360px,1.28fr)]' : 'md:grid-cols-2'}`}>
      <button
        onClick={async () => {
          try { await pushCloudState(); } catch { /* 退出仍继续，本地隐私优先 */ }
          clearSynchronizedLocalState();
          clearAuthToken();
          window.location.reload();
        }}
        className="min-h-[56px] rounded-[20px] border border-warm-200 bg-white/75 px-4 py-3 text-sm font-bold text-warm-600 cursor-pointer transition hover:-translate-y-0.5 hover:bg-white"
      >
        退出账号
      </button>
      <div className="rounded-[20px] border border-rose-200/70 bg-rose-50/70 p-3">
        {!showDeleteAccount ? (
          <button
            onClick={() => setShowDeleteAccount(true)}
            className="min-h-[32px] w-full border-none bg-transparent py-1 text-sm font-bold text-rose-700 cursor-pointer"
          >
            注销并删除账号
          </button>
        ) : (
          <div>
            <p className="text-xs leading-relaxed text-rose-800">此操作会永久删除记录、书摘、手账云同步数据和上传图片，无法撤销。</p>
            <label className="block mt-2 text-[11px] text-rose-700" htmlFor="delete-account-password">输入密码确认</label>
            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-rose-200 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-rose-400"
            />
            {deleteError && <p role="alert" className="mt-1.5 text-[11px] text-rose-700">{deleteError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  setShowDeleteAccount(false);
                  setDeletePassword('');
                  setDeleteError('');
                }}
                className="flex-1 rounded-xl border border-rose-200 bg-white py-2 text-xs text-warm-600 cursor-pointer"
              >
                取消
              </button>
              <button
                disabled={deletingAccount || deletePassword.length < 8}
                onClick={async () => {
                  setDeletingAccount(true);
                  setDeleteError('');
                  try {
                    await deleteAccount(deletePassword);
                    clearSynchronizedLocalState();
                    clearAuthToken();
                    window.location.reload();
                  } catch (error) {
                    setDeleteError(error instanceof Error ? error.message : '注销失败，请稍后再试');
                    setDeletingAccount(false);
                  }
                }}
                className="flex-1 rounded-xl border-none bg-rose-700 py-2 text-xs text-white cursor-pointer disabled:opacity-40"
              >
                {deletingAccount ? '正在删除…' : '永久删除'}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );

  // 还没有任何记录 —— 不编造画像,显示"画像待生成"的引导
  if (!hasRecords) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center pt-14">
          <div className="w-[96px] h-[96px] rounded-full bg-gradient-to-br from-[#cfe3da] to-[#dcd2ea] flex items-center justify-center text-[42px] animate-float shadow-inner">🫧</div>
          <h1 className="font-serif text-xl text-warm-800 mt-5">画像还没生成</h1>
          <p className="text-[13px] text-warm-500 leading-relaxed mt-2.5 max-w-[260px]">
            画像会从你的记录里慢慢长出来——情绪趋势、高频意象、还有一只属于你的治愈小动物。先记下几条心情，我就能替你画出来。
          </p>
          <button
            onClick={() => navigate('/record')}
            className="mt-6 bg-gradient-to-r from-leaf-400 to-emerald-500 text-white font-bold text-[14px] px-6 py-3 rounded-[24px] shadow-lg cursor-pointer active:scale-95 transition-transform"
          >
            ✍️ 去记录第一条
          </button>
          {savedWords.length > 0 && (
            <div className="mt-3 px-3 text-left">
              <p className="text-[11px] text-warm-400">📖 你的情绪词典</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {savedWords.slice(0, 6).map((w) => (
                  <span key={w.word} className="text-[11px] text-warm-600 bg-warm-50 px-2 py-1 rounded-lg">{w.word}</span>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => navigate('/record?focus=word')} className="mt-3 border-none bg-transparent text-xs text-leaf-500 underline underline-offset-4 cursor-pointer">Go to record page for words</button>
          {accountActions}
        </div>
      </Shell>
    );
  }

  // 有记录但用户主动关闭了画像 —— 可随时重开
  if (closed) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center pt-16">
          <div className="w-[88px] h-[88px] rounded-full bg-gradient-to-br from-[#e3eee0] to-[#dfe5e7] flex items-center justify-center text-[40px]">🌿</div>
          <h1 className="font-serif text-xl text-warm-800 mt-5">画像已关闭</h1>
          <p className="text-[13px] text-warm-500 leading-relaxed mt-2.5 max-w-[250px]">
            你选择了不被定义，这很好。画像和数据都还在，随时可以重新打开。
          </p>
          <button
            onClick={reopenPortrait}
            className="mt-6 bg-white text-warm-700 border border-warm-200 font-bold text-[14px] px-6 py-3 rounded-[24px] shadow cursor-pointer active:scale-95 transition-transform"
          >
            重新打开画像
          </button>
          {savedWords.length > 0 && (
            <div className="mt-3 px-3 text-left">
              <p className="text-[11px] text-warm-400">📖 你的情绪词典</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {savedWords.slice(0, 6).map((w) => (
                  <span key={w.word} className="text-[11px] text-warm-600 bg-warm-50 px-2 py-1 rounded-lg">{w.word}</span>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => navigate('/record?focus=word')} className="mt-3 border-none bg-transparent text-xs text-leaf-500 underline underline-offset-4 cursor-pointer">Go to record page for words</button>
          {accountActions}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
        {/* Hero */}
        <div className="rounded-3xl p-5 text-white relative overflow-hidden bg-gradient-to-br from-[#7fb0c4] via-[#6a93b8] to-[#8a7fb0] shadow-xl">
          <div className="absolute -right-8 -top-8 w-[160px] h-[160px] rounded-full bg-radial-[circle] from-white/30 to-transparent" />
          <button
            onClick={closePortrait}
            className="absolute top-3.5 right-3.5 bg-white/15 border-none text-white/70 text-[10px] px-2.5 py-1 rounded-xl cursor-pointer z-[3]"
          >
            关闭画像 ✕
          </button>
          <p className="text-white/80 text-[11px] tracking-widest">你的治愈画像 · {portraitMonth}</p>

          <div className="w-[88px] h-[88px] rounded-full bg-radial-[circle_at_50%_30%] from-[#cfeefb] via-[#7fb6d6] to-[#5a86b0] flex items-center justify-center text-[46px] shadow-inner animate-float mt-1 relative z-[2]">
            {profile.animalEmoji}
            <span className="absolute text-[13px] opacity-0 animate-pulse left-2 top-2.5">✦</span>
            <span className="absolute text-[13px] opacity-0 animate-pulse right-3 bottom-4" style={{ animationDelay: '1.2s' }}>✦</span>
          </div>

          <h1 className="font-serif text-2xl tracking-wider mt-3.5">{profile.animalType}</h1>
          <div className="text-xs opacity-90 mt-1.5 leading-relaxed whitespace-pre-line">{profile.description}</div>
          <div className="mt-3 text-[10px] opacity-60">🌿 这是系统看见的你，不是给你下的定义</div>
        </div>

        {/* 宽屏(web)左右两列组合,窄屏(手机)自动回到上下单列 */}
        {recordsUnavailable && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-[12px] leading-relaxed text-amber-800 shadow-sm">
            Backend is offline; this portrait is using local cache and will not clear existing content.
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-x-3.5 items-start">
        {/* 性格速写 */}
        <div className="bg-white rounded-[20px] p-4 mt-3.5 shadow-md">
          <h2 className="text-[14.5px] text-warm-700 flex items-center gap-2 mb-3">
            <span>✍️</span> 性格速写
          </h2>
          <div className="font-hand text-[15px] leading-[1.85] text-warm-700">
            <p>{profile.personality}</p>
          </div>
        </div>

        {/* 高频情绪词云 */}
        <div className="bg-white rounded-[20px] p-4 mt-3.5 shadow-md">
          <h2 className="text-[14.5px] text-warm-700 flex items-center gap-2 mb-3">
            <span>{String.fromCodePoint(0x1f3a8)}</span> 高频情绪
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-1 gap-x-3 py-1.5">
            {profile.frequentMoods.length ? profile.frequentMoods.map((item, i) => {
              const sizes = [28, 22, 18, 24, 16, 20, 15, 17];
              return (
                <span key={item.mood} className="font-hand cursor-default drop-shadow-[0_1px_0_rgba(255,255,255,.75)]" style={{ color: item.color, fontSize: `${sizes[i] || 16}px`, opacity: 0.78 + (i % 3) * 0.08 }}>
                  {getEmotionDisplay(item.mood)}
                  <small className="ml-1 font-sans text-[10px] opacity-55">{item.percentage}%</small>
                </span>
              );
            }) : <span className="text-xs text-warm-400">继续记录后，高频情绪会在这里慢慢浮现。</span>}
          </div>
        </div>

        {/* 情绪趋势 + 日历 */}
        <div className="bg-white rounded-[20px] px-4 py-3 mt-3.5 shadow-md">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[14px] text-warm-700 flex items-center gap-2">
              <span>📈</span> 情绪趋势
            </h2>
            <span className="text-[10px] text-warm-400">近 4 周</span>
          </div>
          {(() => {
            const moodColors: Record<string, string> = MOOD_TEXT_COLORS;
            const heights = [60, 50, 70, 30, 20, 65, 55];
            const labels = ['一', '二', '三', '四', '五', '六', '日'];
            return (
              <>
                {/* 柱子坐落在固定高度的轨道里,百分比高度才有参照 */}
                <div className="flex gap-1.5 items-end h-16">
                  {profile.emotionTrend.map((mood, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full transition-all"
                      style={{ height: `${heights[i]}%`, backgroundColor: moodColors[mood] || '#ccc' }}
                      title={getEmotionDisplay(mood)}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1 mb-2.5">
                  {profile.emotionTrend.map((_, i) => (
                    <span key={i} className="flex-1 text-center text-[9px] text-warm-400">{labels[i]}</span>
                  ))}
                </div>
              </>
            );
          })()}

          {/* 日历热力图 */}
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
            {heatmap.map((day) => (
              <button
                key={day.date}
                onClick={() => day.count ? navigate(`/collage?date=${day.date}`) : showToast('这一天还没有记录')}
                title={day.count ? `${day.date} · ${day.count} 条记录 · 查看手帐` : `${day.date} · 暂无记录`}
                className="aspect-square rounded-[3px] block border-none cursor-pointer transition-transform active:scale-90"
                style={{ backgroundColor: day.color }}
              />
            ))}
          </div>
          <div className="flex gap-2.5 mt-2 text-[9.5px] text-warm-400 flex-wrap">
            <span><b className="inline-block w-2.5 h-2.5 rounded mr-1 align-middle" style={{ backgroundColor: '#e8e0d0' }} />低</span>
            <span><b className="inline-block w-2.5 h-2.5 rounded mr-1 align-middle" style={{ backgroundColor: '#b89860' }} />中</span>
            <span><b className="inline-block w-2.5 h-2.5 rounded mr-1 align-middle" style={{ backgroundColor: '#a88040' }} />高</span>
          </div>
        </div>

        {/* 阅读偏好 */}
        <div className="bg-white rounded-[20px] p-4 mt-3.5 shadow-md">
          <h2 className="text-[14.5px] text-warm-700 flex items-center gap-2 mb-3">
            <span>📚</span> 阅读偏好
          </h2>
          {profile.readingPrefs.length ? profile.readingPrefs.map((pref) => (
            <div key={pref.category} className="mb-2.5">
              <div className="flex justify-between text-xs text-warm-700 mb-1">
                <span>{pref.category}</span>
                <span>{pref.percentage}%</span>
              </div>
              <div className="h-[9px] rounded-full bg-warm-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#9ccfc0] to-[#6fa9c4]"
                  style={{ width: `${pref.percentage}%` }}
                />
              </div>
            </div>
          )) : <p className="text-xs leading-relaxed text-warm-400">还没有阅读偏好。去阅读页收藏句子后，这里会按真实收藏生成。</p>}
        </div>

        </div>
        {/* 气质相近 */}
        <div className="mt-3.5">
          <h2 className="text-[14.5px] text-warm-700 flex items-center gap-2 mb-3 px-1">
            <span>🤝</span> 气质相近
          </h2>
          <div className="flex gap-2.5 overflow-x-auto hide-scrollbar pb-1">
            {profile.recommendedAuthors.length ? profile.recommendedAuthors.map((author) => (
              <button onClick={() => navigate(`/agent?persona=${encodeURIComponent(author)}`)} key={author} className="flex-shrink-0 w-[150px] bg-gradient-to-br from-warm-50 to-warm-100 rounded-2xl p-3 border border-black/5 text-left cursor-pointer">
                <div className="text-xs text-warm-500 font-bold">推荐作者</div>
                <div className="font-serif text-[15px] text-warm-800 mt-1.5">{author}</div>
                <div className="text-[11px] text-warm-400 mt-1.5 leading-relaxed">来自你的真实收藏 · 去聊聊 ›</div>
              </button>
            )) : <div className="rounded-2xl border border-dashed border-warm-300 px-4 py-3 text-xs text-warm-400">收藏书摘后，相关作者才会在这里出现。</div>}
          </div>
        </div>

        <div className="w-full mt-3.5 rounded-[20px] border border-warm-200 bg-white p-4 text-left shadow-md">
          <h2 className="text-[14.5px] text-warm-700">📖 私人情绪词典</h2>
          {savedWords.length === 0 ? (
            <>
              <p className="mt-1 text-[11.5px] text-warm-400">还没有收藏的情绪词。去拾词页为说不清的感受存一个属于你的词吧。</p>
              <button onClick={() => navigate('/record?focus=word')} className="mt-2.5 border-none bg-transparent text-xs text-leaf-500 underline underline-offset-4 cursor-pointer">Go pick a word in record page</button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 mt-2.5">
                {savedWords.map((w) => (
                  <div key={w.word} className="flex items-start gap-2.5 rounded-xl bg-warm-50 px-3 py-2.5">
                    <span className="shrink-0 mt-0.5 text-[15px] font-serif text-warm-800">{w.word}</span>
                    <span className="text-[9px] text-warm-300 bg-warm-100 px-1.5 py-0.5 rounded">{w.language}</span>
                    <span className="text-[12px] text-warm-500 leading-relaxed">{w.meaning}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/record?focus=word')} className="mt-3 border-none bg-transparent text-xs text-leaf-500 underline underline-offset-4 cursor-pointer">Pick another word in record page</button>
            </>
          )}
        </div>

        {/* 治愈文案 */}
        {accountActions}
    </Shell>
  );
}
