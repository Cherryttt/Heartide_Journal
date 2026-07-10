import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import type { Book } from '../types';
import { searchLibrary } from '../api';
import type { LibrarySearchResponse } from '../api';

const TABS = ['最近收藏', '最治愈', '夜晚常读', '自我成长', '文学', '最共鸣'];

const TAB_KEYWORDS: Record<string, string[]> = {
  最治愈: ['治愈', '温柔', '平静', '生命', '童心', '自由', '稳定', '安心', '疗愈'],
  夜晚常读: ['夜', '夜晚', '孤独', '安静', '梦', '星', '月', '森林'],
  自我成长: ['成长', '自我', '自由', '坚韧', '哲学', '稳定', '力量', '选择', '清醒'],
  文学: ['文学', '诗', '小说', '散文', '摘录', '飞鸟集', '小王子', '挪威的森林'],
  最共鸣: ['共鸣', '焦虑', '忧郁', '孤独', '难过', '痛', '生活', '心情'],
};

const bookHaystack = (book: Book) =>
  [book.title, book.author, book.category, book.sampleQuote || '', ...(book.sampleTags || [])]
    .join(' ')
    .toLowerCase();

const matchesTab = (book: Book, tab: string, seenBookIds: string[]) => {
  if (tab === '最近收藏') return true;
  const haystack = bookHaystack(book);
  const keywords = TAB_KEYWORDS[tab] || [tab];
  if (tab === '最共鸣' && book.quoteCount >= 2) return true;
  if (tab === '夜晚常读' && seenBookIds.includes(book.id)) return keywords.some((word) => haystack.includes(word.toLowerCase()));
  return keywords.some((word) => haystack.includes(word.toLowerCase()));
};

