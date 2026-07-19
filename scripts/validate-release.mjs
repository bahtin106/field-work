import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = json('package.json');
const appJson = json('app.json').expo;
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradle = read('android/app/build.gradle');
const gradleProperties = read('android/gradle.properties');
const externalUrls = read('config/externalUrls.js');
const appRuntime = read('config/appRuntime.js');
const financeQueue = read('src/features/finance/queries.js');
const financeApi = read('src/features/finance/api.js');
const keyboardControllerCompat = read('lib/keyboardControllerCompat.js');
const mapHelpers = read('components/ui/map.js');
const mapQueriesPlugin = read('plugins/withMapAppQueries.js');
const clientPrefill = read('src/features/clients/prefillFromSearch.js');
const orderSort = read('src/features/orders/orderSort.js');
const orderFacetCounts = read('src/features/orders/facetCounts.js');
const filtersPanel = read('components/filters/FiltersPanel.jsx');
const orderDetailsScreen = read('screens/orders/OrderDetailsScreen.jsx');
const createOrderScreen = read('screens/orders/CreateOrderScreen.jsx');
const myOrdersRoute = read('app/orders/my-orders.js');
const allOrdersRoute = read('app/orders/all-orders.jsx');
const orderDetailsRoute = read('app/orders/[id].jsx');
const bottomNavigation = read('components/navigation/BottomNav.jsx');
const bottomNavigationGuard = read('src/shared/navigation/bottomNavigationGuard.js');
const textField = read('components/ui/TextField.jsx');
const inputLimits = read('src/shared/input/limits.js');
const requestSearch = read('src/features/requests/search.js');
const requestApi = read('src/features/requests/api.ts');
const tagFiltering = read('src/features/tags/filtering.js');
const clientsIndexScreen = read('screens/clients/ClientsIndexScreen.jsx');
const objectsIndexScreen = read('screens/objects/ObjectsIndexScreen.jsx');
const myOrdersScreen = read('screens/orders/MyOrdersScreen.js');
const allOrdersScreen = read('screens/orders/AllOrdersScreen.jsx');
const authValidation = read('lib/authValidation.js');
const authProvider = read('providers/SimpleAuthProvider.jsx');
const authFlowState = read('lib/authFlowNavigationState.js');
const rootLayout = read('app/_layout.js');
const photoQueue = read('src/shared/media/orderPhotoQueue.js');
const emailServer = read('email-server.cjs');
const financePersistenceMigrationPath =
  'supabase/migrations/20260719120000_fix_manual_expense_persistence.sql';
const financePersistenceMigration = read(financePersistenceMigrationPath);
const orderPermissionMigration = read(
  'supabase/migrations/20260711017000_add_complete_other_orders_permission.sql',
);
const financeExclusionMigrationPath =
  'supabase/migrations/20260719142000_add_order_finance_rule_exclusions.sql';
const financeExclusionMigration = read(financeExclusionMigrationPath);
const functionSearchPathMigrationPath =
  'supabase/migrations/20260719160000_harden_remaining_function_search_paths.sql';
const functionSearchPathMigration = read(functionSearchPathMigrationPath);

check(!packageJson.dependencies?.['expo-dev-client'], 'expo-dev-client must not be bundled in production dependencies');
check(packageJson.dependencies?.['expo-background-task'], 'expo-background-task is required for deferred media delivery');
check(packageJson.dependencies?.expo === '~54.0.36', 'Expo must stay on the validated SDK 54 patch');
check(packageJson.dependencies?.['expo-updates'] === '~29.0.19', 'expo-updates must match the validated SDK 54 patch');
check(packageJson.dependencies?.['@react-native-community/netinfo'] === '11.4.1', 'NetInfo must match Expo SDK 54');
check(packageJson.dependencies?.['react-native-keyboard-controller'] === '1.18.5', 'Keyboard controller must match Expo SDK 54');

