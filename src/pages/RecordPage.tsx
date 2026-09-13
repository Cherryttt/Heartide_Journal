import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { analyzeEmotion, createRecord, findWord, healthCheck, saveWord, uploadAsset } from '../api';
import type { RecordResponse } from '../api';
import type { EmotionAnalysis, EmotionItem, HealthResponse, WordResponse } from '../api';
import type { Mood, RecordType } from '../types';
import { EMOTION_LIST, EMOTION_META, getEmotionDisplay, isCanonicalMood } from '../emotionMeta';

const MOODS = EMOTION_LIST.map((key) => ({ key, ...EMOTION_META[key] }));

const WORD_CACHE_KEY = 'heartide-word-cache';
const FALLBACK_WORDS: WordResponse[] = [
  { word: 'mangata', language: 'Swedish', roman: 'mon-ga-ta', meaning: 'Moonlight making a road across water.', literal: 'moon + road', is_coined: false, reason: 'For a quiet feeling that still follows a thin line of light.' },
  { word: 'saudade', language: 'Portuguese', roman: 'saw-dah-jee', meaning: 'A tender longing for someone, somewhere, or a version of yourself.', literal: 'sweet ache of absence', is_coined: false, reason: 'For a soft empty space inside the sentence.' },
  { word: 'hiraeth', language: 'Welsh', roman: 'hi-raith', meaning: 'Homesickness for a place or time you cannot fully return to.', literal: 'longing for home', is_coined: false, reason: 'For wanting to go back without knowing exactly where back is.' },
  { word: 'apricity', language: 'English', roman: 'a-pri-si-tee', meaning: 'The warmth of winter sunlight on your skin.', literal: 'sun warmth in cold air', is_coined: false, reason: 'For a small pocket of warmth in a tired day.' },
  { word: 'komorebi', language: 'Japanese', roman: 'ko-mo-re-bi', meaning: 'Sunlight filtering through leaves.', literal: 'light leaking through trees', is_coined: false, reason: 'For complicated feelings broken into soft pieces of light.' },
  { word: 'Waldeinsamkeit', language: 'German', roman: 'valdt-ine-zam-kite', meaning: 'The calm of being alone in a forest.', literal: 'forest solitude', is_coined: false, reason: 'For wanting to hide inside nature until the heart loosens.' },
  { word: 'meraki', language: 'Greek', roman: 'meh-rah-kee', meaning: 'Putting a piece of your soul into what you make.', literal: 'doing with soul', is_coined: false, reason: 'For still caring, even while tired.' },
  { word: 'gezellig', language: 'Dutch', roman: 'heh-zel-likh', meaning: 'A warm, intimate, just-right coziness.', literal: 'convivial comfort', is_coined: false, reason: 'For wanting life to hold you gently.' },
  { word: 'sisu', language: 'Finnish', roman: 'see-soo', meaning: 'Quiet resilience that keeps going through difficulty.', literal: 'inner grit', is_coined: false, reason: 'For being exhausted and still moving by one small step.' },
  { word: 'nunchi', language: 'Korean', roman: 'noon-chee', meaning: 'The ability to sense the room and other people feelings.', literal: 'eye measure', is_coined: false, reason: 'For sensitivity that notices too much.' },
  { word: 'fernweh', language: 'German', roman: 'fern-vay', meaning: 'An ache for faraway places.', literal: 'distance pain', is_coined: false, reason: 'For a heart that has left before the body can.' },
  { word: 'sobremesa', language: 'Spanish', roman: 'so-breh-meh-sa', meaning: 'The after-meal time spent lingering at the table.', literal: 'over the table', is_coined: false, reason: 'For not wanting a gentle conversation to end.' },
  { word: 'cafune', language: 'Portuguese', roman: 'ka-foo-neh', meaning: 'Tenderly running fingers through someone hair.', literal: 'a soothing touch', is_coined: false, reason: 'For wanting to be comforted without explaining everything.' },
  { word: 'iktsuarpok', language: 'Inuktitut', roman: 'eekt-soo-ar-pok', meaning: 'The restless anticipation of waiting for someone to arrive.', literal: 'going out to check', is_coined: false, reason: 'For expectation mixed with unease.' },
  { word: 'yugen', language: 'Japanese', roman: 'you-gen', meaning: 'A deep beauty that cannot be fully explained.', literal: 'mysterious depth', is_coined: false, reason: 'For being touched by something quiet and hard to name.' },
  { word: 'ubuntu', language: 'Zulu', roman: 'oo-boon-too', meaning: 'I am because we are.', literal: 'shared humanity', is_coined: false, reason: 'For remembering connection and being held by others.' },
  { word: 'mudita', language: 'Sanskrit', roman: 'moo-dee-ta', meaning: 'Joy for another person happiness.', literal: 'sympathetic joy', is_coined: false, reason: 'For a bright, non-possessive tenderness.' },
  { word: 'resfeber', language: 'Swedish', roman: 'ress-fay-ber', meaning: 'The nervous excitement before a journey.', literal: 'travel fever', is_coined: false, reason: 'For standing just before change.' },
  { word: 'tsundoku', language: 'Japanese', roman: 'tsun-doh-ku', meaning: 'Books gathered and waiting unread.', literal: 'pile-reading', is_coined: false, reason: 'For being surrounded by plans, books, and unfinished tenderness.' },
  { word: 'dor', language: 'Romanian', roman: 'dor', meaning: 'Longing, desire, and a small ache braided together.', literal: 'the ache of missing', is_coined: false, reason: 'For missing what cannot be reached directly.' },
];

