import { LogoMark, APP_NAME, APP_TAGLINE } from '../brand';

/**
 * 首次落地页:梦幻晨昏天空(柔光太阳 + 漂移云 + 粼粼海面 + 远山 + 轻微动效)。
 * 全部用 %/视口定位 → 手机竖屏、桌面宽屏都不变形、不裁切。点击进入登录/注册。
 */
export default function LandingPage({ onEnter }: { onEnter: () => void }) {
  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: 'linear-gradient(180deg,#3a4178 0%,#6f5790 24%,#bb7f9a 44%,#efa98e 60%,#f4c79c 74%,#c2d6dd 100%)' }}
    >
      <style>{`
        @keyframes lp-drift { from { transform: translateX(-3%) } to { transform: translateX(4%) } }
        @keyframes lp-drift2 { from { transform: translateX(3%) } to { transform: translateX(-3%) } }
        @keyframes lp-glow { 0%,100% { opacity:.9; transform: translate(-50%,-50%) scale(1) } 50% { opacity:1; transform: translate(-50%,-50%) scale(1.06) } }
        @keyframes lp-shimmer { 0%,100% { opacity:.22 } 50% { opacity:.5 } }
        @keyframes lp-rise { from { opacity:0; transform: translateY(16px) } to { opacity:1; transform: translateY(0) } }
        @keyframes lp-twinkle { 0%,100% { opacity:.15 } 50% { opacity:.85 } }
      `}</style>

      {/* 高空微星 */}
      {[['12%', '12%'], ['26%', '9%'], ['78%', '11%'], ['88%', '18%'], ['64%', '8%'], ['40%', '15%']].map(([l, t], i) => (
        <span key={i} className="absolute rounded-full bg-white" style={{ left: l, top: t, width: 3, height: 3, animation: `lp-twinkle ${2.6 + i * 0.5}s ease-in-out ${i * 0.4}s infinite` }} />
      ))}

      {/* 漂移柔云 */}
      <div className="absolute left-[14%] top-[20%]" style={{ width: '34%', height: '7%', background: 'radial-gradient(closest-side, rgba(255,255,255,.55), transparent)', filter: 'blur(8px)', animation: 'lp-drift 16s ease-in-out infinite alternate' }} />
      <div className="absolute right-[10%] top-[15%]" style={{ width: '30%', height: '6%', background: 'radial-gradient(closest-side, rgba(255,255,255,.5), transparent)', filter: 'blur(9px)', animation: 'lp-drift2 20s ease-in-out infinite alternate' }} />

      {/* 太阳:柔光晕 + 圆盘(圆形,不随比例变形) */}
      <div className="absolute left-1/2 top-[34%]" style={{ width: 'min(78vw, 560px)', aspectRatio: '1', transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, #fff6da 0%, #ffe2ad 20%, rgba(255,207,142,.32) 46%, transparent 70%)', animation: 'lp-glow 6.5s ease-in-out infinite' }} />
      <div className="absolute left-1/2 top-[34%] rounded-full" style={{ width: 'min(20vw, 124px)', aspectRatio: '1', transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle at 50% 45%, #fff4d4, #ffe1ad)', filter: 'blur(1.5px)', boxShadow: '0 0 60px 20px rgba(255,224,170,.5)' }} />

      {/* 海面 */}
      <div className="absolute inset-x-0 bottom-0 h-[33%]" style={{ background: 'linear-gradient(180deg, #e7ad8e 0%, #b98aa1 20%, #6f86ac 54%, #3e5c82 100%)' }} />
      {/* 远山(贴海平线,横向铺满) */}
      <svg className="absolute inset-x-0" style={{ bottom: '31%', height: '11%' }} viewBox="0 0 400 70" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="20,70 80,20 150,70" fill="#5d6c8e" opacity="0.45" />
        <polygon points="250,70 312,12 380,70" fill="#536489" opacity="0.5" />
      </svg>
      {/* 太阳在海面的倒影 */}
      <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-[33%]" style={{ width: 'min(20vw, 120px)', background: 'linear-gradient(180deg, rgba(255,233,191,.85), transparent 80%)', animation: 'lp-shimmer 3.6s ease-in-out infinite' }} />
      {/* 波光 */}
      <svg className="absolute inset-x-0 bottom-0 h-[33%]" viewBox="0 0 400 230" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,28 Q100,18 200,28 T400,28" fill="none" stroke="#fff" strokeWidth="2" style={{ animation: 'lp-shimmer 4s ease-in-out infinite' }} />
        <path d="M0,86 Q120,76 240,86 T400,86" fill="none" stroke="#fff" strokeWidth="2" opacity="0.6" style={{ animation: 'lp-shimmer 5s ease-in-out .6s infinite' }} />
        <path d="M0,150 Q90,140 180,150 T400,150" fill="none" stroke="#fff" strokeWidth="2" opacity="0.4" style={{ animation: 'lp-shimmer 6s ease-in-out 1.1s infinite' }} />
      </svg>

      {/* 暗角 */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(125% 80% at 50% 40%, transparent 52%, rgba(28,22,38,.42) 100%)' }} />

      {/* 内容(略上移,避开海平线/太阳盘) */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-8 text-center" style={{ animation: 'lp-rise 1.1s ease-out both', transform: 'translateY(-4%)' }}>
        <LogoMark size={66} />
        <h1
          className="font-art text-[58px] leading-none mt-4 tracking-[0.08em] bg-gradient-to-br from-[#fff4dc] via-[#ffd6c6] to-[#dbe6f4] bg-clip-text text-transparent"
          style={{ paddingBottom: 8, filter: 'drop-shadow(0 3px 16px rgba(35,26,48,.5))' }}
        >
          {APP_NAME}
        </h1>
        <p className="font-hand text-[16px] text-white mt-1.5" style={{ textShadow: '0 1px 12px rgba(35,26,40,.65)' }}>
          {APP_TAGLINE}
        </p>
        <p className="font-hand text-[14.5px] text-white/95 mt-7 max-w-[260px] leading-relaxed" style={{ textShadow: '0 1px 12px rgba(35,26,40,.65)' }}>
          写下心情，这片海会读懂你，<br />然后慢慢为你变天。
        </p>
        <button
          onClick={onEnter}
          className="mt-9 rounded-full bg-white/22 text-white font-bold text-[15px] px-7 py-3 active:scale-95 transition-transform cursor-pointer border border-white/45 backdrop-blur-md"
          style={{ boxShadow: '0 10px 32px rgba(35,26,48,.32)' }}
        >
          走进你的情绪手帐 →
        </button>
        <button
          onClick={onEnter}
          className="mt-3.5 bg-transparent border-none text-[12.5px] text-white/90 underline underline-offset-4 cursor-pointer"
          style={{ textShadow: '0 1px 8px rgba(35,26,40,.65)' }}
        >
          登录 / 注册
        </button>
      </div>
    </div>
  );
}
