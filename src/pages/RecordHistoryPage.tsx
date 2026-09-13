import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { getEmotionDisplay } from '../emotionMeta';

export default function RecordHistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const records = useStore((state) => state.records);
  const loadRecords = useStore((state) => state.loadRecords);
  const [loading, setLoading] = useState(records.length === 0);
  const tag = searchParams.get('tag') || '';

  useEffect(() => { void loadRecords(true).finally(() => setLoading(false)); }, [loadRecords]);

  const visibleRecords = useMemo(() => {
    if (!tag) return records;
    return records.filter((record) => [
      ...record.tags,
      ...record.imagery,
      ...record.emotions.map((emotion) => emotion.mood),
      ...record.emotions.map((emotion) => getEmotionDisplay(emotion.mood)),
    ].includes(tag));
  }, [records, tag]);

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-gradient-to-b from-[#edf4ef] to-[#f4ede5]">
      <div className="page-scroll-padding px-4 pt-[52px] pb-[104px]">
        <button onClick={() => navigate(-1)} className="border-none bg-transparent p-0 text-xs text-warm-500 cursor-pointer">‹ 返回</button>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.22em] text-warm-400">MEMORY TIDE</p>
            <h1 className="mt-1 font-serif text-[24px] text-warm-800">{tag ? `#${tag} 的记录` : '记录潮汐'}</h1>
          </div>
          {tag && <button onClick={() => setSearchParams({})} className="rounded-xl border border-warm-200 bg-white px-3 py-1.5 text-[11px] text-warm-500 cursor-pointer">查看全部</button>}
        </div>

        <div className="mt-5 space-y-3">
          {loading && <div className="rounded-2xl bg-white/70 p-5 text-center text-xs text-warm-400">正在打捞旧日记录…</div>}
          {!loading && visibleRecords.map((record) => {
            const date = new Date(record.createdAt);
            const dateKey = date.toISOString().slice(0, 10);
            return (
              <button
                key={record.id}
                onClick={() => navigate(`/collage?date=${dateKey}`)}
                className="w-full rounded-[20px] border border-white/70 bg-white/80 p-4 text-left shadow-sm cursor-pointer transition-transform active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-warm-400">{date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
                  <span className="rounded-xl bg-warm-100 px-2 py-0.5 text-[10px] text-warm-500">{record.emotions[0] ? getEmotionDisplay(record.emotions[0].mood) : record.type}</span>
                </div>
                {record.imageUrl && (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/70 bg-warm-50">
                    <img src={record.imageUrl} alt="记录图片" className="h-36 w-full object-cover" loading="lazy" />
                  </div>
                )}
                <p className="mt-2 font-hand text-[15px] leading-[1.75] text-warm-700">{record.text}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...new Set([...record.tags, ...record.imagery])].slice(0, 5).map((item) => (
                    <span key={item} className="rounded-lg bg-leaf-50 px-2 py-0.5 text-[10px] text-leaf-700">#{item}</span>
                  ))}
                </div>
              </button>
            );
          })}
          {!loading && visibleRecords.length === 0 && (
            <div className="rounded-[20px] border border-dashed border-warm-300 bg-white/50 p-8 text-center text-xs leading-relaxed text-warm-400">
              还没有与 {tag ? `#${tag}` : '这里'} 相连的记录。<br />新的潮汐会慢慢留下痕迹。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