const readWordCache = () => {
  try { return JSON.parse(localStorage.getItem(WORD_CACHE_KEY) || '[]') as { word: string; meaning?: string; language?: string }[]; } catch { return []; }
};

const rememberWordLocally = (word: WordResponse) => {
  const current = readWordCache();
  const next = [{ word: word.word, meaning: word.meaning, language: word.language }, ...current.filter((item) => item.word !== word.word)].slice(0, 80);
  localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(next));
};

const localSafety = (text: string): Pick<EmotionAnalysis, 'risk_level' | 'safety_message'> => {
  const highRisk = ['想死', '不想活', '结束生命', '结束这一切', '自杀', '伤害自己', '活不下去'];
  const elevatedRisk = ['只想消失', '撑不下去', '没有希望', '再也不想醒'];
  if (['不想自杀', '不会自杀', '不想死', '不会伤害自己'].some((phrase) => text.includes(phrase))) return { risk_level: 'none' };
  if (highRisk.some((phrase) => text.includes(phrase))) {
    return { risk_level: 'high', safety_message: '我很在意你刚才说的话。请先联系一位可信任的人并让 TA 来到你身边；如果你正处于立即危险中，请联系当地紧急服务。' };
  }
  if (elevatedRisk.some((phrase) => text.includes(phrase))) {
    return { risk_level: 'elevated', safety_message: '听起来你已经撑得很辛苦了。请现在联系一位信任的人，让现实中的陪伴先来到你身边。' };
  }
  return { risk_level: 'none' };
};

const modelSourceLabel = (source: string) => {
  const labels: Record<string, string> = {
    calibrated_ml: '训练模型 · 概率校准',
    uncalibrated_ml: '训练模型',
    llm_fallback: '低置信 LLM 兜底',
    rules: '规则兜底',
    local_rules: '本地关键词兜底',
    empty: '等待输入',
    unknown: '未知来源',
  };
  return labels[source] || source || '未知来源';
};

const healthLine = (health: HealthResponse | null, apiAvailable: boolean) => {
  if (!apiAvailable) return '后端未连接 · 本地兜底可用';
  const model = health?.emotion_model_loaded ? 'ML 模型已加载' : 'ML 模型待检查';
  const llm = health?.llm_configured ? 'LLM 已配置' : 'LLM 未配置';
  return `后端在线 · ${model} · ${llm}`;
};

