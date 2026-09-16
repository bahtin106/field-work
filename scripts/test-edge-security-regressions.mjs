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
const universalHome = read('components/UniversalHome.jsx');
const entityPhotoPreview = read('components/media/EntityPhotoPreview.jsx');
const profileMediaUrl = read('src/shared/media/profileMediaUrl.js');
const backfill = read('supabase/functions/backfill-media-sizes/index.ts');
const supabaseConfig = read('supabase/config.toml');
const profileMediaStorage = read('supabase/functions/profile-media-storage/index.ts');
const supabaseSessionCache = read('lib/supabaseSessionCache.js');
const registerUser = read('supabase/functions/register_user/index.ts');
const registrationEmailGuard = read(
  'supabase/migrations/20260916200000_prevent_duplicate_registration_emails.sql',
);
const adminUserProfileFix = read(
  'supabase/migrations/20260916213000_fix_admin_user_profile_suspended_at.sql',
);

// Registration retries must never treat an orphan profile as an available
// email. Database uniqueness closes concurrent races, while failed multi-step
// registrations are removed by one service-only transaction.
assert.equal(registerUser.includes('isProfileEmailOwnedByAuthUser'), false);
assert.equal(registerUser.includes('existingUser = null'), false);
assert.equal(registerUser.includes('auth.admin.deleteUser'), false);
assert.match(registerUser, /rpc\('service_rollback_failed_registration'/);
assert.match(
  registerUser,
  /Do not delete only the auth row when public cleanup failed/,
);
assert.match(registrationEmailGuard, /create unique index if not exists profiles_email_normalized_uidx/);
assert.match(registrationEmailGuard, /create unique index if not exists users_email_normalized_uidx/);
assert.match(
  registrationEmailGuard,
  /revoke all on function public\.service_rollback_failed_registration\(uuid, uuid, text\)[\s\S]*?from public, anon, authenticated/,
);
assert.match(
  registrationEmailGuard,
  /grant execute on function public\.service_rollback_failed_registration\(uuid, uuid, text\)[\s\S]*?to service_role/,
);
assert.match(
  adminUserProfileFix,
  /null::timestamptz as suspended_at/,
  'admin profile RPC must expose the CTE timestamp under the name selected below',
);
assert.match(adminUserProfileFix, /s\.suspended_at/);
assert.match(adminUserProfileFix, /perform public\.admin_assert_super_admin\(\)/);
assert.match(
  adminUserProfileFix,
  /revoke all on function public\.admin_get_user_profile_full\(uuid\)[\s\S]*?from public, anon/,
);

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
assert.doesNotMatch(cachedImage, /isProtectedProfileMediaRenderUrl/);
assert.match(cachedImage, /Authorization: `Bearer \$\{protectedAccessToken\}`/);
assert.match(cachedImage, /effectiveCachePolicy = requiresProtectedAuth \? 'none' : cachePolicy/);
assert.match(cachedImage, /getCachedSupabaseAccessToken\(\)/);
assert.match(profileMediaUrl, /functions\/v1\/profile-media-storage/);
assert.match(profileMediaUrl, /target\.searchParams\.get\('sig'\)/);
assert.match(
  universalHome,
  /await ExpoImage\.loadAsync\(source/,
  'the home avatar must load into a reusable native ImageRef',
);
assert.match(
  universalHome,
  /const source = \{[\s\S]*?uri: avatarUrl,[\s\S]*?cacheKey: avatarCacheKey/,
  'signed home avatars must load directly without waiting for the session cache',
);
assert.doesNotMatch(universalHome, /Protected avatar session is unavailable/);
assert.match(
  universalHome,
  /<ExpoImage\s+source=\{avatarImageRef\}/,
  'the home avatar must render the resolved native ImageRef',
);
assert.match(
  universalHome,
  /ExpoImage\.prefetch\(snapshot\.avatar_display_url, 'memory-disk'\)/,
  'signature-authenticated profile images may be prefetched directly',
);
assert.match(entityPhotoPreview, /disableContentShrink/);
assert.match(entityPhotoPreview, /width: previewSize, height: previewSize/);
assert.match(entityPhotoPreview, /await ExpoImage\.loadAsync\(source/);
assert.ok(
  (entityPhotoPreview.match(/source=\{previewImageRef\}/g) || []).length >= 2,
  'the thumbnail and modal must render the same native ImageRef',
);
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
assert.doesNotMatch(
  fullscreenViewer,
  /RNImage\.getSize|useImageResolution/,
  'fullscreen viewer must not fetch and decode remote images through a second native pipeline',
);
assert.match(
  fullscreenViewer,
  /onLoad=\{handleImageLoad\}/,
  'fullscreen viewer must reuse expo-image load metadata for image dimensions',
);
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

// Profile image render URLs are short-lived and signed by the handler, so the
// gateway must let their unauthenticated GET requests reach that verification.
// Mutating POST actions remain protected by explicit user JWT validation.
assert.match(
  supabaseConfig,
  /\[functions\.profile-media-storage\][\s\S]*?verify_jwt\s*=\s*false/,
  'profile image render GETs must bypass the gateway JWT check',
);
assert.match(profileMediaStorage, /if \(req\.method === 'GET'\)[\s\S]*?verifyRenderRequest\(url\)/);
assert.match(profileMediaStorage, /if \(!valid\)[\s\S]*?binary\(403, 'Forbidden'/);
assert.match(profileMediaStorage, /const token = \(req\.headers\.get\('Authorization'\)/);
assert.match(profileMediaStorage, /if \(!token\) return json\(401/);
assert.match(profileMediaStorage, /getCallerContext\(admin, callerDb, token\)/);

console.log('Edge security regression tests passed.');
