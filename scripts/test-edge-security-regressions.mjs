import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractBearerToken,
  hasExactBearerSecret,
} from '../supabase/functions/_shared/edge-auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const passwordReset = read('supabase/functions/request-password-reset/index.ts');
const login = read('app/(auth)/login.jsx');
const mediaThumbnail = read('supabase/functions/media-thumbnail/index.ts');
const cachedImage = read('components/ui/CachedImage.jsx');
const backfill = read('supabase/functions/backfill-media-sizes/index.ts');

// Password reset: an initial request may only start the OTP proof flow. It must
// never alter credentials or reveal whether the profile exists.
for (const dangerousFragment of [
  'generateTempPassword',
  'tempPassword',
  'temporary-password',
  "type: 'password-reset'",
  "code: 'USER_NOT_FOUND'",
]) {
  assert.equal(passwordReset.includes(dangerousFragment), false, `dangerous reset branch returned: ${dangerousFragment}`);
}
assert.match(passwordReset, /\/registration\/send-code/);
assert.match(passwordReset, /genericInitialResponse\(startedAt\)/);
assert.match(passwordReset, /PASSWORD_RESET_MIN_RESPONSE_MS/);
assert.match(passwordReset, /isValidNewPassword\(nextPassword\)/);
assert.match(
  passwordReset,
  /if \(!profile\?\.id\)[\s\S]*?status: 'user_not_found'[\s\S]*?return genericInitialResponse\(startedAt\)/,
  'unknown accounts must receive the generic initial response',
);
assert.ok(
  (passwordReset.match(/waitForInitialResponseFloor\(startedAt\)/g) || []).length >= 3,
  'success and both rate-limit paths must share the timing floor',
);
const verifyIndex = passwordReset.indexOf('/registration/verify-code');
const consumeIndex = passwordReset.indexOf('/registration/consume-token');
const confirmationProfileLookupIndex = passwordReset.indexOf(".from('profiles')");
const passwordUpdateIndex = passwordReset.indexOf('admin.auth.admin.updateUserById');
assert.ok(verifyIndex >= 0 && verifyIndex < consumeIndex, 'OTP must be verified before proof consumption');
assert.ok(
  consumeIndex < confirmationProfileLookupIndex,
  'confirmation must not look up a profile until the one-time proof is consumed',
);
assert.ok(
  (passwordReset.match(/return invalidRecoveryProofResponse\(\)/g) || []).length >= 4,
  'invalid OTP, malformed proof, failed consumption, and missing profiles must share one response',
);
assert.match(
  passwordReset,
  /function invalidRecoveryProofResponse\(\): Response \{[\s\S]*?code: 'INVALID_CODE'[\s\S]*?\}, 400\);/,
  'invalid and missing recovery proofs must share the same HTTP status and body',
);
assert.ok(consumeIndex < passwordUpdateIndex, 'password must change only after OTP proof consumption');
assert.match(login, /body:\s*\{ email: normalizedEmail, mode: 'profile-change' \}/);
assert.match(login, /code: normalizedCode/);
assert.match(login, /new_password: recoverNewPassword/);
assert.equal(login.includes("code === 'USER_NOT_FOUND'"), false, 'client must not expose account enumeration');
assert.match(login, /recoverRequestedEmail === nextEmail/, 'recovery stage must be bound to the requested email');
assert.match(login, /normalizeEmail\(recoverRequestedEmail\)/, 'OTP confirmation must use the bound email');

