import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
const icon = await readFile('public/icon.svg');
await Promise.all([
  sharp(icon).resize(192).png().toFile('public/icon-192.png'),
  sharp(icon).resize(512).png().toFile('public/icon-512.png'),
  sharp(icon).resize(180).png().toFile('public/apple-touch-icon.png'),
  sharp({ create: { width: 512, height: 512, channels: 4, background: '#176cd3' } })
    .composite([{ input: await sharp(icon).resize(320).png().toBuffer(), left: 96, top: 96 }])
    .png()
    .toFile('public/icon-maskable.png'),
]);
