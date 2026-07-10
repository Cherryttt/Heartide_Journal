import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { streamChat } from '../api';
import type { Persona, AgentMessage } from '../types';

const PERSONAS: Persona[] = [
  { key: '加缪', avatar: '🪨', color: '#9a7a52', group: '作者', role: '荒诞与反抗 ·《西西弗神话》', hello: '真正严肃的哲学问题只有一个：判断人值不值得活。其余的，我们慢慢谈。' },
  { key: '村上春树', avatar: '🌀', color: '#5f86a0', group: '作者', role: '孤独、隐喻与地下世界', hello: '要不要先喝杯咖啡？有些话，得在很安静的地方才听得见。' },
  { key: '史铁生', avatar: '🌳', color: '#6a8a5e', group: '作者', role: '生命、苦难与意义', hello: '我在地坛里坐了很多年。你想聊的那个问题，我大概也想过。' },
  { key: '王小波', avatar: '🐖', color: '#b0744a', group: '作者', role: '理性、自由与有趣', hello: '人最大的恶，是剥夺别人的有趣。说吧，今天想较什么真？' },
  { key: '温柔朋友', avatar: '🤍', color: '#c08a9a', group: '陪伴', role: '不评判你的老朋友', hello: '嘿，我在呢。今天过得怎么样？' },
  { key: '海边小鹿', avatar: '🦌', color: '#8a7f6a', group: '陪伴', role: '你的治愈小动物，话不多但很暖', hello: '……（它把头轻轻靠过来）' },
  { key: '睡前故事人', avatar: '🌙', color: '#6a5f9a', group: '陪伴', role: '用很轻的声音把今天哄睡', hello: '灯关小一点。今晚想听海的故事，还是森林的？' },
];

const SUGGESTIONS = [
  '聊聊"荒诞"到底是什么',
  'AI 真的会有"意识"吗',
  '适合低落时看的句子',
];

const CHAT_LOGS_KEY = 'heartide-agent-chat-logs';
const MAX_CHAT_LOGS = 80;

interface AgentChatLog {
  id: string;
  title: string;
  persona: Persona;
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
}

const createSessionId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const readChatLogs = (): AgentChatLog[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_LOGS_KEY) || '[]') as AgentChatLog[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && Array.isArray(item.messages)) : [];
  } catch {
    return [];
  }
};

const persistChatLogs = (logs: AgentChatLog[]) => {
  localStorage.setItem(CHAT_LOGS_KEY, JSON.stringify(logs.slice(0, MAX_CHAT_LOGS)));
};

const makeChatTitle = (messages: AgentMessage[]) => {
  const firstUser = messages.find((item) => item.role === 'user' && item.text.trim());
  return (firstUser?.text || '新的对话').replace(/\s+/g, ' ').slice(0, 28);
};

const formatLogTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const localSafetyReply = (text: string) => {
  if (['不想活', '想死', '结束生命', '结束这一切', '自杀', '伤害自己', '活不下去'].some((phrase) => text.includes(phrase))
    && !['不想自杀', '不会自杀', '不想死'].some((phrase) => text.includes(phrase))) {
    return '我很在意你刚才说的话。请先不要独自承担，马上联系一位可信任的人并让 TA 来到你身边；如果你正处于立即危险中，请联系当地紧急服务。你现在安全吗？';
  }
  if (['只想消失', '撑不下去', '没有希望', '再也不想醒'].some((phrase) => text.includes(phrase))) {
    return '听起来你已经撑得很辛苦了。先联系一位信任的人，让现实中的陪伴来到你身边。你现在身边有人吗？';
  }
  return '';
};