const permissions = new Set(appJson.android?.permissions || []);
const blockedPermissions = new Set(appJson.android?.blockedPermissions || []);
for (const permission of [
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
]) {
  check(!permissions.has(permission), `${permission} must not be requested in app config`);
  check(blockedPermissions.has(permission), `${permission} must be blocked against transitive manifests`);
}

check(/RECORD_AUDIO"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove RECORD_AUDIO');
check(/READ_MEDIA_IMAGES"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove READ_MEDIA_IMAGES');
check(/android\.enableProguardInReleaseBuilds=true/.test(gradleProperties), 'Release minification must be enabled');
check(/android\.enableShrinkResourcesInReleaseBuilds=true/.test(gradleProperties), 'Release resource shrinking must be enabled');

const versionName = gradle.match(/versionName\s*=\s*["']([^"']+)["']/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
check(versionName === appJson.version, `Native versionName (${versionName}) must match app version (${appJson.version})`);
check(appJson.android?.runtimeVersion === appJson.version, 'Android runtimeVersion must match app version');
check(appJson.ios?.runtimeVersion === appJson.version, 'iOS runtimeVersion must match app version');
check(Number.isInteger(versionCode) && versionCode > 0, 'Android versionCode must be a positive integer');

check(externalUrls.includes('https://monitorapp.ru/data-deletion'), 'Public account deletion URL is required');
check(
  appRuntime.includes("CANONICAL_SUPABASE_URL = 'https://supabase.monitorapp.ru'") &&
    appRuntime.includes('supabaseUrl: CANONICAL_SUPABASE_URL') &&
    !appRuntime.includes("readPublicEnv('EXPO_PUBLIC_SUPABASE_URL')") &&
    !appRuntime.includes("readPublicEnv('SUPABASE_URL')"),
  'The app must use only the canonical self-hosted Supabase origin',
);
check(
  !fs.existsSync(path.join(root, 'supabase/.temp/linked-project.json')),
  'Supabase CLI must not retain a link to a hosted project',
);
check(
  !fs.existsSync(path.join(root, 'scripts/deploy_yandex_display_url.ps1')) &&
    !fs.existsSync(path.join(root, 'ops/scripts-root/deploy-password-fix.sh')),
  'Legacy hosted-Supabase deployment scripts must not be present',
);
check(financeQueue.includes('ownerUserId') && financeQueue.includes('mutateFinanceOutbox'), 'Finance outbox must be owner-scoped and serialized');
check(
  financeQueue.includes('if (!snapshot.isNetworkKnown) return true'),
  'Cold-start finance writes must try the server before falling back to the outbox',
);
check(
  inputLimits.includes('description: 4000') &&
    inputLimits.includes('email: 254') &&
    textField.includes('maxLength={effectiveMaxLength}') &&
    textField.includes("T('validation_max_length')"),
  'Text inputs must enforce centralized type-specific limits with localized feedback',
);
check(
  myOrdersScreen.includes('buildRequestSearchIndex(o, {') &&
    allOrdersScreen.includes('buildRequestSearchIndex(order, {') &&
    requestSearch.includes('row.object_name') &&
    requestSearch.includes('row.client_tags') &&
    requestSearch.includes('row.object_tags') &&
    requestSearch.includes('ADDRESS_FIELDS.flatMap') &&
    requestSearch.includes('options.includePhones'),
  'My and All requests must share the complete permission-aware request search index',
);
check(
  clientsIndexScreen.includes('mode="clients"') &&
    clientsIndexScreen.includes("'clients_clientTags'") &&
    clientsIndexScreen.includes("'clients_objectTags'") &&
    clientsIndexScreen.includes('matchesSelectedTags(client?.tags, clientTags)') &&
    clientsIndexScreen.includes('matchesSelectedTags(relatedObjectTags, objectTags)'),
  'Client library filters must cover both client tags and tags of related objects',
);
check(
  objectsIndexScreen.includes("'objects_tags'") &&
    objectsIndexScreen.includes('matchesSelectedTags(item?.tags, selectedObjectTags)'),
  'Object library filters must support object tags',
);
check(
  filtersPanel.includes("key: 'orders_clientTags'") &&
    filtersPanel.includes("key: 'orders_objectTags'") &&
    myOrdersScreen.includes("query.overlaps('client_tags', clientTags)") &&
    myOrdersScreen.includes("query.overlaps('object_tags', objectTags)") &&
    requestApi.includes("query.overlaps('client_tags', normalizedClientTags)") &&
    requestApi.includes("query.overlaps('object_tags', normalizedObjectTags)") &&
    tagFiltering.includes('export function matchesSelectedTags'),
  'Request filters must apply related client/object tags before pagination',
);
check(
  clientsIndexScreen.includes("tagType: 'client'") &&
    clientsIndexScreen.includes("tagType: 'object'") &&
    clientsIndexScreen.includes('companyClientTags') &&
    clientsIndexScreen.includes('companyObjectTags'),
  'Client filters must include the complete company tag catalogs',
);
check(
  orderFacetCounts.includes('addOrderTagCounts(counts.clientTags') &&
    orderFacetCounts.includes('addOrderTagCounts(counts.objectTags') &&
    tagFiltering.includes('export function buildTagFacetCounts') &&
    clientsIndexScreen.includes('clientTagFacetCounts') &&
    clientsIndexScreen.includes('objectTagFacetCounts') &&
    objectsIndexScreen.includes('objectTagFacetCounts') &&
    filtersPanel.includes('orderFacetCounts.clientTags') &&
    filtersPanel.includes('orderFacetCounts.objectTags') &&
    filtersPanel.includes('clientFacetCounts.clientTags') &&
    filtersPanel.includes('clientFacetCounts.objectTags') &&
    filtersPanel.includes('isEmpty && !selected'),
  'Entity tag facets must show case-insensitive counts and keep zero-count values muted',
);
const filtersApplyBarStyle = filtersPanel.match(/applyBar:\s*\{([\s\S]*?)\n\s*\},/)?.[1] || '';
check(
  filtersApplyBarStyle &&
    !filtersApplyBarStyle.includes("position: 'absolute'") &&
    filtersApplyBarStyle.includes('backgroundColor: c.background') &&
    !clientsIndexScreen.includes('previewCountResolver=') &&
    !objectsIndexScreen.includes('previewCountResolver='),
  'Filter apply action must reserve layout space and entity filter panels must share the orders layout',
);
check(
  authValidation.includes("errors.push('password_missing_digit')") &&
    authValidation.includes("errors.push('password_missing_uppercase')") &&
    authValidation.includes("errors.push('password_missing_lowercase')"),
  'Password validation must enforce every requirement used by the UI checklist',
);
check(
  authProvider.includes('SIGN_OUT_AUTH_TIMEOUT_MS') &&
    authProvider.includes('clearPersistedAuthSession()') &&
    authProvider.includes('completing local sign-out'),
  'Sign-out must have bounded network waits and a local session fallback',
);
check(
  authFlowState.includes('hydratePublicAuthRoute') &&
    authFlowState.includes('PUBLIC_AUTH_ROUTE_STORAGE_KEY') &&
    rootLayout.includes('publicAuthRouteHydrated'),
  'Pending email-code navigation must be restored before auth redirects',
);
check(
  financeQueue.includes('placeholderData: () => undefined'),
  'Finance entries must not reuse another order query placeholder',
);
for (const signature of [
  'public.media_assets_provider_from_url(text, text)',
  'public.media_assets_storage_bucket_from_url(text)',
  'public.finance_validate_rule_conditions(jsonb)',
  'public.finance_rule_conditions_match(jsonb, public.orders)',
]) {
  check(
    functionSearchPathMigration.includes(`alter function ${signature}`) &&
      functionSearchPathMigration.includes("set search_path = ''"),
    `${signature} must retain an immutable empty search_path`,
  );
}
check(
  financeApi.includes(".eq('order_id', row.order_id)") &&
    financeApi.includes('.update(updateRow)') &&
    financeApi.includes('.insert(row)'),
  'Finance entry updates must be scoped to their original order',
);
check(
  orderDetailsScreen.includes('targetOrderId !== routeOrderId') &&
    orderDetailsScreen.includes('isEntityBoundToOrder(entry, routeOrderId)'),
  'Order finance forms must remain bound to their route order',
);
const orderDetailsScrollStart = orderDetailsScreen.indexOf('ref={detailsScrollRef}');
const orderDetailsScrollEnd = orderDetailsScreen.indexOf('</ScrollView>', orderDetailsScrollStart);
const orderDetailsScrollBody = orderDetailsScreen.slice(orderDetailsScrollStart, orderDetailsScrollEnd);
check(
  orderDetailsScrollStart >= 0 &&
    orderDetailsScrollEnd > orderDetailsScrollStart &&
    !orderDetailsScrollBody.includes('<MediaUploadModal'),
  'Order photo modal must remain outside the details ScrollView to preserve VirtualizedList windowing on iOS',
);
check(
  orderDetailsScreen.includes('enableFallbackAutomaticScroll={false}') &&
    orderDetailsScreen.includes('enableFallbackFocusedInputUpdate={false}') &&
    orderDetailsScreen.includes('usePlainScrollViewFallback') &&
    orderDetailsScreen.includes('automaticallyAdjustKeyboardInsets'),
  'Finance entry modal must bypass legacy focused-input measurement while retaining native keyboard insets',
);
check(
  keyboardControllerCompat.includes('if (usePlainScrollViewFallback)') &&
    keyboardControllerCompat.includes('return React.createElement(ScrollView'),
  'Expo Go keyboard fallback must support bypassing the legacy measurement wrapper',
);
check(
  keyboardControllerCompat.includes("keyboardShouldPersistTaps = 'always'") &&
    keyboardControllerCompat.includes('keyboardShouldPersistTaps,'),
  'Shared keyboard-aware forms must deliver the first tap to action buttons',
);
check(
  mapHelpers.includes("id: 'android_system_maps'") &&
    mapHelpers.includes('buildAndroidGeoUrl') &&
    mapQueriesPlugin.includes('withInfoPlist') &&
    /android:scheme="yandexmaps"/.test(manifest) &&
    /android:scheme="comgooglemaps"/.test(manifest) &&
    /android:scheme="geo"/.test(manifest),
  'Map opening must detect installed apps in native builds and retain an Android system fallback',
);
check(
  clientPrefill.includes('PATRONYMIC_SUFFIXES') &&
    clientPrefill.includes('patronymicIndex === tokens.length - 1') &&
    clientPrefill.includes('patronymicIndex === 1'),
  'Client prefill must recognize patronymics and international middle names without dropping tokens',
);
check(
  orderSort.includes("preferredField.startsWith('createdDate')") &&
    orderSort.includes('ORDER_SORT_KEYS.createdAsc') &&
    orderSort.includes('ORDER_SORT_KEYS.departureAsc') &&
    filtersPanel.includes('lastDateFilterField: lastOrderDateFilterFieldRef.current'),
  'Date filters must select matching field and direction for order sorting',
);
for (const [routeSource, screenPath] of [
  [myOrdersRoute, '../../screens/orders/MyOrdersScreen'],
  [allOrdersRoute, '../../screens/orders/AllOrdersScreen'],
  [orderDetailsRoute, '../../screens/orders/OrderDetailsScreen'],
]) {
  check(
    routeSource.includes(`export { default } from '${screenPath}'`) &&
      !routeSource.includes('LazyRouteScreen'),
    `${screenPath} must be loaded directly by Expo Router without a second lazy-loading waterfall`,
  );
}
check(
  orderDetailsScreen.includes('const bgTasks = [];') &&
    orderDetailsScreen.includes('cachedOrderNeedsStatusAdvance') &&
    orderDetailsScreen.includes('const shouldAdvanceStatus =') &&
    orderDetailsScreen.includes('.then((updatedOrder) => {') &&
    !orderDetailsScreen.includes('const refreshed = await ensureRequestPrefetch(queryClient, id);'),
  'Order details must render before automatic status persistence and redundant detail refetching',
);
check(
  bottomNavigation.includes('requestBottomNavigation(target, proceed)') &&
    bottomNavigationGuard.includes('registerBottomNavigationGuard') &&
    createOrderScreen.includes('pendingBottomNavigationRef.current = proceed'),
  'Bottom navigation must honor the active create-order data-loss guard',
);
check(
  createOrderScreen.includes('create_order_modal_cancel_save_draft') &&
    createOrderScreen.includes('saveDraftAndExit') &&
    createOrderScreen.includes('stayOnCreateScreen') &&
    createOrderScreen.includes('confirmCancel'),
  'Create-order exit confirmation must offer save draft, stay, and discard actions',
);
check(
  orderDetailsScreen.includes('const handleOrderStatusSelect = useCallback') &&
    orderDetailsScreen.includes('const canEditAnyOrderStatus =') &&
    orderDetailsScreen.includes("has('canCompleteOwnOrders')") &&
    orderDetailsScreen.includes("has('canCompleteOtherOrders')") &&
    orderDetailsScreen.includes("nextStatus === 'feed'") &&
    orderDetailsScreen.includes('{ status: nextStatus, assigned_to: null }') &&
    orderDetailsScreen.includes("const leavingFeed = resolvedCurrentStatus === 'feed'") &&
    orderDetailsScreen.includes('setPendingStatusSelection({ orderId: targetOrderId, statusKey: nextStatus })') &&
    orderDetailsScreen.includes('{ status: nextStatus, assigned_to: selectedAssigneeId }') &&
    orderDetailsScreen.includes(".eq('company_id', executorCompanyId)") &&
    orderDetailsScreen.includes("String(profile?.company_id || '') === executorCompanyId") &&
    orderDetailsScreen.includes('const selectedAssigneeIsScoped = users.some') &&
    orderDetailsScreen.includes("String(profile?.company_id || '') === targetCompanyId") &&
    orderDetailsScreen.includes('await handleFinishOrder(currentOrder)') &&
    orderDetailsScreen.includes("title={t('order_modal_change_status')}"),
  'Order details status changes must preserve company scope, role permissions, completion validation, and atomic Feed assignment rules',
);
check(
  orderPermissionMigration.includes("'canEditOrders'") &&
    orderPermissionMigration.includes("'canCompleteOwnOrders'") &&
    orderPermissionMigration.includes("'canCompleteOtherOrders'") &&
    orderPermissionMigration.includes(`p_patch = '{"status":"done"}'::jsonb`),
  'Server-side order updates must enforce edit and completion permissions',
);
check(
  fs.existsSync(path.join(root, financePersistenceMigrationPath)) &&
    financePersistenceMigration.includes('trg_prevent_order_finance_entry_reparenting') &&
    !financePersistenceMigration.includes('least(v_amount'),
  'Finance persistence migration must preserve fixed expenses and prevent reparenting',
);
check(
  fs.existsSync(path.join(root, financeExclusionMigrationPath)) &&
    financeExclusionMigration.includes('order_finance_rule_exclusions') &&
    financeExclusionMigration.includes('exclude_order_finance_rule') &&
    financeExclusionMigration.includes('current_user_has_app_permission'),
  'Per-order finance rule exclusions must exist and enforce server-side permissions',
);
check(photoQueue.includes('ownerUserId') && photoQueue.includes('flushOrderPhotoQueue'), 'Photo queue must be owner-scoped and globally flushable');
check(fs.existsSync(path.join(root, 'supabase/migrations/20260712190000_harden_error_logs.sql')), 'Error log schema migration is required');
check(
  emailServer.includes("'X-Postmaster-Msgtype': POSTMASTER_MESSAGE_TYPES[type]"),
  'Transactional email must expose a stable Postmaster message type',
);
check(
  emailServer.includes('<!doctype html>') && emailServer.includes('<html lang="ru">'),
  'Transactional verification email must use a complete HTML document',
);

if (failures.length) {
  console.error('Release validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Release validation passed.');
