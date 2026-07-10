import { FormEvent, useState } from 'react';
import { login, register, setAuthToken } from '../api';
import { LogoMark, APP_NAME, APP_TAGLINE } from '../brand';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = mode === 'login' ? await login(email, password) : await register(email, password, name);
      setAuthToken(result.access_token);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法登录');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-[#dce9e6] via-[#f2eadc] to-[#d8e4ea] flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-[28px] bg-white/70 backdrop-blur-xl border border-white/70 shadow-xl p-8">
        {/* 艺术化主标题 */}
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} />
          <h1
            className="font-hand text-[42px] leading-none mt-3.5 tracking-[0.14em] bg-gradient-to-r from-[#d28e44] via-[#d2728a] to-[#5a86b0] bg-clip-text text-transparent"
            style={{ paddingBottom: '6px' }}
          >
            {APP_NAME}
          </h1>
          <p className="text-[12.5px] text-warm-400 mt-1.5 tracking-[0.12em]">{APP_TAGLINE}</p>
        </div>
        <p className="text-[11px] text-warm-400 text-center mt-5 mb-6">登录后，记录会按账号安全隔离，并在不同设备间同步。</p>
        {mode === 'register' && <input aria-label="怎么称呼你" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="怎么称呼你" className="w-full mb-3 rounded-xl border border-warm-200 bg-white/80 px-4 py-3 outline-none" />}
        <input aria-label="邮箱" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="邮箱" className="w-full mb-3 rounded-xl border border-warm-200 bg-white/80 px-4 py-3 outline-none" />
        <input aria-label="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} type="password" placeholder="密码（至少 8 位）" className="w-full mb-3 rounded-xl border border-warm-200 bg-white/80 px-4 py-3 outline-none" />
        {error && <p role="alert" className="text-xs text-red-500 mb-3">{error}</p>}
        <button disabled={loading} className="w-full rounded-xl border-none bg-warm-700 text-white py-3 cursor-pointer disabled:opacity-50">{loading ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="w-full mt-4 border-none bg-transparent text-xs text-warm-500 cursor-pointer">{mode === 'login' ? '第一次来？创建账号' : '已有账号？直接登录'}</button>
      </form>
    </div>
  );
}
