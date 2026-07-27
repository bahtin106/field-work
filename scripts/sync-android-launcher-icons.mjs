/* global console */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  compositeImagesAsync,
  generateImageAsync,
  generateImageBackgroundAsync,
} from '@expo/image-utils';
import Jimp from 'jimp-compact';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const canonicalArtwork = path.join(root, 'assets/adaptive-icon.png');
const checkOnly = process.argv.includes('--check');
const failures = [];
const densities = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

if (!fs.existsSync(canonicalArtwork)) {
  throw new Error(`Missing canonical app artwork: ${canonicalArtwork}`);
}

const canonicalBuffer = fs.readFileSync(canonicalArtwork);

async function resizeArtwork(width, height = width) {
  const { source } = await generateImageAsync(
    { projectRoot: root },
    {
      src: canonicalArtwork,
      width,
      height,
      resizeMode: 'contain',
    },
  );
  return source;
}

async function createOpaqueAppIcon() {
  const background = await generateImageBackgroundAsync({
    width: 1024,
    height: 1024,
    backgroundColor: '#F2F2F7',
    resizeMode: 'cover',
  });
  return compositeImagesAsync({
    background,
    foreground: await resizeArtwork(1024),
  });
}

async function createMonochromeArtwork() {
  const image = await Jimp.read(canonicalBuffer);

  image.scanQuiet(0, 0, image.bitmap.width, image.bitmap.height, (_x, _y, index) => {
    const red = image.bitmap.data[index];
    const green = image.bitmap.data[index + 1];
    const blue = image.bitmap.data[index + 2];
    const alpha = image.bitmap.data[index + 3];
    const isBlueBrandPixel = alpha > 0 && blue - red >= 12 && blue - green >= 12;

    image.bitmap.data[index] = 255;
    image.bitmap.data[index + 1] = 255;
    image.bitmap.data[index + 2] = 255;
    image.bitmap.data[index + 3] = isBlueBrandPixel ? alpha : 0;
  });

  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function resizeBuffer(buffer, width, height = width) {
  const image = await Jimp.read(buffer);
  return image.resize(width, height).getBufferAsync(Jimp.MIME_PNG);
}

async function createNativeSplash(scale) {
  const canvasSize = 288 * scale;
  const artworkSize = 180 * scale;
  const background = await generateImageBackgroundAsync({
    width: canvasSize,
    height: canvasSize,
    backgroundColor: 'transparent',
    resizeMode: 'cover',
  });
  const foreground = await resizeArtwork(artworkSize);

  return compositeImagesAsync({
    background,
    foreground,
    x: (canvasSize - artworkSize) / 2,
    y: (canvasSize - artworkSize) / 2,
  });
}

async function writeExpected(relativePath, expected) {
  const target = path.join(root, relativePath);
  const actual = fs.existsSync(target) ? fs.readFileSync(target) : null;

  if (actual?.equals(expected)) return;

  if (checkOnly) {
    failures.push(relativePath);
    return;
  }

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, expected);
}

const monochromeBuffer = await createMonochromeArtwork();

for (const alias of [
  'assets/branding/adaptive-foreground.png',
  'assets/branding/adaptive-foreground-safe.png',
  'assets/splash/splashscreen_logo.png',
  'assets/splash.png',
  'assets/splash-icon.png',
]) {
  await writeExpected(alias, canonicalBuffer);
}

await writeExpected('assets/icon.png', await createOpaqueAppIcon());
await writeExpected('assets/favicon.png', await resizeArtwork(48));
await writeExpected('assets/branding/app-mark-monochrome.png', monochromeBuffer);
await writeExpected(
  'assets/notifications/notification-icon.png',
  await resizeBuffer(monochromeBuffer, 96),
);

for (const { name, scale } of densities) {
  const adaptiveSize = 108 * scale;
  const legacySize = 48 * scale;
  const notificationSize = 24 * scale;
  const adaptiveForeground = await resizeArtwork(adaptiveSize);
  const legacyIcon = await resizeArtwork(legacySize);
  const adaptiveMonochrome = await resizeBuffer(monochromeBuffer, adaptiveSize);
  const notificationIcon = await resizeBuffer(monochromeBuffer, notificationSize);

  await writeExpected(
    `android/app/src/main/res/mipmap-${name}/ic_launcher_foreground.png`,
    adaptiveForeground,
  );
  await writeExpected(`android/app/src/main/res/mipmap-${name}/ic_launcher.png`, legacyIcon);
  await writeExpected(`android/app/src/main/res/mipmap-${name}/ic_launcher_round.png`, legacyIcon);
  await writeExpected(
    `android/app/src/main/res/mipmap-${name}/ic_launcher_monochrome.png`,
    adaptiveMonochrome,
  );
  await writeExpected(
    `android/app/src/main/res/drawable-${name}/notification_icon.png`,
    notificationIcon,
  );
  await writeExpected(
    `android/app/src/main/res/drawable-${name}/splashscreen_logo.png`,
    await createNativeSplash(scale),
  );
}

if (failures.length) {
  throw new Error(
    `App icon assets are out of sync with assets/adaptive-icon.png:\n${failures
      .map((file) => `- ${file}`)
      .join('\n')}\nRun npm run icons:sync.`,
  );
}

console.log(
  checkOnly
    ? 'App icon assets match the canonical artwork.'
    : 'App icon assets were synchronized from assets/adaptive-icon.png.',
);
