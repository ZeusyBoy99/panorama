import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Icon } from '../components/Icon';
export function UpdatePrompt() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  const {
    needRefresh: [refresh, setRefresh],
    offlineReady: [ready, setReady],
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration.current = reg;
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(
        () => {
          if (navigator.onLine && !document.hidden) void reg.update();
        },
        60 * 60 * 1000,
      );
    },
  });
  // The stock update call silently does nothing when no worker is waiting
  // (stale prompt state, slow install, cached worker script). This always
  // finishes with a reload so the button visibly works: check for an update,
  // activate a waiting worker, then reload with a fallback timer in case the
  // controllerchange event never arrives.
  async function updateNow() {
    let reloaded = false;
    const reload = () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    };
    try {
      const reg =
        registration.current ?? (await navigator.serviceWorker.getRegistration()) ?? null;
      if (reg) {
        await reg.update().catch(() => undefined);
        const current =
          (await navigator.serviceWorker.getRegistration())?.waiting ?? reg.waiting;
        if (current) {
          navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
          current.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(reload, 2500);
          return;
        }
      }
    } catch {
      // Fall through to a plain reload below.
    }
    reload();
  }
  if (!refresh && !ready) return null;
  return (
    <div className="pwa-toast" role="status">
      <Icon name={refresh ? 'download' : 'check'} />
      <span>{refresh ? 'An app update is available.' : 'App ready for offline use.'}</span>
      {refresh && (
        <button
          className="button accent-button small"
          onClick={() => {
            void updateNow();
          }}
        >
          Update now
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Dismiss app notice"
        onClick={() => {
          setRefresh(false);
          setReady(false);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