// 本地关键词兜底分析（后端不可用时使用）
function localAnalyze(text: string): EmotionAnalysis {
  if (!text.trim()) return { emotions: [], tags: [], colors: [], imagery: [], valence: 0.5, arousal: 0.3, confidence: 0, model_source: 'local_rules', calibrated: false, risk_level: 'none' };

  const lower = text.toLowerCase();
  const emotions: EmotionItem[] = [];

  const rules: [Mood, string, string][] = [
    ['无情绪', EMOTION_META.无情绪.emoji, EMOTION_META.无情绪.color],
    ['积极', EMOTION_META.积极.emoji, EMOTION_META.积极.color],
    ['悲伤', EMOTION_META.悲伤.emoji, EMOTION_META.悲伤.color],
    ['愤怒', EMOTION_META.愤怒.emoji, EMOTION_META.愤怒.color],
    ['恐惧', EMOTION_META.恐惧.emoji, EMOTION_META.恐惧.color],
    ['惊奇', EMOTION_META.惊奇.emoji, EMOTION_META.惊奇.color],
  ];

  const kwMap: Record<string, string[]> = {
    '无情绪': ['无感', '没感觉', '麻木', '空白', '平静', '安静'],
    '积极': ['开心', '快乐', '高兴', '笑', '幸福', '顺利'],
    '悲伤': ['难过', '悲伤', '伤心', '低落', '委屈'],
    '愤怒': ['愤怒', '生气', '气死', '火大', '恼火', '烦死'],
    '恐惧': ['害怕', '恐惧', '焦虑', '担心', '紧张', '心慌'],
    '惊奇': ['惊讶', '惊奇', '意外', '没想到', '震惊', '吓一跳'],
  };

  for (const [mood, emoji, color] of rules) {
    const kws = kwMap[mood] || [mood];
    const count = kws.filter(kw => lower.includes(kw)).length;
    if (count > 0) {
      emotions.push({ mood, probability: Math.min(0.3 + count * 0.15, 0.9), color });
    }
  }

  if (emotions.length === 0) {
    emotions.push({ mood: '无情绪', probability: 0.5, color: EMOTION_META.无情绪.color });
  }
  emotions.sort((a, b) => b.probability - a.probability);

  const tags: string[] = [];
  if (lower.includes('花') || lower.includes('雏菊')) tags.push('花', '自然');
  if (lower.includes('雨')) tags.push('雨天');
  if (lower.includes('海')) tags.push('海');
  if (lower.includes('书') || lower.includes('读')) tags.push('阅读');

  return { emotions: emotions.slice(0, 3), tags, colors: [], imagery: [], valence: 0.5, arousal: 0.3, confidence: emotions[0]?.probability || 0, model_source: 'local_rules', calibrated: false, ...localSafety(text) };
}

