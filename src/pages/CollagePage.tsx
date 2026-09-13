import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { generateJournalImage, generatePoem, rewriteFragments } from '../api';
import { useStore } from '../store';
import { notifyLocalStateChanged } from '../cloudSync';
import { EMOTION_META, getEmotionDisplay } from '../emotionMeta';

const STYLES = ['保留原声', '海子', '村上春树', '聂鲁达', '泰戈尔'];
// 更丰富的贴纸 + 和纸胶带(washi tape)
const STICKERS = ['📎', '🌸', '🍃', '🌿', '🦋', '⭐', '🌙', '☁️', '🐱', '🌼', '🍂', '🫧', '🎐', '💌', '🕊️', '☕', '🐚', '🍓'];
const TAPES = ['#e9b7c4', '#bcd6c2', '#cbd6ee', '#efd6a4', '#dcc6e8', '#f0c2a6'];
const JOURNAL_PREFIX = 'heartide-journal-';
const JOURNAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 翻页旋转与卷曲阴影必须用同一时长,否则阴影会和纸张脱节。
const TURN_DURATION = 0.62;
const PAPER_BY_MOOD: Record<string, { paper: string; ink: string; accent: string }> = {
  无情绪: { paper: '#e6e5df', ink: '#545a5d', accent: EMOTION_META.无情绪.color },
  积极: { paper: '#fff1c7', ink: '#704d28', accent: EMOTION_META.积极.color },
  悲伤: { paper: '#dfe5e7', ink: '#46565f', accent: EMOTION_META.悲伤.color },
  愤怒: { paper: '#f0ddd4', ink: '#6d3d32', accent: EMOTION_META.愤怒.color },
  恐惧: { paper: '#ebe3ed', ink: '#5c4c63', accent: EMOTION_META.恐惧.color },
  惊奇: { paper: '#dcecf0', ink: '#365a68', accent: EMOTION_META.惊奇.color },
};

interface LineSlip {
  id: string;
  text: string;
  x: number;
  y: number;
  rotate: number;
  fontSize: number;
  color: string;
  variant?: 'fragment' | 'poem';
}

interface Deco {
  id: string;
  kind: 'emoji' | 'tape' | 'image';
  emoji?: string;
  color?: string;
  src?: string;
  x: number;
  y: number;
  size: number;
  rotate: number;
}

interface SavedJournal {
  style?: string;
  mood?: string;
  imageUrl?: string;
  lines?: LineSlip[];
  stickers?: Deco[];
  updatedAt?: string;
}

const initialPosition = (index: number): Pick<LineSlip, 'x' | 'y' | 'rotate'> => ({
  x: 8 + (index % 2) * 42,
  y: 10 + Math.floor(index / 2) * 18,
  rotate: (index % 3 - 1) * 1.6,
});

const createLine = (id: string, text: string, index: number, color: string): LineSlip => ({
  id,
  text,
  ...initialPosition(index),
  fontSize: 15,
  color,
  variant: 'fragment',
});

const createPoemSticker = (id: string, text: string, color: string): LineSlip => ({
  id,
  text,
  x: 14 + Math.random() * 10,
  y: 18 + Math.random() * 10,
  rotate: -2 + Math.random() * 4,
  fontSize: 16,
  color,
  variant: 'poem',
});

const INK_COLORS = ['#405b67', '#704d28', '#5c4c63', '#385943', '#8b4f55', '#33456b'];
const RINGS = Array.from({ length: 11 });

const RingBinding = () => (
  <>
    <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 hidden w-5 -translate-x-1/2 flex-col items-center justify-around py-5 lg:flex" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.22), rgba(255,255,255,.06), rgba(0,0,0,.22))' }}>
      {RINGS.map((_, i) => <span key={i} className="h-3.5 w-3.5 rounded-full border border-[#b8a48c] bg-gradient-to-b from-[#f7f0e2] to-[#b6a78f] shadow" />)}
    </div>
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex h-5 -translate-y-1/2 flex-row items-center justify-around px-5 lg:hidden" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.22), rgba(255,255,255,.06), rgba(0,0,0,.22))' }}>
      {RINGS.map((_, i) => <span key={i} className="h-3.5 w-3.5 rounded-full border border-[#b8a48c] bg-gradient-to-b from-[#f7f0e2] to-[#b6a78f] shadow" />)}
    </div>
  </>
);

