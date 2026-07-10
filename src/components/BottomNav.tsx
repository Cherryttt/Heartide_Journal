import { useNavigate, useLocation } from 'react-router-dom';

// 手帐为主线:主页 / 拼贴诗 / 记录(中央主行动) / 书房(阅读·摘录·对话副入口) / 画像
const navItems = [
  { path: '/', icon: '🏠', label: '主页' },
  { path: '/collage', icon: '📜', label: '手帐' },
  { path: '/record', icon: '✍️', label: '记录', primary: true },
  { path: '/study', icon: '📚', label: '书房' },
  { path: '/profile', icon: '🦌', label: '画像' },
];

const sectionPaths: Record<string, string[]> = {
  '/collage': ['/collage'],
  '/record': ['/record', '/records'],
  '/study': ['/study', '/bookshelf', '/reading', '/agent', '/word-finder'],
  '/profile': ['/profile'],
};

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const themes: Record<string, { background: string; border: string; text: string; active: string }> = {
    '/': { background: 'rgba(238, 244, 241, 0.22)', border: 'rgba(255, 255, 255, 0.34)', text: '#ffffff', active: 'rgba(255,255,255,0.22)' },
    '/study': { background: 'rgba(89, 67, 49, 0.82)', border: 'rgba(232, 207, 158, 0.28)', text: '#f5ead4', active: 'rgba(232,207,158,0.18)' },
  };
  const theme = themes[location.pathname] || { background: 'rgba(248, 243, 233, 0.94)', border: 'rgba(194, 174, 142, 0.56)', text: '#5a4422', active: 'rgba(232,207,158,0.42)' };

  return (
    <nav
      className="app-nav absolute left-3 right-3 bottom-3.5 h-[60px] backdrop-blur-xl rounded-3xl flex items-center justify-around z-20 transition-colors border"
      style={{ backgroundColor: theme.background, borderColor: theme.border, color: theme.text }}
    >
      {navItems.map((item) => {
        const active = item.path === '/' ? location.pathname === '/' : (sectionPaths[item.path] || []).includes(location.pathname);
        if (item.primary) {
          // 记录:始终高亮的中央主行动
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="min-w-[52px] min-h-[52px] -translate-y-1.5 border-none flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer rounded-2xl text-white shadow-lg active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg, #7ab36a, #5a7a4e)' }}
            >
              <span className="text-lg block leading-none">{item.icon}</span>
              <span className="mt-0.5">{item.label}</span>
            </button>
          );
        }
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`min-w-[52px] min-h-[48px] border-none flex flex-col items-center justify-center text-[10px] cursor-pointer transition-all rounded-2xl ${
              active ? 'opacity-100 -translate-y-0.5 font-bold' : 'opacity-65'
            }`}
            style={{ backgroundColor: active ? theme.active : 'transparent' }}
          >
            <span className="text-lg block leading-none">{item.icon}</span>
            <span className="mt-0.5">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