export default function RecordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const addRecord = useStore((s) => s.addRecord);
  const showToast = useStore((s) => s.showToast);

  const recordType = (searchParams.get('type') || '此刻') as RecordType;
  const [text, setText] = useState('');
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [analysis, setAnalysis] = useState(localAnalyze(text));
  const [saving, setSaving] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [foundWord, setFoundWord] = useState<WordResponse | null>(null);
  const [findingWord, setFindingWord] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wordCardRef = useRef<HTMLDivElement>(null);
  const wordAttemptRef = useRef(0);

  useEffect(() => () => {
    if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (searchParams.get('focus') !== 'word') return;
    window.setTimeout(() => wordCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 180);
  }, [searchParams]);

  // 检查后端是否可用
  useEffect(() => {
    healthCheck()
      .then((d) => {
        setHealth(d);
        setApiAvailable(d.status === 'ok');
      })
      .catch(() => {
        setHealth(null);
        setApiAvailable(false);
        setAnalysisNotice('后端暂时不可达，情绪分析已切换为本地兜底。');
      });
  }, []);

  // 实时情绪分析（优先后端 API，不可用时本地兜底）
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!text.trim()) {
        setAnalysis(localAnalyze(text));
        setAnalysisNotice(apiAvailable ? '' : '后端暂时不可达，情绪分析已切换为本地兜底。');
        return;
      }
      if (apiAvailable) {
        try {
          const result = await analyzeEmotion(text);
          if (result.emotions?.length) {
            setAnalysis(result);
            setAnalysisNotice('');
            return;
          }
        } catch {
          setApiAvailable(false);
          setAnalysisNotice('后端分析暂时失败，已保留输入并切换为本地兜底。');
        }
      }
      setAnalysis(localAnalyze(text));
    }, 500);
    return () => clearTimeout(timer);
  }, [text, apiAvailable]);

  const topEmotion = analysis.emotions[0];
  const [showThinking, setShowThinking] = useState(true);

  useEffect(() => {
    setShowThinking(true);
    const timer = setTimeout(() => setShowThinking(false), 1200);
    return () => clearTimeout(timer);
  }, [text]);

  const handleFindWord = async () => {
    if (!text.trim()) {
      showToast('Write a little feeling first, then pick a word for it');
      return;
    }
    setFindingWord(true);
    wordAttemptRef.current += 1;
    const avoidWords = [...new Set([...readWordCache().map((item) => item.word), foundWord?.word].filter(Boolean) as string[])];
    try {
      const nextWord = await findWord(text, avoidWords);
      setFoundWord(nextWord);
      rememberWordLocally(nextWord);
    } catch {
      const hash = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const pool = FALLBACK_WORDS.filter((item) => !avoidWords.includes(item.word));
      const fallback = (pool.length ? pool : FALLBACK_WORDS)[(hash + wordAttemptRef.current) % (pool.length || FALLBACK_WORDS.length)];
      setFoundWord(fallback);
      rememberWordLocally(fallback);
      showToast('Backend is offline; picked one from the local word bank');
    } finally {
      setFindingWord(false);
    }
  };

  const handleSave = async () => {
    if (!text.trim()) {
      showToast('先写下一点内容，再保存这一刻');
      return;
    }
    setSaving(true);
    const emo = selectedMood || (isCanonicalMood(topEmotion?.mood) ? topEmotion.mood : undefined) || '无情绪';

    let uploadedImageUrl = '';
    let cloudSaved = false;
    let savedRecord: RecordResponse | null = null;
    try {
      if (apiAvailable) {
        if (imageFile) {
          try {
            setUploadingImage(true);
            uploadedImageUrl = (await uploadAsset(imageFile)).url;
          } catch {
            showToast('图片云端上传失败，已先保留本地预览');
          }
        }
        // 使用真实 API 保存
        const saved = await createRecord({
          text,
          record_type: recordType,
          image_url: uploadedImageUrl || undefined,
          manual_mood: selectedMood || undefined,
        });
        savedRecord = saved;
        cloudSaved = true;
        if (foundWord) void saveWord(foundWord, saved.id).then(() => rememberWordLocally(foundWord)).catch(() => showToast('Record saved; word can be synced later'));
      }
    } catch {
      setApiAvailable(false);
      setAnalysisNotice('云端保存暂时失败，这条记录已先保存在本地。');
    }

    if (foundWord) rememberWordLocally(foundWord);

    addRecord({
      id: savedRecord?.id || Date.now().toString(),
      text: savedRecord?.text || text,
      imageUrl: savedRecord?.image_url || uploadedImageUrl || imagePreview || undefined,
      type: (savedRecord?.record_type || recordType) as RecordType,
      emotions: savedRecord?.emotions || analysis.emotions,
      tags: savedRecord?.tags || analysis.tags,
      colors: savedRecord?.colors || analysis.colors,
      imagery: savedRecord?.imagery || analysis.imagery,
      valence: savedRecord?.valence ?? analysis.valence,
      arousal: savedRecord?.arousal ?? analysis.arousal,
      intensity: savedRecord?.confidence || analysis.confidence || topEmotion?.probability || 0.5,
      manualMood: (savedRecord?.manual_mood || selectedMood || undefined) as Mood | undefined,
      createdAt: savedRecord?.created_at || new Date().toISOString(),
    });
    setSaving(false);
    setUploadingImage(false);
    showToast(cloudSaved ? '已保存 · 主页会随今日心情轻轻变天 🌊' : '已先保存到本地 · 展示不会中断');
    setTimeout(() => navigate('/'), 600);
  };

  const typeOptions: { key: RecordType; emoji: string }[] = [
    { key: '吃喝', emoji: '🍰' },
    { key: '书摘', emoji: '📖' },
    { key: '灵感', emoji: '✨' },
    { key: '此刻', emoji: '💭' },
  ];

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-[#eef2f1] to-[#f4efe7]">
      <div className="flex-1 overflow-y-auto hide-scrollbar">
        <div className="px-4 pt-[50px] pb-5">
        {/* 头部 */}
        <div className="flex justify-between items-start gap-3">
          <div>
            <h1 className="text-xl text-warm-800">记录此刻</h1>
            <div className="mt-1 text-xs text-warm-400">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}</div>
          </div>
          <button onClick={() => navigate('/records')} className="shrink-0 rounded-full border border-warm-200 bg-white/70 px-3 py-1.5 text-[11px] font-bold text-warm-600 shadow-sm backdrop-blur cursor-pointer active:scale-95 transition-transform">历史记录</button>
        </div>
        <div className={`mt-2 inline-flex max-w-full rounded-full px-3 py-1 text-[10.5px] ${apiAvailable ? 'bg-leaf-50 text-leaf-700' : 'bg-amber-50 text-amber-700'}`}>
          {healthLine(health, apiAvailable)}
        </div>

        {/* 编辑器 */}
        <div className="bg-white rounded-[20px] p-4 mt-3.5 shadow-md">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天，有什么轻轻路过你？一句话、一段书摘、一个瞬间都好…"
            className="w-full border-none outline-none resize-none font-hand text-base leading-relaxed text-warm-800 bg-transparent min-h-[96px] placeholder:text-warm-300"
          />
          <div className="flex gap-2 flex-wrap pt-3 border-t border-dashed border-warm-200">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
                setImageFile(file);
                setImagePreview(URL.createObjectURL(file));
              }}
            />
            <button type="button" className="border-none text-xs text-ocean-400 bg-ocean-50 rounded-[13px] px-3 py-1.5 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              📷 {imageFile ? '更换图片' : '加图片'}
            </button>
            <span className="text-[11px] text-warm-400 self-center">文字 + 图片可同时记录</span>
          </div>
          {imagePreview && (
            <div className="relative mt-3 overflow-hidden rounded-2xl bg-warm-50">
              <img src={imagePreview} alt="待上传图片预览" className="max-h-52 w-full object-cover" />
              <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="absolute right-2 top-2 h-7 w-7 rounded-full border-none bg-black/55 text-white cursor-pointer">×</button>
            </div>
          )}
        </div>

        {/* 心情选择 */}
        <p className="text-[11px] text-warm-400 tracking-wider mt-3.5 mb-1.5">
          此刻心情 · 系统识别{selectedMood ? '（已手动选择）' : '（点其它可改）'}
        </p>
        <div className="flex gap-2 overflow-x-auto hide-scrollbar py-0.5">
          {MOODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setSelectedMood(m.key === selectedMood ? null : m.key)}
              className={`mood-btn ${(selectedMood || topEmotion?.mood) === m.key ? 'active' : ''}`}
              style={{
                backgroundColor: (selectedMood || topEmotion?.mood) === m.key ? m.color : undefined,
              }}
            >
              {m.emoji} {m.display}
            </button>
          ))}
        </div>

        {/* AI 分析 */}
        <p className="text-[11px] text-warm-400 tracking-wider mt-3.5 mb-1.5">系统读到的（实时 · 可编辑）</p>
        <div className="bg-gradient-to-br from-[#eef4f3] to-[#f3ecf2] rounded-[20px] p-4 shadow-md">
          {showThinking ? (
            <div className="flex items-center gap-1.5 text-[11px] text-ocean-400 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-ocean-300 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-ocean-300 animate-pulse" style={{ animationDelay: '0.2s' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-ocean-300 animate-pulse" style={{ animationDelay: '0.4s' }} />
              正在理解你的这段话…
            </div>
          ) : (
            <>
              {/* 情绪条 */}
              {topEmotion && (
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[15px] font-bold text-warm-700">{getEmotionDisplay(topEmotion.mood)}</span>
                  <div className="flex-1 h-[7px] rounded-full bg-warm-200 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${topEmotion.probability * 100}%`, backgroundColor: topEmotion.color }}
                    />
                  </div>
                  <span className="text-[11px] text-warm-400 w-[54px] text-right">
                    {Math.round(topEmotion.probability * 100)}%
                  </span>
                </div>
              )}
              <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-warm-500">
                <span className="rounded-full bg-white/70 px-2 py-1">来源：{modelSourceLabel(analysis.model_source)}</span>
                <span className="rounded-full bg-white/70 px-2 py-1">置信度：{Math.round((analysis.confidence || topEmotion?.probability || 0) * 100)}%</span>
                <span className="rounded-full bg-white/70 px-2 py-1">{analysis.calibrated ? '概率已校准' : '兜底/未校准'}</span>
              </div>
              {analysisNotice && (
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                  {analysisNotice}
                </div>
              )}

              {/* 自动标签 */}
              <div className="mb-2.5">
                <div className="text-[11px] text-warm-400 mb-1.5">自动标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.tags.map((tag) => (
                    <span key={tag} className="chip">
                      {getEmotionDisplay(tag) === `${tag}（旧）` ? tag : getEmotionDisplay(tag)}
                      <span className="opacity-40 text-[10px] ml-1 cursor-pointer hover:text-red-400">✕</span>
                    </span>
                  ))}
                  <span className="chip border-dashed text-warm-400 cursor-pointer">＋ 添加</span>
                </div>
              </div>

              {/* 颜色倾向 */}
              {analysis.colors.length > 0 && (
                <div className="mb-2.5">
                  <div className="text-[11px] text-warm-400 mb-1.5">颜色倾向</div>
                  <div className="flex gap-2">
                    {analysis.colors.map((c) => (
                      <span key={c} className="inline-block w-4 h-4 rounded" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              )}

              {/* 意象 */}
              {analysis.imagery.length > 0 && (
                <div>
                  <div className="text-[11px] text-warm-400 mb-1.5">捕捉到的意象</div>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.imagery.map((img) => (
                      <span key={img} className="chip">{img}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {analysis.risk_level !== 'none' && analysis.safety_message && (
          <div className={`mt-3.5 rounded-[20px] border p-4 text-[12px] leading-relaxed shadow-sm ${
            analysis.risk_level === 'high'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}>
            <strong className="block mb-1">先照顾你的安全</strong>
            {analysis.safety_message}
          </div>
        )}

        <div ref={wordCardRef} className="mt-3.5 rounded-[20px] bg-gradient-to-br from-[#27384d] to-[#426875] p-4 text-warm-100 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] tracking-widest opacity-70">把说不清的感觉，拾成一个词</div>
              <div className="font-hand text-sm mt-1 opacity-90">它会随这条记录收进你的私人情绪词典。</div>
            </div>
            <button
              onClick={handleFindWord}
              disabled={findingWord}
              className="shrink-0 rounded-full border border-white/20 bg-white/15 px-3.5 py-2 text-xs text-white cursor-pointer disabled:opacity-60"
            >
              {findingWord ? '正在拾…' : foundWord ? '再拾一个' : '✦ 为此刻拾词'}
            </button>
          </div>
          {foundWord && (
            <div className="mt-3 border-t border-white/15 pt-3">
              <div className="flex items-baseline gap-2">
                <strong className="font-serif text-[25px]">{foundWord.word}</strong>
                <span className="text-[10px] opacity-65">{foundWord.language} · {foundWord.roman}</span>
              </div>
              <p className="font-hand text-sm leading-relaxed mt-1">{foundWord.meaning}</p>
              <p className="text-[10.5px] opacity-65 mt-1.5">{foundWord.reason}</p>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* 保存按钮 - 固定在底部 */}
      <div className="flex-shrink-0 px-4 pb-5 pt-2 bg-gradient-to-t from-[#f4efe7] via-[#f4efe7]/85 to-transparent">
        <button
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="w-full h-[52px] border-none rounded-[26px] bg-gradient-to-r from-leaf-400 to-emerald-500 text-white text-[15.5px] font-bold cursor-pointer shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-45"
        >
          {uploadingImage ? '正在上传图片…' : saving ? '正在保存…' : '✓ 保存这一刻'}
        </button>
      </div>
    </div>
  );
}
