import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Icon } from '../components/Icon';
export function UpdatePrompt() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  const {
    needRefresh: [refresh, setRefresh],
    offlineReady: [ready, setReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(
        () => {
          if (navigator.onLine && !document.hidden) void registration.update();
        },
        60 * 60 * 1000,
      );
    },
  });
  if (!refresh && !ready) return null;
  return (
    <div className="pwa-toast" role="status">
      <Icon name={refresh ? 'download' : 'check'} />
      <span>{refresh ? 'An app update is available.' : 'App ready for offline use.'}</span>
      {refresh && (
        <button
          className="button accent-button small"
          onClick={() => {
            void updateServiceWorker(true);
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
