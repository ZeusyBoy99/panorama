import { create } from 'zustand';
import type { Profile } from '../domain/schema';
import { MockProvider } from '../providers/mock/provider';
import type { Scenario } from '../providers/mock/engine';
import { ReplayProvider, parseRecording, type Recording } from '../providers/replay/provider';
import { NatsoftLiveProvider } from '../providers/live/provider';
import { controller } from './controller';
export type RuntimeProvider = MockProvider | ReplayProvider | NatsoftLiveProvider;
interface Runtime {
  provider: RuntimeProvider | null;
  scenario: Scenario;
  profile: Profile;
  seed: number;
  replay: Recording | null;
  liveUrl: string | null;
  startDemo: (patch?: Partial<Pick<Runtime, 'scenario' | 'profile' | 'seed'>>) => void;
  loadReplay: (recording: Recording) => void;
  loadFixture: () => Promise<void>;
  startLive: (url: string) => void;
  stopLive: () => void;
}
export const useRuntime = create<Runtime>((set, get) => ({
  provider: null,
  scenario: 'Normal racing',
  profile: 'position',
  seed: 10002026,
  replay: null,
  liveUrl: null,
  startDemo: (patch = {}) => {
    const next = { ...get(), ...patch };
    const provider = new MockProvider(next.seed, next.scenario, next.profile);
    set({
      provider,
      scenario: next.scenario,
      profile: next.profile,
      seed: next.seed,
      replay: null,
      liveUrl: null,
    });
    controller.switchTo(provider);
  },
  loadReplay: (replay) => {
    const provider = new ReplayProvider(replay);
    set({ provider, replay, profile: replay.records[0].snapshot.profile, liveUrl: null });
    controller.switchTo(provider);
  },
  loadFixture: async () => {
    const response = await fetch('/demo-replay.json');
    if (!response.ok) throw new Error('Bundled replay could not be loaded');
    get().loadReplay(parseRecording(await response.text()));
  },
  startLive: (url) => {
    const provider = new NatsoftLiveProvider(url);
    set({ provider, replay: null, liveUrl: url });
    controller.switchTo(provider);
  },
  stopLive: () => {
    controller.stop();
    set({ provider: null, liveUrl: null });
  },
}));

/**
 * Live is the default boot source: the app connects to the timing feed
 * unless the visitor explicitly asked for the demo (`?demo`) or the browser
 * is offline (live needs a connection; the demo works offline).
 */
export function shouldBootLive(search: string, online: boolean): boolean {
  if (new URLSearchParams(search).get('demo') !== null) return false;
  return online;
}
