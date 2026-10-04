import { writeFileSync } from 'node:fs';
import { RaceEngine } from '../src/providers/mock/engine';
import type { Profile } from '../src/domain/schema';
const profile = (process.argv[2] ?? 'sector') as Profile;
if (!['position', 'sector', 'lap', 'classification'].includes(profile))
  throw new Error('Use position, sector, lap or classification');
const duration = Math.max(1000, Math.min(120000, Number(process.argv[3] ?? 60000)));
const cadence = Math.max(500, Number(process.argv[5] ?? 10000));
const engine = new RaceEngine();
const records = [];
for (let t = 0; t <= duration; t += cadence) {
  if (t) engine.advance(cadence);
  records.push({
    offset: t,
    snapshot: engine.snapshot(profile, 'fixture-stream', t / cadence + 1),
  });
}
const path = process.argv[4] ?? 'public/demo-replay.json';
writeFileSync(
  path,
  JSON.stringify({
    format: 'panorama-replay',
    version: 1,
    name: 'Mountain sector timing · fictional demo',
    records,
  }),
);
console.log('Generated ' + records.length + ' validated transport snapshots: ' + path);
