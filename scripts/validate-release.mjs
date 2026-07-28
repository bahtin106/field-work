import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const androidNetworkSecurityConfig = read(
  'android/app/src/main/res/xml/network_security_config.xml',
);
const isrgRootX1Pem = read('android/app/src/main/res/raw/isrg_root_x1.pem');
const isrgRootX1 = new X509Certificate(isrgRootX1Pem);
const androidStrings = read('android/app/src/main/res/values/strings.xml');
const androidStyles = read('android/app/src/main/res/values/styles.xml');
const androidNightStyles = read('android/app/src/main/res/values-night/styles.xml');
const androidColors = read('android/app/src/main/res/values/colors.xml');
const androidNightColors = read('android/app/src/main/res/values-night/colors.xml');
const androidLauncherIcon = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
const androidRoundLauncherIcon = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
const androidLauncherBackground = read(
  'android/app/src/main/res/drawable/ic_launcher_background.xml',
);
const gradle = read('android/app/build.gradle');
const gradleProperties = read('android/gradle.properties');
const legacySystemBarCompat = read(
  'android/app/src/main/java/com/monitorapp/monitor/LegacySystemBarColorCompat.java',
);
const legacySystemBarVisitor = read(
  'android/buildSrc/src/main/groovy/com/monitorapp/build/LegacySystemBarColorApiVisitorFactory.groovy',
);
const mainActivity = read('android/app/src/main/java/com/monitorapp/monitor/MainActivity.kt');
const systemBars = read('lib/systemBars.js');
const externalUrls = read('config/externalUrls.js');
const appRuntime = read('config/appRuntime.js');
const financeQueue = read('src/features/finance/queries.js');
const financeApi = read('src/features/finance/api.js');
const keyboardControllerCompat = read('lib/keyboardControllerCompat.js');
const mapHelpers = read('components/ui/map.js');
const mapQueriesPlugin = read('plugins/withMapAppQueries.js');
const mapAppsNativeModule = read(
  'modules/monitor-map-apps/android/src/main/java/expo/modules/monitormapapps/MonitorMapAppsModule.kt',
);
const mapAppsNativeBuild = read('modules/monitor-map-apps/android/build.gradle');
const mapAppsModuleConfig = json('modules/monitor-map-apps/expo-module.config.json');
const clientPrefill = read('src/features/clients/prefillFromSearch.js');
const orderSort = read('src/features/orders/orderSort.js');
const orderFacetCounts = read('src/features/orders/facetCounts.js');
const filtersPanel = read('components/filters/FiltersPanel.jsx');
const appSettingsScreen = read('screens/app_settings/AppSettingsScreen.jsx');
const trashScreen = read('screens/app_settings/TrashScreen.jsx');
const trashFiltersPanel = read('components/filters/TrashFiltersPanel.jsx');
const selectionToolbar = read('components/ui/SelectionToolbar.jsx');
const trashApi = read('src/features/trash/api.ts');
const objectViewScreen = read('screens/objects/[id]/ObjectViewScreen.jsx');
const orderDetailsScreen = read('screens/orders/OrderDetailsScreen.jsx');
const createOrderScreen = read('screens/orders/CreateOrderScreen.jsx');
const myOrdersRoute = read('app/orders/my-orders.js');
const allOrdersRoute = read('app/orders/all-orders.jsx');
const orderDetailsRoute = read('app/orders/[id].jsx');
const bottomNavigation = read('components/navigation/BottomNav.jsx');
const universalHome = read('components/UniversalHome.jsx');
const userViewScreen = read('screens/users/[id]/UserViewScreen.jsx');
const bottomNavigationGuard = read('src/shared/navigation/bottomNavigationGuard.js');
const textField = read('components/ui/TextField.jsx');
const phoneInput = read('components/ui/PhoneInput.jsx');
const contactPhonePicker = read('components/ui/ContactPhonePickerButton.jsx');
const expandableTextRow = read('components/ui/ExpandableTextRow.jsx');
const inputLimits = read('src/shared/input/limits.js');
const requestSearch = read('src/features/requests/search.js');
const requestApi = read('src/features/requests/api.ts');
const tagFiltering = read('src/features/tags/filtering.js');
const clientsIndexScreen = read('screens/clients/ClientsIndexScreen.jsx');
const clientViewScreen = read('screens/clients/[id]/ClientViewScreen.jsx');
const objectsIndexScreen = read('screens/objects/ObjectsIndexScreen.jsx');
const objectCard = read('components/objects/ObjectCard.jsx');
const objectAddressing = read('src/features/objects/addressing.js');
const objectMatching = read('src/features/objects/matching.js');
const clientsApi = read('src/features/clients/api.ts');
const myOrdersScreen = read('screens/orders/MyOrdersScreen.js');
const allOrdersScreen = read('screens/orders/AllOrdersScreen.jsx');
const authValidation = read('lib/authValidation.js');
const authProvider = read('providers/SimpleAuthProvider.jsx');
const supabaseClient = read('lib/supabase.js');
const offlineStatus = read('src/shared/offline/offlineStatus.ts');
const queryClient = read('src/shared/query/queryClient.ts');
const authFlowState = read('lib/authFlowNavigationState.js');
const rootLayout = read('app/_layout.js');
const photoQueue = read('src/shared/media/orderPhotoQueue.js');
const cachedImage = read('components/ui/CachedImage.jsx');
const photoGrid = read('app/orders/components/PhotoGrid.jsx');
const quickPreviewModal = read('components/ui/modals/QuickPreviewModal.jsx');
const dialog = read('components/ui/Dialog.jsx');
const fullscreenImageViewer = read('app/orders/components/FullscreenImageViewer.jsx');
const baseModal = read('components/ui/modals/BaseModal.jsx');
const confirmAlertModals = read('components/ui/modals/ConfirmAlertModals.jsx');
const selectModal = read('components/ui/modals/SelectModal.jsx');
const multiSelectModal = read('components/ui/modals/MultiSelectModal.jsx');
const dateTimeModal = read('components/ui/modals/DateTimeModal.jsx');
const mediaUploadModal = read('app/orders/components/OrderPhotosModal.jsx');
const themeProvider = read('theme/ThemeProvider.jsx');
const ruTranslations = read('src/i18n/ru.js');
const objectLocationModeMigration = read(
  'supabase/migrations/20260728190000_expose_order_object_location_mode.sql',
);
const signedMediaUrl = read('src/shared/media/signedUrl.js');
const mediaAssets = read('src/shared/media/assets.js');
const emailServer = read('email-server.cjs');
const iconSyncValidation = spawnSync(
  process.execPath,
  ['scripts/sync-android-launcher-icons.mjs', '--check'],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
const iconSyncValidationOutput = `${iconSyncValidation.stdout || ''}\n${
  iconSyncValidation.stderr || ''
}`.trim();
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
const mediaUploadTimestampMigrationPath =
  'supabase/migrations/20260719170000_preserve_media_upload_timestamps.sql';
const mediaUploadTimestampMigration = read(mediaUploadTimestampMigrationPath);
const mediaCaptureOriginMigrationPath =
  'supabase/migrations/20260719171000_preserve_media_capture_origin.sql';
const mediaCaptureOriginMigration = read(mediaCaptureOriginMigrationPath);
const trashBulkMigrationPath =
  'supabase/migrations/20260720200000_add_trash_filters_and_bulk_actions.sql';
const trashBulkMigration = read(trashBulkMigrationPath);
const trashBulkRollbackPath =
  'supabase/rollback/20260720200000_add_trash_filters_and_bulk_actions_rollback.sql';
const trashBulkRollback = read(trashBulkRollbackPath);
const trashClearMigrationPath =
  'supabase/migrations/20260720213000_add_atomic_empty_trash.sql';
const trashClearMigration = read(trashClearMigrationPath);
const trashClearRollbackPath =
  'supabase/rollback/20260720213000_add_atomic_empty_trash_rollback.sql';
const trashClearRollback = read(trashClearRollbackPath);

check(!packageJson.dependencies?.['expo-dev-client'], 'expo-dev-client must not be bundled in production dependencies');
check(packageJson.dependencies?.['expo-background-task'], 'expo-background-task is required for deferred media delivery');
check(packageJson.dependencies?.['expo-contacts'] === '~15.0.11', 'expo-contacts must match Expo SDK 54');
check(packageJson.dependencies?.expo === '~54.0.36', 'Expo must stay on the validated SDK 54 patch');
check(packageJson.dependencies?.['expo-updates'] === '~29.0.19', 'expo-updates must match the validated SDK 54 patch');
check(packageJson.dependencies?.['@react-native-community/netinfo'] === '11.4.1', 'NetInfo must match Expo SDK 54');
check(packageJson.dependencies?.['react-native-keyboard-controller'] === '1.18.5', 'Keyboard controller must match Expo SDK 54');
check(
  packageJson.devDependencies?.['@expo/image-utils'] === '0.8.8' &&
    packageJson.devDependencies?.['jimp-compact'] === '0.16.1',
  'Canonical app icon synchronization requires the validated image tooling',
);

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
check(permissions.has('android.permission.READ_CONTACTS'), 'Contact picker requires READ_CONTACTS on Android');
check(blockedPermissions.has('android.permission.WRITE_CONTACTS'), 'Contact picker must not request contact write access');

check(/RECORD_AUDIO"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove RECORD_AUDIO');
check(/READ_MEDIA_IMAGES"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove READ_MEDIA_IMAGES');
check(/READ_CONTACTS"\s*\/>/.test(manifest), 'Native manifest must include READ_CONTACTS');
check(/WRITE_CONTACTS"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove WRITE_CONTACTS');
check(/android\.enableProguardInReleaseBuilds=true/.test(gradleProperties), 'Release minification must be enabled');
check(/android\.enableShrinkResourcesInReleaseBuilds=true/.test(gradleProperties), 'Release resource shrinking must be enabled');
check(
  appJson.plugins?.some(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === 'expo-contacts' &&
      String(plugin[1]?.contactsPermission || '').trim(),
  ),
  'iOS contact picker permission description must stay configured',
);
check(
  phoneInput.includes('<ContactPhonePickerButton') &&
    phoneInput.includes('<ClearButton') &&
    phoneInput.includes("onPress={() => handleChange('')}") &&
    contactPhonePicker.includes('Contacts.presentContactPickerAsync()') &&
    contactPhonePicker.includes("Platform.OS === 'android'") &&
    contactPhonePicker.includes('Contacts.requestPermissionsAsync()') &&
    contactPhonePicker.includes('options.length === 1') &&
    contactPhonePicker.includes('<SelectModal'),
  'Phone inputs must keep contact picking, safe phone clearing, Android permission handling, and multi-number selection',
);
check(
  expandableTextRow.includes('onTextLayout={handleMeasurementTextLayout}') &&
    expandableTextRow.includes('const canExpand = hasControlledExpansion || textOverflows') &&
    expandableTextRow.includes('{canExpand ? (') &&
    expandableTextRow.includes('paddingLeft: theme.spacing.md'),
  'Expandable text rows must only expose overflow-driven chevrons and keep readable expanded indentation',
);

const versionName = gradle.match(/versionName\s*=\s*["']([^"']+)["']/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
const nativeRuntimeVersion = androidStrings.match(/name="expo_runtime_version">([^<]+)</)?.[1];
check(packageJson.version === appJson.version, 'Package version must match Expo app version');
check(versionName === appJson.version, `Native versionName (${versionName}) must match app version (${appJson.version})`);
check(
  versionCode === Number(appJson.android?.versionCode),
  `Native versionCode (${versionCode}) must match Expo Android versionCode (${appJson.android?.versionCode})`,
);
check(
  nativeRuntimeVersion === appJson.android?.runtimeVersion,
  `Native runtime version (${nativeRuntimeVersion}) must match Expo Android runtimeVersion (${appJson.android?.runtimeVersion})`,
);
check(appJson.android?.runtimeVersion === appJson.version, 'Android runtimeVersion must match app version');
check(appJson.ios?.runtimeVersion === appJson.version, 'iOS runtimeVersion must match app version');
check(Number.isInteger(versionCode) && versionCode > 0, 'Android versionCode must be a positive integer');
check(appJson.orientation === 'default', 'Android release must support user-selected orientation');
check(
  appJson.icon === './assets/icon.png' &&
    appJson.splash?.image === './assets/icon.png' &&
    appJson.web?.favicon === './assets/favicon.png' &&
    appJson.android?.adaptiveIcon?.foregroundImage ===
      './assets/branding/app-icon-android-foreground.png' &&
    appJson.android?.adaptiveIcon?.monochromeImage ===
      './assets/branding/app-mark-monochrome.png' &&
    appJson.android?.adaptiveIcon?.backgroundColor === '#68C2EE' &&
    appJson.ios?.icon === './assets/branding/app-icon-ios.png' &&
    appJson.plugins?.some(
      (plugin) =>
        Array.isArray(plugin) &&
        plugin[0] === 'expo-splash-screen' &&
        plugin[1]?.image === './assets/icon.png' &&
        plugin[1]?.dark?.image === './assets/icon.png',
    ) &&
    appJson.plugins?.some(
      (plugin) =>
        Array.isArray(plugin) &&
        plugin[0] === 'expo-notifications' &&
        plugin[1]?.icon === './assets/notifications/notification-icon.png',
    ) &&
    rootLayout.includes("source={require('../assets/icon.png')}") &&
    manifest.includes('android:icon="@mipmap/ic_launcher"') &&
    manifest.includes('android:roundIcon="@mipmap/ic_launcher_round"') &&
    manifest.includes('android:resource="@drawable/notification_icon"') &&
    androidLauncherIcon.includes('<foreground android:drawable="@mipmap/ic_launcher_foreground"') &&
    androidLauncherIcon.includes(
      '<monochrome android:drawable="@mipmap/ic_launcher_monochrome"',
    ) &&
    androidRoundLauncherIcon.includes('<foreground android:drawable="@mipmap/ic_launcher_foreground"') &&
    androidRoundLauncherIcon.includes(
      '<monochrome android:drawable="@mipmap/ic_launcher_monochrome"',
    ) &&
    androidLauncherBackground.includes('@color/iconBackground') &&
    /name="iconBackground">#68C2EE</.test(androidColors) &&
    /name="iconBackground">#68C2EE</.test(androidNightColors) &&
    iconSyncValidation.status === 0,
  `All visible app icon variants must derive from assets/icon.png; run npm run icons:sync${
    iconSyncValidationOutput ? `\n${iconSyncValidationOutput}` : ''
  }`,
);
check(appJson.android?.edgeToEdgeEnabled === true, 'Android edge-to-edge must be enabled');
check(
  !manifest.includes('android:screenOrientation=') &&
    manifest.includes('com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity') &&
    manifest.includes('tools:remove="android:screenOrientation"'),
  'Android release must remove orientation locks from app and merged code-scanner activities',
);
check(
  /(?:^|\n)expo\.edgeToEdgeEnabled=true(?:\r?\n|$)/.test(gradleProperties) &&
    /(?:^|\n)edgeToEdgeEnabled=true(?:\r?\n|$)/.test(gradleProperties),
  'Expo and React Native edge-to-edge Gradle flags must be enabled',
);
check(
  !`${androidStyles}\n${androidNightStyles}`.match(
    /windowOptOutEdgeToEdgeEnforcement|android:(?:statusBarColor|navigationBarColor|navigationBarDividerColor|windowTranslucentNavigation)/,
  ),
  'Android themes must not opt out of edge-to-edge or set deprecated system bar colors',
);
check(
  !systemBars.match(/StatusBar\.setTranslucent|NavigationBar\.set(?:Behavior|BackgroundColor)Async/) &&
    systemBars.includes('if (Number(Platform.Version) < 35)') &&
    systemBars.includes('StatusBar.setBackgroundColor(backgroundColor, false)'),
  'Legacy status-bar color updates must stay below Android 15 and track the live app theme',
);
check(
  mainActivity.includes('Build.VERSION.SDK_INT >= 35') &&
    mainActivity.includes(
      'LegacySystemBarColorCompat.setStatusBarColor(window, getColor(R.color.app_background))',
    ),
  'Pre-Android 15 devices must start with the resolved app background instead of a transparent manufacturer fallback',
);
check(
  gradle.includes('LegacySystemBarColorApiVisitorFactory') &&
    gradle.includes('InstrumentationScope.ALL') &&
    legacySystemBarCompat.includes('Build.VERSION.SDK_INT >= EDGE_TO_EDGE_ENFORCED_API') &&
    legacySystemBarVisitor.includes("'getStatusBarColor()I'") &&
    legacySystemBarVisitor.includes("'setStatusBarColor(I)V'") &&
    legacySystemBarVisitor.includes("'getNavigationBarColor()I'") &&
    legacySystemBarVisitor.includes("'setNavigationBarColor(I)V'") &&
    legacySystemBarVisitor.includes("'getNavigationBarDividerColor()I'") &&
    legacySystemBarVisitor.includes("'setNavigationBarDividerColor(I)V'"),
  'Release builds must isolate legacy system-bar color APIs from Android 15+',
);

check(externalUrls.includes('https://monitorapp.ru/data-deletion'), 'Public account deletion URL is required');
check(
  appRuntime.includes("CANONICAL_SUPABASE_URL = 'https://supabase.monitorapp.ru'") &&
    appRuntime.includes('supabaseUrl: CANONICAL_SUPABASE_URL') &&
    !appRuntime.includes("readPublicEnv('EXPO_PUBLIC_SUPABASE_URL')") &&
    !appRuntime.includes("readPublicEnv('SUPABASE_URL')"),
  'The app must use only the canonical self-hosted Supabase origin',
);
check(
  manifest.includes('android:networkSecurityConfig="@xml/network_security_config"') &&
    manifest.includes('android:usesCleartextTraffic="false"') &&
    androidNetworkSecurityConfig.includes(
      '<domain includeSubdomains="false">supabase.monitorapp.ru</domain>',
    ) &&
    androidNetworkSecurityConfig.includes('<certificates src="system"/>') &&
    androidNetworkSecurityConfig.includes('<certificates src="@raw/isrg_root_x1"/>') &&
    androidNetworkSecurityConfig.includes('cleartextTrafficPermitted="false"') &&
    isrgRootX1.fingerprint256 ===
      '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6',
  'Android must trust the official ISRG Root X1 only for the canonical Supabase domain',
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
  clientViewScreen.includes('params: { filter_client_tag: value }') &&
    objectViewScreen.includes('params: { filter_object_tag: value }') &&
    clientsIndexScreen.includes('clientTags: [routeClientTag]') &&
    clientsIndexScreen.includes('router.setParams({ filter_client_tag: undefined })') &&
    objectsIndexScreen.includes('objectTags: [routeObjectTag]') &&
    objectsIndexScreen.includes('router.setParams({ filter_object_tag: undefined })') &&
    !clientsIndexScreen.includes('params?.tag') &&
    !objectsIndexScreen.includes('params?.tag'),
  'Entity detail tag presses must seed the matching facet instead of text search',
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
  supabaseClient.includes('readPersistedAuthSession') &&
    supabaseClient.includes('lock: processLock') &&
    supabaseClient.includes("AppState.addEventListener('change'") &&
    supabaseClient.includes('supabase.auth.startAutoRefresh()') &&
    supabaseClient.includes('supabase.auth.stopAutoRefresh()') &&
    authProvider.includes("event === 'PERSISTED_SESSION'") &&
    authProvider.includes('commitInitialSession(null)') &&
    authProvider.includes('readPersistedAuthSession()') &&
    !authProvider.includes('}, 3000);'),
  'Cold auth restore must preserve encrypted sessions across transient mobile network failures',
);
check(
  offlineStatus.includes('QUALITY_REQUIRED_SLOW_SAMPLES = 3') &&
    offlineStatus.includes('QUALITY_REQUIRED_GOOD_SAMPLES = 2') &&
    offlineStatus.includes('QUALITY_CONFIRMATION_DELAY_MS') &&
    offlineStatus.includes('QUALITY_SLOW_RTT_MS') &&
    offlineStatus.includes('/auth/v1/health') &&
    offlineStatus.includes("recordNetworkQualitySample(sample: 'slow' | 'good' | 'neutral')") &&
    /:\s*probeTimedOut\s*\?\s*'slow'\s*:\s*'neutral'/.test(offlineStatus) &&
    !offlineStatus.includes('transportHintWasPoor') &&
    !offlineStatus.includes('hasPoorTransportHint') &&
    offlineStatus.includes('qualityProbeAbortController?.abort()') &&
    queryClient.includes('startNetworkQualityMonitoring') &&
    queryClient.includes('setNetworkQualityMonitoringActive(isActive)'),
  'Poor-connection banner must use confirmed backend latency with hysteresis and foreground-only probes',
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
  mapHelpers.includes('MAP_APP_PREFERENCE_KEY') &&
    mapHelpers.includes('getMapAppPreferenceState') &&
    mapHelpers.includes('openPreferredMapTarget') &&
    mapHelpers.includes("probe: Platform.OS === 'android' ? 'google.navigation:q=0,0'") &&
    mapHelpers.includes('MonitorMapApps.getInstalledMapAppsAsync()') &&
    mapHelpers.includes('MonitorMapApps.openMapAppAsync(option.packageName, option.url)') &&
    mapHelpers.includes('ANDROID_MAP_APP_ID_PATTERN') &&
    mapHelpers.includes('buildAndroidGeoUrl') &&
    mapHelpers.includes('ANDROID_MAP_APP_LABEL_KEYS') &&
    mapHelpers.includes("'com.google.android.apps.maps': 'map_app_google_maps'") &&
    mapHelpers.includes("'ru.yandex.yandexmaps': 'map_app_yandex_maps'") &&
    mapHelpers.includes("'ru.yandex.yandexnavi': 'map_app_yandex_navigator'") &&
    mapHelpers.includes("'ru.dublgis.dgismobile': 'map_app_2gis'") &&
    mapHelpers.includes('disambiguateUnknownMapAppLabels(options)') &&
    !mapHelpers.includes("'android_system_maps'") &&
    !mapHelpers.includes("'web_maps'") &&
    mapHelpers.includes('Linking.openURL(buildYandexMapsWebUrl(normalized))') &&
    mapAppsNativeModule.includes('queryIntentActivities') &&
    mapAppsNativeModule.includes('MATCH_DEFAULT_ONLY') &&
    mapAppsNativeModule.includes('loadLabel(packageManager)') &&
    mapAppsNativeModule.includes('setPackage(normalizedPackage)') &&
    mapAppsNativeBuild.includes('canBePublished false') &&
    mapAppsNativeBuild.includes('versionName "1.0.0"') &&
    mapAppsModuleConfig.android?.modules?.includes(
      'expo.modules.monitormapapps.MonitorMapAppsModule',
    ) &&
    mapQueriesPlugin.includes('withInfoPlist') &&
    mapQueriesPlugin.includes("'geo'") &&
    mapQueriesPlugin.includes("'com.google.android.apps.maps'") &&
    mapQueriesPlugin.includes("'google.navigation'") &&
    /android:scheme="yandexmaps"/.test(manifest) &&
    /android:scheme="google\.navigation"/.test(manifest) &&
    /android:scheme="geo"/.test(manifest) &&
    /android:name="com\.google\.android\.apps\.maps"/.test(manifest) &&
    appJson.ios?.infoPlist?.LSApplicationQueriesSchemes?.includes('comgooglemaps') &&
    appSettingsScreen.includes("key: 'navigation'") &&
    appSettingsScreen.includes('setPreferredMapAppId') &&
    appSettingsScreen.includes('item.label || t(item.labelKey)') &&
    appSettingsScreen.includes("t('map_app_none_installed')") &&
    objectViewScreen.includes('openAddressInPreferredMap') &&
    objectViewScreen.includes('onCollapsedPress={openNavigatorAddress}') &&
    orderDetailsScreen.includes('openAddressInPreferredMap') &&
    !fs.existsSync(path.join(root, 'components/ui/MapAppChooser.jsx')),
  'Map settings must enumerate and disambiguate named Android geo handlers while retaining a non-selectable web fallback',
);
check(
  clientPrefill.includes('PATRONYMIC_SUFFIXES') &&
    clientPrefill.includes('patronymicIndex === tokens.length - 1') &&
    clientPrefill.includes('patronymicIndex === 1'),
  'Client prefill must recognize patronymics and international middle names without dropping tokens',
);
check(
  objectAddressing.includes('buildClientObjectLocationSummary') &&
    objectAddressing.includes("getClientObjectLocationMode(objectLike) === 'map'") &&
    objectAddressing.includes('normalized.summary = buildClientObjectLocationSummary(normalized)') &&
    objectCard.includes('buildClientObjectLocationSummary(item') &&
    clientsApi.includes('geo_lat, geo_lng, location_mode') &&
    clientsApi.includes('primaryObjectSummary: buildClientObjectLocationSummary(primaryObject)') &&
    objectsIndexScreen.includes("getClientObjectLocationMode(item) === 'address'") &&
    objectMatching.includes("getClientObjectLocationMode(candidateRaw) !== 'address'"),
  'Object lists, client summaries, filters, and matching must honor the active object location mode',
);
check(
  requestApi.includes('row.object_location_mode') &&
    requestApi.includes('object_location_mode: objectLocationMode') &&
    objectLocationModeMigration.includes('co.location_mode as object_location_mode'),
  'Accessible order rows must preserve the selected object location mode instead of inferring it from coordinates',
);
check(
  requestApi.includes('export async function hydrateRequestObjectLocations') &&
    requestApi.includes(".from('client_objects_secure')") &&
    requestApi.includes('!readExplicitObjectLocationMode(row)') &&
    requestApi.includes('object_location_mode: objectItem.location_mode') &&
    requestApi.includes('await hydrateRequestObjectLocations(Array.isArray(data) ? data : [])') &&
    myOrdersScreen.includes('await hydrateRequestObjectLocations('),
  'Request lists must hydrate missing object location modes from the secure object projection before rendering addresses',
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
  !bottomNavigation.includes('onPressIn={() => preloadRouteScreen') &&
    !universalHome.includes('onPressIn={() => preloadRouteScreen') &&
    !universalHome.includes('onPressIn={item.route') &&
    bottomNavigation.includes('scheduleUiIdleTask') &&
    universalHome.includes('scheduleUiIdleTask'),
  'Route modules must preload during idle time, never inside the active press gesture',
);
check(
  universalHome.indexOf('isAdmin ? HOME_ROUTES.companySettings') <
    universalHome.indexOf('!isSoloAdmin ? HOME_ROUTES.appSettings') &&
    universalHome.includes('delayMs: index * 220'),
  'High-use home settings routes must be warmed early, with company settings first for administrators',
);
check(
  userViewScreen.includes("String(authProfile?.role || '').trim().toLowerCase() === 'admin'") &&
    userViewScreen.includes("const authUserId = String(authUser?.id || '').trim()") &&
    userViewScreen.includes('const canEdit = meIsAdmin || isOwnProfile'),
  'Employee edit permission must be available from the authenticated session before detail data refetches',
);
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
    bottomNavigationGuard.includes('const guardEntries = []') &&
    bottomNavigationGuard.includes('proceed: () => dispatch(nextIndex - 1)') &&
    filtersPanel.includes('pendingBottomNavigationRef.current = proceed') &&
    filtersPanel.includes('registerBottomNavigationGuard') &&
    createOrderScreen.includes('pendingBottomNavigationRef.current = proceed'),
  'Bottom navigation must close filter overlays and then honor every remaining data-loss guard',
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
check(
  !cachedImage.includes('__img_retry') &&
    !cachedImage.includes('fallbackUriRef') &&
    cachedImage.includes('const imageSource = useMemo(() => ({ uri: sourceUri }), [sourceUri])') &&
    cachedImage.includes('source={imageSource}') &&
    cachedImage.includes("retryAttempt > 0 ? 'none' : cachePolicy"),
  'Image retries must preserve signed URLs exactly and bypass a failed cache entry',
);
check(
  photoGrid.includes('key: buildPhotoKey(uploadedUrl || visibleUri, visibleUri') &&
    photoGrid.includes('const stableDisplayBySourceRef = useRef(new Map())') &&
    photoGrid.includes('stableDisplayBySourceRef.current.get(sourceKey)'),
  'Uploaded order photos must keep stable identities and must not be replaced by late thumbnails',
);
check(
  quickPreviewModal.includes('registerIOSModal') &&
    quickPreviewModal.includes('requestIOSModalPresentation') &&
    quickPreviewModal.includes('notifyIOSModalDismissed') &&
    quickPreviewModal.includes("visible={Platform.OS === 'ios' ? nativeVisible : true}"),
  'Quick previews opened from another modal must participate in the shared iOS modal stack',
);
check(
  !baseModal.includes('withSpring') &&
    !dialog.includes('withSpring') &&
    !quickPreviewModal.includes('withSpring') &&
    baseModal.includes('const OPEN_EASING = Easing.bezier(0.2, 0, 0, 1)'),
  'Modal open and cancelled-drag transitions must use classic non-overshooting timing curves',
);
check(
  keyboardControllerCompat.includes('SMOOTH_KEYBOARD_DISMISS_MODE') &&
    keyboardControllerCompat.includes('keyboardDismissMode,') &&
    !themeProvider.includes('onStartShouldSetResponderCapture') &&
    baseModal.includes('<KeyboardAvoidingView'),
  'Keyboard movement and dismissal must use one native animated path without responder-capture blur races',
);
check(
  orderDetailsScreen.includes('accessibilityLabel={`${t(\'order_details_phone\')}: ${orderPhoneDisplayValue}`}') &&
    orderDetailsScreen.includes('onPress={openOrderPhoneDialer}') &&
    orderDetailsScreen.includes('onLongPress={copyOrderPhone}') &&
    orderDetailsScreen.includes('onLongPress={copyOrderCoordinates}') &&
    orderDetailsScreen.includes('onValueLongPress={copyOrderAddress}') &&
    !orderDetailsScreen.includes('orderPhoneLongPressHandledRef') &&
    !orderDetailsScreen.includes('orderAddressLongPressHandledRef') &&
    !orderDetailsScreen.includes('valuePressOnly') &&
    expandableTextRow.includes('<Pressable\n        style={base.row}') &&
    expandableTextRow.includes('onLongPress={rowOnLongPress}') &&
    !expandableTextRow.includes('hitSlop={theme.components?.interactive?.hitSlop}\n        accessibilityRole'),
  'Request phone and address must use separate native press targets without cross-row hit slop',
);
check(
  (mediaUploadModal.match(/order_photos_selected_hint/g) || []).length === 1 &&
    ruTranslations.includes(
      'Выбранные фото ({count}) останутся в корзине на 30 дней.',
    ),
  'Photo selection count must appear once and bulk-delete copy must remain concise',
);
check(
  fullscreenImageViewer.includes('onDisplay={handleDisplayed}') &&
    fullscreenImageViewer.includes("t('viewer_image_load_error')") &&
    fullscreenImageViewer.includes('fallbackImages={retainedProps.fallbackImages}') &&
    fullscreenImageViewer.includes('registerIOSModal') &&
    fullscreenImageViewer.includes('onNativeDismiss={handleNativeDismiss}'),
  'Fullscreen photos must expose loading failure recovery and a network fallback',
);
check(
  !fullscreenImageViewer.includes('handleGalleryPanEnd') &&
    !fullscreenImageViewer.includes('GALLERY_SNAP_TIMING') &&
    !fullscreenImageViewer.includes('snapTimingConfig='),
  'Fullscreen photo paging must use the gallery native snap animation without remounting on pan end',
);
check(
  signedMediaUrl.includes("'x-amz-date'") &&
    signedMediaUrl.includes("'x-amz-expires'") &&
    orderDetailsScreen.includes('getFallbackUrl={orderMedia.getRemoteDisplayUrl}'),
  'Expired signed media URLs must refresh instead of being reused by order photos',
);
check(
  mediaAssets.includes('buildMediaAssetInfoMap') &&
    mediaAssets.includes('asset?.createdAt') &&
    fullscreenImageViewer.includes("t('viewer_info_captured_at')") &&
    fullscreenImageViewer.includes("t('viewer_info_uploaded_at')") &&
    orderDetailsScreen.includes('imageMetadata={viewerPhotoMetadata}'),
  'Photo info must use catalog upload dates and show capture dates only when metadata provides them',
);
check(
  fs.existsSync(path.join(root, mediaUploadTimestampMigrationPath)) &&
    mediaUploadTimestampMigration.includes('media_assets_set_upload_timestamp') &&
    mediaUploadTimestampMigration.includes("jsonb_build_object('uploaded_at', v_uploaded_at)"),
  'Media catalog resyncs must preserve the authoritative upload timestamp',
);
check(
  fs.existsSync(path.join(root, mediaCaptureOriginMigrationPath)) &&
    mediaCaptureOriginMigration.includes('media_metadata jsonb') &&
    mediaCaptureOriginMigration.includes("new.metadata || coalesce(v_media_metadata") &&
    fullscreenImageViewer.includes('handleManualImageRetry') &&
    fullscreenImageViewer.includes('infoRequestRef.current !== requestId') &&
    fullscreenImageViewer.includes('MIN_PLAUSIBLE_PHOTO_DATE_MS') &&
    fullscreenImageViewer.includes("infoOpen.origin !== 'app_camera' && infoOpen.uploadedAt") &&
    orderDetailsScreen.includes('media_origin: mediaOrigin') &&
    orderDetailsScreen.includes('captured_at: capturedAt'),
  'Photo retry controls, instant info, plausible dates, and capture origin must stay production-safe',
);
check(
  baseModal.includes('embedded = false') &&
    baseModal.includes("presentation = 'sheet'") &&
    baseModal.includes("presentation === 'sheet'") &&
    baseModal.includes("justifyContent: isSheet ? 'flex-end' : 'center'") &&
    baseModal.includes("const floatingSheet = isSheet && windowW >= 768") &&
    baseModal.includes("const sheetCornerRadius = Platform.OS === 'ios' ? 24 : 28") &&
    baseModal.includes('EmbeddedModalHostContext') &&
    baseModal.includes('registerRequestClose') &&
    baseModal.includes('registerIOSModal') &&
    baseModal.includes('requestIOSModalPresentation') &&
    baseModal.includes('notifyIOSModalDismissed') &&
    baseModal.includes('iosSuspendedRef') &&
    !baseModal.includes('FullWindowOverlay') &&
    baseModal.includes('const ModalContainer = embedded ? View : Modal') &&
    baseModal.includes('collapsable={false}') &&
    baseModal.includes("BackHandler.addEventListener('hardwareBackPress'") &&
    confirmAlertModals.includes('<BaseModal') &&
    confirmAlertModals.includes('presentation="dialog"') &&
    confirmAlertModals.includes('<ModalActionsRow') &&
    confirmAlertModals.includes('<ModalMessage') &&
    !confirmAlertModals.includes('Alert.alert(') &&
    selectModal.includes('presentation="sheet"') &&
    multiSelectModal.includes('presentation="sheet"') &&
    dateTimeModal.includes('presentation="sheet"') &&
    mediaUploadModal.includes('embedded={embedded}') &&
    mediaUploadModal.includes('presentation="sheet"') &&
    mediaUploadModal.includes('<ConfirmModal') &&
    !mediaUploadModal.includes('embeddedSheet:') &&
    fullscreenImageViewer.includes('embedded={embedded}') &&
    fullscreenImageViewer.includes('presentation="sheet"') &&
    fullscreenImageViewer.includes('<ConfirmModal') &&
    !fullscreenImageViewer.includes('embedded && !capturePreviewMode'),
  'Product modals must preserve themed adaptive dialog/sheet presentation and Android Back handling',
);
check(
  fs.existsSync(path.join(root, trashBulkMigrationPath)) &&
    fs.existsSync(path.join(root, trashBulkRollbackPath)) &&
    trashBulkMigration.includes('list_trash_items_v2') &&
    trashBulkMigration.includes('list_trash_item_ids_v2') &&
    trashBulkMigration.includes('get_trash_filter_options') &&
    trashBulkMigration.includes('restore_trash_items') &&
    trashBulkMigration.includes('purge_trash_items') &&
    trashBulkMigration.includes('Trash selection changed') &&
    trashBulkRollback.includes('drop function if exists public.purge_trash_items') &&
    trashBulkRollback.includes('drop function if exists public.list_trash_items_v2') &&
    fs.existsSync(path.join(root, trashClearMigrationPath)) &&
    fs.existsSync(path.join(root, trashClearRollbackPath)) &&
    trashClearMigration.includes('purge_all_trash_items') &&
    trashClearMigration.includes("current_user_has_trash_permission('canPurgeTrash')") &&
    trashClearMigration.includes('auth.uid() = any(t.access_user_ids)') &&
    trashClearRollback.includes('drop function if exists public.purge_all_trash_items') &&
    trashApi.includes("supabase.rpc('list_trash_items_v2'") &&
    trashApi.includes("supabase.rpc('restore_trash_items'") &&
    trashApi.includes("supabase.rpc('purge_trash_items'") &&
    trashApi.includes("supabase.rpc('purge_all_trash_items'") &&
    trashScreen.includes('delayLongPress={450}') &&
    trashScreen.includes('<SelectionToolbar') &&
    trashScreen.includes('<TrashFiltersPanel') &&
    trashScreen.includes("title: t('trash_title')") &&
    trashScreen.includes("rightTextLabel: canPurgeTrash && !selectionMode ? t('trash_clear_action')") &&
    trashScreen.includes('rightDisabled: busy || trashKnownEmpty') &&
    trashScreen.includes('onRightPress: canPurgeTrash && !selectionMode') &&
    trashScreen.includes("setConfirmation({ action: 'purgeAll' })") &&
    trashScreen.includes("setConfirmation({ action: 'purge', ids: [id]") &&
    trashFiltersPanel.includes('mode="trash"') &&
    selectionToolbar.includes('onToggleAll') &&
    selectionToolbar.includes('styles.toggleCheckbox') &&
    selectionToolbar.includes('backgroundColor: theme.colors.primary') &&
    selectionToolbar.includes('backgroundColor: theme.colors.danger') &&
    filtersPanel.includes("const isTrashMode = mode === 'trash'") &&
    filtersPanel.includes("case 'trash_entityTypes'") &&
    filtersPanel.includes("case 'trash_deletedDate'"),
  'Trash must preserve server-side filtering, atomic bulk/clear actions, long-press selection, and purge confirmation',
);
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
