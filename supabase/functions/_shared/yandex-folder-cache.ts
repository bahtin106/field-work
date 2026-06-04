type CreateFolder = (path: string) => Promise<void>;
type NormalizeFolderPath = (path: string) => string;

const FOLDER_CACHE_TTL_MS = 10 * 60 * 1000;
const FOLDER_CACHE_MAX_ENTRIES = 2048;

const ensuredFolders = new Map<string, number>();
const inflightFolders = new Map<string, Promise<void>>();

function buildTokenScope(accessToken: string) {
  const token = String(accessToken || '');
  if (!token) return 'anonymous';
  return `${token.length}:${token.slice(0, 8)}:${token.slice(-12)}`;
}

function pruneFolderCache(now: number) {
  if (ensuredFolders.size <= FOLDER_CACHE_MAX_ENTRIES) return;
  for (const [key, touchedAt] of ensuredFolders) {
    if (now - touchedAt > FOLDER_CACHE_TTL_MS || ensuredFolders.size > FOLDER_CACHE_MAX_ENTRIES) {
      ensuredFolders.delete(key);
    }
    if (ensuredFolders.size <= FOLDER_CACHE_MAX_ENTRIES) break;
  }
}

async function ensureSingleFolder({
  accessToken,
  path,
  createFolder,
  force,
}: {
  accessToken: string;
  path: string;
  createFolder: CreateFolder;
  force: boolean;
}) {
  const now = Date.now();
  const key = `${buildTokenScope(accessToken)}:${path}`;
  const cachedAt = ensuredFolders.get(key) || 0;
  if (!force && cachedAt && now - cachedAt < FOLDER_CACHE_TTL_MS) return;

  const inflight = inflightFolders.get(key);
  if (inflight && !force) {
    await inflight;
    return;
  }

  const task = (async () => {
    await createFolder(path);
    ensuredFolders.set(key, Date.now());
    pruneFolderCache(Date.now());
  })();

  inflightFolders.set(key, task);
  try {
    await task;
  } finally {
    if (inflightFolders.get(key) === task) {
      inflightFolders.delete(key);
    }
  }
}

export async function ensureYandexFolderTreeCached({
  accessToken,
  fullPath,
  normalizeFolderPath,
  createFolder,
  force = false,
}: {
  accessToken: string;
  fullPath: string;
  normalizeFolderPath: NormalizeFolderPath;
  createFolder: CreateFolder;
  force?: boolean;
}) {
  const normalized = normalizeFolderPath(fullPath);
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    await ensureSingleFolder({
      accessToken,
      path: current,
      createFolder,
      force,
    });
  }
}