// 往日手帐:只读回看某一天保存的拼贴(供翻页)
function ReadonlySpread({ data }: { data: SavedJournal }) {
  const p = PAPER_BY_MOOD[data.mood || '无情绪'] || PAPER_BY_MOOD.无情绪;
  const [imageFailed, setImageFailed] = useState(false);
  const lines = data.lines || [];
  const stickers = (data.stickers || []) as Deco[];
  return (
    <div className="rounded-[22px] p-2.5 shadow-2xl" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.ink})`, boxShadow: '0 26px 60px rgba(60,40,28,.34)' }}>
      <div className="journal-spread relative grid min-h-[clamp(430px,58vh,700px)] gap-0 overflow-hidden rounded-[14px] bg-[#e7dccb] lg:grid-cols-2">
        <section className="relative min-h-[330px] overflow-hidden rounded-t-[12px] bg-[#e7dccb] lg:min-h-[inherit] lg:rounded-l-[12px] lg:rounded-tr-none">
          {data.imageUrl && !imageFailed ? <img src={data.imageUrl} alt="Past journal image" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-contain p-3" /> : <div className="absolute inset-0 flex items-center justify-center px-8 text-center" style={{ background: `radial-gradient(circle at 70% 20%, ${p.accent}88, transparent 35%), linear-gradient(145deg, ${p.paper}, ${p.accent}88)` }}><span className="rounded-2xl bg-white/55 px-4 py-3 text-[12px] leading-relaxed text-warm-600 backdrop-blur">{data.imageUrl ? 'Image link expired. Regenerate this day if needed.' : 'No illustration was generated for that day.'}</span></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/15" />
          <div className="absolute left-5 top-5 rounded-full bg-white/70 px-3 py-1 text-[10px] text-warm-700 backdrop-blur">左页 · 那天的画面</div>
        </section>
        <section className="relative min-h-[330px] overflow-hidden rounded-b-[12px] lg:min-h-[inherit] lg:rounded-r-[12px] lg:rounded-bl-none" style={{ backgroundColor: p.paper, color: p.ink, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 27px, ${p.accent}33 27px, ${p.accent}33 28px)` }}>
          <div className="absolute left-5 top-5 text-[10px] tracking-widest opacity-45">右页 · {getEmotionDisplay(data.mood || '无情绪')} · 往日回看</div>
          {lines.map((line) => (
            <div key={line.id} className={`absolute bg-white/75 font-hand leading-relaxed shadow-md ${line.variant === 'poem' ? 'px-4 py-3' : 'px-3 py-2'}`} style={{ left: `${line.x}%`, top: `${line.y}%`, maxWidth: line.variant === 'poem' ? '78%' : '72%', color: line.color || p.ink, fontSize: `${line.fontSize || 15}px`, transform: `rotate(${line.rotate}deg)`, borderRadius: line.variant === 'poem' ? '16px 11px 18px 13px' : '7px 13px 8px 11px', whiteSpace: 'pre-line' }}>{line.text}</div>
          ))}
          {stickers.map((s) => s.kind === 'tape' ? (
            <div key={s.id} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}px`, height: `${s.size * 0.32}px`, background: s.color, opacity: 0.82, borderRadius: '2px', transform: `rotate(${s.rotate || 0}deg)`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)' }} />
          ) : s.kind === 'image' ? (
            <div key={s.id} className="absolute overflow-hidden rounded-xl border-[5px] border-white/85 bg-white shadow-md" style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}px`, height: `${s.size * 0.72}px`, transform: `rotate(${s.rotate || 0}deg)` }}>
              <img src={s.src} alt="Record memory" className="h-full w-full object-cover" />
            </div>
          ) : (
            <div key={s.id} className="absolute leading-none" style={{ left: `${s.x}%`, top: `${s.y}%`, fontSize: `${s.size || 28}px`, transform: `rotate(${s.rotate || 0}deg)` }}>{s.emoji}</div>
          ))}
        </section>
        <div className="page-curl" aria-hidden="true" />
        <RingBinding />
      </div>
    </div>
  );
}

