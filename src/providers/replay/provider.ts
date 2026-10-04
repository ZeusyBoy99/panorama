import { z } from 'zod';
import { snapshotSchema, type Snapshot } from '../../domain/schema';
import type { PlaybackControls, ProviderStatus, TimingProvider } from '../contract';
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
export const recordingSchema = z
  .object({
    format: z.literal('panorama-replay'),
    version: z.literal(1),
    name: z.string().max(120),
    records: z
      .array(z.object({ offset: z.number().finite().nonnegative(), snapshot: snapshotSchema }))
      .min(1)
      .max(180),
  })
  .superRefine((r, ctx) => {
    if (r.records[0].offset !== 0)
      ctx.addIssue({ code: 'custom', message: 'Recording must start at offset zero' });
    for (let i = 1; i < r.records.length; i++) {
      const prev = r.records[i - 1],
        next = r.records[i];
      if (next.offset <= prev.offset)
        ctx.addIssue({ code: 'custom', message: 'Recording times must increase' });
      if (
        next.snapshot.sessionId !== r.records[0].snapshot.sessionId ||
        next.snapshot.profile !== r.records[0].snapshot.profile
      )
        ctx.addIssue({
          code: 'custom',
          message: 'A recording must use one session and capability profile',
        });
      if (
        Math.abs(
          next.snapshot.session.elapsed - r.records[0].snapshot.session.elapsed - next.offset,
        ) > 1
      )
        ctx.addIssue({ code: 'custom', message: 'Replay offset disagrees with race clock' });
      if (next.snapshot.session.elapsed < prev.snapshot.session.elapsed)
        ctx.addIssue({ code: 'custom', message: 'Recorded race time moved backwards' });
    }
  });
export type Recording = z.infer<typeof recordingSchema>;
export function parseRecording(text: string): Recording {
  if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_BYTES)
    throw new Error('Replay is too large. Maximum size is 8 MB.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const parsed = recordingSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid replay: ' + parsed.error.issues[0].message);
  return parsed.data;
}
let epoch = 0;
export class ReplayProvider implements TimingProvider, PlaybackControls {
  readonly id = 'replay';
  private position = 0;
  private sequence = 0;
  private stream = 'replay-' + ++epoch;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private publishAt = 0;
  private snapshots = new Set<(s: unknown) => void>();
  private statuses = new Set<(s: ProviderStatus) => void>();
  private status: ProviderStatus = {
    connection: 'connecting',
    message: 'Replay ready',
    paused: false,
    speed: 1,
  };
  constructor(readonly recording: Recording) {}
  get capabilities() {
    return this.recording.records[0].snapshot.session.capabilities;
  }
  get duration() {
    return this.recording.records.at(-1)!.offset;
  }
  get offset() {
    return this.position;
  }
  subscribeSnapshots(cb: (s: unknown) => void) {
    this.snapshots.add(cb);
    return () => {
      this.snapshots.delete(cb);
    };
  }
  subscribeStatus(cb: (s: ProviderStatus) => void) {
    this.statuses.add(cb);
    cb({ ...this.status });
    return () => {
      this.statuses.delete(cb);
    };
  }
  private announce() {
    this.statuses.forEach((cb) => cb({ ...this.status }));
  }
  getFullSnapshot(): Snapshot {
    const record =
      [...this.recording.records].reverse().find((r) => r.offset <= this.position) ??
      this.recording.records[0];
    const s = structuredClone(record.snapshot);
    s.session.elapsed = this.recording.records[0].snapshot.session.elapsed + this.position;
    return {
      ...s,
      source: 'replay',
      streamId: this.stream,
      sequence: ++this.sequence,
      receiptTimestamp: null,
    };
  }
  private emit() {
    const s = this.getFullSnapshot();
    this.snapshots.forEach((cb) => cb(s));
  }
  connect() {
    if (this.timer) return;
    this.status.connection = 'connected';
    this.last = performance.now();
    this.announce();
    this.emit();
    this.timer = setInterval(() => {
      const now = performance.now();
      if (!this.status.paused) {
        this.position = Math.min(
          this.duration,
          this.position + (now - this.last) * this.status.speed,
        );
        if (this.position === this.duration) {
          this.status.paused = true;
          this.status.message = 'Replay complete';
          this.announce();
        }
      }
      this.last = now;
      if (now - this.publishAt >= 500) {
        this.publishAt = now;
        this.emit();
      }
    }, 50);
  }
  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.connection = 'stopped';
    this.announce();
  }
  setPaused(value: boolean) {
    this.status.paused = value;
    this.last = performance.now();
    this.status.message = value ? 'Replay paused' : 'Replay playing';
    this.announce();
  }
  setSpeed(value: number) {
    this.status.speed = [1, 5, 20].includes(value) ? value : 1;
    this.announce();
  }
  seek(offset: number) {
    this.position = Math.max(0, Math.min(this.duration, offset));
    this.stream = 'replay-' + ++epoch;
    this.sequence = 0;
    this.last = performance.now();
    this.emit();
  }
  reset() {
    this.seek(0);
    this.setPaused(false);
  }
}