const MOCK_REPLIES: Record<string, { core: string; src: string; quote: string; book: string }> = {
  '聊聊"荒诞"到底是什么': {
    core: '荒诞，是人渴望意义，而世界保持沉默——当这两者相遇，荒诞就诞生了。',
    src: '🧠 检索：哲学思想库 ·《西西弗神话》',
    quote: '重要的不是治愈，而是带着病痛活下去。',
    book: '加缪《西西弗神话》',
  },
  'AI 真的会有"意识"吗': {
    core: '目前没有证据表明大模型拥有主观体验：它们是极强的模式预测，而非"感受者"。但"意识"本身，连我们自己都还没定义清楚。',
    src: '🛰️ 检索：前沿知识库 · AI / 认知科学条目',
    quote: '我们尚无法定义意识，又怎能断言机器有或没有它。',
    book: '知识库 · 意识的"难问题"',
  },
  '适合低落时看的句子': {
    core: '低落的时候，不一定要变好，只要先有人陪着就够了。',
    src: '📚 检索：文学书摘库 ·《飞鸟集》',
    quote: '世界以痛吻我，要我报之以歌。',
    book: '泰戈尔《飞鸟集》',
  },
};

function getVoice(p: Persona, core: string): string {
  switch (p.key) {
    case '加缪': return core + '\n\n但请记住：重要的不是治愈，而是带着病痛、清醒地活下去。我们必须想象西西弗是幸福的。';
    case '村上春树': return '嗯。' + core + '\n\n有些黑暗你没法绕开，只能穿过它——穿过之后，你会成为稍微不同的人。';
    case '史铁生': return core + '\n\n死是一件不必急于求成的事。先把今天，认认真真地活完。';
    case '王小波': return core + '\n\n别被吓住。人只拥有此生此世是不够的，还应拥有诗意的世界——和把事情想清楚的乐趣。';
    case '温柔朋友': return core + ' 我懂的，这种感觉真的很累。要不今晚先别想那么多？';
    case '海边小鹿': return '……' + core.replace(/。/g, '，') + '（它用鼻尖碰了碰你的手）';
    case '睡前故事人': return '从前啊，' + core + ' 现在，把它放下，我们慢慢呼吸。';
    default: return core;
  }
}

