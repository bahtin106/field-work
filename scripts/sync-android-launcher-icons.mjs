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
const canonicalArtwork = path.join(root, 'assets/icon.png');
const checkOnly = process.argv.includes('--check');
const sourceArgumentIndex = process.argv.indexOf('--source');
const failures = [];
// Android renders only the centered 72dp viewport of a 108dp adaptive layer.
// Keeping the complete canonical 72dp artwork in that viewport preserves its
// original proportions while the background fills launcher-specific masks.
const adaptiveArtworkRatio = 2 / 3;
const adaptiveBackgroundColor = '#68C2EE';
// Android small notification icons are single-color alpha masks inside a
// 24dp canvas. Keep the circular brand mark at 21dp so it is prominent while
// retaining the system-recommended optical padding on every OEM skin.
const notificationArtworkRatio = 21 / 24;
const densities = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

if (sourceArgumentIndex >= 0) {
  if (checkOnly) {
    throw new Error('--source cannot be combined with --check.');
  }
  const sourcePath = String(process.argv[sourceArgumentIndex + 1] || '').trim();
  if (!sourcePath) {
    throw new Error('Missing image path after --source.');
  }
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error(`Missing source app artwork: ${resolvedSourcePath}`);
  }
  const normalizedArtwork = await Jimp.read(resolvedSourcePath);
  await fs.promises.writeFile(
    canonicalArtwork,
    await normalizedArtwork.resize(1024, 1024).getBufferAsync(Jimp.MIME_PNG),
  );
}

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

async function createOpaqueIosIcon() {
  const background = await generateImageBackgroundAsync({
    width: 1024,
    height: 1024,
    backgroundColor: adaptiveBackgroundColor,
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

async function createNotificationMark() {
  const image = await Jimp.read(canonicalBuffer);
  const { width, height, data } = image.bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const isInnerCirclePixel = (red, green, blue, alpha) => {
    if (alpha < 64) return false;
    const minChannel = Math.min(red, green, blue);
    const maxChannel = Math.max(red, green, blue);
    // The canonical logo has a light circular field and a blue check/outer
    // tile. Selecting only the light neutral field removes the square tile
    // and leaves the check as transparent negative space.
    return minChannel >= 180 && maxChannel - minChannel <= 60;
  };

  image.scanQuiet(0, 0, width, height, (x, y, index) => {
    if (
      isInnerCirclePixel(
        data[index],
        data[index + 1],
        data[index + 2],
        data[index + 3],
      )
    ) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  });

  if (maxX < minX || maxY < minY) {
    throw new Error('Could not isolate the circular notification mark from assets/icon.png.');
  }

  const markSize = Math.max(maxX - minX + 1, maxY - minY + 1);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const cropX = Math.max(0, Math.min(width - markSize, Math.round(centerX - markSize / 2)));
  const cropY = Math.max(0, Math.min(height - markSize, Math.round(centerY - markSize / 2)));
  const mark = image.clone().crop(cropX, cropY, markSize, markSize);

  mark.scanQuiet(0, 0, markSize, markSize, (_x, _y, index) => {
    const visible = isInnerCirclePixel(
      mark.bitmap.data[index],
      mark.bitmap.data[index + 1],
      mark.bitmap.data[index + 2],
      mark.bitmap.data[index + 3],
    );
    mark.bitmap.data[index] = 255;
    mark.bitmap.data[index + 1] = 255;
    mark.bitmap.data[index + 2] = 255;
    mark.bitmap.data[index + 3] = visible ? 255 : 0;
  });

  return mark.getBufferAsync(Jimp.MIME_PNG);
}

async function resizeBuffer(buffer, width, height = width) {
  const image = await Jimp.read(buffer);
  return image.resize(width, height).getBufferAsync(Jimp.MIME_PNG);
}

async function createNotificationIcon(width) {
  const artworkSize = Math.max(1, Math.round(width * notificationArtworkRatio));
  const canvas = new Jimp(width, width, 0x00000000);
  const mark = await Jimp.read(await resizeBuffer(notificationMarkBuffer, artworkSize));
  const offset = Math.floor((width - artworkSize) / 2);
  canvas.composite(mark, offset, offset);
  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

async function createAdaptiveLayer(width, source = canonicalArtwork) {
  const artworkSize = Math.round(width * adaptiveArtworkRatio);
  const background = await generateImageBackgroundAsync({
    width,
    height: width,
    backgroundColor: 'transparent',
    resizeMode: 'cover',
  });
  const foreground =
    typeof source === 'string'
      ? await resizeArtwork(artworkSize)
      : await resizeBuffer(source, artworkSize);

  return compositeImagesAsync({
    background,
    foreground,
    x: (width - artworkSize) / 2,
    y: (width - artworkSize) / 2,
  });
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

async function removeObsolete(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return;
  if (checkOnly) {
    failures.push(relativePath);
    return;
  }
  await fs.promises.unlink(target);
}

const monochromeBuffer = await createMonochromeArtwork();
const notificationMarkBuffer = await createNotificationMark();

for (const obsoletePath of [
  'icon.png',
  'assets/adaptive-icon.png',
  'assets/branding/adaptive-foreground.png',
  'assets/branding/adaptive-foreground-safe.png',
  'assets/splash/splashscreen_logo.png',
  'assets/splash.png',
  'assets/splash-icon.png',
]) {
  await removeObsolete(obsoletePath);
}

await writeExpected('assets/branding/app-icon-ios.png', await createOpaqueIosIcon());
await writeExpected(
  'assets/branding/app-icon-android-foreground.png',
  await createAdaptiveLayer(1024),
);
await writeExpected('assets/favicon.png', await resizeArtwork(48));
await writeExpected(
  'assets/branding/app-mark-monochrome.png',
  await createAdaptiveLayer(1024, monochromeBuffer),
);
await writeExpected(
  'assets/notifications/notification-icon.png',
  await createNotificationIcon(96),
);

for (const { name, scale } of densities) {
  const adaptiveSize = 108 * scale;
  const legacySize = 48 * scale;
  const notificationSize = 24 * scale;
  const adaptiveForeground = await createAdaptiveLayer(adaptiveSize);
  const legacyIcon = await resizeArtwork(legacySize);
  const adaptiveMonochrome = await createAdaptiveLayer(adaptiveSize, monochromeBuffer);
  const notificationIcon = await createNotificationIcon(notificationSize);

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
  await removeObsolete(`android/app/src/main/res/drawable-${name}/ic_stat_notify.png`);
}

if (failures.length) {
  throw new Error(
    `App icon assets are out of sync with assets/icon.png:\n${failures
      .map((file) => `- ${file}`)
      .join('\n')}\nRun npm run icons:sync.`,
  );
}

console.log(
  checkOnly
    ? 'App icon assets match the canonical artwork.'
    : 'App icon assets were synchronized from assets/icon.png.',
);
