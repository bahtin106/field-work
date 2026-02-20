import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

async function getFileSizeBytes(uri) {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return Number(info?.size || 0);
}

export async function compressImageToTargetBytes(
  uri,
  {
    targetBytes,
    sourceWidth,
    initialWidth,
    minWidth,
    initialQuality = 0.82,
    minQuality = 0.56,
    qualityStep = 0.06,
    widthStepFactor = 0.86,
  } = {},
) {
  if (!uri) throw new Error('Image URI is required');

  const maxBytes = Number(targetBytes || 200 * 1024);
  const maxWidth = Math.max(
    1,
    Math.floor(Math.min(Number(initialWidth || 1600), Number(sourceWidth || initialWidth || 1600))),
  );
  const floorWidth = Math.max(1, Math.min(maxWidth, Math.floor(Number(minWidth || 960))));

  let best = null;
  let width = maxWidth;

  while (width >= floorWidth) {
    for (let quality = initialQuality; quality >= minQuality; quality -= qualityStep) {
      const normalizedQuality = Math.max(0.1, Math.min(0.95, Number(quality.toFixed(2))));
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width } }],
        { compress: normalizedQuality, format: ImageManipulator.SaveFormat.JPEG },
      );

      const bytes = await getFileSizeBytes(result.uri);
      if (!best || bytes < best.bytes) {
        best = { ...result, bytes, width, quality: normalizedQuality };
      }

      if (bytes <= maxBytes) {
        return { ...result, bytes, width, quality: normalizedQuality };
      }
    }

    const nextWidth = Math.floor(width * widthStepFactor);
    if (nextWidth === width) break;
    width = nextWidth;
  }

  if (best) return best;

  const fallback = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: Math.max(0.1, Math.min(0.95, initialQuality)), format: ImageManipulator.SaveFormat.JPEG },
  );
  const fallbackBytes = await getFileSizeBytes(fallback.uri);
  return { ...fallback, bytes: fallbackBytes, width: maxWidth, quality: initialQuality };
}
