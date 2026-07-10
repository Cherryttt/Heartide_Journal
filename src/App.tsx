import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useStore } from './store';
import PhoneFrame from './components/PhoneFrame';
import BottomNav from './components/BottomNav';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import { getAuthToken, getMe } from './api';
import { hydrateCloudState, LOCAL_STATE_CHANGED_EVENT, prepareAccountStorage, pushCloudState } from './cloudSync';

const HomePage = lazy(() => import('./pages/HomePage'));
const RecordPage = lazy(() => import('./pages/RecordPage'));
const CollagePage = lazy(() => import('./pages/CollagePage'));
const BookshelfPage = lazy(() => import('./pages/BookshelfPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ReadingPage = lazy(() => import('./pages/ReadingPage'));
const AgentPage = lazy(() => import('./pages/AgentPage'));
const WordFinderPage = lazy(() => import('./pages/WordFinderPage'));
const StudyPage = lazy(() => import('./pages/StudyPage'));
const RecordHistoryPage = lazy(() => import('./pages/RecordHistoryPage'));

export default function App() {
  const toast = useStore((s) => s.toast);
  const authenticated = !!getAuthToken();
  const [showLogin, setShowLogin] = useState(false); // 未登录先看落地页,点进入才到登录/注册
  const [cloudReady, setCloudReady] = useState(!authenticated);

  useEffect(() => {
    if (!authenticated) {
      setCloudReady(true);
      return;
    }
    let disposed = false;
    let pushTimer: number | undefined;
    const push = () => {
      window.clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => { void pushCloudState().catch(() => undefined); }, 800);
    };
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, push);
    getMe()
      .then((user) => prepareAccountStorage(user.id))
      .then(() => hydrateCloudState())
      .then(() => useStore.getState().hydrateLocalCollections())
      .catch(() => undefined)
      .finally(() => { if (!disposed) setCloudReady(true); });
    return () => {
      disposed = true;
      window.clearTimeout(pushTimer);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, push);
    };
  }, [authenticated]);

  return (
    <>
      <PhoneFrame>
        {authenticated && !cloudReady ? (
          <div className="w-full h-full flex items-center justify-center bg-[#f3eee5] text-sm text-warm-500">正在装订你的手帐数据…</div>
        ) : authenticated ? (
          <>
            <main className="app-content">
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[#f3eee5] text-sm text-warm-500">正在翻开这一页…</div>}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/record" element={<RecordPage />} />
                  <Route path="/records" element={<RecordHistoryPage />} />
                  <Route path="/collage" element={<CollagePage />} />
                  <Route path="/bookshelf" element={<BookshelfPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/reading" element={<ReadingPage />} />
                  <Route path="/study" element={<StudyPage />} />
                  <Route path="/agent" element={<AgentPage />} />
                  <Route path="/word-finder" element={<WordFinderPage />} />
                </Routes>
              </Suspense>
            </main>
            <BottomNav />
          </>
        ) : showLogin ? <LoginPage /> : <LandingPage onEnter={() => setShowLogin(true)} />}
      </PhoneFrame>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}
