import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReadingRecommendations, getWeReadStatus, saveReadingFeedback, searchLibrary, searchWeRead, syncWeRead } from '../api';
import type { LibrarySearchResponse, WeReadBookResult } from '../api';
import { useStore } from '../store';
import { FEED, loadFeedback, mergeUniqueFeedItems, rankFeed } from '../data/readingFeed';
import type { FeedItem, FeedbackAction, FeedbackMap } from '../data/readingFeed';
import { notifyLocalStateChanged } from '../cloudSync';

const HIGHLIGHT_COLORS = ['#ffe49a', '#ffb8c6', '#b8d4ff', '#c8ffb8', '#ffd4b8', '#e0b8ff'];

const CATEGORY_TAGS = ['诗歌', '散文', '文学', '哲学'];
const readingTimeLabel = () => {
  const hour = new Date().getHours();
  if (hour < 6) return '此刻适合读';
  if (hour < 11) return '今早适合读';
  if (hour < 14) return '午间适合读';
  if (hour < 19) return '今天适合读';
  return '今晚适合读';
};
const toFeedItem = (item: Awaited<ReturnType<typeof getReadingRecommendations>>['items'][number]): FeedItem => ({
  id: item.id,
  quote: item.quote,
  book: item.book,
  author: item.author,
  cover: item.cover,
  reason: item.reason,
  bgColor: item.bg_color,
  textColor: item.text_color,
  passage: item.passage,
  tags: item.tags,
});

