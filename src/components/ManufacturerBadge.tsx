import { useState } from 'react';

/**
 * Manufacturer badge.
 *
 * Shows the car maker's real emblem (Toyota wordmark, Ford blue oval,
 * Chevrolet bowtie) bundled locally under public/manufacturers/, sourced
 * from Wikimedia Commons file descriptions (Toyota logo.svg, Ford Motor
 * Company Logo.svg, Chevrolet bowtie 2023.svg). Marks belong to their makers
 * and are used purely to identify which brand each entry races for. Makers
 * without a bundled emblem fall back to a text pill; independent/fictional
 * team names render nothing so demo entries look exactly as before.
 */
export interface Manufacturer {
  brand: string;
  short: string;
  model: string;
}
const MAKES: { match: RegExp; brand: string; short: string }[] = [
  { match: /toyota/i, brand: 'Toyota', short: 'TOYOTA' },
  { match: /ford/i, brand: 'Ford', short: 'FORD' },
  { match: /chev/i, brand: 'Chevrolet', short: 'CHEVROLET' },
  { match: /holden/i, brand: 'Holden', short: 'HOLDEN' },
  { match: /nissan/i, brand: 'Nissan', short: 'NISSAN' },
  { match: /mazda/i, brand: 'Mazda', short: 'MAZDA' },
  { match: /honda/i, brand: 'Honda', short: 'HONDA' },
  { match: /hyundai/i, brand: 'Hyundai', short: 'HYUNDAI' },
  { match: /kia/i, brand: 'Kia', short: 'KIA' },
  { match: /bmw/i, brand: 'BMW', short: 'BMW' },
  { match: /audi/i, brand: 'Audi', short: 'AUDI' },
  { match: /mercedes|amg/i, brand: 'Mercedes', short: 'MERCEDES' },
  { match: /porsche/i, brand: 'Porsche', short: 'PORSCHE' },
  { match: /volvo/i, brand: 'Volvo', short: 'VOLVO' },
];
const EMBLEMS: Partial<Record<string, string>> = {
  Toyota: 'toyota.svg',
  Ford: 'ford.svg',
  Chevrolet: 'chevrolet.svg',
};
export function manufacturerOf(vehicle: string): Manufacturer | null {
  const found = MAKES.find((m) => m.match.test(vehicle));
  if (!found) return null;
  const model = vehicle.replace(found.match, '').replace(/[_-]+/g, ' ').trim();
  return { brand: found.brand, short: found.short, model };
}
export function ManufacturerBadge({ vehicle }: { vehicle: string }) {
  const mfr = manufacturerOf(vehicle);
  const [failed, setFailed] = useState(false);
  if (!mfr) return null;
  const emblem = EMBLEMS[mfr.brand];
  if (!emblem || failed) {
    return (
      <span className="mfr-badge" title={mfr.brand}>
        {mfr.short}
      </span>
    );
  }
  return (
    <span className="mfr-mark" title={mfr.brand}>
      <img
        src={'/manufacturers/' + emblem}
        alt={mfr.brand + ' logo'}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
