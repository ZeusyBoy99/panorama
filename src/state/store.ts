import { create } from 'zustand';
import { readPreferences, savePreferences, type Preferences } from '../persistence/storage';
import type { Snapshot } from '../domain/schema';
import type { ProviderStatus } from '../providers/contract';
interface RaceState {
  snapshot: Snapshot | null;
  receivedMono: number;
  status: ProviderStatus;
  cached: boolean;
  validationError: string | null;
  rejected: number;
  accepted: number;
}
export const useRace = create<RaceState>(() => ({
  snapshot: null,
  receivedMono: 0,
  status: { connection: 'connecting', message: 'Starting', paused: false, speed: 1 },
  cached: false,
  validationError: null,
  rejected: 0,
  accepted: 0,
}));
interface UIState {
  preferences: Preferences;
  selectedId: string | null;
  search: string;
  onlyFavourites: boolean;
  controlsOpen: boolean;
  detailsOpen: boolean;
  storageError: boolean;
  select: (id: string | null) => void;
  setPreferences: (patch: Partial<Preferences>) => void;
  toggleFavourite: (id: string) => void;
}
export const useUI = create<UIState>((set, get) => ({
  preferences: readPreferences(),
  selectedId: new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
    'car',
  ),
  search: '',
  onlyFavourites: false,
  controlsOpen: false,
  detailsOpen: false,
  storageError: false,
  select: (selectedId) => {
    set({ selectedId });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (selectedId) url.searchParams.set('car', selectedId);
      else url.searchParams.delete('car');
      window.history.replaceState(window.history.state, '', url);
    }
  },
  setPreferences: (patch) => {
    const preferences = { ...get().preferences, ...patch };
    const success = savePreferences(preferences);
    set({ preferences, storageError: !success });
  },
  toggleFavourite: (id) => {
    const old = get().preferences.favourites;
    get().setPreferences({
      favourites: old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    });
  },
}));
