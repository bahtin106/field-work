// A deliberately delayed local fixture: no real account or server credentials.
export async function getCachedSupabaseAccessToken() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return 'native-preview-fixture';
}
