import { z } from 'zod';
import { snapshotSchema, type Snapshot } from '../domain/schema';
export const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  uiStyle: z.enum(['fan', 'hacker']).default('fan'),
  density: z.enum(['compact', 'comfortable']),
  motion: z.enum(['system', 'reduced', 'full']),
  favourites: z.array(z.string().max(120)).max(100),
  gapMode: z.enum(['gap', 'interval']),
  awake: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults: Preferences = {
  theme: 'light',
  uiStyle: 'fan',
  density: 'comfortable',
  motion: 'system',
  favourites: [],
  gapMode: 'gap',
  awake: false,
};
export function readPreferences(): Preferences {
  try {
    return preferencesSchema.parse(
      JSON.parse(localStorage.getItem('panorama.preferences.v1') ?? 'null'),
    );
  } catch {
    return { ...defaults, favourites: [] };
  }
}
export function savePreferences(value: Preferences) {
  try {
    localStorage.setItem('panorama.preferences.v1', JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function saveSnapshot(snapshot: Snapshot) {
  try {
    localStorage.setItem(
      'panorama.snapshot.v1',
      JSON.stringify({ provider: snapshot.source, schemaVersion: 1, snapshot }),
    );
    return true;
  } catch {
    return false;
  }
}
export function readSnapshot(): Snapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem('panorama.snapshot.v1') ?? 'null');
    if (value?.schemaVersion !== 1 || value.provider !== value.snapshot?.source) return null;
    return snapshotSchema.parse(value.snapshot);
  } catch {
    return null;
  }
}