export default function BookshelfPage() {
  const showToast = useStore((s) => s.showToast);
  const navigate = useNavigate();
  const books = useStore((s) => s.books);
  const seenBookIds = useStore((s) => s.seenBookIds);
  const markBookSeen = useStore((s) => s.markBookSeen);
  const addJournalMaterial = useStore((s) => s.addJournalMaterial);

  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [keyword, setKeyword] = useState('');
  const [remoteResults, setRemoteResults] = useState<LibrarySearchResponse>({ books: [], quotes: [] });

  const hasBooks = books.length > 0;
  const isNew = (book: Book) => !seenBookIds.includes(book.id);

  const openBook = (book: Book) => {
    setSelectedBook(book);
    markBookSeen(book.id); // 点开即「读过」,NEW 角标消失
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!keyword.trim()) {
        setRemoteResults({ books: [], quotes: [] });
        return;
      }
      try {
        setRemoteResults(await searchLibrary(keyword));
      } catch {
        setRemoteResults({ books: [], quotes: [] });
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [keyword]);

  const visibleBooks = useMemo(() => {
    const tabBooks = books.filter((book) => matchesTab(book, activeTab, seenBookIds));
    if (!keyword.trim()) return tabBooks;
    const query = keyword.toLowerCase();
    return tabBooks.filter((book) =>
      [book.title, book.author, book.category, book.sampleQuote || '']
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [activeTab, keyword, books, seenBookIds]);

  return (
    <div className="absolute inset-0 bg-gradient-to-b from-[#3a2f28] to-[#4a3a2e]">
      {/* 暖光 */}
      <div className="absolute -right-10 -top-10 w-[260px] h-[260px] rounded-full bg-radial-[circle] from-[#ffd99055] to-transparent pointer-events-none" />

      <div className="absolute inset-0 overflow-y-auto hide-scrollbar px-[18px] pt-[52px] pb-7">
        {/* 头部 */}
        <button onClick={() => navigate('/study')} className="border-none bg-transparent p-0 mb-1 text-[13px] text-warm-200 cursor-pointer">‹ 书房</button>
        <h1 className="font-serif text-[23px] text-warm-100 tracking-wider">爱书书架</h1>

        {hasBooks ? (
          <>
            <div className="text-xs text-warm-300 mt-1.5 leading-relaxed">
              你已经收下 {books.length} 本书 · 共 {books.reduce((sum, b) => sum + b.quoteCount, 0)} 条划线。
            </div>

            {/* 搜索 */}
            <div className="mt-3.5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5">
              <span className="text-warm-300">⌕</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜书名、作者、摘录里的一个词"
                className="min-w-0 flex-1 bg-transparent text-xs text-warm-100 outline-none placeholder:text-warm-400"
              />
              {keyword && <button onClick={() => setKeyword('')} className="border-none bg-transparent text-warm-400 cursor-pointer">×</button>}
            </div>

            {/* 分类标签 */}
            <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-[18px] px-[18px] pb-1 mt-4">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-2xl cursor-pointer transition-all whitespace-nowrap border ${
                    activeTab === tab
                      ? 'bg-warm-200 text-warm-800 border-warm-200 font-bold'
                      : 'bg-white/10 text-warm-200 border-warm-500/20'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 书架 */}
            <div className="mt-3.5">
              <div className="flex items-end gap-2 min-h-[210px] px-1.5 flex-wrap">
                {visibleBooks.map((book) => (
                  <div
                    key={book.id}
                    onClick={() => openBook(book)}
                    className={`relative rounded-[3px] cursor-pointer flex-shrink-0 flex flex-col items-center justify-between py-2.5 px-0 shadow-lg transition-transform origin-bottom hover:-translate-y-2 ${
                      isNew(book) ? 'animate-pulse-glow' : ''
                    }`}
                    style={{
                      width: `${Math.max(44, Math.min(58, book.quoteCount * 2.4 + 40))}px`,
                      height: `${Math.max(138, Math.min(204, book.title.length * 18 + book.author.length * 9 + 56))}px`,
                      backgroundColor: book.bookColor,
                      boxShadow: isNew(book)
                        ? `0 0 14px 2px #ffd98a88, inset 2px 0 0 #ffffff40, 0 6px 10px #00000040`
                        : `inset 2px 0 0 #ffffff30, inset -3px 0 6px #00000040, 0 6px 10px #00000040`,
                    }}
                  >
                    <span className="text-white font-hand text-[13px] tracking-wider overflow-visible whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                      {book.title}
                    </span>
                    <span className="text-white/80 text-[8px] tracking-wider whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                      {book.author}
                    </span>
                    {isNew(book) && (
                      <span className="absolute -top-1.5 -right-1 text-[8px] bg-warm-200 text-warm-800 px-1 py-0.5 rounded-lg font-bold shadow-md">
                        NEW
                      </span>
                    )}
                  </div>
                ))}
                {visibleBooks.length === 0 && !keyword.trim() && (
                  <div className="min-h-[160px] flex flex-1 items-center justify-center rounded-3xl border border-dashed border-warm-400/30 bg-white/5 px-6 text-center text-xs leading-relaxed text-warm-300">
                    这一格还没有合适的书。<br />继续收藏、划线后，{activeTab}会慢慢长出来。
                  </div>
                )}
              </div>
              {/* 搁板 */}
              <div className="h-4 -mt-1 rounded bg-gradient-to-b from-[#6a4f38] via-[#523c2a] to-[#3f2e20] shadow-lg relative" />
            </div>

            {keyword && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-sm text-warm-100">摘录里的回声</h2>
                  <span className="text-[10px] text-warm-400">{remoteResults.quotes.length} 条后端结果</span>
                </div>
                <div className="mt-2.5 space-y-2">
                  {remoteResults.quotes.map((quote) => (
                    <button
                      key={quote.id}
                      onClick={() => showToast(`来自 ${quote.book_title || quote.source || '摘录库'}`)}
                      className="w-full border border-white/10 bg-white/8 rounded-xl p-3 text-left cursor-pointer"
                    >
                      <span className="font-hand text-[13px] leading-relaxed text-warm-100">{quote.text}</span>
                      <small className="block mt-1.5 text-[10px] text-warm-400">{quote.book_title} {quote.author && `· ${quote.author}`}</small>
                    </button>
                  ))}
                  {visibleBooks.length === 0 && remoteResults.quotes.length === 0 && remoteResults.books.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-warm-400">
                      暂时没找到。试试一个意象词，比如「海」「夜晚」「自由」。
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* —— 新用户:空书架 —— */
          <div className="mt-12 flex flex-col items-center text-center px-4">
            <div className="relative w-[120px] h-[96px] mb-5">
              {/* 空搁板 + 两本淡淡的占位书 */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-0 flex items-end gap-1.5 opacity-25">
                <span className="block w-7 h-16 rounded-[2px] bg-warm-200" />
                <span className="block w-6 h-12 rounded-[2px] bg-warm-300" />
                <span className="block w-7 h-20 rounded-[2px] bg-warm-200" />
              </div>
              <div className="absolute left-0 right-0 bottom-0 h-3 rounded bg-gradient-to-b from-[#6a4f38] to-[#3f2e20] shadow-lg" />
            </div>
            <h2 className="font-serif text-[17px] text-warm-100">书架还空着</h2>
            <p className="text-xs text-warm-300 leading-relaxed mt-2 max-w-[230px]">
              这里不用手动加书。<br />
              去「阅读」里收藏喜欢的句子，那本书会自己飞上来 📖→📚
            </p>
            <button
              onClick={() => navigate('/reading')}
              className="mt-5 bg-warm-200 text-warm-800 font-bold text-[13px] px-5 py-2.5 rounded-2xl cursor-pointer shadow-lg active:scale-95 transition-transform"
            >
              去阅读页逛逛 →
            </button>
          </div>
        )}
      </div>

      {/* 遮罩层 */}
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 z-[8] ${selectedBook ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSelectedBook(null)}
      />

      {/* 底部书摘弹窗 */}
      <div
        className={`absolute left-0 right-0 bottom-0 z-[9] bg-warm-50 rounded-t-3xl px-[18px] pt-4 pb-5 transition-transform duration-300 shadow-2xl ${
          selectedBook ? 'translate-y-0' : 'translate-y-[110%]'
        }`}
      >
        <div className="w-10 h-1 rounded-full bg-warm-300 mx-auto mb-3.5" />

        {selectedBook && (
          <>
            <div className="flex gap-3">
              <div
                className="w-[54px] h-[76px] rounded flex-shrink-0 shadow-md flex items-center justify-center text-white font-hand text-[11px] text-center px-1.5"
                style={{ backgroundColor: selectedBook.bookColor, writingMode: 'vertical-rl' }}
              >
                {selectedBook.title}
              </div>
              <div>
                <h3 className="font-serif text-[17px] text-warm-800">{selectedBook.title}</h3>
                <p className="text-xs text-warm-400 mt-1">{selectedBook.author}</p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {(selectedBook.sampleTags && selectedBook.sampleTags.length
                    ? selectedBook.sampleTags
                    : [selectedBook.category]
                  ).map((t) => (
                    <span key={t} className="text-[10.5px] text-warm-600 bg-warm-200 px-2 py-0.5 rounded-xl">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 font-hand text-base leading-[1.85] text-warm-800">
              <mark style={{ background: `linear-gradient(180deg, transparent 55%, #ffe49a 55%)`, padding: '0 2px', color: 'inherit' }}>
                {selectedBook.sampleQuote || '这本书里，总有一句正好替你说出了那天的心情。'}
              </mark>
            </div>

            <div className="mt-3 text-[11.5px] text-warm-400 flex gap-3 flex-wrap">
              <span>📖 {selectedBook.author}《{selectedBook.title}》</span>
              <span>✏️ 划线 {selectedBook.quoteCount} 条</span>
            </div>

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => {
                  setKeyword(selectedBook.title);
                  setSelectedBook(null);
                  showToast(`正在查看《${selectedBook.title}》的全部摘录`);
                }}
                className="flex-1 border-none rounded-xl py-3 text-[13px] cursor-pointer bg-warm-200 text-warm-600"
              >
                全部摘录
              </button>
              <button
                onClick={() => {
                  addJournalMaterial({ text: selectedBook.sampleQuote || `《${selectedBook.title}》`, sourceType: 'bookshelf', sourceLabel: `${selectedBook.author}《${selectedBook.title}》` });
                  showToast('已加入今日手帐素材');
                }}
                className="flex-1 border-none rounded-xl py-3 text-[13px] cursor-pointer bg-leaf-400 text-white"
              >
                加入手帐
              </button>
            </div>

            <button
              onClick={() => navigate(`/agent?persona=${encodeURIComponent(selectedBook.author)}`)}
              className="w-full mt-2.5 border border-ocean-100 bg-ocean-50 text-ocean-600 rounded-xl py-3 cursor-pointer text-[13px]"
            >
              💬 和 {selectedBook.author} 聊聊（以 TA 的语气）
            </button>
            <button
              onClick={() => {
                addJournalMaterial({ text: `《${selectedBook.title}》 · ${selectedBook.author}`, sourceType: 'bookshelf', sourceLabel: '书架 · 书本贴纸' });
                showToast('书本贴纸已加入手帐素材');
              }}
              className="w-full mt-2.5 border border-dashed border-warm-400 bg-warm-100 text-warm-600 rounded-xl py-3 cursor-pointer flex flex-col items-center gap-0.5 text-[13px]"
            >
              把整本书加入手帐素材
              <small className="text-[10.5px] text-warm-400">作为书本贴纸使用</small>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
