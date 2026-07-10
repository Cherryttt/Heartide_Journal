import { useEffect, useRef, useState } from 'react';
import {
  type SceneBase,
  type SceneImageAspect,
  type TimeOfDay,
  type WeatherKind,
  fallbackGradient,
  sceneImageUrl,
  weatherOverlay,
} from './sceneAssets';

function FadeInLayer({ src, onDone }: { src: string; onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`scene-bg__img scene-bg__kb scene-bg__img--fade ${visible ? 'is-on' : ''}`}
      style={{ backgroundImage: `url("${src}")` }}
      onTransitionEnd={onDone}
    />
  );
}

export default function SceneBackground({
  base,
  time,
  weather,
}: {
  base: SceneBase;
  time: TimeOfDay;
  weather: WeatherKind;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<SceneImageAspect>('portrait');
  const url = sceneImageUrl(base, time, aspect);
  const fallbackUrl = aspect === 'landscape' ? sceneImageUrl(base, time, 'portrait') : null;
  const [front, setFront] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const failed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const updateAspect = () => {
      const { width, height } = node.getBoundingClientRect();
      const nextAspect = width / Math.max(height, 1) >= 1.05 ? 'landscape' : 'portrait';
      setAspect((current) => (current === nextAspect ? current : nextAspect));
    };

    updateAspect();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateAspect);
      return () => window.removeEventListener('resize', updateAspect);
    }

    const observer = new ResizeObserver(updateAspect);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const candidates = [url, ...(fallbackUrl ? [fallbackUrl] : [])].filter(
      (candidate) => candidate !== front && candidate !== incoming && !failed.current.has(candidate),
    );
    if (!candidates.length) return;

    let cancelled = false;

    const loadCandidate = (index: number) => {
      const candidate = candidates[index];
      if (!candidate) return;

      const image = new Image();
      image.onload = () => {
        if (!cancelled) setIncoming(candidate);
      };
      image.onerror = () => {
        failed.current.add(candidate);
        if (!cancelled) loadCandidate(index + 1);
      };
      image.src = candidate;
    };

    loadCandidate(0);

    return () => {
      cancelled = true;
    };
  }, [fallbackUrl, front, incoming, url]);

  const overlay = weatherOverlay(weather);
  const visibleBackground = front ?? url;

  return (
    <div ref={rootRef} className="scene-bg" data-base={base} data-time={time} data-weather={weather} data-aspect={aspect} aria-hidden="true">
      <div className="scene-bg__fallback" style={{ background: fallbackGradient(base, time) }} />
      {visibleBackground && (
        <div className="scene-bg__img scene-bg__kb" style={{ backgroundImage: `url("${visibleBackground}")` }} />
      )}
      {incoming && (
        <FadeInLayer
          key={incoming}
          src={incoming}
          onDone={() => {
            setFront(incoming);
            setIncoming(null);
          }}
        />
      )}
      {overlay && <div className="scene-bg__grade" style={{ background: overlay }} />}
      {time === 'dusk' && <div className="scene-bg__dusk" />}
      {time === 'night' && <div className="scene-bg__night" />}
      {weather === 'storm' && <div className="scene-bg__lightning" />}
      {(weather === 'rain' || weather === 'storm') && <div className="scene-bg__rain" />}
      {weather === 'fog' && <div className="scene-bg__fog" />}
      {weather === 'snow' && <div className="scene-bg__snow" />}
    </div>
  );
}
