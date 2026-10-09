import { z } from 'zod';
const ms = z.number().finite().nonnegative();
const id = z.string().min(1).max(120);
const text = z.string().max(300);
export const profileSchema = z.enum(['position', 'sector', 'lap', 'classification']);
export type Profile = z.infer<typeof profileSchema>;
export const gapSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('leader') }),
  z.object({ kind: z.literal('seconds'), value: ms }),
  z.object({ kind: z.literal('laps'), value: z.number().int().positive() }),
  z.object({ kind: z.literal('unknown') }),
]);
export type Gap = z.infer<typeof gapSchema>;
export const capabilitiesSchema = z.object({
  classification: z.boolean(),
  gapData: z.boolean(),
  lapTiming: z.boolean(),
  lapCrossings: z.boolean(),
  sectorCrossings: z.boolean(),
  pitStatus: z.boolean(),
  currentDriver: z.boolean(),
  positionSamples: z.boolean(),
  raceControl: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export const crossingSchema = z.object({
  kind: z.enum(['lap', 'sector']),
  sector: z.number().int().min(0).max(2),
  lap: z.number().int().nonnegative(),
  at: ms,
  progress: z.number().min(0).max(1),
  duration: ms.nullable(),
});
export type Crossing = z.infer<typeof crossingSchema>;
const observation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('position'),
    progress: z.number().min(0).max(1),
    pitProgress: z.number().min(0).max(1).nullable(),
    at: ms,
    provenance: z.enum(['simulated', 'reported']),
  }),
  z.object({ kind: z.literal('crossing'), anchor: crossingSchema }),
  z.object({ kind: z.literal('unavailable') }),
]);
export const eventSchema = z.object({
  id,
  at: ms,
  entryIds: z.array(id).max(24),
  category: z.enum([
    'lead',
    'position',
    'fastest',
    'pit',
    'driver',
    'status',
    'penalty',
    'retirement',
    'finish',
  ]),
  message: text,
  origin: z.enum(['supplied', 'derived']),
});
export type RaceEvent = z.infer<typeof eventSchema>;
export const entrySchema = z.object({
  id,
  number: z.string().min(1).max(8),
  team: z.object({ id, name: text, colour: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  drivers: z.tuple([z.object({ id, name: text }), z.object({ id, name: text })]),
  currentDriverId: id.nullable(),
  position: z.number().int().min(1).max(100).nullable(),
  grid: z.number().int().min(1).max(100).nullable(),
  laps: z.number().int().min(0).max(1000),
  status: z.enum(['running', 'pit', 'stopped', 'retired', 'finished', 'unknown']),
  gap: gapSchema,
  interval: gapSchema,
  lastLap: ms.nullable(),
  bestLap: ms.nullable(),
  currentSector: z.number().int().min(0).max(2).nullable(),
  previousSectors: z.tuple([ms.nullable(), ms.nullable(), ms.nullable()]),
  currentSectors: z.tuple([ms.nullable(), ms.nullable(), ms.nullable()]),
  lastCrossing: crossingSchema.nullable(),
  lastLapCrossing: crossingSchema.nullable(),
  observation,
  pits: z.number().int().nonnegative().nullable(),
  observedAt: ms,
  lapHistory: z
    .array(z.object({ lap: z.number().int().nonnegative(), time: ms, at: ms, valid: z.boolean() }))
    .max(16),
  stints: z
    .array(z.object({ driverId: id, fromLap: z.number().int().nonnegative(), at: ms }))
    .max(12),
  pitObservation: z
    .object({
      kind: z.enum(['entry', 'exit', 'service']),
      at: ms,
      provenance: z.enum(['supplied', 'simulated']),
    })
    .nullable(),
  penalty: z
    .object({ message: text, at: ms, provenance: z.enum(['supplied', 'derived']) })
    .nullable(),
});
export type Entry = z.infer<typeof entrySchema>;
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: id,
    streamId: id,
    sequence: z.number().int().nonnegative(),
    sourceTimestamp: ms,
    receiptTimestamp: ms.nullable(),
    source: z.enum(['demo', 'replay', 'live']),
    profile: profileSchema,
    session: z.object({
      eventId: id,
      id,
      name: text,
      /** Meeting or championship context, e.g. "2026 Repco Bathurst 1000". Live only. */
      meeting: text.nullable().optional(),
      /** Series or category label, e.g. "TOYOTA GAZOO Racing Australia GR CUP". Live only. */
      series: text.nullable().optional(),
      season: z.number().int(),
      trackId: id,
      type: z.enum(['race', 'practice', 'qualifying']),
      raceLaps: z.number().int().positive(),
      /** True when the session runs to time (or laps are unbounded, e.g. practice): raceLaps is then only a fallback, not a scheduled distance. Live only. */
      timed: z.boolean().optional(),
      trackKm: z.number().positive().nullable(),
      phase: z.enum(['pre-race', 'running', 'suspended', 'finished', 'unknown']),
      trackStatus: z.enum(['green', 'yellow', 'safety-car', 'red', 'chequered', 'unknown']),
      leaderLaps: z.number().int().nonnegative(),
      elapsed: ms,
      remaining: ms.nullable(),
      timezone: z.string().max(80),
      capabilities: capabilitiesSchema,
    }),
    entries: z.array(entrySchema).min(1).max(100),
    events: z.array(eventSchema).max(100),
  })
  .superRefine((s, ctx) => {
    if (s.sessionId !== s.session.id)
      ctx.addIssue({ code: 'custom', message: 'Session identity mismatch' });
    if (new Set(s.entries.map((e) => e.id)).size !== s.entries.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate entry identity' });
    for (const e of s.entries) {
      if (e.currentDriverId !== null && !e.drivers.some((d) => d.id === e.currentDriverId))
        ctx.addIssue({ code: 'custom', message: 'Unknown current driver' });
      if (!s.session.capabilities.positionSamples && e.observation.kind === 'position')
        ctx.addIssue({ code: 'custom', message: 'Position supplied without capability' });
      const caps = s.session.capabilities;
      if (
        e.observation.kind === 'crossing' &&
        (e.observation.anchor.kind === 'lap' ? !caps.lapCrossings : !caps.sectorCrossings)
      )
        ctx.addIssue({ code: 'custom', message: 'Crossing supplied without capability' });
      if (!caps.lapCrossings && e.lastLapCrossing !== null)
        ctx.addIssue({ code: 'custom', message: 'Lap anchor supplied without capability' });
      if (
        e.lastCrossing &&
        (e.lastCrossing.kind === 'lap' ? !caps.lapCrossings : !caps.sectorCrossings)
      )
        ctx.addIssue({ code: 'custom', message: 'Unsupported last crossing' });
      if (!caps.lapTiming && (e.lastLap !== null || e.bestLap !== null || e.lapHistory.length))
        ctx.addIssue({ code: 'custom', message: 'Lap timing supplied without capability' });
      if (s.profile === 'classification' && e.observation.kind !== 'unavailable')
        ctx.addIssue({ code: 'custom', message: 'Classification profile cannot supply positions' });
      if (
        s.profile === 'lap' &&
        e.observation.kind === 'crossing' &&
        e.observation.anchor.kind !== 'lap'
      )
        ctx.addIssue({ code: 'custom', message: 'Lap profile requires start-line anchors' });
    }
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
export function capabilities(profile: Profile): Capabilities {
  return {
    classification: true,
    gapData: true,
    lapTiming: profile !== 'classification',
    lapCrossings: profile !== 'classification',
    sectorCrossings: profile === 'sector' || profile === 'position',
    pitStatus: true,
    currentDriver: true,
    positionSamples: profile === 'position',
    raceControl: true,
  };
}
export const APP_NAME = 'Panorama';
export const APP_VERSION = '1.0.0';
