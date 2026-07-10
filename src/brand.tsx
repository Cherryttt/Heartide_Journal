/**
 * 品牌单一事实源 —— 想改名/改标语只动这里一处。
 * 命名取向:直观、点明功能(情绪记录 + 治愈手帐),便于在应用商店吸引下载。
 */
export const APP_NAME = '心潮手帐';
export const APP_NAME_EN = 'Heartide';
export const APP_TAGLINE = '会读懂心情的治愈手帐';

/** 小图标:暖色天空 + 落日 + 海浪,呼应主页的潮汐治愈场景 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="mg-logo-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbd9a8" />
          <stop offset="0.5" stopColor="#f3a9bb" />
          <stop offset="1" stopColor="#86b0d6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#mg-logo-sky)" />
      <circle cx="20" cy="17" r="6.4" fill="#fff3d6" />
      <path d="M2 27 Q10 23 20 27 T38 27 V39 H2 Z" fill="#4a98dc" opacity="0.92" />
      <path d="M2 31 Q11 28 20 31 T38 31" fill="none" stroke="#ffffff" strokeWidth="1.1" opacity="0.5" strokeLinecap="round" />
    </svg>
  );
}

/** 图标 + 名称(可选标语)。theme 控制文字深浅,适配深色背景。 */
export function BrandMark({
  size = 28,
  theme = 'light',
  tagline = false,
  className = '',
}: {
  size?: number;
  theme?: 'light' | 'dark';
  tagline?: boolean;
  className?: string;
}) {
  const nameColor = theme === 'light' ? 'text-white' : 'text-warm-800';
  const subColor = theme === 'light' ? 'text-white/75' : 'text-warm-400';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <div className="leading-none">
        <div className={`font-serif tracking-wide ${nameColor}`} style={{ fontSize: size * 0.6 }}>
          {APP_NAME}
        </div>
        {tagline && <div className={`mt-1 text-[10px] ${subColor}`}>{APP_TAGLINE}</div>}
      </div>
    </div>
  );
}
