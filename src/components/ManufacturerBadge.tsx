/**
 * Manufacturer badge.
 *
 * Shows the car maker (Toyota, Ford, Chevrolet…) as a small text pill parsed
 * from the vehicle name. Deliberately text, not the car makers' trademarked
 * logo artwork. Returns null for independent/fictional team names so demo
 * entries render exactly as before.
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
export function manufacturerOf(vehicle: string): Manufacturer | null {
  const found = MAKES.find((m) => m.match.test(vehicle));
  if (!found) return null;
  const model = vehicle.replace(found.match, '').replace(/[_-]+/g, ' ').trim();
  return { brand: found.brand, short: found.short, model };
}
export function ManufacturerBadge({ vehicle }: { vehicle: string }) {
  const mfr = manufacturerOf(vehicle);
  if (!mfr) return null;
  return (
    <span className="mfr-badge" title={mfr.brand}>
      {mfr.short}
    </span>
  );
}
