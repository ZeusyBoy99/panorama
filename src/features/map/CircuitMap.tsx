import { memo, useEffect, useRef, useState } from 'react';
import { useRace, useUI } from '../../state/store';
import { useReducedMotion } from '../../app/hooks';
import {
  trackPath,
  pitPath,
  trackLabels,
  sectorAnchors,
  startFinish,
  trackGeometryNotice,
  trackAttribution,
  northArrow,
} from '../../assets/track';
import { pointAt } from './geometry';
import { resolvePosition } from './resolver';
import { unwrapForward } from '../../domain/speed';
import { Icon } from '../../components/Icon';
import type { Snapshot } from '../../domain/schema';
export const CircuitMap = memo(function CircuitMap({ large = false }: { large?: boolean }) {
  const snapshot = useRace((s) => s.snapshot);
  const received = useRace((s) => s.receivedMono);
  const status = useRace((s) => s.status);
  const cached = useRace((s) => s.cached);
  const selected = useUI((s) => s.selectedId);
  const favourites = useUI((s) => s.preferences.favourites);
  const select = useUI((s) => s.select);
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const previous = useRef<Snapshot | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
    pointers: Map<number, { x: number; y: number }>;
    pinch: number | null;
  }>({ x: 0, y: 0, ox: 0, oy: 0, moved: false, pointers: new Map(), pinch: null });
  const profile = snapshot?.profile ?? 'position';
  useEffect(() => {
    if (!snapshot) return;
    const before =
      previous.current?.sessionId === snapshot.sessionId &&
      previous.current?.streamId === snapshot.streamId
        ? previous.current
        : null;
    const began = performance.now();
    let frame = 0;
    let freshness: ReturnType<typeof setInterval> | null = null;
    const render = () => {
      const now = performance.now();
      const delta = status.paused || cached ? 0 : Math.max(0, now - received) * status.speed;
      const time = snapshot.session.elapsed + delta;
      const occupied: { x: number; y: number }[] = [];
      const selectedId = useUI.getState().selectedId;
      const order = [...snapshot.entries].sort(
        (a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0),
      );
      for (const car of order) {
        const node = nodes.current.get(car.id);
        if (!node) continue;
        const p = resolvePosition(car, snapshot, time);
        let progress = p.progress;
        if (
          progress !== null &&
          car.observation.kind === 'position' &&
          !reduced &&
          before &&
          car.status === 'running'
        ) {
          const prior = before.entries.find((e) => e.id === car.id);
          if (
            prior?.observation.kind === 'position' &&
            prior.observation.at !== car.observation.at &&
            car.observation.at - prior.observation.at < 20000
          ) {
            const start = prior.observation.progress,
              target = unwrapForward(start, progress);
            if (target - start >= 0 && target - start < 0.3)
              progress = start + (target - start) * Math.min(1, (now - began) / 500);
          }
        }
        if (progress === null) {
          node.style.display = 'none';
          continue;
        }
        node.style.display = '';
        node.style.opacity = p.confidence === 'stale' ? '.35' : p.confidence === 'low' ? '.7' : '1';
        const point = pointAt(p.pitProgress ?? progress, p.pitProgress !== null);
        let labelX = 0,
          labelY = 0;
        let neighbours = 0;
        for (const o of occupied) if (Math.hypot(point.x - o.x, point.y - o.y) < 23) neighbours++;
        if (neighbours) {
          const side = neighbours % 2 ? 1 : -1;
          const offset = Math.ceil(neighbours / 2) * 22;
          const angle = (point.angle * Math.PI) / 180;
          labelX = -Math.sin(angle) * offset * side;
          labelY = Math.cos(angle) * offset * side;
        }
        occupied.push(point);
        node.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ')');
        node.dataset.path = p.pitProgress === null ? 'track' : 'pit';
        node.dataset.progress = String(progress);
        const label = node.querySelector<SVGGElement>('.marker-label');
        label?.setAttribute('transform', 'translate(' + labelX + ' ' + labelY + ')');
        if (label) label.dataset.offset = neighbours ? 'true' : 'false';
        const leader = node.querySelector<SVGLineElement>('.marker-leader');
        leader?.setAttribute('x2', String(labelX));
        leader?.setAttribute('y2', String(labelY));
        if (leader) leader.style.display = neighbours ? '' : 'none';
        node.dataset.confidence = p.confidence;
        const title = node.querySelector('title');
        if (title) title.textContent = '#' + car.number + ' · ' + p.provenance + ' · ' + p.reason;
      }
      if (!document.hidden && !reduced) frame = requestAnimationFrame(render);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        render();
      }
    };
    render();
    if (reduced) freshness = setInterval(render, 1000);
    document.addEventListener('visibilitychange', visibility);
    previous.current = snapshot;
    return () => {
      cancelAnimationFrame(frame);
      if (freshness) clearInterval(freshness);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [snapshot, received, status, reduced, cached]);
  const unavailable =
    snapshot?.entries.filter(
      (e) => resolvePosition(e, snapshot, snapshot.session.elapsed).progress === null,
    ) ?? [];
  function zoom(amount: number) {
    setView((v) => ({ ...v, zoom: Math.max(1, Math.min(3, v.zoom + amount)) }));
  }
  function coordinates(event: React.PointerEvent) {
    const box = svg.current!.getBoundingClientRect();
    return { x: event.clientX, y: event.clientY, sx: 680 / box.width, sy: 520 / box.height };
  }
  return (
    <section
      className={'panel circuit-panel ' + (large ? 'large-map' : '')}
      aria-label="Mount Panorama circuit map"
    >
      <div className="panel-heading">
        <div className="section-title">
          <span className="eyebrow">MOUNT PANORAMA</span>
          <h2>
            The mountain <span className="subtle">6.213 km</span>
          </h2>
        </div>
        <span className={'source-chip ' + (profile === 'position' ? '' : 'estimated')}>
          {profile === 'position'
            ? 'SIMULATED POSITIONS'
            : profile === 'classification'
              ? 'POSITIONS UNAVAILABLE'
              : 'ESTIMATED · ' + (profile === 'sector' ? 'SECTOR' : 'LAP')}
        </span>
      </div>
      <div className="map-stage">
        <div className="map-controls">
          <button className="icon-button" aria-label="Zoom in" onClick={() => zoom(0.4)}>
            <Icon name="plus" />
          </button>
          <button className="icon-button" aria-label="Zoom out" onClick={() => zoom(-0.4)}>
            <Icon name="minus" />
          </button>
          <button
            className="icon-button"
            aria-label="Reset map to fit"
            onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
          >
            <Icon name="fit" />
          </button>
        </div>
        <svg
          ref={svg}
          viewBox="0 0 680 520"
          className="circuit-svg"
          aria-label="Mount Panorama circuit outline with interactive car markers"
          onPointerDown={(e) => {
            const p = coordinates(e);
            drag.current.pointers.set(e.pointerId, { x: p.x, y: p.y });
            if (drag.current.pointers.size === 1) {
              drag.current.x = p.x;
              drag.current.y = p.y;
              drag.current.ox = view.x;
              drag.current.oy = view.y;
              drag.current.moved = false;
            } else if (drag.current.pointers.size === 2) {
              const [a, b] = [...drag.current.pointers.values()];
              drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
            }
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current.pointers.has(e.pointerId)) return;
            const p = coordinates(e);
            drag.current.pointers.set(e.pointerId, { x: p.x, y: p.y });
            if (drag.current.pointers.size === 2) {
              const [a, b] = [...drag.current.pointers.values()];
              const distance = Math.hypot(a.x - b.x, a.y - b.y);
              if (drag.current.pinch)
                setView((v) => ({
                  ...v,
                  zoom: Math.max(1, Math.min(3, (v.zoom * distance) / drag.current.pinch!)),
                }));
              drag.current.pinch = distance;
              drag.current.moved = true;
            } else {
              const dx = (p.x - drag.current.x) * p.sx,
                dy = (p.y - drag.current.y) * p.sy;
              if (Math.abs(dx) + Math.abs(dy) > 6) {
                drag.current.moved = true;
                setView({ ...viewRef.current, x: drag.current.ox + dx, y: drag.current.oy + dy });
              }
            }
          }}
          onPointerUp={(e) => {
            drag.current.pointers.delete(e.pointerId);
            drag.current.pinch = null;
            const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-entry]');
            if (!drag.current.moved && hit) select(hit.getAttribute('data-entry'));
          }}
          onPointerCancel={() => {
            drag.current.pointers.clear();
            drag.current.pinch = null;
          }}
        >
          <defs>
            <pattern id="map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".7" className="grid-dot" />
            </pattern>
          </defs>
          <rect width="680" height="520" fill="url(#map-grid)" />
          <g
            transform={
              'translate(' +
              (340 * (1 - view.zoom) + view.x) +
              ' ' +
              (260 * (1 - view.zoom) + view.y) +
              ') scale(' +
              view.zoom +
              ')'
            }
          >
            <path d={trackPath} className="track-shadow" />
            <path d={trackPath} className="track-border" />
            <path d={trackPath} className="track-core" />
            <path d={pitPath} className="pit-path" />
            {trackLabels.map((l) => (
              <text key={l.name} x={l.x} y={l.y} textAnchor={l.anchor} className="track-label">
                {l.name}
              </text>
            ))}
            {sectorAnchors.slice(0, 2).map((a) => (
              <g key={a.id}>
                <circle cx={a.point[0]} cy={a.point[1]} r="6" className="sector-anchor" />
                <text
                  x={a.labelPoint[0]}
                  y={a.labelPoint[1]}
                  textAnchor="middle"
                  className="sector-label"
                >
                  {a.label}
                </text>
              </g>
            ))}
            <path
              d={'M' + startFinish.line[0].join(',') + ' L' + startFinish.line[1].join(',')}
              className="finish-line"
            />
            <text
              x={startFinish.label[0]}
              y={startFinish.label[1]}
              className="sector-label"
              textAnchor="end"
            >
              START / FINISH
            </text>
            <g className="north-indicator" transform="translate(595 70)">
              <g transform={'rotate(' + northArrow.rotation + ')'}>
                <path d="M-12,0 L12,0 M5,-5 L12,0 L5,5" className="direction-arrow" />
              </g>
              <text y="28" textAnchor="middle" className="sector-label">
                N
              </text>
            </g>
            <text x="340" y="315" textAnchor="middle" className="map-watermark">
              PANORAMA
            </text>
            <text x="340" y="341" textAnchor="middle" className="map-distance">
              THE MOUNTAIN · 6.213 KM
            </text>
            {[...(snapshot?.entries ?? [])]
              .sort((a, b) => (a.id === selected ? 1 : 0) - (b.id === selected ? 1 : 0))
              .map((e) => (
                <g
                  ref={(node) => {
                    if (node) nodes.current.set(e.id, node);
                    else nodes.current.delete(e.id);
                  }}
                  key={e.id}
                  role="button"
                  tabIndex={profile === 'classification' ? -1 : 0}
                  aria-label={'Select car ' + e.number + ' on map'}
                  data-entry={e.id}
                  className={
                    'car-marker ' +
                    (e.id === selected ? 'marker-selected ' : '') +
                    (favourites.includes(e.id) ? 'marker-favourite' : '')
                  }
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      select(e.id);
                    }
                  }}
                  style={{ '--team': e.team.colour } as React.CSSProperties}
                >
                  <title>Car {e.number}</title>
                  <circle className="marker-ring" r="18" />
                  <circle className="marker-body" r="13" />
                  <line className="marker-leader" x1="0" y1="0" x2="0" y2="0" />
                  <g className="marker-label" data-offset="false">
                    <circle className="marker-label-backdrop" r="11" />
                    <text textAnchor="middle" dy="4.5">
                      {e.number}
                    </text>
                  </g>
                </g>
              ))}
          </g>
        </svg>
        {profile === 'classification' && (
          <div className="map-message">
            <Icon name="map" />
            <strong>Classification only</strong>
            <span>
              This feed has no position anchors.
              <br />
              Follow every car in the timing tower.
            </span>
          </div>
        )}
      </div>
      {unavailable.length > 0 && profile !== 'classification' && (
        <div className="offtrack">
          <span>Location unavailable</span>
          {unavailable.map((e) => (
            <button key={e.id} onClick={() => select(e.id)} className="offtrack-car">
              #{e.number} · {e.status === 'running' ? 'no estimate' : e.status}
            </button>
          ))}
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-dot green" /> Simulated
        </span>
        <span>
          <i className="legend-dot white" /> Reported
        </span>
        <span>
          <i className="legend-dot amber" /> Estimated
        </span>
        <span>
          <i className="legend-dot grey" /> Unknown / stale
        </span>
      </div>
      <p className="map-note">
        {snapshot?.source === 'live'
          ? 'Live positions are coarse timing-feed segments, not GPS — markers sit at segment midpoints and fade as reports age. '
          : null}
        {trackGeometryNotice}. Close car labels are offset for readability.{' '}
        <a href={trackAttribution.url} target="_blank" rel="noreferrer">
          Map attribution
        </a>
      </p>
    </section>
  );
});
