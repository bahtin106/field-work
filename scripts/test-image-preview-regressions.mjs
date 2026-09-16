import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';

const displayUriModule = await readFile(new URL('../src/shared/media/profileMediaDisplayUri.js', import.meta.url), 'utf8');
const { getProfileMediaDisplayUri } = await import(`data:text/javascript;base64,${Buffer.from(displayUriModule).toString('base64')}`);
const signedAvatar = 'https://example.test/profile-media-storage?mode=render&exp=123&sig=test';
assert.equal(getProfileMediaDisplayUri('yadisk://employee/avatar.jpg', signedAvatar), signedAvatar);
assert.equal(getProfileMediaDisplayUri('https://private.example.test/avatar.jpg', signedAvatar), signedAvatar);
for (const local of ['file:///new-avatar.jpg', 'content://gallery/123', 'ph://photo-id', 'data:image/png;base64,AAAA']) {
  assert.equal(getProfileMediaDisplayUri(local, signedAvatar), local, 'Unsaved local avatar must win over the saved URL');
}
assert.equal(getProfileMediaDisplayUri(null, signedAvatar), '', 'Deleting an avatar must not reveal the old image');
assert.equal(getProfileMediaDisplayUri('https://example.test/avatar.jpg', null), 'https://example.test/avatar.jpg');

const [viewer, modalPreview, photoGrid, userEdit, cachedImage, home, entityPreview] = await Promise.all([
  readFile(new URL('../app/orders/components/FullscreenImageViewer.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/media/ModalImagePreview.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/orders/components/PhotoGrid.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../screens/users/[id]/UserEditScreen.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/ui/CachedImage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/UniversalHome.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/media/EntityPhotoPreview.jsx', import.meta.url), 'utf8'),
]);

assert.match(
  viewer,
  /const handleImageLoad[\s\S]*?markImageReady\(\);[\s\S]*?event\?\.source\?\.width/,
  'Fullscreen viewer must uncover a decoded image from onLoad without waiting for onDisplay',
);
assert.match(viewer, /onDisplay=\{markImageReady\}/);
assert.match(viewer, /transition=\{0\}/);

assert.match(modalPreview, /width: previewSize, height: previewSize/);
assert.match(modalPreview, /<CachedImage[\s\S]*?uri=\{displayUri\}/);
assert.match(modalPreview, /transition=\{0\}/);
assert.doesNotMatch(modalPreview, /<ExpoImage/);

assert.match(photoGrid, /style=\{\(\{ pressed \}\) => \[s\.imagePressable/);
assert.match(photoGrid, /<CachedImage[\s\S]*?uri=\{src\}[\s\S]*?fallbackUri=/);
assert.match(photoGrid, /<CachedImage[\s\S]*?transition=\{0\}/);
assert.match(photoGrid, /\? \[displayUri, thumbUri, remoteDisplayUri\][\s\S]*?: \[thumbUri, displayUri, remoteDisplayUri\]/);
assert.doesNotMatch(photoGrid, /source=\{\{ uri: activeImageUri \}\}/);

assert.match(userEdit, /<ModalImagePreview[\s\S]*?uri=\{avatarDisplayUrl\}/);
assert.doesNotMatch(userEdit, /<ExpoImage/);

assert.match(cachedImage, /const requiresProtectedAuth = isProtectedMediaThumbnailUrl\(sourceUri\)/);
assert.doesNotMatch(cachedImage, /isProtectedProfileMediaRenderUrl/);
assert.match(cachedImage, /const effectiveCachePolicy = requiresProtectedAuth \? 'none' : cachePolicy/);
assert.doesNotMatch(cachedImage, /buildProtectedMemoryCacheKey/);

assert.doesNotMatch(home, /Protected avatar session is unavailable/);
assert.doesNotMatch(home, /isProtectedProfileMediaRenderUrl/);
assert.doesNotMatch(entityPreview, /isProtectedProfileMediaRenderUrl/);

console.log('Image preview regression checks passed.');
