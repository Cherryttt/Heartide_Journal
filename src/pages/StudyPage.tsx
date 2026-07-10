import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getWeReadStatus } from '../api';
import { topRecommendation } from '../data/readingFeed';

/**
 * 书房 —— 阅读这条线的统一副入口(手帐为主线,阅读/摘录为辅)。
 * 把原来的 阅读feed / 书架摘录 / 作者对话 / 微信读书 收拢到一处。
 */
export default function StudyPage() {
  const navigate = useNavigate();
  const books = useStore((s) => s.books);
  const [rec] = useState(() => {
    try { return topRecommendation(); } catch { return null; }
  });
  const [weread, setWeread] = useState<{ connected: boolean; message: string } | null>(null);

  useEffect(() => {
    getWeReadStatus().then(setWeread).catch(() => setWeread({ connected: false, message: '微信读书未连接' }));
  }, []);

  const totalQuotes = books.reduce((sum, b) => sum + b.quoteCount, 0);

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-gradient-to-b from-[#3a2f28] to-[#4a3a2e]">
      {/* 暖光 */}
      <div className="absolute -right-10 -top-10 w-[260px] h-[260px] rounded-full bg-radial-[circle] from-[#ffd99055] to-transparent pointer-events-none" />

      <div className="relative px-[18px] pt-[52px] pb-[96px]">
        <h1 className="font-serif text-[23px] text-warm-100 tracking-wider">书房</h1>
        <p className="text-xs text-warm-300 mt-1.5 leading-relaxed">
          你的阅读角落 · 按今天心情荐读，收藏的句子会回到手帐里。
        </p>

        <div className="grid gap-3 lg:grid-cols-3 mt-5">
          {/* 荐读 */}
          <button
            onClick={() => navigate('/reading')}
            className="text-left border border-white/12 bg-white/8 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-warm-200 tracking-wider">📖 今天适合读</span>
              <span className="text-warm-300 leading-none">›</span>
            </div>
            <div className="font-hand text-[15px] leading-relaxed text-warm-100 mt-2 line-clamp-2">
              「{rec?.quote ?? '关于海与自由的一段温柔文字'}」
            </div>
            {rec && <div className="text-[10.5px] text-warm-400 mt-1.5">{rec.book} · {rec.author}</div>}
          </button>

          {/* 我的摘录 · 书架 */}
          <button
            onClick={() => navigate('/bookshelf')}
            className="text-left border border-white/12 bg-white/8 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-warm-200 tracking-wider">🔖 我的摘录 · 书架</span>
              <span className="text-warm-300 leading-none">›</span>
            </div>
            <div className="font-hand text-[15px] leading-relaxed text-warm-100 mt-2">
              {books.length ? `${books.length} 本书 · ${totalQuotes} 条划线` : '还空着'}
            </div>
            <div className="text-[10.5px] text-warm-400 mt-1.5">
              {books.length ? '收藏的金句都在这儿，也是拼贴诗的素材' : '去荐读里收一句喜欢的，书会自己上架'}
            </div>
          </button>

          {/* 和作者聊 */}
          <button
            onClick={() => navigate('/agent')}
            className="text-left border border-white/12 bg-white/8 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-warm-200 tracking-wider">💬 和作者聊聊</span>
              <span className="text-warm-300 leading-none">›</span>
            </div>
            <div className="font-hand text-[15px] leading-relaxed text-warm-100 mt-2">
              以喜欢的作者的语气对话
            </div>
            <div className="text-[10.5px] text-warm-400 mt-1.5">加缪 · 村上春树 · 史铁生…或你书架里的任何作者</div>
          </button>
        </div>

        {/* 微信读书状态 */}
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/15 px-3.5 py-3">
          <span className="text-base">📚</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-warm-100">微信读书</div>
            <div className="text-[10.5px] text-warm-400 truncate">
              {weread ? (weread.connected ? '已连接 · 可在荐读页检索并同步划线' : weread.message || '未连接') : '检查中…'}
            </div>
          </div>
          <button
            onClick={() => navigate('/reading')}
            className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] text-warm-100 cursor-pointer"
          >
            去检索
          </button>
        </div>
      </div>
    </div>
  );
}