export default function AgentPage() {
  const showToast = useStore((s) => s.showToast);
  const addJournalMaterial = useStore((s) => s.addJournalMaterial);
  const addBook = useStore((s) => s.addBook);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 支持从阅读/书架带 ?persona=作者名 进来,任意作者都能成为对话对象
  const initialPersona: Persona = (() => {
    const q = searchParams.get('persona');
    if (q) {
      const found = PERSONAS.find((p) => p.key === q);
      if (found) return found;
      return { key: q, avatar: '✍️', color: '#8a6a52', group: '作者', role: `拟·${q} 的语气与思想`, hello: `（${q}）想和我聊些什么？` };
    }
    return PERSONAS[0];
  })();
  const [persona, setPersona] = useState<Persona>(initialPersona);
  const [messages, setMessages] = useState<AgentMessage[]>([
    { id: '0', role: 'agent', text: initialPersona.hello, timestamp: Date.now().toString() },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatLogs, setChatLogs] = useState<AgentChatLog[]>(() => readChatLogs());
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(0);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!messages.some((item) => item.role === 'user' && item.text.trim())) return;
    const now = new Date().toISOString();
    const nextLog: AgentChatLog = {
      id: sessionId,
      title: makeChatTitle(messages),
      persona,
      messages,
      createdAt: new Date(Number(messages[0]?.timestamp) || Date.now()).toISOString(),
      updatedAt: now,
    };
    setChatLogs((current) => {
      const next = [nextLog, ...current.filter((item) => item.id !== sessionId)]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, MAX_CHAT_LOGS);
      persistChatLogs(next);
      return next;
    });
  }, [messages, persona, sessionId]);

  const handlePersonaChange = (p: Persona) => {
    if (p.key === persona.key) return;
    sessionRef.current += 1;
    setPersona(p);
    setInput('');
    setIsTyping(false);
    setStreamingId(null);
    setHistoryOpen(false);
    setSessionId(createSessionId());
    const hello: AgentMessage = {
      id: Date.now().toString(),
      role: 'agent',
      text: p.hello,
      timestamp: Date.now().toString(),
    };
    setMessages([hello]);
  };

  const loadChatLog = (log: AgentChatLog) => {
    sessionRef.current += 1;
    setPersona(log.persona);
    setMessages(log.messages);
    setSessionId(log.id);
    setInput('');
    setIsTyping(false);
    setStreamingId(null);
    setHistoryOpen(false);
    requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }));
  };

  const deleteChatLog = (id: string) => {
    setChatLogs((current) => {
      const next = current.filter((item) => item.id !== id);
      persistChatLogs(next);
      return next;
    });
    if (id === sessionId) setSessionId(createSessionId());
    showToast('已从聊天记录本移除');
  };

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg) return;
    const sessionId = sessionRef.current;
    const respondingPersona = persona;
    setInput('');

    const userMsg: AgentMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: msg,
      timestamp: Date.now().toString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsTyping(true);
    const safetyReply = localSafetyReply(msg);
    if (safetyReply) {
      setMessages((prev) => [...prev, {
        id: `${Date.now() + 1}-safety`,
        role: 'agent',
        text: safetyReply,
        source: '安全优先回应 · AI 陪伴角色',
        timestamp: Date.now().toString(),
      }]);
      setIsTyping(false);
      return;
    }

    try {
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'agent')
        .slice(-6)
        .map(m => ({ role: m.role, text: m.text }));
      const responseId = `${Date.now() + 1}-stream`;
      const agentMsg: AgentMessage = {
        id: responseId,
        role: 'agent',
        text: '',
        timestamp: Date.now().toString(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      setStreamingId(responseId);
      let received = false;
      await streamChat({ message: msg, persona_key: respondingPersona.key, history }, (chunk) => {
        if (sessionRef.current !== sessionId) return;
        if (!received) {
          received = true;
          setIsTyping(false);
        }
        setMessages((prev) => prev.map((item) => item.id === responseId ? { ...item, text: item.text + chunk } : item));
      });
      if (sessionRef.current !== sessionId) return;
      if (!received) {
        setMessages((prev) => prev.map((item) => item.id === responseId ? {
          ...item,
          text: getVoice(respondingPersona, '我在，只是这次云端没有把话完整送回来。我们可以再试一次，或者先慢慢说。'),
          source: '空响应兜底 · AI 陪伴角色',
        } : item));
      }
      setIsTyping(false);
      setStreamingId(null);
    } catch {
      // 后端不可用时使用本地 mock
      showToast('云端对话暂时不可用，已切换本地陪伴兜底');
      setMessages((prev) => prev.filter((item) => item.text));
      setStreamingId(null);
      setTimeout(() => {
        if (sessionRef.current !== sessionId) return;
        setIsTyping(false);
        const mock = MOCK_REPLIES[msg];
        const core = mock ? mock.core : '我听见你说的了。';
        const agentMsg: AgentMessage = {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          text: getVoice(respondingPersona, core),
          source: mock?.src || '本地兜底 · 后端暂时不可用',
          recommendation: mock ? { quote: mock.quote, book: mock.book } : undefined,
          timestamp: Date.now().toString(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      }, 900);
    }
  };

  return (
    <div className="relative flex flex-col h-full bg-[#f4efe8]">
      {/* 顶部 - 角色信息 */}
      <div
        className="flex-shrink-0 pt-[46px] pb-2.5 px-4 text-white transition-colors duration-300 overflow-hidden"
        style={{ backgroundColor: persona.color }}
      >
        <button onClick={() => navigate('/study')} className="border-none bg-transparent text-white/85 text-[13px] cursor-pointer p-0 mb-1.5">‹ 书房</button>
        <div className="flex items-center gap-3">
          <div className="w-[42px] h-[42px] rounded-full bg-white/20 flex items-center justify-center text-[23px] flex-shrink-0">
            {persona.avatar}
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] font-bold truncate">{persona.key}</h1>
            <div className="text-[11.5px] opacity-90 truncate">{persona.role}</div>
            <div className="mt-1 text-[9.5px] opacity-75">AI 文学陪伴角色 · 非真人或专业咨询</div>
          </div>
          <button
            onClick={() => setHistoryOpen((value) => !value)}
            aria-label="查看聊天记录本"
            className="ml-auto flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-lg shadow-sm backdrop-blur cursor-pointer active:scale-95 transition"
          >
            📖
          </button>
        </div>

        {/* 作者栏 - 支持左右滑动 */}
        <div className="overflow-x-auto hide-scrollbar mt-3 -mx-4 px-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex gap-1.5 w-max min-w-full">
            {(() => {
              let lastGroup = '';
              return PERSONAS.map((p, i) => {
                const showGroup = p.group !== lastGroup;
                lastGroup = p.group;
                return (
                  <span key={p.key} className="contents">
                    {showGroup && (
                      <span className="flex-shrink-0 self-center text-[10px] opacity-65 px-0.5 leading-none">
                        {p.group}
                      </span>
                    )}
                    <button
                      onClick={() => handlePersonaChange(p)}
                      className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded-2xl cursor-pointer transition-all whitespace-nowrap border ${
                        persona.key === p.key
                          ? 'bg-white font-bold border-white'
                          : 'bg-white/15 border-white/25'
                      }`}
                      style={{ color: persona.key === p.key ? persona.color : undefined }}
                    >
                      {p.avatar} {p.key}
                    </button>
                  </span>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {historyOpen && (
        <div className="absolute right-4 top-[92px] z-40 w-[min(360px,calc(100%-32px))] max-h-[66%] overflow-hidden rounded-[24px] border border-warm-200 bg-[#fffaf1]/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-warm-100 px-4 py-3">
            <div>
              <div className="font-hand text-[18px] font-bold text-warm-800">聊天记录本</div>
              <div className="text-[10px] text-warm-400">自动保存每次角色对话</div>
            </div>
            <button onClick={() => setHistoryOpen(false)} className="h-8 w-8 rounded-full border-none bg-warm-100 text-warm-500 cursor-pointer">×</button>
          </div>
          <div className="max-h-[calc(66vh-82px)] overflow-y-auto hide-scrollbar p-2.5">
            {chatLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-warm-200 bg-white/70 px-4 py-8 text-center text-sm text-warm-500">
                还没有保存的对话。和角色聊一句，它会自动落到这里。
              </div>
            ) : chatLogs.map((log) => (
              <div
                key={log.id}
                role="button"
                tabIndex={0}
                onClick={() => loadChatLog(log)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    loadChatLog(log);
                  }
                }}
                className="mb-2 w-full rounded-2xl border border-warm-100 bg-white/80 p-3 text-left shadow-sm cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-lg">{log.persona.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-warm-800">{log.title}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-warm-400">{log.persona.key} · {formatLogTime(log.updatedAt)}</span>
                    <span className="mt-1 block line-clamp-2 text-[11.5px] leading-relaxed text-warm-500">
                      {log.messages.filter((item) => item.text.trim()).slice(-1)[0]?.text || '新的对话'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteChatLog(log.id);
                    }}
                    className="rounded-full border-none bg-transparent px-2 py-1 text-[10px] text-warm-300 hover:bg-rose-50 hover:text-rose-500 cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 聊天区 */}
      <div ref={chatRef} className="flex-1 overflow-y-auto hide-scrollbar px-3.5 py-4 flex flex-col gap-3.5">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="max-w-[84%] ml-auto bg-current text-white px-3.5 py-2.5 rounded-2xl rounded-br text-[14.5px] leading-relaxed" style={{ backgroundColor: persona.color }}>
                {msg.text}
              </div>
            ) : (
              <div className="max-w-[84%]">
                <div className="text-[11px] text-warm-400 mb-1 ml-1">
                  {persona.avatar} {persona.key}
                </div>
                <div className="bg-white text-warm-800 px-3.5 py-3 rounded-2xl rounded-bl font-hand text-[15px] leading-[1.85] shadow-sm whitespace-pre-wrap">
                  {msg.text || (
                    <span className="inline-flex items-center gap-2 text-warm-400">
                      正在把回答慢慢写出来
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-warm-300 animate-pulse" />
                        <span className="h-1.5 w-1.5 rounded-full bg-warm-300 animate-pulse" style={{ animationDelay: '0.18s' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-warm-300 animate-pulse" style={{ animationDelay: '0.36s' }} />
                      </span>
                    </span>
                  )}
                </div>

                {/* 出处 */}
                {msg.text && msg.source && (
                  <div className="inline-flex items-center gap-1.5 mt-2 text-[11px] text-ocean-600 bg-ocean-50 border border-ocean-100 px-2.5 py-1 rounded-xl">
                    🔎 {msg.source}
                  </div>
                )}

                {/* 推荐卡片 */}
                {msg.text && msg.recommendation && (
                  <div className="mt-2.5 bg-warm-50 border border-warm-200 rounded-2xl p-3">
                    <div className="font-serif text-sm text-warm-800 leading-relaxed">
                      「{msg.recommendation.quote}」
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11.5px] text-warm-400">— {msg.recommendation.book}</span>
                      <button
                        onClick={() => {
                          const match = msg.recommendation?.book.match(/^(.+?)《(.+?)》$/);
                          const author = match?.[1] || persona.key;
                          const title = match?.[2] || msg.recommendation?.book || 'Agent 推荐';
                          const quote = msg.recommendation?.quote || '';
                          addBook({ title, author, color: persona.color, category: 'Agent 推荐', quote, tags: ['Agent 推荐'] });
                          addJournalMaterial({ text: quote, sourceType: 'agent', sourceLabel: `${author}《${title}》` });
                          showToast('已加入书架和手帐素材');
                        }}
                        className="border-none bg-leaf-400 text-white text-[11px] px-3 py-1.5 rounded-xl cursor-pointer"
                      >
                        收藏
                      </button>
                    </div>
                  </div>
                )}

                {/* 操作栏 */}
                {msg.text && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => {
                    addJournalMaterial({ text: msg.text, sourceType: 'agent', sourceLabel: `${persona.key} · 对话回答` });
                    showToast('已加入今日手帐素材');
                  }} className="text-[11px] bg-warm-100 text-warm-600 px-3 py-1.5 rounded-xl cursor-pointer border-none">
                    📜 加入手帐
                  </button>
                  <button onClick={() => navigate(`/word-finder?text=${encodeURIComponent(msg.text)}`)} className="text-[11px] bg-warm-100 text-warm-600 px-3 py-1.5 rounded-xl cursor-pointer border-none">
                    ✦ 为这感受拾个词
                  </button>
                </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* 输入中 */}
        {isTyping && !streamingId && (
          <div className="flex gap-1.5 bg-white px-4 py-3 rounded-2xl self-start shadow-sm">
            <span className="w-[7px] h-[7px] rounded-full bg-warm-300 animate-pulse" />
            <span className="w-[7px] h-[7px] rounded-full bg-warm-300 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <span className="w-[7px] h-[7px] rounded-full bg-warm-300 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
      </div>

      {/* 建议问题 */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto hide-scrollbar px-3.5 py-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => handleSend(s)}
            disabled={isTyping}
            className="flex-shrink-0 text-xs bg-white border border-warm-200 text-warm-700 px-3 py-2 rounded-2xl cursor-pointer whitespace-nowrap shadow-sm disabled:opacity-45"
          >
            {s}
          </button>
        ))}
      </div>

      {/* 输入栏 */}
      <div className="nav-safe-input flex-shrink-0 flex gap-2 items-center px-3.5 py-2 mb-[76px] bg-warm-50 border-t border-warm-200">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isTyping && handleSend()}
          placeholder="说点什么…比如「我最近有点焦虑」"
          aria-label="对话内容"
          disabled={isTyping}
          className="flex-1 border border-warm-200 rounded-[20px] px-4 py-3 text-sm outline-none text-warm-800 bg-warm-50 disabled:opacity-60"
        />
        <button
          onClick={() => handleSend()}
          aria-label="发送消息"
          disabled={isTyping || !input.trim()}
          className="w-[42px] h-[42px] rounded-full border-none text-white text-lg cursor-pointer flex-shrink-0 flex items-center justify-center disabled:opacity-45"
          style={{ backgroundColor: persona.color }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
