import { create } from 'zustand';
import type { Profile } from '../domain/schema';
import { MockProvider } from '../providers/mock/provider';
import type { Scenario } from '../providers/mock/engine';
import { ReplayProvider, parseRecording, type Recording } from '../providers/replay/provider';
import { controller } from './controller';
interface Runtime {
  provider: MockProvider | ReplayProvider | null;
  scenario: Scenario;
  profile: Profile;
  seed: number;
  replay: Recording | null;
  startDemo: (patch?: Partial<Pick<Runtime, 'scenario' | 'profile' | 'seed'>>) => void;
  loadReplay: (recording: Recording) => void;
  loadFixture: () => Promise<void>;
}
export const useRuntime = create<Runtime>((set, get) => ({
  provider: null,
  scenario: 'Normal racing',
  profile: 'position',
  seed: 10002026,
  replay: null,
  startDemo: (patch = {}) => {
    const next = { ...get(), ...patch };
    const provider = new MockProvider(next.seed, next.scenario, next.profile);
    set({
      provider,
      scenario: next.scenario,
      profile: next.profile,
      seed: next.seed,
      replay: null,
    });
    controller.switchTo(provider);
  },
  loadReplay: (replay) => {
    const provider = new ReplayProvider(replay);
    set({ provider, replay, profile: replay.records[0].snapshot.profile });
    controller.switchTo(provider);
  },
  loadFixture: async () => {
    const response = await fetch('/demo-replay.json');
    if (!response.ok) throw new Error('Bundled replay could not be loaded');
    get().loadReplay(parseRecording(await response.text()));
  },
}));
