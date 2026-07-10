import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { describeImage, findWord, listWords, saveWord } from '../api';
import type { WordResponse } from '../api';

interface DisplayWord {
  word: string;
  roman: string;
  lang: string;
  meaning: string;
  literal: string;
  why: string;
  isCoined: boolean;
}

const toDisplay = (w: WordResponse): DisplayWord => ({
  word: w.word,
  roman: w.roman,
  lang: w.language,
  meaning: w.meaning,
  literal: w.literal,
  why: w.reason,
  isCoined: w.is_coined,
});

// 后端不可用时的兜底(刻意用外语词,呼应「寻遍世界各语言」)
const FALLBACK: WordResponse = {
  word: 'mångata',
  language: '瑞典语',
  roman: '/ˈmoːnɡɑːta/',
  meaning: '月光在水面上铺成的那一条路。',
  literal: 'måne(月)+ gata(街道、路)',
  is_coined: false,
  reason: '当你写下海、夜晚与想念时，常会落到这个词。',
};

export default function WordFinderPage() {
  const showToast = useStore((s) => s.showToast);
  const addJournalMaterial = useStore((s) => s.addJournalMaterial);
  const [searchParams] = useSearchParams();
  const [text, setText] = useState(() => searchParams.get('text') || '');
  const [word, setWord] = useState<DisplayWord | null>(null);
  const [loading, setLoading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [savedWords, setSavedWords] = useState<DisplayWord[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listWords().then((items) => setSavedWords(items.map(toDisplay))).catch(() => undefined);
  }, []);

  const find = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      setWord(toDisplay(await findWord(text)));
    } catch {
      setWord(toDisplay(FALLBACK));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (word && !savedWords.find((w) => w.word === word.word)) {
      await saveWord({
        word: word.word,
        roman: word.roman,
        language: word.lang,
        meaning: word.meaning,
        literal: word.literal,
        reason: word.why,
        is_coined: word.isCoined,
      }).catch(() => undefined);
      setSavedWords((prev) => [...prev, word]);
      showToast('已加入情绪词典');
    }
  };

  const handleImage = async (file?: File) => {
    if (!file || describing) return;
    setDescribing(true);
    try {
      const result = await describeImage(file);
      setText(result.description);
      showToast('照片里的氛围已经替你写下来了');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '暂时无法理解这张照片');
    } finally {
      setDescribing(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-gradient-to-b from-[#eef0f2] to-[#efe8de]">
      <div className="px-4 pt-[50px] pb-8">
        {/* 头部 */}
        <h1 className="font-serif text-[23px] text-warm-800 tracking-widest">拾　词</h1>
        <p className="text-xs text-warm-400 mt-1.5 leading-relaxed">
          说不清的那种感受，世界上可能早有一个词。<br />
          描述它 —— 我们替你寻遍各种语言把那个词拾起来，或为你造一个。
        </p>

        {/* 输入框 */}
        <div className="bg-white rounded-[18px] p-3.5 mt-4 shadow-md">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例如：明明在热闹里，却忽然很想一个人去海边走走，看天慢慢黑下来。"
            className="w-full border-none outline-none resize-none font-hand text-[15px] leading-[1.8] text-warm-800 min-h-[64px] bg-transparent placeholder:text-warm-300"
          />
          <div className="flex justify-between items-center pt-2.5 border-t border-dashed border-warm-200">
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
            <button
              type="button"
              disabled={describing}
              className="border-none text-xs text-ocean-400 bg-ocean-50 rounded-xl px-3 py-1.5 cursor-pointer disabled:opacity-50"
              onClick={() => imageInputRef.current?.click()}
            >
              {describing ? '📷 正在读图…' : '📷 用照片描述'}
            </button>
            <button
              onClick={find}
              disabled={!text.trim() || loading}
              className="border-none rounded-[18px] px-4 py-2.5 text-[13.5px] font-bold cursor-pointer bg-gradient-to-r from-[#6a7fb0] to-[#8a6fa0] text-white shadow-lg active:scale-[0.97] transition-transform disabled:opacity-40"
            >
              {loading ? '正在寻…' : '✦ 为我寻一个词'}
            </button>
          </div>
        </div>

        {/* 词卡:仅在寻到后出现 */}
        {!word ? (
          <div className="mt-[18px] rounded-[24px] border border-dashed border-warm-300 bg-white/40 p-8 text-center text-warm-400 text-[13px] leading-relaxed">
            描述完上面那种感觉，点「为我寻一个词」，<br />
            我们会去世界各语言里替你找一个最贴切、不可直译的词。
          </div>
        ) : (
          <>
            <div className={`mt-[18px] rounded-[24px] overflow-hidden relative text-warm-100 min-h-[330px] p-6 shadow-xl transition-all ${
              word.isCoined
                ? 'bg-gradient-to-br from-[#3a2f4e] via-[#4a3a64] to-[#6a5a86]'
                : 'bg-gradient-to-br from-[#2c3a52] via-[#34536a] to-[#3a6a74]'
            }`}>
              {/* 月光 */}
              <div className="absolute -right-8 -top-5 w-[140px] h-[140px] rounded-full bg-radial-[circle] from-[#fff6da66] to-transparent" />
              {/* 水纹 */}
              <div className="absolute left-0 right-0 bottom-0 h-[70px] opacity-50" style={{
                background: 'repeating-linear-gradient(0deg, #ffffff14 0 2px, transparent 2px 10px)',
                maskImage: 'linear-gradient(180deg, transparent, black)',
              }} />

              {/* 语言标签 */}
              <span className="inline-block text-[11px] bg-white/15 border border-white/20 px-2.5 py-1 rounded-xl relative z-[2]">
                {word.lang}
              </span>

              {/* 造词标记 */}
              {word.isCoined && (
                <span className="absolute top-[18px] right-[18px] text-[10.5px] bg-warm-200 text-warm-800 px-2.5 py-1 rounded-xl font-bold z-[3]">
                  ✨ 为你造的词
                </span>
              )}

              {/* 词 */}
              <div className="font-serif text-[44px] leading-[1.15] mt-3.5 mb-1 relative z-[2] drop-shadow-lg break-words">
                {word.word}
              </div>
              <div className="text-[13px] opacity-80 tracking-wider relative z-[2]">{word.roman}</div>

              {/* 释义 */}
              <div className="font-hand text-lg leading-[1.7] mt-4 relative z-[2]">
                {word.meaning}
              </div>
              {word.literal && <div className="text-xs opacity-75 mt-3 relative z-[2]">{word.literal}</div>}

              {/* 为什么 */}
              {word.why && (
                <div className="text-xs leading-[1.7] mt-3.5 pt-3 border-t border-white/20 opacity-90 relative z-[2]">
                  {word.why}
                </div>
              )}

              {/* 操作 */}
              <div className="flex gap-2 mt-[18px] relative z-[2]">
                <button
                  onClick={handleSave}
                  className={`flex-1 border-none rounded-xl py-2.5 text-xs cursor-pointer backdrop-blur flex items-center justify-center gap-1.5 ${
                    savedWords.find((w) => w.word === word.word) ? 'bg-white/25 text-white' : 'bg-white/15 text-white'
                  }`}
                >
                  {savedWords.find((w) => w.word === word.word) ? '✓ 已收藏' : '♡ 收藏'}
                </button>
                <button
                  onClick={() => {
                    addJournalMaterial({ text: `${word.word}：${word.meaning}`, sourceType: 'word', sourceLabel: `私人情绪词典 · ${word.lang}` });
                    showToast('已加入今日手帐素材');
                  }}
                  className="flex-1 border-none rounded-xl py-2.5 text-xs cursor-pointer bg-white/15 text-white backdrop-blur flex items-center justify-center gap-1.5"
                >
                  ✦ 加入手帐
                </button>
              </div>
            </div>

            {/* 换一个词:重新向各语言寻一个 */}
            <button
              onClick={find}
              disabled={loading}
              className="w-full mt-3 border border-dashed border-warm-300 bg-transparent text-warm-500 rounded-xl py-3 text-[13px] cursor-pointer disabled:opacity-40"
            >
              {loading ? '正在寻…' : '↻ 再寻一个（不同语言 / 造词模式）'}
            </button>
          </>
        )}

        {/* 我的情绪词典 */}
        <div className="mt-[18px] bg-white rounded-2xl p-3.5 shadow-sm">
          <h3 className="text-[13px] text-warm-700">📖 我的情绪词典</h3>
          <p className="text-[11.5px] text-warm-400">这里就是你的私人情绪词典；收藏后的词会跨设备保存在账号中。</p>
          <div className="flex gap-2 mt-2.5 flex-wrap">
            {savedWords.length === 0 ? (
              <span className="text-[11.5px] text-warm-300">还没有收藏的词。</span>
            ) : (
              savedWords.map((w) => (
                <span key={w.word} className="font-serif text-xs text-warm-700 bg-warm-100 px-2.5 py-1 rounded-xl">
                  {w.word}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