export default function CollagePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showToast = useStore((state) => state.showToast);
  const records = useStore((state) => state.records);
  const loadRecords = useStore((state) => state.loadRecords);
  const journalMaterials = useStore((state) => state.journalMaterials);
  const mood = useStore((state) => state.todayMood)?.primaryMood || '无情绪';
  const paper = PAPER_BY_MOOD[mood] || PAPER_BY_MOOD.无情绪;
  const today = new Date().toDateString();
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRecords = useMemo(() => {
    return records.filter((record) => new Date(record.createdAt).toDateString() === today);
  }, [records, today]);
  const sourceRecords = useMemo(() => todayRecords.slice(0, 8), [todayRecords]);
  const dailyMotif = useMemo(() => {
    const imagery = [...new Set(sourceRecords.flatMap((record) => record.imagery).filter(Boolean))].slice(0, 3);
    return imagery.length ? imagery.join(' / ') : `${getEmotionDisplay(mood)}的一天`;
  }, [sourceRecords, mood]);
  const journalKey = `heartide-journal-${todayKey}`;
  const savedJournal = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(journalKey) || '{}'); } catch { return {}; }
  }, [journalKey]);
  const [style, setStyle] = useState(savedJournal.style || '保留原声');
  const [lines, setLines] = useState<LineSlip[]>(() => savedJournal.lines || []);
  const [imageUrl, setImageUrl] = useState(savedJournal.imageUrl || '');
  const [todayImageFailed, setTodayImageFailed] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [composingPoem, setComposingPoem] = useState(false);
  const [stickers, setStickers] = useState<Deco[]>(() => (savedJournal.stickers || []).map((s: Partial<Deco>) => ({ kind: 'emoji', size: 28, rotate: 0, ...s } as Deco)));
  const [selected, setSelected] = useState<{ type: 'line' | 'sticker'; id: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ type: 'line' | 'sticker'; id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const rewriteCache = useRef<Record<string, LineSlip[]>>({
    保留原声: savedJournal.lines || [],
    [savedJournal.style || '保留原声']: savedJournal.lines || [],
  });
  const rewriteRequestRef = useRef(0);
  const knownRecordIdsRef = useRef<Set<string>>(new Set((savedJournal.lines || []).map((line: { id: string }) => line.id)));
  const reduceMotion = useReducedMotion();
  const [turn, setTurn] = useState<{ data: SavedJournal; dir: number; key: number } | null>(null);
  const [lastFlipDir, setLastFlipDir] = useState(0);
  const turnKeyRef = useRef(0);
  const pastedRecordIds = useMemo(() => new Set(lines.map((line) => line.id)), [lines]);
  const unpastedRecordCount = todayRecords.filter((record) => !pastedRecordIds.has(record.id)).length;

  // —— 往日翻页:收集本地保存过的每一天,今天永远在最后 ——
  const [daysVer, setDaysVer] = useState(0);
  const days = useMemo(() => {
    const keys = Object.keys(localStorage)
      .filter((key) => key.startsWith(JOURNAL_PREFIX))
      .map((key) => key.slice(JOURNAL_PREFIX.length))
      .filter((date) => JOURNAL_DATE_RE.test(date));
    const recordDates = records.map((record) => new Date(record.createdAt).toISOString().slice(0, 10));
    const set = new Set([...keys, ...recordDates]); set.add(todayKey);
    return Array.from(set).sort();
  }, [todayKey, daysVer, records]);
  const [dayIndex, setDayIndex] = useState(() => {
    const requestedDate = searchParams.get('date');
    const requestedIndex = requestedDate ? days.indexOf(requestedDate) : -1;
    return requestedIndex >= 0 ? requestedIndex : days.length - 1;
  });
  const safeIndex = Math.max(0, Math.min(dayIndex, days.length - 1));
  const currentDateStr = days[safeIndex] || todayKey;
  const isToday = currentDateStr === todayKey;
  const pastDays = days.filter((d) => d !== todayKey);
  const pastData = useMemo<SavedJournal>(() => {
    if (isToday) return {};
    try {
      const saved = JSON.parse(localStorage.getItem(`heartide-journal-${currentDateStr}`) || '{}');
      if (saved.lines?.length || saved.imageUrl) return saved;
    } catch { /* use record draft below */ }
    const dayRecords = records.filter((record) => new Date(record.createdAt).toISOString().slice(0, 10) === currentDateStr);
    return {
      mood: dayRecords[0]?.emotions[0]?.mood || '无情绪',
      imageUrl: dayRecords.find((record) => record.imageUrl)?.imageUrl,
      lines: dayRecords.slice(0, 8).map((record, index) => createLine(record.id, record.text, index, paper.ink)),
      stickers: [],
    };
  }, [isToday, currentDateStr, records, paper.ink]);
  const showEmpty = !todayRecords.length && pastDays.length === 0;

  // 直接进入 /collage(底部导航、刷新、带 ?date= 的深链)时,HomePage 可能从未挂载,
  // 记录就一直是空的。这里主动拉一次,记录已存在则会立即返回。
  useEffect(() => { void loadRecords(true); }, [loadRecords]);

  useEffect(() => { setTodayImageFailed(false); }, [imageUrl]);

  useEffect(() => {
    if (!isToday || style !== '保留原声') return;
    rewriteCache.current['保留原声'] = lines;
    lines.forEach((line) => knownRecordIdsRef.current.add(line.id));
  }, [isToday, lines, style]);

  // 翻页前把"当前停留的这一页"快照成 ReadonlySpread 能渲染的数据,用作掀页层的克隆
  const currentSpread = (): SavedJournal => isToday ? { mood, imageUrl, lines, stickers } : pastData;
  const flipTo = (next: number) => {
    if (next < 0 || next > days.length - 1) return;
    const dir = next > safeIndex ? 1 : -1;
    setSelected(null);
    setLastFlipDir(dir);
    if (!reduceMotion) setTurn({ data: currentSpread(), dir, key: ++turnKeyRef.current });
    setDayIndex(next);
  };
  const fmtDate = (d: string) => { const parts = d.split('-'); return `${Number(parts[1])}月${Number(parts[2])}日`; };

  const localRewriteLine = (text: string, nextStyle: string, index: number) => {
    const clean = text.trim().replace(/\s+/g, ' ');
    if (!clean || nextStyle === '保留原声') return clean;
    const motifs = [dailyMotif, mood, '今天'].filter(Boolean);
    const motif = motifs[index % motifs.length] || '今天';
    const clipped = clean.length > 18 ? `${clean.slice(0, 18)}…` : clean;
    if (nextStyle === '海子') return `${motif}里，${clipped}开成麦浪`.slice(0, 24);
    if (nextStyle === '村上春树') return `像夜里一支爵士，${clipped}`.slice(0, 24);
    if (nextStyle === '聂鲁达') return `我把${clipped}交给海风`.slice(0, 24);
    if (nextStyle === '泰戈尔') return `${clipped}，在晨光里轻轻合掌`.slice(0, 24);
    return `${clipped}，被这一页轻轻收好`.slice(0, 24);
  };

  const normalizeLineText = (text: string) => text.trim().replace(/\s+/g, ' ');
  const hasVisibleRewrite = (baseLines: LineSlip[], texts: string[]) => baseLines.some((line, index) => normalizeLineText(texts[index] || '') !== normalizeLineText(line.text));
  const getRewriteSourceLines = () => lines.filter((line) => line.variant !== 'poem' && line.text.trim());
  const getOriginalText = (line: LineSlip) => rewriteCache.current['保留原声']?.find((origin) => origin.id === line.id)?.text || line.text;
  const getRewriteBaseLines = () => getRewriteSourceLines().map((line) => ({ ...line, text: getOriginalText(line) }));
  const applyRewriteTexts = (targetLines: LineSlip[], baseLines: LineSlip[], texts: string[]) => {
    const rewrittenById = new Map(baseLines.map((line, index) => [line.id, texts[index]?.trim() || line.text]));
    return targetLines.map((line) => rewrittenById.has(line.id) ? { ...line, text: rewrittenById.get(line.id)! } : line);
  };
  const localRewrite = (nextStyle: string, targetLines: LineSlip[], baseLines: LineSlip[]) => applyRewriteTexts(
    targetLines,
    baseLines,
    baseLines.map((line, index) => localRewriteLine(line.text, nextStyle, index)),
  );

  const rewrite = async (nextStyle: string) => {
    const currentLines = lines;
    const sourceLines = getRewriteBaseLines();
    if (!sourceLines.length) {
      showToast('右页还没有可润色的句子');
      return;
    }
    const requestId = ++rewriteRequestRef.current;
    const cacheKey = `${nextStyle}:${sourceLines.map((line) => `${line.id}:${line.text}`).join('|')}`;
    if (style === '保留原声') rewriteCache.current['保留原声'] = currentLines;
    else rewriteCache.current[style] = currentLines;
    setStyle(nextStyle);
    setSelected(null);

    if (nextStyle === '保留原声' && rewriteCache.current['保留原声']?.length) {
      setLines(rewriteCache.current['保留原声']);
      setRewriting(false);
      return;
    }
    if (rewriteCache.current[cacheKey]) {
      setLines(rewriteCache.current[cacheKey]);
      setRewriting(false);
      return;
    }

    setRewriting(true);
    try {
      const result = await rewriteFragments(sourceLines.map((line) => line.text), nextStyle);
      const safeTexts = hasVisibleRewrite(sourceLines, result.lines) ? result.lines : sourceLines.map((line, index) => localRewriteLine(line.text, nextStyle, index));
      const rewritten = applyRewriteTexts(currentLines, sourceLines, safeTexts);
      rewriteCache.current[cacheKey] = rewritten;
      rewriteCache.current[nextStyle] = rewritten;
      if (requestId === rewriteRequestRef.current) setLines(rewritten);
    } catch {
      const rewritten = localRewrite(nextStyle, currentLines, sourceLines);
      rewriteCache.current[cacheKey] = rewritten;
      rewriteCache.current[nextStyle] = rewritten;
      if (requestId === rewriteRequestRef.current) setLines(rewritten);
      showToast('后端润色暂时不可用，已用本地逐句润色');
    } finally {
      if (requestId === rewriteRequestRef.current) setRewriting(false);
    }
  };

  const composePoemSticker = async () => {
    if (!sourceRecords.length && !lines.length) return;
    setComposingPoem(true);
    setSelected(null);
    try {
      const pastedRecordIdSet = new Set(todayRecords.map((record) => record.id));
      const selectedRecordIds = lines.filter((line) => line.variant !== 'poem' && pastedRecordIdSet.has(line.id)).map((line) => line.id);
      const result = await generatePoem({ style, records: selectedRecordIds.length ? selectedRecordIds : sourceRecords.map((record) => record.id) });
      const poemText = result.poem_text.trim();
      if (!poemText) throw new Error('empty poem');
      const poemSlip = createPoemSticker(`poem-${todayKey}`, poemText, paper.ink);
      setLines((current) => [poemSlip, ...current.filter((line) => line.id !== poemSlip.id)]);
      showToast('已装订成一张完整诗贴纸');
    } catch {
      const fallbackPoem = lines
        .filter((line) => line.variant !== 'poem')
        .map((line) => line.text.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join('\n');
      if (fallbackPoem) {
        const poemSlip = createPoemSticker(`poem-${todayKey}`, fallbackPoem, paper.ink);
        setLines((current) => [poemSlip, ...current.filter((line) => line.id !== poemSlip.id)]);
        showToast('后端暂时不可用，已先把碎片装订成贴纸');
      } else {
        showToast('还没有足够的句子可以装订');
      }
    } finally {
      setComposingPoem(false);
    }
  };

  const createImage = async () => {
    if (!sourceRecords.length) return;
    setGeneratingImage(true);
    const imagery = sourceRecords.flatMap((record) => record.imagery).filter(Boolean).slice(0, 5).join(', ') || 'soft light, wind, gentle plants, quiet room';
    const textMood = sourceRecords.map((record) => record.text).join('; ').slice(0, 180);
    const prompt = `Generate one horizontal dreamy healing dreamcore scene illustration, not a journal page. Core mood: ${mood}. Today imagery: ${imagery}. User atmosphere: ${textMood}. Scene direction: choose a surreal landscape or a quiet indoor sanctuary that matches the mood, such as floating flower fields, moonlit sea rooms, cloud corridors, rain-glass reading corners, indoor gardens, glowing windows, gentle islands, misty libraries, soft ocean bedrooms, or impossible cozy rooms. Visual style: non-photorealistic, utopian, tender, poetic, dreamy, pastel mist, soft gouache, watercolor-like gradients, pearly light, translucent glow, tiny stardust or petals, rounded forms, warm cinematic atmosphere, safe and comforting. Composition: a complete standalone environment image, wide landscape ratio, immersive depth, beautiful background first, no dominant people or faces. Strictly avoid: journal book, scrapbook page, open notebook, paper collage layout, page border, text, calligraphy, label, logo, watermark, realistic photography, stock-photo look, hard-edge 3D, horror dreamcore, uncanny liminal dread, oppressive darkness.`;
    try {
      const imageResult = await generateJournalImage(prompt);
      const url = imageResult.url;
      if (!url) throw new Error('图像接口未返回图片');
      setTodayImageFailed(false);
      setImageUrl(url);
      try {
        localStorage.setItem(journalKey, JSON.stringify({ style, lines, imageUrl: url, stickers, mood, updatedAt: new Date().toISOString() }));
        notifyLocalStateChanged();
        setDaysVer((v) => v + 1);
        showToast('插画已生成并保存');
      } catch {
        showToast('插画已生成，但浏览器本地缓存空间不足，暂未保存');
      }
    } catch (error) {
      showToast(error instanceof Error ? `生图失败：${error.message}` : '生图失败，请稍后重试');
    } finally {
      setGeneratingImage(false);
    }
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, line: LineSlip) => {
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    dragRef.current = { type: 'line', id: line.id, offsetX: event.clientX - board.left - board.width * line.x / 100, offsetY: event.clientY - board.top - board.height * line.y / 100, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startStickerDrag = (event: PointerEvent<HTMLButtonElement>, sticker: Deco) => {
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    dragRef.current = { type: 'sticker', id: sticker.id, offsetX: event.clientX - board.left - board.width * sticker.x / 100, offsetY: event.clientY - board.top - board.height * sticker.y / 100, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const board = boardRef.current?.getBoundingClientRect();
    const active = dragRef.current;
    if (!board || !active) return;
    active.moved = true;
    const x = Math.max(0, Math.min(82, ((event.clientX - board.left - active.offsetX) / board.width) * 100));
    const y = Math.max(0, Math.min(90, ((event.clientY - board.top - active.offsetY) / board.height) * 100));
    if (active.type === 'line') setLines((current) => current.map((line) => line.id === active.id ? { ...line, x, y } : line));
    else setStickers((current) => current.map((sticker) => sticker.id === active.id ? { ...sticker, x, y } : sticker));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const addSticker = (emoji: string) => setStickers((current) => [...current, { id: `${Date.now()}-${emoji}`, kind: 'emoji', emoji, x: 12 + Math.random() * 64, y: 12 + Math.random() * 64, size: 30, rotate: (Math.random() - 0.5) * 16 }]);
  const addTape = (color: string) => setStickers((current) => [...current, { id: `${Date.now()}-tape`, kind: 'tape', color, x: 10 + Math.random() * 55, y: 12 + Math.random() * 66, size: 78, rotate: (Math.random() - 0.5) * 36 }]);
  const addRecordLine = (record: typeof todayRecords[number]) => {
    const imageStickerId = `${record.id}-image`;
    const hasText = lines.some((line) => line.id === record.id);
    const hasImage = record.imageUrl && stickers.some((sticker) => sticker.id === imageStickerId);
    if (hasText && (!record.imageUrl || hasImage)) {
      showToast('这条记录已经在右页了');
      return;
    }
    let nextLine: LineSlip | null = null;
    if (!hasText) {
      nextLine = createLine(record.id, record.text, lines.length, paper.ink);
      const next = [...lines, nextLine];
      knownRecordIdsRef.current.add(record.id);
      rewriteCache.current['保留原声'] = [...(rewriteCache.current['保留原声'] || []).filter((line) => line.id !== record.id), nextLine];
      if (style === '保留原声') rewriteCache.current[style] = next;
      setLines(next);
    }
    if (record.imageUrl && !hasImage) {
      const imageSticker: Deco = {
        id: imageStickerId,
        kind: 'image',
        src: record.imageUrl,
        x: 12 + Math.random() * 42,
        y: 16 + Math.random() * 48,
        size: 132,
        rotate: (Math.random() - 0.5) * 10,
      };
      setStickers((current) => [...current, imageSticker]);
      setSelected({ type: 'sticker', id: imageSticker.id });
      showToast(nextLine ? '文字和图片都贴入右页了' : '图片已贴入右页，可以拖动排版');
    } else if (nextLine) {
      setSelected({ type: 'line', id: record.id });
      showToast('已贴入右页，可以拖动排版');
    }
  };
  const addMaterialLine = (id: string, text: string) => {
    if (lines.some((line) => line.id === id)) {
      showToast('这份素材已经在右页了');
      return;
    }
    setLines((current) => [...current, createLine(id, text, current.length, paper.ink)]);
    showToast('已放入今日手帐右页');
  };

  const randomize = () => setLines((current) => current.map((line, index) => ({ ...line, x: 4 + Math.random() * 62, y: 6 + Math.random() * 76, rotate: -4 + Math.random() * 8 + index * 0.05 })));

  const selectedObj = selected ? (selected.type === 'line' ? lines.find((l) => l.id === selected.id) : stickers.find((s) => s.id === selected.id)) : null;
  const selectedStickerKind = selected?.type === 'sticker' ? (selectedObj as Deco | undefined)?.kind : undefined;
  const selectedIsTape = selectedStickerKind === 'tape';
  const selectedIsImage = selectedStickerKind === 'image';
  const sizeRange: [number, number] = selected?.type === 'line' ? [11, 30] : selectedIsImage ? [72, 220] : [16, 96];
  const selectedSize = selected?.type === 'line' ? (selectedObj as LineSlip | undefined)?.fontSize ?? 15 : (selectedObj as Deco | undefined)?.size ?? 30;
  const setSelectedSize = (value: number) => {
    const v = Math.max(sizeRange[0], Math.min(sizeRange[1], value));
    if (selected?.type === 'line') setLines((current) => current.map((line) => line.id === selected.id ? { ...line, fontSize: v } : line));
    else if (selected) setStickers((current) => current.map((sticker) => sticker.id === selected.id ? { ...sticker, size: v } : sticker));
  };
  const rotateSelected = (delta: number) => {
    if (selected?.type === 'sticker') setStickers((current) => current.map((sticker) => sticker.id === selected.id ? { ...sticker, rotate: (sticker.rotate || 0) + delta } : sticker));
    else if (selected?.type === 'line') setLines((current) => current.map((line) => line.id === selected.id ? { ...line, rotate: (line.rotate || 0) + delta } : line));
  };
  const updateSelectedColor = (color: string) => {
    if (selected?.type === 'line') setLines((current) => current.map((line) => line.id === selected.id ? { ...line, color } : line));
  };
  const removeSelected = () => {
    if (!selected) return;
    if (selected.type === 'line') setLines((current) => current.filter((line) => line.id !== selected.id));
    else setStickers((current) => current.filter((sticker) => sticker.id !== selected.id));
    setSelected(null);
  };
  const saveJournal = () => {
    localStorage.setItem(journalKey, JSON.stringify({ style, lines, imageUrl, stickers, mood, updatedAt: new Date().toISOString() }));
    notifyLocalStateChanged();
    setDaysVer((v) => v + 1);
    showToast('已保存今天的手帐布局');
  };

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-gradient-to-b from-[#ece2d3] to-[#d3c1ab]">
      <div className="page-scroll-padding px-4 pt-[38px] pb-[110px]">
        <header className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full border border-warm-200 bg-white/70 text-warm-700 cursor-pointer">‹</button>
          <div>
            <h1 className="font-hand text-[30px] font-bold tracking-[0.12em] text-warm-800">心潮手帐</h1>
            <p className="text-[11px] text-warm-400">碎片保留拼贴感，也可以一键装订成完整诗贴纸。</p>
          </div>
          {!showEmpty && isToday && (
            <button
              onClick={saveJournal}
              className="ml-auto shrink-0 rounded-full border border-warm-200 bg-white/75 px-4 py-2 text-xs font-bold text-warm-700 shadow-sm backdrop-blur cursor-pointer active:scale-95 transition-transform"
            >
              保存手帐
            </button>
          )}
        </header>

        {showEmpty ? (
          <div className="mt-8 rounded-[28px] border border-dashed border-warm-300 bg-white/45 p-10 text-center">
            <p className="font-hand text-lg text-warm-700">今天还没有可以装订进手帐的碎片。</p>
            <button onClick={() => navigate('/record')} className="mt-4 rounded-full border-none bg-leaf-500 px-5 py-2.5 text-sm text-white cursor-pointer">写下第一条</button>
          </div>
        ) : (
          <>
            {/* 往日翻页导航 */}
            {days.length > 1 && (
              <div className="mt-3 flex items-center justify-center text-warm-600">
                <span className="rounded-full border border-warm-200 bg-white/50 px-3 py-1 text-[11px] font-bold tracking-wide shadow-sm backdrop-blur">{isToday ? '今日' : fmtDate(currentDateStr)} · {safeIndex + 1}/{days.length}</span>
              </div>
            )}

            {isToday && (
              <>
                {journalMaterials.length > 0 && (
                  <div className="mt-3 rounded-xl border border-white/45 bg-white/35 px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold tracking-wider text-warm-600">从别处带回来的素材</span>
                      <span className="text-[10px] text-warm-400">{journalMaterials.length} 份 · 点一下放入右页</span>
                    </div>
                    <div className="mt-1.5 flex gap-1.5 overflow-x-auto hide-scrollbar">
                      {journalMaterials.slice(0, 12).map((material) => (
                        <button key={material.id} onClick={() => addMaterialLine(material.id, material.text)} className="w-[132px] shrink-0 rounded-lg border border-warm-200/80 bg-white/75 px-2 py-1.5 text-left shadow-sm cursor-pointer active:scale-[0.98] transition-transform">
                          <span className="block truncate text-[8px] text-warm-400">{material.sourceLabel}</span>
                          <span className="mt-0.5 block line-clamp-2 font-hand text-[11.5px] leading-snug text-warm-700">{material.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {todayRecords.length > 0 && (
                  <div className="mt-3 rounded-[18px] border border-white/55 bg-white/38 px-3 py-2.5 shadow-sm backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold tracking-[0.16em] text-warm-700">今日记录抽屉</div>
                        <div className="mt-0.5 text-[9px] text-warm-400">横向滑动，挑选要贴进右页的记录</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-white/60 px-2.5 py-1 text-[10px] text-warm-500">{unpastedRecordCount} 条可贴</span>
                    </div>
                    <div className="mt-2 flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                      {todayRecords.map((record) => {
                        const pasted = pastedRecordIds.has(record.id);
                        const recordMood = record.emotions[0]?.mood || mood;
                        return (
                          <button
                            key={record.id}
                            onClick={() => !pasted && addRecordLine(record)}
                            disabled={pasted}
                            className={`w-[178px] shrink-0 rounded-2xl border px-3 py-2 text-left shadow-sm transition ${pasted ? 'cursor-default border-white/50 bg-white/35 opacity-60' : 'cursor-pointer border-warm-200/80 bg-[#fffaf0]/82 active:scale-[0.98] hover:bg-white/95'}`}
                          >
                            <span className="flex items-center justify-between gap-2 text-[9px] text-warm-400">
                              <span>{new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="rounded-full bg-white/60 px-2 py-0.5">{pasted ? (record.imageUrl ? '文字已贴' : '已贴入') : record.imageUrl ? '图文可贴' : getEmotionDisplay(recordMood)}</span>
                            </span>
                            {record.imageUrl && (
                              <span className="mt-2 block overflow-hidden rounded-xl border border-white/70 bg-warm-50">
                                <img src={record.imageUrl} alt="记录图片" className="h-20 w-full object-cover" loading="lazy" />
                              </span>
                            )}
                            <span className="mt-1.5 block line-clamp-3 font-hand text-[13px] leading-snug text-warm-700">{record.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2 overflow-x-auto hide-scrollbar">
                  <span className="shrink-0 self-center rounded-full border border-warm-200 bg-white/45 px-3 py-1.5 text-[10px] text-warm-500">今日意象 · {dailyMotif}</span>
                  <span className="shrink-0 self-center rounded-full border border-warm-200 bg-white/45 px-3 py-1.5 text-[10px] text-warm-500">规则 · 逐句贴纸 10-24 字 / 小诗贴纸 4-6 行</span>
                  {STYLES.map((item) => <button key={item} onClick={() => rewrite(item)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs cursor-pointer transition-colors ${style === item ? 'border-warm-700 bg-warm-700 text-warm-50' : 'border-warm-200 bg-white/70 text-warm-600'}`}>{item === '保留原声' ? '保留我的原句' : `${item} · 逐句润色`}</button>)}
                  <button onClick={composePoemSticker} disabled={composingPoem || !lines.length} className="shrink-0 rounded-full border border-[#9b7a55] bg-[#9b7a55] px-3 py-1.5 text-xs text-warm-50 cursor-pointer transition disabled:opacity-55">{composingPoem ? '正在装订…' : '装订成小诗贴纸'}</button>
                  {rewriting && <span className="shrink-0 self-center text-[10px] text-warm-500">正在准备 {style} 的句子…</span>}
                </div>
              </>
            )}

            {/* 翻页舞台 —— 在今日(可编辑) / 往日(只读) 之间像翻书一样卷动 */}
            <div className="relative mt-5" style={{ perspective: '1600px' }}>
              {/* 下层:翻完后停留的目标页(今日可编辑 / 往日只读) */}
              <motion.div
                key={currentDateStr}
                className="journal-settle-layer"
                style={{ transformStyle: 'preserve-3d' }}
                initial={reduceMotion ? false : { opacity: 0.72, x: lastFlipDir * 20, rotateY: lastFlipDir * -4 }}
                animate={{ opacity: 1, x: 0, rotateY: 0 }}
                transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              >
                {isToday ? (
                  <div className="rounded-[22px] p-2.5 shadow-2xl" style={{ background: `linear-gradient(135deg, ${paper.accent}, ${paper.ink})`, boxShadow: '0 26px 60px rgba(60,40,28,.34)' }}>
                    <div className="journal-spread relative grid min-h-[clamp(430px,58vh,700px)] gap-0 overflow-hidden rounded-[14px] bg-[#e7dccb] lg:grid-cols-2">
                      <section className="relative min-h-[330px] overflow-hidden rounded-t-[12px] bg-[#e7dccb] lg:min-h-[inherit] lg:rounded-l-[12px] lg:rounded-tr-none">
                        {imageUrl && !todayImageFailed ? <img src={imageUrl} alt="今日手帐插画" onError={() => setTodayImageFailed(true)} className="absolute inset-0 h-full w-full object-contain p-3" /> : <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 70% 20%, ${paper.accent}88, transparent 35%), linear-gradient(145deg, ${paper.paper}, ${paper.accent}88)` }} />}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/15" />
                        <div className="absolute left-5 top-5 rounded-full bg-white/70 px-3 py-1 text-[10px] text-warm-700 backdrop-blur">左页 · 今日画面</div>
                        {(!imageUrl || todayImageFailed) && (
                          <div className="absolute inset-0 flex items-center justify-center px-10 text-center">
                            <div className="max-w-[250px] -translate-y-3 text-warm-700/75">
                              <div className="mx-auto mb-4 h-16 w-16 rounded-full border border-white/50 bg-white/25 shadow-inner" />
                              <p className="font-hand text-[22px] leading-relaxed">让今天的心情，慢慢显影成一幅画。</p>
                              <p className="mt-2 text-[10px] tracking-[0.18em] opacity-65">点击下方按钮 · 留住今日光景</p>
                            </div>
                          </div>
                        )}
                        <button onClick={createImage} disabled={generatingImage} className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/40 bg-white/75 px-4 py-2 text-xs text-warm-700 backdrop-blur cursor-pointer disabled:opacity-60">{generatingImage ? '正在生图…' : imageUrl ? '重新生成画面' : '用今日记录生成插画'}</button>
                      </section>

                      <section ref={boardRef} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }} className="relative min-h-[330px] overflow-hidden rounded-b-[12px] touch-none lg:min-h-[inherit] lg:rounded-r-[12px] lg:rounded-bl-none" style={{ backgroundColor: paper.paper, color: paper.ink, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 27px, ${paper.accent}33 27px, ${paper.accent}33 28px)` }}>
                        <div className="absolute left-5 top-5 text-[10px] tracking-widest opacity-45">右页 · {getEmotionDisplay(mood)} · {dailyMotif} · 拖动排列</div>
                        {lines.map((line) => (
                          <button key={line.id} onClick={() => setSelected({ type: 'line', id: line.id })} onPointerDown={(event) => startDrag(event, line)} onPointerMove={drag} onPointerUp={endDrag} className={`absolute border-none bg-white/75 text-left font-hand leading-relaxed shadow-md cursor-grab active:cursor-grabbing ${line.variant === 'poem' ? 'px-4 py-3' : 'px-3 py-2'} ${selected?.type === 'line' && selected.id === line.id ? 'outline outline-2 outline-warm-500 outline-offset-2' : ''}`} style={{ left: `${line.x}%`, top: `${line.y}%`, maxWidth: line.variant === 'poem' ? '78%' : '72%', color: line.color || paper.ink, fontSize: `${line.fontSize || 15}px`, transform: `rotate(${line.rotate}deg)`, borderRadius: line.variant === 'poem' ? '16px 11px 18px 13px' : '7px 13px 8px 11px', whiteSpace: 'pre-line' }}>{line.text}</button>
                        ))}
                        {stickers.map((sticker) => sticker.kind === 'tape' ? (
                          <button key={sticker.id} onClick={() => setSelected({ type: 'sticker', id: sticker.id })} onPointerDown={(event) => startStickerDrag(event, sticker)} onPointerMove={drag} onPointerUp={endDrag} className={`absolute border-none cursor-grab active:cursor-grabbing ${selected?.type === 'sticker' && selected.id === sticker.id ? 'outline outline-2 outline-warm-500 outline-offset-2' : ''}`} style={{ left: `${sticker.x}%`, top: `${sticker.y}%`, width: `${sticker.size}px`, height: `${sticker.size * 0.32}px`, background: sticker.color, opacity: 0.82, borderRadius: '2px', transform: `rotate(${sticker.rotate || 0}deg)`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35), 0 1px 3px rgba(0,0,0,.12)' }} />
                        ) : sticker.kind === 'image' ? (
                          <button key={sticker.id} onClick={() => setSelected({ type: 'sticker', id: sticker.id })} onPointerDown={(event) => startStickerDrag(event, sticker)} onPointerMove={drag} onPointerUp={endDrag} className={`absolute overflow-hidden rounded-xl border-[5px] border-white/85 bg-white p-0 shadow-md cursor-grab active:cursor-grabbing ${selected?.type === 'sticker' && selected.id === sticker.id ? 'outline outline-2 outline-warm-500 outline-offset-2' : ''}`} style={{ left: `${sticker.x}%`, top: `${sticker.y}%`, width: `${sticker.size}px`, height: `${sticker.size * 0.72}px`, transform: `rotate(${sticker.rotate || 0}deg)` }}>
                            <img src={sticker.src} alt="记录图片贴纸" className="h-full w-full object-cover" draggable={false} />
                          </button>
                        ) : (
                          <button key={sticker.id} onClick={() => setSelected({ type: 'sticker', id: sticker.id })} onPointerDown={(event) => startStickerDrag(event, sticker)} onPointerMove={drag} onPointerUp={endDrag} className={`absolute border-none bg-transparent leading-none cursor-grab active:cursor-grabbing ${selected?.type === 'sticker' && selected.id === sticker.id ? 'outline outline-2 outline-warm-500 outline-offset-2 rounded-md' : ''}`} style={{ left: `${sticker.x}%`, top: `${sticker.y}%`, fontSize: `${sticker.size || 28}px`, transform: `rotate(${sticker.rotate || 0}deg)` }}>{sticker.emoji}</button>
                        ))}
                      </section>
                      {/* 右下角常驻卷角 */}
                      <div className="page-curl" aria-hidden="true" />
                      <RingBinding />
                    </div>
                  </div>
                ) : (
                  <ReadonlySpread data={pastData} />
                )}
              </motion.div>

              {/* 上层:把离开的那一页克隆出来,绕书脊卷走,露出下层 */}
              <AnimatePresence>
                {turn && (
                  <motion.div
                    key={turn.key}
                    className="journal-curl-reveal pointer-events-none absolute inset-0 z-30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    <motion.div
                      className={`journal-curl-sheet ${turn.dir > 0 ? 'journal-curl-sheet--next' : 'journal-curl-sheet--prev'}`}
                      initial={{ x: 0, rotateZ: 0, scale: 1 }}
                      animate={{
                        x: turn.dir > 0 ? -64 : 64,
                        rotateZ: turn.dir > 0 ? -2.5 : 2.5,
                        scale: 1.012,
                      }}
                      transition={{ duration: TURN_DURATION, ease: [0.16, 1, 0.3, 1] }}
                      onAnimationComplete={() => setTurn(null)}
                    >
                      <ReadonlySpread data={turn.data} />
                      <motion.div
                        className="journal-curl-sheet__shade"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0.16, 0.52, 0.28] }}
                        transition={{ duration: TURN_DURATION, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </motion.div>
                    <motion.div
                      className="journal-curl-edge"
                      initial={{ opacity: 0, x: 34 }}
                      animate={{ opacity: [0, 0.75, 0.4], x: 0 }}
                      transition={{ duration: TURN_DURATION, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {days.length > 1 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex items-end justify-between px-5 lg:px-7">
                  <button
                    onClick={() => flipTo(safeIndex - 1)}
                    disabled={safeIndex === 0}
                    aria-label="翻到往日"
                    className="pointer-events-auto rounded-full border border-warm-200/80 bg-[#fff8ea]/88 px-3.5 py-1.5 text-[11px] font-bold text-warm-700 shadow-md backdrop-blur cursor-pointer transition active:scale-95 disabled:cursor-default disabled:opacity-30"
                  >
                    ← 往日
                  </button>
                  <button
                    onClick={() => flipTo(safeIndex + 1)}
                    disabled={safeIndex === days.length - 1}
                    aria-label="翻到近期"
                    className="pointer-events-auto rounded-full border border-warm-200/80 bg-[#fff8ea]/88 px-3.5 py-1.5 text-[11px] font-bold text-warm-700 shadow-md backdrop-blur cursor-pointer transition active:scale-95 disabled:cursor-default disabled:opacity-30"
                  >
                    近期 →
                  </button>
                </div>
              )}
            </div>

            {isToday ? (
              <>
                <div className="mt-3 rounded-2xl border border-white/60 bg-white/55 p-2.5">
                  <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
                    <span className="shrink-0 text-[10px] font-bold tracking-wider text-warm-500">贴纸</span>
                    {STICKERS.map((emoji) => <button key={emoji} onClick={() => addSticker(emoji)} className="h-9 w-9 shrink-0 rounded-full border border-warm-200 bg-white text-lg leading-none cursor-pointer active:scale-90">{emoji}</button>)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 overflow-x-auto hide-scrollbar">
                    <span className="shrink-0 text-[10px] font-bold tracking-wider text-warm-500">胶带</span>
                    {TAPES.map((color) => <button key={color} onClick={() => addTape(color)} aria-label="和纸胶带" className="h-6 w-12 shrink-0 rounded-sm border border-white/70 shadow cursor-pointer active:scale-90" style={{ background: color, opacity: 0.85 }} />)}
                    <button onClick={randomize} className="ml-auto shrink-0 rounded-full border border-warm-200 bg-white/70 px-3 py-1.5 text-[11px] text-warm-600 cursor-pointer">↻ 随机散落</button>
                  </div>
                </div>

                {selected && selectedObj && (
                  <div className="sticky bottom-[82px] z-10 mt-3 flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/60 bg-[#f7f0e5]/95 p-3 shadow-xl backdrop-blur">
                    <span className="px-1 text-[10px] font-bold tracking-wider text-warm-500">{selected.type === 'line' ? '文字' : selectedIsTape ? '胶带' : selectedIsImage ? '图片' : '贴纸'}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-warm-500">大小</span>
                      <button onClick={() => setSelectedSize(selectedSize - (selected.type === 'line' ? 1 : 4))} className="h-7 w-7 rounded-full border border-warm-200 bg-white text-warm-700 cursor-pointer">−</button>
                      <input type="range" min={sizeRange[0]} max={sizeRange[1]} value={selectedSize} onChange={(e) => setSelectedSize(Number(e.target.value))} className="w-24 accent-leaf-500 cursor-pointer" />
                      <button onClick={() => setSelectedSize(selectedSize + (selected.type === 'line' ? 1 : 4))} className="h-7 w-7 rounded-full border border-warm-200 bg-white text-warm-700 cursor-pointer">+</button>
                    </div>
                    <button onClick={() => rotateSelected(-8)} className="h-7 min-w-7 rounded-full border border-warm-200 bg-white px-2 text-warm-700 cursor-pointer">↺</button>
                    <button onClick={() => rotateSelected(8)} className="h-7 min-w-7 rounded-full border border-warm-200 bg-white px-2 text-warm-700 cursor-pointer">↻</button>
                    {selected.type === 'line' && INK_COLORS.map((color) => <button key={color} aria-label={`文字颜色 ${color}`} onClick={() => updateSelectedColor(color)} className="h-6 w-6 rounded-full border-2 border-white shadow cursor-pointer" style={{ backgroundColor: color }} />)}
                    <button onClick={removeSelected} className="ml-auto rounded-full border-none bg-rose-200 px-3 py-1.5 text-[10px] text-rose-800 cursor-pointer">🗑️ 删除</button>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-4 text-center text-[11px] text-warm-400">这是 {fmtDate(currentDateStr)} 的手帐 · 往日只供回看，翻回今日即可继续编辑。</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
