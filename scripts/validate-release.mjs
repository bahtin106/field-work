import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const failures = [];
const approvedActionPins = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['denoland/setup-deno', '22d081ff2d3a40755e97629de92e3bcbfa7cf2ed'],
]);
const legacySystemBarVisitorPath =
  'android/buildSrc/src/main/groovy/com/monitorapp/buildlogic/LegacySystemBarColorApiVisitorFactory.groovy';

function check(condition, message) {
  if (!condition) failures.push(message);
}

function hasProductionUpdatesChannel(manifestSource) {
  return /<meta-data\b(?=[^>]*android:name="expo\.modules\.updates\.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY")(?=[^>]*android:value="\{&quot;expo-channel-name&quot;:&quot;production&quot;\}")[^>]*\/?\s*>/.test(
    manifestSource,
  );
}

const packageJson = json('package.json');
const appJson = json('app.json').expo;
const easIgnore = read('.easignore');
const releaseWorkflow = read('.github/workflows/release-quality.yml');
const workflowDirectory = path.join(root, '.github/workflows');
const workflowSources = fs
  .readdirSync(workflowDirectory)
  .filter((fileName) => /\.ya?ml$/i.test(fileName))
  .map((fileName) => [
    fileName,
    fs.readFileSync(path.join(workflowDirectory, fileName), 'utf8'),
  ]);
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
const legacySystemBarVisitor = read(legacySystemBarVisitorPath);
const legacySystemBarVisitorTracked = spawnSync(
  'git',
  ['ls-files', '--error-unmatch', legacySystemBarVisitorPath],
  { cwd: root, encoding: 'utf8' },
);
const mainActivity = read('android/app/src/main/java/com/monitorapp/monitor/MainActivity.kt');
const systemBars = read('lib/systemBars.js');
const notificationConfig = read('config/notifications.js');
const rootConfig = read('config/index.js');
const externalUrls = read('config/externalUrls.js');
const appRuntime = read('config/appRuntime.js');
const financeQueue = read('src/features/finance/queries.js');
const financeApi = read('src/features/finance/api.js');
const tagQueries = read('src/features/tags/queries.ts');
const tagApi = read('src/features/tags/api.ts');
const mutationAuthCarrier = read('src/shared/security/mutationAuthCarrier.ts');
const requestQueries = read('src/features/requests/queries.ts');
const executorNameCache = read('src/features/requests/executorNameCache.js');
const clientQueries = read('src/features/clients/queries.ts');
const objectQueries = read('src/features/objects/queries.ts');
const employeeQueries = read('src/features/employees/queries.ts');
const employeeApi = read('src/features/employees/api.ts');
const queryKeysSource = read('src/shared/query/queryKeys.ts');
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
const accountDeletionScreen = read('screens/app_settings/AccountDeletionScreen.jsx');
const pushAutoSetup = read('lib/pushAutoSetup.js');
const pushWorkerTick = read('scripts/push-worker-tick.sh');
const pushWorkerBurst = read('scripts/push-worker-burst.sh');
const pushWorkerRunbook = read('docs/push-worker-runbook.md');
const adminHomeScreen = read('app/admin/index.jsx');
const adminFeedbackDetailsScreen = read('app/admin/feedbacks/[id]/index.jsx');
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
const orderActivityTimeline = read('components/orders/OrderActivityTimeline.jsx');
const billingScreen = read('screens/billing/BillingScreen.jsx');
const userViewScreen = read('screens/users/[id]/UserViewScreen.jsx');
const userEditScreen = read('screens/users/[id]/UserEditScreen.jsx');
const adminUsersScreen = read('app/admin/users/index.jsx');
const adminUserViewRoute = read('app/admin/users/[id]/index.jsx');
const adminUserEditRoute = read('app/admin/users/[id]/edit.jsx');
const adminCompanyDetailsScreen = read('app/admin/companies/details.jsx');
const adminCompanyEditScreen = read('app/admin/companies/edit.jsx');
const companyAccessStateHook = read('hooks/useCompanyAccessState.js');
const bottomNavigationGuard = read('src/shared/navigation/bottomNavigationGuard.js');
const textField = read('components/ui/TextField.jsx');
const phoneInput = read('components/ui/PhoneInput.jsx');
const contactPhonePicker = read('components/ui/ContactPhonePickerButton.jsx');
const expandableTextRow = read('components/ui/ExpandableTextRow.jsx');
const inputLimits = read('src/shared/input/limits.js');
const requestSearch = read('src/features/requests/search.js');
const requestApi = read('src/features/requests/api.ts');
const supportRequestsApi = read('src/features/supportRequests/api.js');
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
const authLogin = read('hooks/useAuthLogin.js');
const authSessionCleanup = read('lib/authSessionCleanup.js');
const supabaseSessionCache = read('lib/supabaseSessionCache.js');
const supabaseClient = read('lib/supabase.js');
const offlineStatus = read('src/shared/offline/offlineStatus.ts');
const ownerBoundAuthorization = read('src/shared/security/ownerBoundAuthorization.ts');
const offlineSync = read('src/shared/offline/useOfflineSync.ts');
const backgroundSync = read('src/shared/offline/backgroundSync.js');
const backgroundSyncOutcome = read('src/shared/offline/backgroundSyncOutcome.mjs');
const queryProvider = read('src/shared/query/QueryProvider.tsx');
const queryClient = read('src/shared/query/queryClient.ts');
const prefetchRegistry = read('src/shared/query/prefetchRegistry.js');
const routeFreshnessBoundary = read('src/shared/query/RouteFreshnessBoundary.tsx');
const readDeadline = read('src/shared/network/readDeadline.ts');
const imageSizeSecurityPatch = read('patches/image-size+1.2.1.patch');
const authFlowState = read('lib/authFlowNavigationState.js');
const accessSnapshot = read('lib/accessSnapshot.js');
const permissionsProvider = read('lib/permissions.js');
const workTypes = read('lib/workTypes.js');
const rootLayout = read('app/_layout.js');
const rootErrorBoundary = read('components/feedback/ErrorBoundary.jsx');
const photoQueue = read('src/shared/media/orderPhotoQueue.js');
const orderMediaHook = read('hooks/useOrderMedia.js');
const mediaStorageAction = read('lib/mediaStorageAction.js');
const orderMediaStorage = read('lib/orderMediaStorage.js');
const yandexDiskIntegration = read('lib/yandexDiskIntegration.js');
const financeEntryMediaHook = read('hooks/useFinanceEntryMedia.js');
const cachedImage = read('components/ui/CachedImage.jsx');
const photoGrid = read('app/orders/components/PhotoGrid.jsx');
const orderPhotoRow = read('app/orders/components/OrderPhotoRow.jsx');
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
const accountDeletionMigrationPath =
  'supabase/migrations/20260821220000_add_account_deletion_requests.sql';