// Protected thumbnails: missing/malformed bearer values fail before any asset
// lookup, while normal asset lookup must use the caller's RLS-scoped client.
assert.equal(extractBearerToken(null), '');
assert.equal(extractBearerToken(''), '');
assert.equal(extractBearerToken('Basic abc'), '');
assert.equal(extractBearerToken('Bearer   '), '');
assert.equal(extractBearerToken('Bearer user-jwt'), 'user-jwt');
assert.match(mediaThumbnail, /if \(!token\) return json\(401/);
assert.match(mediaThumbnail, /caller\.auth\.getUser\(token\)/);
assert.match(mediaThumbnail, /const \{ data, error \} = await caller\s*\.from\('media_assets'\)/);
assert.doesNotMatch(mediaThumbnail, /await admin\s*\.from\('media_assets'\)/);
assert.equal(mediaThumbnail.includes("Deno.env.get('SUPABASE_ANON_KEY') || serviceRole"), false);
assert.equal(mediaThumbnail.includes("'public, max-age="), false);
assert.match(mediaThumbnail, /headers\.set\('Vary', 'Accept, Authorization'\)/);
const callerAssetIndex = mediaThumbnail.indexOf("await caller\n      .from('media_assets')");
const adminClientIndex = mediaThumbnail.indexOf('const admin = createClient(supabaseUrl, serviceRole');
assert.ok(callerAssetIndex >= 0 && callerAssetIndex < adminClientIndex, 'service role must be created only after RLS authorization');
assert.match(cachedImage, /isProtectedMediaThumbnailUrl\(sourceUri\)/);
assert.match(cachedImage, /Authorization: `Bearer \$\{protectedAccessToken\}`/);
assert.match(cachedImage, /effectiveCachePolicy = requiresProtectedAuth \? 'none' : cachePolicy/);
const photoGrid = read('app/orders/components/PhotoGrid.jsx');
const imagePipeline = read('src/shared/media/imagePipeline.js');
const objectEdit = read('screens/objects/[id]/ObjectEditScreen.jsx');
const fullscreenViewer = read('app/orders/components/FullscreenImageViewer.jsx');
const financeMedia = read('hooks/useFinanceEntryMedia.js');
const orderDetails = read('screens/orders/OrderDetailsScreen.jsx');
const trashScreen = read('screens/app_settings/TrashScreen.jsx');
const trashDetailScreen = read('screens/app_settings/TrashDetailScreen.jsx');
assert.match(photoGrid, /!isProtectedMediaThumbnailUrl\(url\)/, 'protected thumbnails must not use unauthenticated prefetch');
assert.match(imagePipeline, /!isProtectedMediaThumbnailUrl\(url\)/, 'shared prefetch must skip protected thumbnails');
assert.match(objectEdit, /<CachedImage\s+uri=\{photoAvatarUrl\}/, 'object avatar must use the authenticated renderer');
assert.match(fullscreenViewer, /!activeUriIsProtected \? \(/, 'fullscreen viewer must not render protected URLs without auth');
assert.match(fullscreenViewer, /filter\(\(uri\) => !isProtectedMediaThumbnailUrl\(uri\)\)/, 'viewer prefetch must skip protected URLs');
const financeDisplaySection = financeMedia.slice(
  financeMedia.indexOf('const getDisplayUrl = useCallback'),
  financeMedia.indexOf('const getThumbnailUrl = useCallback'),
);
assert.doesNotMatch(financeDisplaySection, /thumbUrls/, 'full-size finance display must not fall back to a protected thumbnail');
assert.doesNotMatch(orderDetails, /getDisplayUrl\(raw\) \|\| orderMedia\.getThumbnailUrl\(raw\)/, 'full-screen order viewer must not receive a thumbnail URL');
assert.match(
  trashScreen,
  /<Image source=\{thumbnailSource\} cachePolicy="none"/,
  'protected trash thumbnails must not enter the shared native disk cache',
);
assert.match(
  trashDetailScreen,
  /<Image source=\{mediaSource\} cachePolicy="none"/,
  'protected trash detail images must not enter the shared native disk cache',
);

// Global backfill maintenance is service-role only. Missing, anon, and ordinary
// user tokens all exercise the same 401 branch.
const serviceRole = 'service-role-secret';
const statusFor = (authorization) => (
  hasExactBearerSecret(authorization, serviceRole) ? 200 : 401
);
assert.equal(statusFor(undefined), 401, 'missing bearer must be rejected');
assert.equal(statusFor('Bearer anon-key'), 401, 'anon bearer must be rejected');
assert.equal(statusFor('Bearer user-access-token'), 401, 'user bearer must be rejected');
assert.equal(statusFor(`Bearer ${serviceRole}`), 200, 'service-role bearer must be accepted');
assert.equal(statusFor(serviceRole), 401, 'a raw secret without Bearer must be rejected');
assert.match(backfill, /if \(!hasExactBearerSecret\(req\.headers\.get\('authorization'\), serviceRole\)\)/);
assert.match(backfill, /return json\(401, \{ success: false, message: 'Unauthorized' \}\)/);
assert.equal(backfill.includes(".select('role')"), false, 'tenant-admin bypass must stay removed');
assert.equal(backfill.includes('admin.auth.getUser'), false, 'user JWTs must not authorize global maintenance');

console.log('Edge security regression tests passed.');
