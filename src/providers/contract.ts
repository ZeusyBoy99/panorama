import type { Capabilities, Snapshot } from '../domain/schema';
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'error';
export type ProviderStatus = {
  connection: Connection;
  message: string;
  paused: boolean;
  speed: number;
};
export interface TimingProvider {
  readonly id: string;
  readonly capabilities: Capabilities;
  connect(): void;
  disconnect(): void;
  subscribeSnapshots(callback: (snapshot: unknown) => void): () => void;
  subscribeStatus(callback: (status: ProviderStatus) => void): () => void;
  getFullSnapshot(): Snapshot;
}
export interface PlaybackControls {
  setPaused(value: boolean): void;
  setSpeed(value: number): void;
  reset(): void;
}