const accountDeletionRollbackPath =
  'supabase/rollback/20260821220000_add_account_deletion_requests_rollback.sql';
const accountDeletionMigration = read(accountDeletionMigrationPath);
const accountDeletionRollback = read(accountDeletionRollbackPath);
const adminDeleteCompanyFunction = read('supabase/functions/admin-delete-company/index.ts');
const pushSendFunction = read('supabase/functions/push-send/index.ts');

const easIgnorePatterns = new Set(
  easIgnore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);
for (const pattern of [
  '.git/',
  'node_modules/',
  '.env',
  '.env.*',
  '.eas/',
  '.easlrc',
  '*.jks',
  'credentials.json',
  '*.agekey',
  'supabase/.temp/',
  'backup-secrets/',
  '.codex-temp/',
  'releases/',
  'dist-ci-*/',
  'android/app/.cxx/',
  'android/buildSrc/.gradle/',
  'modules/monitor-map-apps/android/build/',
]) {
  check(easIgnorePatterns.has(pattern), `EAS archive must exclude ${pattern}`);
}

for (const [fileName, workflowSource] of workflowSources) {
  for (const match of workflowSource.matchAll(
    /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?/gm,
  )) {
    const actionReference = match[1];
    if (actionReference.startsWith('./') || actionReference.startsWith('docker://')) continue;
    check(
      /^[^@\s]+@[0-9a-f]{40}$/.test(actionReference),
      `${fileName} must pin ${actionReference} to an immutable 40-character commit SHA`,
    );

    const separatorIndex = actionReference.lastIndexOf('@');
    const actionName = actionReference.slice(0, separatorIndex);
    const actionSha = actionReference.slice(separatorIndex + 1);
    const approvedSha = approvedActionPins.get(actionName);
    if (approvedSha) {
      check(
        actionSha === approvedSha,
        `${fileName} must use the reviewed ${actionName}@${approvedSha} pin`,
      );
    }
  }

  for (const match of workflowSource.matchAll(
    /^\s*node-version:\s*['"]?([^'"\s#]+)['"]?/gm,
  )) {
    check(match[1] === '24', `${fileName} must use the maintained Node.js 24 release line`);
  }
}

check(
  [...approvedActionPins].every(([actionName, actionSha]) =>
    releaseWorkflow.includes(`${actionName}@${actionSha}`),
  ) &&
    releaseWorkflow.includes('deno-version: v2.9.5') &&
    releaseWorkflow.includes('deno check --node-modules-dir=none') &&
    releaseWorkflow.includes('./gradlew :app:bundleRelease --no-daemon'),
  'Release CI must pin third-party actions and compile both Edge and Android native sources',
);

check(
  rootErrorBoundary.includes('OTA_RECOVERY_WINDOW_MS = 10_000') &&
    rootErrorBoundary.includes('Updates.isEmbeddedLaunch === false') &&
    rootErrorBoundary.includes('throw error;'),
  'The root error boundary must delegate early downloaded-update failures to expo-updates rollback',
);

check(!packageJson.dependencies?.['expo-dev-client'], 'expo-dev-client must not be bundled in production dependencies');
check(packageJson.dependencies?.['expo-background-task'], 'expo-background-task is required for deferred media delivery');
check(packageJson.dependencies?.['expo-contacts'] === '~15.0.11', 'expo-contacts must match Expo SDK 54');
check(packageJson.dependencies?.expo === '~54.0.37', 'Expo must stay on the validated SDK 54 patch');
check(packageJson.dependencies?.['expo-constants'] === '~18.0.14', 'expo-constants must match the validated SDK 54 patch');
check(packageJson.dependencies?.['expo-file-system'] === '~19.0.24', 'expo-file-system must match the validated SDK 54 patch');
check(packageJson.dependencies?.['expo-updates'] === '~29.0.20', 'expo-updates must match the validated SDK 54 patch');
check(packageJson.dependencies?.['@react-native-community/netinfo'] === '11.4.1', 'NetInfo must match Expo SDK 54');
check(packageJson.dependencies?.['react-native-keyboard-controller'] === '1.18.5', 'Keyboard controller must match Expo SDK 54');
check(packageJson.devDependencies?.pngjs === '3.4.0', 'Icon tooling must declare its direct pngjs dependency');
check(
  packageJson.devDependencies?.['expo-doctor'] === '1.20.2' &&
    packageJson.scripts?.doctor === 'expo-doctor',
  'Release diagnostics must use the locked expo-doctor dependency',
);
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
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
]) {
  check(!permissions.has(permission), `${permission} must not be requested in app config`);
  check(blockedPermissions.has(permission), `${permission} must be blocked against transitive manifests`);
}
check(permissions.has('android.permission.READ_CONTACTS'), 'Contact picker requires READ_CONTACTS on Android');
check(blockedPermissions.has('android.permission.WRITE_CONTACTS'), 'Contact picker must not request contact write access');

