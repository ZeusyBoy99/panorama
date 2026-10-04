import { useEffect, useLayoutEffect, useState } from 'react';
import { useUI } from '../state/store';
import { controller } from '../state/controller';
export function useOnline() {
  const [online, set] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => set(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
export function useTicker() {
  const [now, set] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => set(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function useReducedMotion() {
  const pref = useUI((s) => s.preferences.motion);
  const [system, set] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => set(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return pref === 'reduced' || (pref === 'system' && system);
}
export function useTheme() {
  const theme = useUI((s) => s.preferences.theme);
  const density = useUI((s) => s.preferences.density);
  const uiStyle = useUI((s) => s.preferences.uiStyle);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.ui = uiStyle;
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.density = density;
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          'content',
          getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        );
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, density, reduced, uiStyle]);
}
export function useVisibilityResync() {
  useEffect(() => {
    const update = () => {
      if (!document.hidden) controller.resync();
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
}
export function useWakeLock() {
  const enabled = useUI((s) => s.preferences.awake);
  const [message, setMessage] = useState('Screen wake lock is off');
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    let acquiring = false;
    async function acquire() {
      if (
        !enabled ||
        document.hidden ||
        acquiring ||
        (lock && !lock.released) ||
        !('wakeLock' in navigator)
      )
        return;
      acquiring = true;
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (disposed) {
          await acquired.release();
          return;
        }
        lock = acquired;
        setMessage('Screen will stay awake');
        acquired.addEventListener('release', () => {
          if (!disposed) setMessage('Wake lock released · reacquires when visible');
        });
      } catch {
        if (!disposed) setMessage('Browser declined wake lock');
      } finally {
        acquiring = false;
      }
    }
    if (!('wakeLock' in navigator)) setMessage('Wake lock is unavailable in this browser');
    else if (enabled) void acquire();
    else setMessage('Screen wake lock is off');
    const visibility = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      void lock?.release();
    };
  }, [enabled]);
  return message;
}