export default function ReadingPage() {
  const showToast = useStore((state) => state.showToast);
  const addBook = useStore((state) => state.addBook);
  const addJournalMaterial = useStore((state) => state.addJournalMaterial);
  const navigate = useNavigate();
  const [detailItem, setDetailItem] = useState<FeedItem | null>(null);
  const [activePen, setActivePen] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMap>(loadFeedback);
  const [visibleItems, setVisibleItems] = useState(() => rankFeed(loadFeedback(), 0));
  const [batch, setBatch] = useState(1);
  const [profileSummary, setProfileSummary] = useState<string[]>([]);
  const [recommendationMode, setRecommendationMode] = useState<'dynamic' | 'local'>('local');
  const [recommendationError, setRecommendationError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [libraryResults, setLibraryResults] = useState<LibrarySearchResponse>({ books: [], quotes: [] });
  const [weReadConnected, setWeReadConnected] = useState(false);
  const [weReadMessage, setWeReadMessage] = useState('');
  const [weReadResultCount, setWeReadResultCount] = useState(0);
  const [weReadResults, setWeReadResults] = useState<WeReadBookResult[]>([]);
  const [weReadSearching, setWeReadSearching] = useState(false);
  const [detailWeReadBook, setDetailWeReadBook] = useState<WeReadBookResult | null>(null);
  const [matchingDetailBook, setMatchingDetailBook] = useState(false);
  const [syncingWeRead, setSyncingWeRead] = useState(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    getWeReadStatus().then((result) => { setWeReadConnected(result.connected); setWeReadMessage(result.message); }).catch(() => { setWeReadConnected(false); setWeReadMessage('后端暂时不可用'); });
    getReadingRecommendations(12, 0)
      .then((result) => {
        setVisibleItems(mergeUniqueFeedItems([], result.items.map(toFeedItem), 12));
        setProfileSummary(result.profile_summary);
        setRecommendationMode('dynamic');
        setRecommendationError('');
      })
      .catch(() => {
        setRecommendationMode('local');
        setRecommendationError('动态推荐服务暂时不可用，已切换为本地精选兜底。');
        setProfileSummary(['本地精选兜底', '行为仍会被记录']);
      });
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setLibraryResults({ books: [], quotes: [] });
        setWeReadResultCount(0);
        setWeReadResults([]);
        setSearchError('');
        return;
      }
      try {
        setLibraryResults(await searchLibrary(query));
        setSearchError('');
      } catch {
        setLibraryResults({ books: [], quotes: [] });
        setSearchError('摘录库检索暂时失败，仍可检索当前推荐内容。');
      }
      if (weReadConnected) {
        setWeReadSearching(true);
        try {
          const result = await searchWeRead(query);
          const books = result.results.flatMap((group) => group.books || []);
          const unique = [...new Map(books.map((book) => [book.bookInfo.bookId, book])).values()];
          setWeReadResults(unique);
          setWeReadResultCount(unique.length);
        } catch {
          setWeReadResults([]);
          setWeReadResultCount(0);
          setSearchError('微信读书检索暂时失败，已保留本地检索结果。');
        } finally {
          setWeReadSearching(false);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, weReadConnected]);

  useEffect(() => {
    if (!detailItem || !weReadConnected) {
      setDetailWeReadBook(null);
      return;
    }
    let cancelled = false;
    setMatchingDetailBook(true);
    searchWeRead(detailItem.book)
      .then((result) => {
        if (cancelled) return;
        const books = result.results.flatMap((group) => group.books || []);
        const normalize = (value: string) => value.replace(/[《》\s·•]/g, '').toLowerCase();
        const exact = books.find(({ bookInfo }) => normalize(bookInfo.title) === normalize(detailItem.book) && (!bookInfo.author || normalize(bookInfo.author).includes(normalize(detailItem.author))));
        setDetailWeReadBook(exact || books[0] || null);
      })
      .catch(() => { if (!cancelled) setDetailWeReadBook(null); })
      .finally(() => { if (!cancelled) setMatchingDetailBook(false); });
    return () => { cancelled = true; };
  }, [detailItem, weReadConnected]);

  const localSearchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return FEED.filter((item) => [item.quote, item.book, item.author, item.passage, ...item.tags].some((value) => value.toLowerCase().includes(normalized)));
  }, [query]);

  const recordFeedback = (item: FeedItem, action: FeedbackAction) => {
    setFeedback((previous) => {
      const next = {
        ...previous,
        [item.id]: { ...previous[item.id], [action]: (previous[item.id]?.[action] || 0) + 1 },
      };
      localStorage.setItem('moodgarden-reading-feedback', JSON.stringify(next));
      notifyLocalStateChanged();
      return next;
    });
    void saveReadingFeedback({
      item_id: item.id,
      action,
      book_title: item.book,
      author: item.author,
      category: item.tags.find((tag) => CATEGORY_TAGS.includes(tag)) || '',
      tags: item.tags,
    }).catch(() => showToast('后端反馈暂时不可用，已先保存在本地'));
    // 收藏 / 划线 = 行为驱动上架:这本书自动飞上「爱书书架」(带 NEW 角标)
    if (action === 'favorite' || action === 'highlight') {
      addBook({
        title: item.book,
        author: item.author,
        color: item.cover,
        category: item.tags.find((t) => CATEGORY_TAGS.includes(t)) || '文学',
        quote: item.quote,
        tags: item.tags.slice(0, 3),
      });
      addJournalMaterial({
        text: item.quote,
        sourceType: 'reading',
        sourceLabel: `${item.author}《${item.book}》`,
      });
    }
    const messages = {
      favorite: '已收藏 · 同时加入手帐素材',
      highlight: '已划线 · 同时加入手帐素材',
      dislike: '已减少相似内容推荐',
    };
    showToast(messages[action]);
  };

  const loadMore = async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const nextBatch = batch + 1;
    setBatch(nextBatch);
    try {
      const result = await getReadingRecommendations(12, nextBatch);
      setVisibleItems((current) => mergeUniqueFeedItems(current, result.items.map(toFeedItem), 36));
      setProfileSummary(result.profile_summary);
      setRecommendationMode('dynamic');
      setRecommendationError('');
    } catch {
      setVisibleItems((current) => mergeUniqueFeedItems(current, rankFeed(feedback, nextBatch), 32));
      setRecommendationMode('local');
      setRecommendationError('继续阅读时后端暂时不可用，已追加本地精选内容。');
    }
    window.setTimeout(() => { loadingMoreRef.current = false; }, 100);
  };

  const openWeReadBook = (bookId: string, title: string) => {
    const webUrl = `https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(title)}`;
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      window.location.href = `weread://reading?bId=${bookId}`;
      window.setTimeout(() => window.open(webUrl, '_blank', 'noopener,noreferrer'), 900);
      showToast('已尝试打开微信读书；应用内划线会保存当前推荐句');
      return;
    }
    window.open(webUrl, '_blank', 'noopener,noreferrer');
    showToast('已打开微信读书搜索页；应用内只保存推荐片段');
  };

  const openDetailBookInWeRead = () => {
    if (!detailItem) return;
    if (detailWeReadBook) {
      openWeReadBook(detailWeReadBook.bookInfo.bookId, detailWeReadBook.bookInfo.title);
      return;
    }
    window.open(`https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(detailItem.book)}`, '_blank', 'noopener,noreferrer');
    showToast('未匹配到直达书籍，已打开微信读书搜索页');
  };

  const collectSearchBook = (book: { title: string; author?: string; category?: string; intro?: string }) => {
    addBook({
      title: book.title,
      author: book.author || '未知作者',
      color: '#5c8069',
      category: book.category || '文学摘录',
      quote: book.intro || '',
      tags: [book.category || '文学摘录'],
    });
    if (book.intro) {
      addJournalMaterial({
        text: book.intro,
        sourceType: 'reading',
        sourceLabel: `${book.author || '未知作者'}《${book.title}》`,
      });
    }
    showToast(`已收藏《${book.title}》到书架`);
  };

  const handleSyncWeRead = async () => {
    setSyncingWeRead(true);
    try {
      const result = await syncWeRead();
      showToast(`已同步 ${result.imported} 条微信读书划线`);
    } catch {
      showToast('微信读书同步失败，可先使用搜索或文本导入');
    } finally {
      setSyncingWeRead(false);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#1f2830]">
      <div
        className="h-full overflow-y-scroll hide-scrollbar overscroll-y-contain"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight - element.scrollTop - element.clientHeight < element.clientHeight * 1.5) loadMore();
        }}
      >
        {visibleItems.map((item, index) => (
          <section key={`${item.id}-${index}`} className="reading-feed-section min-h-full relative flex flex-col justify-center px-[26px] pb-[132px] pt-[78px] overflow-hidden" style={{ backgroundColor: item.bgColor, color: item.textColor, contentVisibility: 'auto', containIntrinsicSize: '800px' }}>
            <div className="absolute top-[58px] left-[18px] font-serif text-[120px] opacity-[0.12] leading-none">“</div>
            <div className="relative z-[2] self-start mb-4 max-w-[88%] text-[10px] bg-white/25 px-3 py-1 rounded-2xl border border-white/30 leading-relaxed">{item.reason}</div>
            <button onClick={() => setDetailItem(item)} className="border-none bg-transparent text-left font-serif text-[25px] leading-[1.7] cursor-pointer relative z-[2]" style={{ color: item.textColor }}>{item.quote}</button>
            <button onClick={() => setDetailItem(item)} className="flex items-center gap-2.5 mt-6 relative z-[2] border-none bg-transparent text-left cursor-pointer" style={{ color: item.textColor }}>
              <div className="w-[30px] h-[42px] rounded shadow-md" style={{ backgroundColor: item.cover }} />
              <div><h3 className="font-serif text-sm">{item.book}</h3><p className="text-[11px] opacity-70 mt-0.5">{item.author}</p></div>
              <span className="ml-1 text-[10px] opacity-60">查看书籍 ›</span>
            </button>
            <div className="flex gap-1.5 mt-4 flex-wrap">{item.tags.slice(0, 3).map((tag) => <span key={tag} className="text-[10px] border border-current/20 rounded-full px-2 py-0.5 opacity-70">#{tag}</span>)}</div>
            <div className="reading-actions absolute right-4 bottom-[138px] flex flex-col gap-3 z-[3]">
              <button onClick={() => recordFeedback(item, 'favorite')} className="min-w-11 min-h-11 border-none bg-transparent flex flex-col items-center justify-center gap-1 cursor-pointer text-[10px]" style={{ color: item.textColor }}><span className="text-[23px]">♡</span><span>收藏</span></button>
              <button onClick={() => recordFeedback(item, 'highlight')} className="min-w-11 min-h-11 border-none bg-transparent flex flex-col items-center justify-center gap-1 cursor-pointer text-[10px]" style={{ color: item.textColor }}><span className="text-[23px]">✎</span><span>划线</span></button>
              <button onClick={() => recordFeedback(item, 'dislike')} className="min-w-11 min-h-11 border-none bg-transparent flex flex-col items-center justify-center gap-1 cursor-pointer text-[10px]" style={{ color: item.textColor }}><span className="text-[20px]">⊘</span><span>不感兴趣</span></button>
            </div>
            <div className="reading-page-hint absolute left-0 right-0 bottom-[100px] text-center text-[10px] opacity-55">↑ 上滑继续</div>
          </section>
        ))}
      </div>

      <header className="absolute top-0 left-0 right-0 z-[5] px-[18px] pt-[48px] pb-5 flex justify-between items-center text-white bg-gradient-to-b from-black/75 via-black/35 to-transparent [text-shadow:0_1px_5px_rgba(0,0,0,0.65)]">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/study')} className="border-none bg-transparent text-white text-xl leading-none cursor-pointer p-0">‹</button>
          <div><b className="text-[15px]">{readingTimeLabel()}</b><small className="block text-[9px] opacity-65 mt-0.5">{recommendationMode === 'dynamic' ? '动态推荐服务' : '本地精选兜底'} · {profileSummary.length ? profileSummary.slice(0, 2).join(' · ') : '推荐会随你的动作慢慢改变'}</small></div>
        </div>
        <button onClick={() => setSearchOpen(true)} className="border border-white/25 bg-white/15 text-white rounded-full px-3 py-2 text-xs cursor-pointer">⌕ 检索</button>
      </header>

      <div className={`absolute inset-0 z-20 bg-[#f4efe7] transition-transform duration-300 ${searchOpen ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="page-scroll-padding px-4 pt-[48px] pb-[92px] h-full overflow-y-auto hide-scrollbar">
          <div className="flex items-center gap-2">
            <button onClick={() => setSearchOpen(false)} className="border-none bg-transparent text-xl text-warm-600 cursor-pointer">‹</button>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="阅读检索" placeholder="搜句子、书名、作者、意象…" className="flex-1 rounded-full border border-warm-200 bg-white px-4 py-3 text-sm outline-none text-warm-800" />
          </div>
          <div className="flex items-center justify-between mt-3 text-[10.5px] text-warm-400">
            <span>MoodGarden 摘录库 + 当前推荐</span>
            <span className={weReadConnected ? 'text-leaf-600' : ''}>{weReadConnected ? '微信读书已连接' : '微信读书未连接'}</span>
          </div>
          {(recommendationError || searchError) && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
              {searchError || recommendationError}
            </div>
          )}
          {!weReadConnected && (
            <div className="mt-3 rounded-2xl bg-ocean-50 p-3 text-xs text-ocean-600 leading-relaxed">
              {weReadMessage || '请配置微信读书连接，或使用书摘文本导入。'}
            </div>
          )}
          {weReadConnected && (
            <button onClick={handleSyncWeRead} disabled={syncingWeRead} className="mt-3 w-full border border-dashed border-leaf-300 bg-leaf-50 text-leaf-700 rounded-xl py-2.5 text-xs cursor-pointer disabled:opacity-50">
              {syncingWeRead ? '正在同步…' : '↻ 同步微信读书划线到摘录库'}
            </button>
          )}
          {query && (
            <div className="mt-5 space-y-3">
              <p className="text-[11px] text-warm-400">当前推荐 {localSearchResults.length} · 本地摘录 {libraryResults.quotes.length} · 微信读书 {weReadResultCount}</p>
              {localSearchResults.map((item) => (
                <button key={item.id} onClick={() => { setDetailItem(item); setSearchOpen(false); }} className="w-full border-none bg-white rounded-2xl p-4 text-left shadow-sm cursor-pointer">
                  <strong className="font-serif text-sm text-warm-800">「{item.quote}」</strong><small className="block mt-2 text-warm-400">{item.book} · {item.author}</small>
                </button>
              ))}
              {libraryResults.quotes.map((quote) => (
                <div key={quote.id} className="bg-white rounded-2xl p-4 shadow-sm"><p className="font-hand text-sm text-warm-800">{quote.text}</p><small className="block mt-2 text-warm-400">{quote.book_title} {quote.author && `· ${quote.author}`}</small></div>
              ))}
              {libraryResults.books.map((book) => (
                <div key={book.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate font-serif text-sm text-warm-800">{book.title}</strong>
                    <span className="block mt-1 truncate text-[11px] text-warm-400">{book.author || '未知作者'} {book.category && `· ${book.category}`}</span>
                  </div>
                  <button onClick={() => collectSearchBook(book)} className="shrink-0 border border-leaf-200 rounded-full bg-leaf-50 px-3 py-2 text-[10px] text-leaf-700 cursor-pointer">收藏</button>
                </div>
              ))}
              {weReadConnected && (
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif text-sm text-warm-700">微信读书书城</h3>
                    {weReadSearching && <span className="text-[10px] text-warm-400">正在检索…</span>}
                  </div>
                  <div className="space-y-2">
                    {weReadResults.map(({ bookInfo, readingCount }) => (
                      <div key={bookInfo.bookId} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm">
                        {bookInfo.cover ? <img loading="lazy" src={bookInfo.cover} alt="" className="w-12 h-[68px] rounded-md object-cover bg-warm-100" /> : <div className="w-12 h-[68px] rounded-md bg-warm-200" />}
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate font-serif text-sm text-warm-800">{bookInfo.title}</strong>
                          <span className="block mt-1 truncate text-[11px] text-warm-400">{bookInfo.author || '未知作者'} {bookInfo.category && `· ${bookInfo.category}`}</span>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[9.5px] text-warm-500">
                            {bookInfo.newRating ? <span className="rounded-full bg-warm-100 px-2 py-0.5">评分 {(bookInfo.newRating / 100).toFixed(1)}</span> : null}
                            {bookInfo.newRatingDetail?.title ? <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-leaf-600">{bookInfo.newRatingDetail.title}</span> : null}
                            {readingCount ? <span className="rounded-full bg-ocean-50 px-2 py-0.5 text-ocean-600">{readingCount} 人在读</span> : null}
                          </div>
                        </div>
                        <div className="self-center shrink-0 flex flex-col gap-1.5">
                          <button onClick={() => collectSearchBook(bookInfo)} className="border border-leaf-200 rounded-full bg-leaf-50 px-3 py-2 text-[10px] text-leaf-700 cursor-pointer">收藏</button>
                          <button onClick={() => openWeReadBook(bookInfo.bookId, bookInfo.title)} className="border-none rounded-full bg-[#5c9d72] px-3 py-2 text-[10px] text-white cursor-pointer">打开</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {localSearchResults.length + libraryResults.quotes.length + libraryResults.books.length + weReadResultCount === 0 && <div className="text-center text-xs text-warm-400 py-12">没有找到，试试「海」「孤独」「自由」。</div>}
            </div>
          )}
        </div>
      </div>

      <div className={`absolute inset-0 z-10 bg-[#f6f1e8] transition-transform duration-300 flex flex-col ${detailItem ? 'translate-x-0' : 'translate-x-full'}`}>
        {detailItem && (
          <>
            <div className="flex items-center gap-3 px-4 pt-[46px] pb-2.5"><button className="border-none bg-transparent text-[22px] text-warm-600 cursor-pointer" onClick={() => setDetailItem(null)}>‹</button><span className="font-serif text-[15px] text-warm-800">书籍详情</span></div>
            <div className="flex-1 overflow-y-auto hide-scrollbar px-[22px] py-2">
              <div className="flex gap-4 rounded-2xl bg-white/70 p-4 shadow-sm">
                {detailWeReadBook?.bookInfo.cover
                  ? <img src={detailWeReadBook.bookInfo.cover} alt="" className="h-[112px] w-[78px] rounded-lg object-cover shadow-md" />
                  : <div className="h-[112px] w-[78px] shrink-0 rounded-lg shadow-md" style={{ backgroundColor: detailItem.cover }} />}
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-xl text-warm-800">{detailItem.book}</h2>
                  <p className="mt-1 text-xs text-warm-500">{detailItem.author}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{detailItem.tags.map((tag) => <span key={tag} className="rounded-full bg-warm-100 px-2 py-1 text-[9px] text-warm-500">#{tag}</span>)}</div>
                  <p className="mt-3 text-[10px] leading-relaxed text-warm-400">{detailWeReadBook?.bookInfo.intro || detailItem.reason}</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-leaf-50 p-3 text-[10.5px] leading-relaxed text-leaf-700">
                推荐依据：{detailItem.reason}。你的收藏、划线和“不感兴趣”会继续改变后续排序。
              </div>
              <div className="mt-5 text-[10px] tracking-widest text-warm-400">本次推荐片段</div>
              <div className="mt-2 font-serif text-lg leading-[2.05] text-warm-800">{detailItem.passage}</div>
              <div className="mt-5 rounded-2xl bg-ocean-50 p-3 text-[10.5px] leading-relaxed text-ocean-600">
                当前应用内展示的是推荐片段；完整正文由微信读书提供。应用内划线会保存当前推荐句，微信读书中的正文划线需在微信读书完成后再同步回来。
              </div>
            </div>
            <div className="reading-detail-actions bg-warm-50 border-t border-warm-200 px-4 pt-3 pb-[88px]">
              <div className="flex items-center justify-center gap-2 mb-3"><span className="text-[10px] text-warm-400">划线当前推荐句</span>{HIGHLIGHT_COLORS.map((color, index) => <button key={color} aria-label={`使用第 ${index + 1} 种划线颜色`} onClick={() => { setActivePen(index); recordFeedback(detailItem, 'highlight'); }} className={`w-9 h-9 rounded-full border-none cursor-pointer shadow-md ${activePen === index ? 'outline outline-2 outline-warm-600 outline-offset-2' : ''}`} style={{ backgroundColor: color }} />)}</div>
              <button onClick={openDetailBookInWeRead} disabled={matchingDetailBook} className="mb-2 w-full rounded-xl border-none bg-[#5c9d72] py-3 text-xs font-bold text-white cursor-pointer disabled:opacity-60">{matchingDetailBook ? '正在匹配微信读书…' : detailWeReadBook ? '去微信读书阅读完整书籍' : '在微信读书搜索这本书'}</button>
              <div className="flex gap-2"><button onClick={() => recordFeedback(detailItem, 'favorite')} className="flex-1 border-none rounded-xl py-3 text-xs bg-warm-100 text-warm-600 cursor-pointer">♡ 收藏本书与句子</button><button onClick={() => navigate(`/agent?persona=${encodeURIComponent(detailItem.author)}`)} className="flex-1 border-none rounded-xl py-3 text-xs bg-ocean-50 text-ocean-600 cursor-pointer">和作者聊聊</button></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