check(/RECORD_AUDIO"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove RECORD_AUDIO');
for (const permission of [
  'READ_MEDIA_IMAGES',
  'READ_MEDIA_VIDEO',
  'READ_MEDIA_AUDIO',
  'READ_MEDIA_VISUAL_USER_SELECTED',
]) {
  check(
    new RegExp(`${permission}"\\s+tools:node="remove"`).test(manifest),
    `Native manifest must remove ${permission}`,
  );
}
check(/READ_CONTACTS"\s*\/>/.test(manifest), 'Native manifest must include READ_CONTACTS');
check(/WRITE_CONTACTS"\s+tools:node="remove"/.test(manifest), 'Native manifest must remove WRITE_CONTACTS');
check(
  /WRITE_EXTERNAL_STORAGE"\s+android:maxSdkVersion="28"\s+tools:replace="android:maxSdkVersion"/.test(
    manifest,
  ),
  'Legacy gallery writes must limit WRITE_EXTERNAL_STORAGE to Android 9 and older',
);
check(/android\.enableProguardInReleaseBuilds=true/.test(gradleProperties), 'Release minification must be enabled');
check(/android\.enableShrinkResourcesInReleaseBuilds=true/.test(gradleProperties), 'Release resource shrinking must be enabled');
check(
  appJson.plugins?.some(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === 'expo-contacts' &&
      plugin[1]?.contactsPermission === false,
  ),
  'The permission-free iOS contact picker must explicitly remove full Contacts access',
);
check(
  phoneInput.includes('<ContactPhonePickerButton') &&
    phoneInput.includes('<ClearButton') &&
    phoneInput.includes("onPress={() => handleChange('')}") &&
    contactPhonePicker.includes('Contacts.presentContactPickerAsync()') &&
    contactPhonePicker.includes("Platform.OS === 'android'") &&
    contactPhonePicker.includes('Contacts.requestPermissionsAsync()') &&
    contactPhonePicker.includes("Platform.OS === 'android' &&") &&
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
const nativeRuntimeVersion = androidStrings.match(
  /name="expo_runtime_version"[^>]*>([^<]+)</,
)?.[1];
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
check(
  /name="expo_runtime_version"\s+translatable="false">/.test(androidStrings),
  'Android runtime version resource must not be changed by Play app-string translation',
);
check(
  hasProductionUpdatesChannel(manifest),
  'Native Android release must be pinned to the production EAS Update channel',
);
check(
  /^[1-9]\d*$/.test(String(appJson.ios?.buildNumber || '')),
  'iOS buildNumber must be an explicit positive integer and increase for every upload',
);
check(
  appJson.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false &&
    appJson.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking === true,
  'iOS App Transport Security must reject arbitrary remote cleartext traffic',
);
check(
  appJson.ios?.config?.usesNonExemptEncryption === false,
  'iOS export-compliance declaration must match the validated HTTPS/platform-crypto usage',
);
check(
  appJson.ios?.privacyManifests?.NSPrivacyTracking === false &&
    Array.isArray(appJson.ios?.privacyManifests?.NSPrivacyAccessedAPITypes) &&
    appJson.ios.privacyManifests.NSPrivacyAccessedAPITypes.length >= 4,
  'iOS privacy manifest must declare the validated required-reason APIs',
);
const expectedCollectedDataTypes = [
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypePhoneNumber',
  'NSPrivacyCollectedDataTypePhysicalAddress',
  'NSPrivacyCollectedDataTypeOtherUserContactInfo',
  'NSPrivacyCollectedDataTypeOtherFinancialInfo',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeCustomerSupport',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypePurchaseHistory',
  'NSPrivacyCollectedDataTypeProductInteraction',
  'NSPrivacyCollectedDataTypeCrashData',
  'NSPrivacyCollectedDataTypeOtherDiagnosticData',
  'NSPrivacyCollectedDataTypeOtherDataTypes',
];
const collectedDataTypes = appJson.ios?.privacyManifests?.NSPrivacyCollectedDataTypes || [];
check(
  collectedDataTypes.length === expectedCollectedDataTypes.length &&
    expectedCollectedDataTypes.every((dataType) =>
      collectedDataTypes.some((entry) => entry.NSPrivacyCollectedDataType === dataType),
    ) &&
    collectedDataTypes.every(
      (entry) =>
        entry.NSPrivacyCollectedDataTypeLinked === true &&
        entry.NSPrivacyCollectedDataTypeTracking === false &&
        entry.NSPrivacyCollectedDataTypePurposes?.length === 1 &&
        entry.NSPrivacyCollectedDataTypePurposes[0] ===
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
    ),
  'iOS collected-data manifest must match the audited linked, non-tracking App Store privacy inventory',
);
check(
  fs.existsSync(path.join(root, accountDeletionMigrationPath)) &&
    fs.existsSync(path.join(root, accountDeletionRollbackPath)) &&
    accountDeletionMigration.includes('create table if not exists public.account_deletion_requests') &&
    accountDeletionMigration.includes('create or replace function public.request_account_deletion()') &&
    accountDeletionMigration.includes('create or replace function public.transition_account_deletion_request(') &&
    accountDeletionMigration.includes('security definer') &&
    accountDeletionMigration.includes('for update') &&
    accountDeletionMigration.includes('confirmation_sent_at') &&
    accountDeletionMigration.includes("requested_email = case when p_next_status = 'completed' then null") &&
    accountDeletionMigration.includes("user_id = case when p_next_status = 'completed' then null") &&
    accountDeletionMigration.includes("company_id = case when p_next_status = 'completed' then null") &&
    accountDeletionMigration.includes("and (p_next_status <> 'completed' or r.user_id is null)") &&
    accountDeletionMigration.includes('set user_id = null,') &&
    accountDeletionMigration.includes('company_id = null,') &&
    accountDeletionMigration.includes('ACCOUNT_DELETION_FEEDBACK_PII_NOT_CLEARED') &&
    accountDeletionMigration.includes('create or replace function public.account_deletion_requests_preserve_active_delete()') &&
    accountDeletionMigration.includes("if old.status in ('pending', 'processing')") &&
    accountDeletionMigration.includes('revoke all on table public.account_deletion_requests from service_role') &&
    accountDeletionMigration.includes('grant select on table public.account_deletion_requests to authenticated, service_role') &&
    accountDeletionMigration.includes('alter table public.account_deletion_requests enable row level security') &&
    accountDeletionMigration.includes('grant execute on function public.request_account_deletion() to authenticated') &&
    accountDeletionRollback.includes('ACCOUNT_DELETION_ROLLBACK_REFUSED') &&
    accountDeletionRollback.includes('drop function if exists public.transition_account_deletion_request') &&
    accountDeletionRollback.includes('drop function if exists public.request_account_deletion()') &&
    accountDeletionRollback.includes('drop function if exists public.account_deletion_requests_preserve_active_delete()') &&
    accountDeletionScreen.includes("supabase.rpc('request_account_deletion')") &&
    accountDeletionScreen.includes(".from('account_deletion_requests')") &&
    (adminDeleteCompanyFunction.match(/c\.table_name <> 'account_deletion_requests'/g) || []).length === 2 &&
    !accountDeletionScreen.includes('createSupportRequest'),
  'Account deletion must use the dedicated authenticated, RLS-protected request workflow with rollback',
);
check(
  backgroundSync.includes('didBackgroundSyncComplete(results)') &&
    backgroundSyncOutcome.includes('Number(photos.failed || 0) === 0') &&
    backgroundSyncOutcome.includes('Number(photos.pending || 0) === 0') &&
    photoQueue.includes('pending: await countPending()') &&
    backgroundSyncOutcome.includes('Number(finance.pending || 0) === 0') &&
    backgroundSyncOutcome.includes('Number(generic.pending || 0) === 0'),
  'Background task result must reflect retryable photo, finance, and generic outbox work',
);
check(
  /if \(isInitializing \|\| !isAuthenticated \|\| !user\?\.id\) return undefined;\s+let active = true;\s+let running = false;/.test(
    rootLayout,
  ) &&
    rootLayout.includes('if (isInitializing || isAuthenticated) return;') &&
    rootLayout.includes('unregisterOfflineBackgroundSync().catch(() => {})') &&
    rootLayout.includes('}, [isAuthenticated, isInitializing]);'),
  'Offline background work must register/unregister only after settled auth state',
);
check(
  rootLayout.includes('<ErrorBoundary>') &&
    rootErrorBoundary.includes("from 'react-native'") &&
    rootErrorBoundary.includes('logClientError(error') &&
    rootErrorBoundary.includes('Updates.reloadAsync()') &&
    !rootErrorBoundary.includes('<div'),
  'The native root must provide a production-safe crash recovery boundary',
);
check(
  !pushAutoSetup.includes('AndroidNotificationVisibility.PUBLIC') &&
    !appSettingsScreen.includes('AndroidNotificationVisibility.PUBLIC') &&
    pushAutoSetup.includes('AndroidNotificationVisibility.PRIVATE') &&
    notificationConfig.includes("'app-notify-private-v2'") &&
    rootConfig.includes("ANDROID_CHANNEL_ID: 'app-notify-private-v2'") &&
    manifest.includes(
      'com.google.firebase.messaging.default_notification_channel_id" android:value="app-notify-private-v2"',
    ) &&
    appJson.plugins?.some(
      (plugin) =>
        Array.isArray(plugin) &&
        plugin[0] === 'expo-notifications' &&
        plugin[1]?.defaultChannel === 'app-notify-private-v2',
    ) &&
    pushSendFunction.includes("'app-notify-private-v2'") &&
    /await ensureAndroidNotificationChannel\(Notifications\);[\s\S]{0,160}const \{ status: existing \} = await Notifications\.getPermissionsAsync\(\);/.test(
      pushAutoSetup,
    ),
  'Sensitive notifications must migrate to the versioned PRIVATE channel before Android permission requests',
);
check(
  pushWorkerTick.includes(': "${PUSH_WORKER_KEY:?PUSH_WORKER_KEY is required}"') &&
    pushWorkerTick.includes("stat -c '%a %U:%G'") &&
    pushWorkerTick.includes('curl --fail --silent --show-error --config -') &&
    pushWorkerTick.includes('must use HTTPS unless it targets the local loopback interface') &&
    !pushWorkerTick.includes('-H "x-worker-key: ${PUSH_WORKER_KEY}"') &&
    pushWorkerBurst.includes(': "${PUSH_WORKER_KEY:?PUSH_WORKER_KEY is required}"') &&
    pushWorkerBurst.includes('timeout --signal=TERM') &&
    pushWorkerBurst.includes('bash /root/push-worker-tick.sh') &&
    pushWorkerBurst.includes("logger -t monitorapp-push-worker 'push catch-up tick failed'") &&
    pushWorkerRunbook.includes('install -o root -g root -m 0700') &&
    pushWorkerRunbook.includes('owned by `root:root` with mode') &&
    pushWorkerRunbook.includes('## Atomic key rotation'),
  'Push worker source must fail closed, protect its secret, and retry through the bounded fallback',
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
    gradle.includes('com.monitorapp.buildlogic.LegacySystemBarColorApiVisitorFactory') &&
    legacySystemBarVisitorTracked.status === 0 &&
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
  financeQueue.includes('return onlineManager.isOnline() && canRunOutboxSync(snapshot)'),
  'Unknown, offline, and EDGE finance writes must use the durable outbox without blocking the UI',
);
check(
  mutationAuthCarrier.includes('export function assertMutationPayloadCompany') &&
    mutationAuthCarrier.includes("'MUTATION_COMPANY_SCOPE_REQUIRED'") &&
    mutationAuthCarrier.includes("'MUTATION_COMPANY_SCOPE_MISMATCH'") &&
    mutationAuthCarrier.includes('payloadCompanyId !== queryCompanyId') &&
    mutationAuthCarrier.includes('payloadCompanyId !== offlineCompanyId') &&
    mutationAuthCarrier.includes('enumerable: false') &&
    mutationAuthCarrier.includes("request.setHeader('Authorization', activeCarrier.authorization)"),
  'Mutation authorization must remain non-serializable and fail closed across user/company owner epochs',
);
check(
  financeQueue.includes('async function beginSecuredFinanceMutation') &&
    financeQueue.includes('clearMutationAuthCarrier(payload)') &&
    financeQueue.includes('companyId: item.ownerCompanyId') &&
    financeQueue.includes('requireMutationAuthCarrier(payload, { requireOfflineOwner: true })') &&
    financeQueue.includes('assertMutationPayloadCompany(authCarrier, payload?.company_id)') &&
    financeApi.includes('export async function deleteOrderFinanceEntry(') &&
    financeApi.includes(".eq('company_id', scopedCompanyId)") &&
    financeApi.includes("supabase.rpc('set_order_finance_money_holder_v2'") &&
    financeApi.includes("supabase.rpc('set_order_finance_scheme_disabled_v2'") &&
    financeApi.includes("supabase.rpc('delete_company_finance_rule'") &&
    financeApi.includes("supabase.rpc('upsert_company_finance_scheme_v2'") &&
    financeApi.includes("supabase.rpc('archive_company_finance_scheme_v2'") &&
    financeApi.includes("supabase.rpc('set_company_finance_scheme_enabled_v2'") &&
    (financeApi.match(/pinMutationAuthorization\(/g) || []).length >= 12,
  'Every finance write path, including background deletes, must pin auth and preserve company scope',
);
check(
  ['createCompanyTag', 'deleteAllCompanyTags', 'updateCompanyTagSettings'].every(
    (name) => tagApi.includes(`export async function ${name}`),
  ) &&
    (tagApi.match(/assertMutationPayloadCompany\(authCarrier, companyId\)/g) || []).length >= 3 &&
    (tagQueries.match(/assertMutationPayloadCompany\(authCarrier, variables\?\.companyId\)/g) || [])
      .length >= 3,
  'Company tag creation, bulk deletion, and settings writes must reject stale or cross-company payloads',
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
  queryProvider.indexOf('configureQueryEnvironment();') >= 0 &&
    queryProvider.indexOf('configureQueryEnvironment();') <
      queryProvider.indexOf('export function QueryProvider') &&
    queryClient.includes('PERSIST_RESTORE_TIMEOUT_MS = 1_800') &&
    queryClient.includes("const timedOut = Symbol('persist-restore-timeout')") &&
    queryClient.includes('if (result === timedOut)') &&
    authProvider.includes('useIsRestoring()') &&
    authProvider.includes('queryCacheBootstrapReady') &&
    authProvider.includes('LOCAL_SESSION_READ_WAIT_MS = 1500') &&
    authProvider.includes('PROFILE_UI_WAIT_TIMEOUT_MS = 4000') &&
    authFlowState.includes('PUBLIC_AUTH_ROUTE_HYDRATION_TIMEOUT_MS = 1200') &&
    authFlowState.includes('hydrationPromise = Promise.race([') &&
    rootLayout.includes('NATIVE_SPLASH_WATCHDOG_MS = 2500') &&
    accessSnapshot.includes('LOCAL_READ_WATCHDOG_MS = 1200') &&
    accessSnapshot.includes('options.onLateValue?.(lateValue)'),
  'Cold startup, splash, auth hydration, and local access snapshots must all remain bounded',
);
check(
  readDeadline.includes('DEGRADED_READ_DEADLINE_MS = 6_000') &&
    readDeadline.includes('const upstreamSignal = options.signal') &&
    readDeadline.includes('controller.abort(reason)') &&
    readDeadline.includes('(controller.signal)') &&
    readDeadline.includes("error.code = 'READ_DEADLINE_EXCEEDED'"),
  'Foreground remote reads must retain a constrained-link deadline and composed cancellation',
);
check(
  offlineStatus.includes('QUALITY_REQUIRED_SLOW_SAMPLES = 2') &&
    offlineStatus.includes('QUALITY_REQUIRED_GOOD_SAMPLES = 2') &&
    offlineStatus.includes('QUALITY_CONFIRMATION_DELAY_MS') &&
    offlineStatus.includes('QUALITY_SLOW_RTT_MS') &&
    offlineStatus.includes('/auth/v1/health') &&
    offlineStatus.includes("recordNetworkQualitySample(sample: 'slow' | 'good' | 'neutral')") &&
    /:\s*probeTimedOut\s*\?\s*'slow'\s*:\s*'neutral'/.test(offlineStatus) &&
    !offlineStatus.includes('transportHintWasPoor') &&
    !offlineStatus.includes('hasPoorTransportHint') &&
    offlineStatus.includes('isConstrainedCellularState') &&
    offlineStatus.includes('qualityProbeAbortController?.abort()') &&
    queryClient.includes('startNetworkQualityMonitoring') &&
    queryClient.includes('setNetworkQualityMonitoringActive(isActive)'),
  'Poor-connection handling must combine immediate 2G constraints with latency hysteresis and foreground-only probes',
);
check(
  queryClient.includes('QUERY_CACHE_ENVELOPE_SCHEMA = 1') &&
    queryClient.includes('readPersistedAuthSession()') &&
    queryClient.includes('query-cache-owner-changed-before-write') &&
    queryClient.includes('query-cache-company-owner-required') &&
    queryClient.includes('persistedClientContainsCompanyScopedData') &&
    authProvider.includes('hasQueryCacheOwnerScopeChanged') &&
    authProvider.includes('hasAuthMetadataCompanyScopeChanged') &&
    authProvider.includes("const safeRole = 'worker'") &&
    authProvider.includes('Boolean(previousRole || nextRole) && previousRole !== nextRole') &&
    authProvider.includes('scheduleProfileRecovery(user);') &&
    authProvider.includes("cleanupSessionRuntime('auth-metadata-company-changed')") &&
    authProvider.includes('const authEventGeneration = ++authEventGenerationRef.current') &&
    authProvider.includes('authEventGeneration !== authEventGenerationRef.current') &&
    authProvider.includes('profile: bootstrapProfile || (metadataScopeChanged ? null : prev.profile) || null') &&
    authSessionCleanup.includes('clearActiveQueryCacheOwner()'),
  'Persisted query data must be owner-enveloped and rejected before hydration across account/company changes',
);
check(
  offlineStatus.includes('export function getActiveOfflineOwnerContext') &&
    offlineStatus.includes('export function isActiveOfflineOwnerContext') &&
    offlineStatus.includes('if (!owner.companyId) return false;') &&
    offlineStatus.includes('itemCompanyId === owner.companyId') &&
    offlineStatus.includes("error.code = 'OFFLINE_OWNER_CHANGED'") &&
    offlineStatus.includes('Offline request conflict check') &&
    authSessionCleanup.includes('clearActiveOfflineOwner()') &&
    financeQueue.includes('requireFinanceOwnerContext') &&
    financeQueue.includes('assertFinanceOwnerContext(ownerContext)') &&
    photoQueue.includes('requireOwnerContext') &&
    photoQueue.includes('assertPhotoOwnerContext(ownerContext)'),
  'Every durable outbox must be exact user/company scoped, epoch guarded, and bound its conflict reads',
);
check(
  supabaseSessionCache.includes('cachedAccessTokenUserId') &&
    supabaseSessionCache.includes('tokenCacheGeneration') &&
    supabaseSessionCache.includes('supabase.auth.onAuthStateChange') &&
    supabaseSessionCache.includes('generationAtStart !== tokenCacheGeneration') &&
    supabaseSessionCache.includes('accessTokenPromise?.promise === promise') &&
    authSessionCleanup.includes('clearCachedSupabaseAccessToken()') &&
    ownerBoundAuthorization.includes('new WeakMap<object, string>()') &&
    ownerBoundAuthorization.includes('Object.freeze({ userId })') &&
    ownerBoundAuthorization.includes('pinOwnerBoundPostgrestRequest'),
  'Supabase JWT reuse must be owner-bound, generation guarded, non-serializable, and cleared on every auth transition',
);
check(
  offlineStatus.includes('captureOwnerBoundAuthorization(owner.userId)') &&
    offlineStatus.includes('pinOwnerBoundPostgrestRequest') &&
    offlineStatus.includes('getClientByIdForOfflineSync') &&
    offlineStatus.includes('getClientObjectByIdForOfflineSync') &&
    offlineStatus.includes('getEmployeeByIdForOfflineSync') &&
    photoQueue.includes('captureOwnerBoundAuthorization(owner.userId)') &&
    photoQueue.includes('{ authCarrier }') &&
    mediaStorageAction.includes('buildOwnerBoundFunctionHeaders') &&
    orderMediaStorage.includes('options') &&
    yandexDiskIntegration.includes('const maxAttempts = authCarrier ? 1 : 2'),
  'Generic and photo outbox runs must pin one owner-bound Authorization through all network transports',
);
check(
    executorNameCache.includes('generation: 0') &&
    executorNameCache.includes('throwIfExecutorCacheGenerationChanged') &&
    executorNameCache.includes('expectedGeneration') &&
    executorNameCache.includes('EXECUTOR_NAME_BATCH_STATE.controller?.abort()'),
  'Late executor-name hydration and batch responses must not repopulate cache after owner cleanup',
);
check(
  offlineStatus.includes('export function canRunDeferredNetworkWork') &&
    offlineStatus.includes('export function canRunOutboxSync') &&
    offlineStatus.includes('if (!canRunOutboxSync()) break;') &&
    financeQueue.includes('return onlineManager.isOnline() && canRunOutboxSync(snapshot)') &&
    financeQueue.includes('if (!canRunOutboxSync()) break;') &&
    photoQueue.includes('if (!canRunOutboxSync()) {') &&
    photoQueue.includes('pending: await countPending()') &&
    photoQueue.includes('if (!canRunOutboxSync()) break;') &&
    backgroundSync.includes('if (!canRunOutboxSync()) return true;') &&
    orderDetailsScreen.includes('const canRunDeferredSync = canRunOutboxSync(offlineSnapshot)') &&
    offlineSync.includes('wasSyncableRef') &&
    offlineSync.includes('becameSyncable') &&
    authLogin.includes('LOGIN_UI_WATCHDOG_MS') &&
    authLogin.includes("code: 'AUTH_UI_TIMEOUT'"),
  'EDGE mode must pause outbox traffic, resume on poor-to-good recovery, and never leave login loading forever',
);
check(
  offlineStatus.includes('const syncInFlightByOwner = new Map') &&
    offlineStatus.includes('const syncRerunRequestedByOwner = new Set') &&
    offlineStatus.includes('const syncRetryTimersByOwner = new Map') &&
    offlineStatus.includes('getOfflineOwnerRunKey(activeContext)') &&
    prefetchRegistry.includes('canRunDeferredNetworkWork') &&
    prefetchRegistry.includes("error.code = 'PREFETCH_NETWORK_PAUSED'") &&
    routeFreshnessBoundary.includes(
      'if (!network.isNetworkKnown || !network.isOnline || network.isPoorConnection) return;',
    ),
  'Reconnect sync and prefetch work must be owner-isolated, deduplicated, and quality-gated',
);
check(
  allOrdersScreen.includes('isSuccess: requestsSuccess') &&
    allOrdersScreen.includes('isPlaceholderData: requestsPlaceholder') &&
    allOrdersScreen.includes('const canApplyRequestItems =') &&
    allOrdersScreen.includes(
      '!requestsPlaceholder && (requestItems.length > 0 || requestsSuccess)',
    ) &&
    allOrdersScreen.includes(
      'requestsLoading && requestItems.length === 0 && orders.length === 0',
    ),
  'All-orders must retain a visible persisted snapshot until its exact query returns an authoritative result',
);
check(
  myOrdersScreen.includes("if (context?.reason === 'network-recovered') return undefined;") &&
    myOrdersScreen.includes('const shouldUseCacheOnly =') &&
    myOrdersScreen.includes('network.isPoorConnection'),
  'My-orders network recovery must use its single cache-preserving loader instead of clearing cache and fetching twice',
);
check(
  createOrderScreen.includes('useMyCompanyIdQuery()') &&
    createOrderScreen.includes('useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER') &&
    createOrderScreen.includes('useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT') &&
    createOrderScreen.includes('fetchWorkTypes(cid, {') &&
    createOrderScreen.includes('deferNetworkWhenConstrained: true') &&
    createOrderScreen.includes('WORK_TYPES_NETWORK_DEFERRED_CODE') &&
    createOrderScreen.includes('[canRefreshWorkTypes, companyId, companySettings?.use_work_types, profile?.company_id]') &&
    queryClient.includes("key0 === 'company-order-statuses'") &&
    queryClient.includes("key0 === 'clients' || key0 === 'objects' || key0 === 'tags' || key0 === 'field-settings'") &&
    workTypes.includes("WORK_TYPES_STORAGE_PREFIX = 'workTypes.cache.v2:'") &&
    workTypes.includes('readWorkTypesDiskCache(cacheKey)') &&
    workTypes.includes('WORK_TYPES_DISK_CACHE_MAX_AGE_MS') &&
    workTypes.includes("WORK_TYPES_NETWORK_DEFERRED_CODE = 'WORK_TYPES_NETWORK_DEFERRED'") &&
    workTypes.includes('options?.deferNetworkWhenConstrained && !canRunDeferredNetworkWork()') &&
    workTypes.includes('if (!network.isOnline || network.isPoorConnection) return;') &&
    permissionsProvider.includes('readPermissionsSnapshot(requestedUserId') &&
    permissionsProvider.includes('onLateValue: (lateSnapshot)') &&
    permissionsProvider.includes('setLoading(false)'),
  'Create-order permissions and reference data must retain owner-scoped, durable cache-first bootstrap paths',
);
check(
  requestQueries.includes('findRequestPageInCachedSuperset') &&
    clientQueries.includes('findClientsInCachedSuperset') &&
    objectQueries.includes('findClientObjectsInCachedCompanySuperset') &&
    employeeQueries.includes('findEmployeesInCachedSuperset') &&
    employeeQueries.includes('findDepartmentsInCachedSuperset') &&
    [requestQueries, clientQueries, objectQueries, employeeQueries].every(
      (source) => source.includes('if (derived) return derived;') && source.includes('throw error;'),
    ),
  'Offline list reads must prefer exact/same-scope cached supersets and preserve errors instead of caching false empty success',
);
check(
  [requestQueries, clientQueries, objectQueries, employeeQueries].every(
    (source) =>
      source.includes('onlineManager.isOnline() && canRunOutboxSync()') &&
      !source.includes('onlineManager.isOnline() && getOfflineSnapshot().isOnline'),
  ) &&
    trashApi.includes('if (!canRunOutboxSync())') &&
    orderDetailsScreen.includes('const canAttemptForegroundMedia = canRunOutboxSync(getOfflineSnapshot())'),
  'Queue-capable entity writes, trash restore, and foreground media must route unknown/EDGE traffic to durable pending state',
);
check(
  orderMediaHook.includes('const canUseMediaNetwork = canRunDeferredNetworkWork(offlineSnapshot)') &&
    orderMediaHook.includes('if (!order?.id || !canUseMediaNetwork) return;') &&
    orderMediaHook.includes('if (cancelled || !canUseMediaNetworkRef.current) return undefined;') &&
    financeEntryMediaHook.includes('!financeEntryId || !canUseMediaNetwork') &&
    photoGrid.includes('if (!canPrefetchMedia) return;') &&
    orderPhotoRow.includes('if (!canPrefetchMedia) return;'),
  'Automatic media inspection, prefetch, retry, and disk warmup must pause on unknown/EDGE networks',
);
check(
  photoQueue.includes("from 'expo-file-system/legacy'") &&
    photoQueue.includes('FileSystem.documentDirectory') &&
    photoQueue.includes('persistManagedLocalFile') &&
    photoQueue.includes('managedLocalUrl') &&
    photoQueue.includes('FileSystem.copyAsync') &&
    photoQueue.includes('FileSystem.moveAsync') &&
    photoQueue.includes('safeDeleteManagedLocalFile') &&
    photoQueue.includes('const inFlightQueueItemIds = new Set()'),
  'Queued order photos must survive picker cleanup/restarts and remain single-flight',
);
check(
  orderDetailsScreen.includes('if (!canRunDeferredSync) return undefined;') &&
    orderDetailsScreen.includes("yandexDiskIntegration('status', {}, { signal })") &&
    orderDetailsScreen.includes("label: 'Yandex Disk status'") &&
    orderDetailsScreen.includes('yandexStatusCheckRef') &&
    yandexDiskIntegration.includes('signal,') &&
    yandexDiskIntegration.includes('signal?.aborted'),
  'Yandex health checks must be bounded, cancellable, single-flight, and skipped on constrained links',
);
check(
  supportRequestsApi.includes('throwIfSupportReadAborted(signal)') &&
    supportRequestsApi.includes('{ forcePhotoRefresh = false, signal = undefined }') &&
    supportRequestsApi.includes('countUnreadSupportRequests(signal = undefined)') &&
    adminFeedbackDetailsScreen.includes('canRunDeferredNetworkWork(offlineSnapshot)') &&
    adminFeedbackDetailsScreen.includes("label: 'Admin support request details'") &&
    adminHomeScreen.includes('enabled: isAllowed && canUseAdminNetwork') &&
    adminHomeScreen.includes('refetchIntervalInBackground: false'),
  'Admin support reads, retries, polling, and realtime must be bounded and quality-gated',
);
check(
  !universalHome.includes('refetchOnReconnect: true') &&
    !billingScreen.includes('refetchOnReconnect: true') &&
    universalHome.includes("label: 'Home unread support count'") &&
    orderActivityTimeline.includes('canRunDeferredNetworkWork(offlineSnapshot)') &&
    orderActivityTimeline.includes('query.isPending && canUseActivityNetwork') &&
    orderActivityTimeline.includes('refetchIntervalInBackground: false') &&
    requestQueries.includes('const canUseCalendarPolling = canRunDeferredNetworkWork(network)') &&
    requestQueries.includes(
      'refetchInterval: isScreenActive && canUseCalendarPolling ? refetchIntervalMs : false',
    ),
  'Home, billing, calendar, and activity reads must not fan out on raw reconnect or poll constrained links',
);
check(
  objectQueries.includes('readCachedObjectSearchFallback') &&
    objectQueries.includes('findObjectSearchInCachedCompanySuperset') &&
    objectQueries.includes('enabled: hasEnoughInput && isRequested && canSearchNetwork') &&
    objectQueries.includes("pausedError.code = 'OBJECT_SEARCH_NETWORK_PAUSED'") &&
    !objectQueries.includes('return Array.isArray(cached) ? cached : [];'),
  'Offline object search must preserve scoped cached suggestions without persisting a false empty success',
);
check(
    imageSizeSecurityPatch.includes('if (boxSize < 8)') &&
    imageSizeSecurityPatch.includes('assertValidImageEntry') &&
    packageJson.scripts?.['test:security-regressions'] ===
      'node scripts/test-image-size-security.mjs && node scripts/test-edge-security-regressions.mjs && node scripts/test-media-upload-policy.mjs',
  'The Metro image parser DoS mitigation and its isolated regression test must remain reproducible',
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
    requestApi.includes('await hydrateRequestObjectLocations(Array.isArray(data) ? data : [], signal)') &&
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
    orderDetailsScreen.includes('const shouldVerifyAutomaticStatus =') &&
    orderDetailsScreen.includes("{ label: 'Automatic order status verification' }") &&
    orderDetailsScreen.includes('retryOnVersionMismatch: false') &&
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
    orderDetailsScreen.includes('const executorsQuery = useRequestExecutors({') &&
    orderDetailsScreen.includes('placeholderData: () => undefined') &&
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
    cachedImage.includes('uri: sourceUri') &&
    cachedImage.includes('source={imageSource}') &&
    cachedImage.includes("const effectiveCachePolicy = requiresProtectedAuth ? 'none' : cachePolicy") &&
    cachedImage.includes("cachePolicy={retryAttempt > 0 ? 'none' : effectiveCachePolicy}") &&
    cachedImage.includes('Authorization: `Bearer ${protectedAccessToken}`'),
  'Image retries must preserve signed URLs while protected thumbnails stay authenticated and uncached',
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
    (orderDetailsScreen.match(/collapsable=\{false\}/g) || []).length >= 2 &&
    (orderDetailsScreen.match(/style=\{styles\.contactTouchBoundary\}/g) || []).length === 2 &&
    orderDetailsScreen.includes("contactTouchBoundary: {\n      overflow: 'hidden'") &&
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
check(
  queryKeysSource.includes("adminDetail: (id) => ['adminEmployeeDetail'") &&
    employeeQueries.includes('allowSuperAdmin: privilegedAdminAccess') &&
    employeeQueries.includes('PRIVILEGED_EMPLOYEE_EDIT_REQUIRES_ONLINE') &&
    employeeQueries.includes('{ privilegedAdminAccess }') &&
    employeeApi.includes("`${allowSuperAdmin ? 'admin' : 'regular'}:${employeeId}`") &&
    employeeApi.includes("if (!iAmSuperAdmin) throw new Error('SUPER_ADMIN_ACCESS_REQUIRED')"),
  'Employee detail must keep ordinary and super-admin reads, in-flight work, writes, and offline behavior capability-scoped',
);
check(
  adminUserViewRoute.includes('useRequireSuperAdmin') &&
    adminUserViewRoute.includes('screenProps={{ privilegedAdminAccess: true }}') &&
    adminUserEditRoute.includes('useRequireSuperAdmin') &&
    adminUserEditRoute.includes('screenProps={{ privilegedAdminAccess: true }}') &&
    adminUsersScreen.includes('router.push(`/admin/users/${profileId}`)') &&
    !adminUsersScreen.includes('router.push(`/users/${profileId}`)') &&
    userViewScreen.includes('privilegedAdminAccess = false') &&
    userViewScreen.includes('`/admin/users/${userId}/edit`') &&
    userEditScreen.includes('privilegedAdminAccess = false'),
  'Super-admin employee routes must guard before mounting and must never fall back to ordinary user navigation',
);
check(
  queryClient.includes('isLegacyPrivilegedEmployeeDetailQuery') &&
    queryClient.includes('data.meIsSuperAdmin === true') &&
    queryClient.includes('!isPrivilegedAdminQuery(query)') &&
    queryClient.includes("'adminEmployeeDetail'") &&
    routeFreshnessBoundary.includes('queryKeys.employees.adminDetail(userId)'),
  'Legacy elevated employee rows and new admin employee details must remain memory-only and purgeable on demotion',
);
check(
  companyAccessStateHook.includes("adminScope ? 'adminCompanyAccessState' : 'companyAccessState'") &&
    companyAccessStateHook.includes('enabled: canRefresh') &&
    adminCompanyDetailsScreen.includes("['adminCompanyAccessState', companyId]") &&
    adminCompanyDetailsScreen.includes('adminScope: true') &&
    adminCompanyDetailsScreen.includes('enabled: isAllowed') &&
    adminCompanyEditScreen.includes('adminScope: true') &&
    adminCompanyEditScreen.includes('enabled: isAllowed') &&
    routeFreshnessBoundary.includes("['adminCompanyAccessState']"),
  'Cross-company access state must use an authorization-gated memory-only admin cache key',
);

if (failures.length) {
  console.error('Release validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Release validation passed.');
