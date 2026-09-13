/**
 * 阅读信息流的共享数据与排序逻辑。
 * 阅读页用它渲染整条信息流;主页「适合读」卡片用它算出当前最高推荐的那一句。
 */

export interface FeedItem {
  id: string;
  quote: string;
  book: string;
  author: string;
  cover: string;
  reason: string;
  bgColor: string;
  textColor: string;
  passage: string;
  tags: string[];
}

export type FeedbackAction = 'favorite' | 'highlight' | 'dislike';
export type FeedbackMap = Record<string, Partial<Record<FeedbackAction, number>>>;

export const FEED: FeedItem[] = [
  { id: '1', quote: '世界以痛吻我，要我报之以歌。', book: '飞鸟集', author: '泰戈尔', cover: '#c0a040', reason: '离线精选 · 温柔与欣然', bgColor: '#e8f0f2', textColor: '#3a5a6a', passage: '世界以痛吻我，要我报之以歌。只有经历过地狱般的磨砺，才能练就创造天堂的力量；只有流过血的手指，才能弹出世间的绝响。', tags: ['积极', '诗歌', '海', '温柔'] },
  { id: '2', quote: '死是一件不必急于求成的事。', book: '我与地坛', author: '史铁生', cover: '#6a8a5e', reason: '离线精选 · 生命与无波', bgColor: '#eaf1e8', textColor: '#3a5a3a', passage: '死是一件不必急于求成的事，死是一个必然会降临的节日。这样想过之后我安心多了，眼前的一切不再那么可怕。', tags: ['生命', '散文', '无情绪', '成长'] },
  { id: '3', quote: '有些黑暗你没法绕开，只能穿过它。', book: '挪威的森林', author: '村上春树', cover: '#5f86a0', reason: '离线精选 · 低落与成长', bgColor: '#e8eef0', textColor: '#3a4a5a', passage: '有些黑暗你没法绕开，只能穿过它。穿过它之后，你会成为稍微不同的人。而这，正是我们称之为成长的东西。', tags: ['悲伤', '文学', '成长'] },
  { id: '4', quote: '重要的不是治愈，而是带着病痛活下去。', book: '西西弗神话', author: '加缪', cover: '#9a7a52', reason: '离线精选 · 哲学与坚韧', bgColor: '#f0ece4', textColor: '#4a3a2a', passage: '在荒诞中保持清醒，并认真地生活，本身就是一种反抗。', tags: ['哲学', '荒诞', '生命', '坚韧'] },
  { id: '5', quote: '面朝大海，春暖花开。', book: '海子的诗', author: '海子', cover: '#4a80a0', reason: '离线精选 · 海与自由', bgColor: '#e8f0f4', textColor: '#2a4a6a', passage: '从明天起，做一个幸福的人。喂马，劈柴，周游世界。从明天起，关心粮食和蔬菜。我有一所房子，面朝大海，春暖花开。', tags: ['海', '诗歌', '自由', '积极'] },
  { id: '6', quote: '使生活如此美丽的，是我们藏起来的真诚和童心。', book: '小王子', author: '圣埃克苏佩里', cover: '#c08840', reason: '离线精选 · 童心与温柔', bgColor: '#f4eddf', textColor: '#6d5432', passage: '真正重要的东西，用眼睛是看不见的。正因为你为你的玫瑰花费了时间，它才变得如此重要。', tags: ['童心', '温柔', '文学', '积极'] },
  { id: '7', quote: '自由就是成为自己的可能。', book: '人间食粮', author: '纪德', cover: '#8a9a6a', reason: '离线精选 · 自由与成长', bgColor: '#edf0e5', textColor: '#48523d', passage: '不要因为结果而哭泣，要因为它曾经发生而微笑。自由并不是逃离，而是成为自己的可能。', tags: ['自由', '散文', '成长', '积极'] },
  { id: '8', quote: '你有力量选择如何看待发生在你身上的事。', book: '沉思录', author: '马可·奥勒留', cover: '#7a6a5a', reason: '离线精选 · 惶然与稳定', bgColor: '#ebe8e2', textColor: '#50483e', passage: '困扰人的不是事情本身，而是人们对事情的看法。你可以在任何时刻回到自己的内心。', tags: ['哲学', '恐惧', '无情绪', '自我'] },
];

export const loadFeedback = (): FeedbackMap => {
  try { return JSON.parse(localStorage.getItem('moodgarden-reading-feedback') || '{}'); } catch { return {}; }
};

const normalizeFeedValue = (value: string) => value.trim().replace(/\s+/g, '').toLowerCase();

export const feedIdentity = (item: Pick<FeedItem, 'quote' | 'book' | 'author'>) => [
  normalizeFeedValue(item.book),
  normalizeFeedValue(item.author),
  normalizeFeedValue(item.quote),
].join('::');

export const mergeUniqueFeedItems = (current: FeedItem[], incoming: FeedItem[], limit = 36) => {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    const key = feedIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-limit);
};

export const rankFeed = (feedback: FeedbackMap, offset: number) => {
  const feedbackEntries = Object.entries(feedback).map(([id, actions]) => ({
    source: FEED.find((item) => item.id === id),
    actions,
  })).filter((entry) => entry.source);

  return [...FEED].sort((a, b) => {
    const score = (item: FeedItem) => {
      const own = feedback[item.id] || {};
      const tagScore = item.tags.reduce((sum, tag) => sum + feedbackEntries.reduce((tagSum, entry) => {
        if (!entry.source?.tags.includes(tag)) return tagSum;
        const actions = entry.actions;
        return tagSum + (actions.favorite || 0) * 3 + (actions.highlight || 0) * 2 - (actions.dislike || 0) * 7;
      }, 0), 0);
      const authorScore = feedbackEntries.reduce((sum, entry) => entry.source?.author === item.author
        ? sum + (entry.actions.favorite || 0) * 2 + (entry.actions.highlight || 0) - (entry.actions.dislike || 0) * 6
        : sum, 0);
      return (own.favorite || 0) * 5 + (own.highlight || 0) * 3 - (own.dislike || 0) * 18 + tagScore + authorScore + ((Number(item.id) + offset) % 5) * 0.01;
    };
    return score(b) - score(a);
  });
};

export const topRecommendation = (): FeedItem => rankFeed(loadFeedback(), 0)[0];
