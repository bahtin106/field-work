import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_WINDOW_METHODS = new Set([
  'getStatusBarColor',
  'setStatusBarColor',
  'getNavigationBarColor',
  'setNavigationBarColor',
  'getNavigationBarDividerColor',
  'setNavigationBarDividerColor',
]);
const WINDOW_DESCRIPTOR = 'Landroid/view/Window;';
const DEX_HEADER_SIZE = 0x70;
const R8_METADATA_ENTRY = 'BUNDLE-METADATA/com.android.tools/r8.json';

function assertRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error(`Invalid ${label} range`);
  }
  if (offset + length > buffer.length) {
    throw new Error(`${label} extends past the end of the DEX file`);
  }
}

function readUnsignedLeb128(buffer, initialOffset) {
  let offset = initialOffset;
  let value = 0;
  let shift = 0;

  for (let count = 0; count < 5; count += 1) {
    assertRange(buffer, offset, 1, 'ULEB128');
    const byte = buffer[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, nextOffset: offset };
    shift += 7;
  }

  throw new Error('Invalid ULEB128 value in DEX string table');
}

function readDexString(buffer, stringIdsOffset, stringCount, stringIndex) {
  if (!Number.isInteger(stringIndex) || stringIndex < 0 || stringIndex >= stringCount) {
    throw new Error(`Invalid DEX string index ${stringIndex}`);
  }

  const stringIdOffset = stringIdsOffset + stringIndex * 4;
  assertRange(buffer, stringIdOffset, 4, 'string_id');
  const stringDataOffset = buffer.readUInt32LE(stringIdOffset);
  const { nextOffset } = readUnsignedLeb128(buffer, stringDataOffset);
  const terminatorOffset = buffer.indexOf(0, nextOffset);
  if (terminatorOffset < 0) throw new Error('Unterminated DEX string');
  return buffer.toString('utf8', nextOffset, terminatorOffset);
}

export function findForbiddenWindowMethodsInDex(buffer, sourceLabel = 'classes.dex') {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('DEX input must be a Buffer');
  assertRange(buffer, 0, DEX_HEADER_SIZE, 'DEX header');
  if (buffer.toString('ascii', 0, 4) !== 'dex\n') {
    throw new Error(`${sourceLabel} is not a standard DEX file`);
  }

  const declaredFileSize = buffer.readUInt32LE(0x20);
  const declaredHeaderSize = buffer.readUInt32LE(0x24);
  const endianTag = buffer.readUInt32LE(0x28);
  if (declaredFileSize !== buffer.length || declaredHeaderSize !== DEX_HEADER_SIZE) {
    throw new Error(`${sourceLabel} has an invalid DEX header`);
  }
  if (endianTag !== 0x12345678) {
    throw new Error(`${sourceLabel} uses an unsupported DEX byte order`);
  }

  const stringCount = buffer.readUInt32LE(0x38);
  const stringIdsOffset = buffer.readUInt32LE(0x3c);
  const typeCount = buffer.readUInt32LE(0x40);
  const typeIdsOffset = buffer.readUInt32LE(0x44);
  const methodCount = buffer.readUInt32LE(0x58);
  const methodIdsOffset = buffer.readUInt32LE(0x5c);
  assertRange(buffer, stringIdsOffset, stringCount * 4, 'string_ids');
  assertRange(buffer, typeIdsOffset, typeCount * 4, 'type_ids');
  assertRange(buffer, methodIdsOffset, methodCount * 8, 'method_ids');

  const stringCache = new Map();
  const readString = (index) => {
    if (!stringCache.has(index)) {
      stringCache.set(index, readDexString(buffer, stringIdsOffset, stringCount, index));
    }
    return stringCache.get(index);
  };

  const forbiddenReferences = [];
  for (let methodIndex = 0; methodIndex < methodCount; methodIndex += 1) {
    const methodOffset = methodIdsOffset + methodIndex * 8;
    const classIndex = buffer.readUInt16LE(methodOffset);
    if (classIndex >= typeCount) throw new Error(`${sourceLabel} has an invalid method class index`);

    const descriptorStringIndex = buffer.readUInt32LE(typeIdsOffset + classIndex * 4);
    if (readString(descriptorStringIndex) !== WINDOW_DESCRIPTOR) continue;

    const nameIndex = buffer.readUInt32LE(methodOffset + 4);
    const methodName = readString(nameIndex);
    if (FORBIDDEN_WINDOW_METHODS.has(methodName)) forbiddenReferences.push(methodName);
  }

  return [...new Set(forbiddenReferences)].sort();
}

function jarCommand() {
  const executable = process.platform === 'win32' ? 'jar.exe' : 'jar';
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable) : executable;
}

function runJar(args, options = {}) {
  const result = spawnSync(jarCommand(), args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Unable to inspect the Android App Bundle with jar${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || '';
}

function collectDexFiles(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.dex')) files.push(entryPath);
    }
  }
  return files.sort();
}

export function auditAndroidEdgeToEdgeAab(inputPath) {
  const aabPath = resolve(inputPath);
  if (!existsSync(aabPath)) throw new Error(`Android App Bundle not found: ${aabPath}`);

  const archiveEntries = runJar(['tf', aabPath])
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const dexEntries = archiveEntries.filter((entry) => /^[^/]+\/dex\/[^/]+\.dex$/.test(entry));
  if (dexEntries.length === 0) throw new Error(`No DEX files found in ${basename(aabPath)}`);
  if (!archiveEntries.includes(R8_METADATA_ENTRY)) {
    throw new Error(`R8 metadata not found in ${basename(aabPath)}`);
  }

  const extractionDirectory = mkdtempSync(join(tmpdir(), 'monitor-edge-to-edge-audit-'));
  try {
    runJar(['xf', aabPath, ...dexEntries, R8_METADATA_ENTRY], { cwd: extractionDirectory });
    const dexFiles = collectDexFiles(extractionDirectory);
    const r8Metadata = JSON.parse(
      readFileSync(join(extractionDirectory, ...R8_METADATA_ENTRY.split('/')), 'utf8'),
    );
    const forbiddenReferences = dexFiles.flatMap((dexPath) =>
      findForbiddenWindowMethodsInDex(
        readFileSync(dexPath),
        relative(extractionDirectory, dexPath),
      ).map((methodName) => ({
        dex: relative(extractionDirectory, dexPath).replaceAll('\\', '/'),
        method: `${WINDOW_DESCRIPTOR}.${methodName}`,
      })),
    );

    return {
      aabPath,
      dexFiles: dexFiles.map((dexPath) => relative(extractionDirectory, dexPath)),
      forbiddenReferences,
      r8: {
        version: String(r8Metadata?.version || 'unknown'),
        isObfuscationEnabled: r8Metadata?.options?.isObfuscationEnabled === true,
        isOptimizationsEnabled: r8Metadata?.options?.isOptimizationsEnabled === true,
        isShrinkingEnabled: r8Metadata?.options?.isShrinkingEnabled === true,
        isOptimizedResourceShrinkingEnabled:
          r8Metadata?.resourceOptimization?.isOptimizedShrinkingEnabled === true,
      },
    };
  } finally {
    rmSync(extractionDirectory, { force: true, recursive: true });
  }
}

export function assertAndroidEdgeToEdgeAabIsClean(inputPath) {
  const result = auditAndroidEdgeToEdgeAab(inputPath);
  const failures = [];
  if (result.forbiddenReferences.length > 0) {
    const references = result.forbiddenReferences
      .map(({ dex, method }) => `- ${dex}: ${method}`)
      .join('\n');
    failures.push(`the AAB still references Android 15 legacy system-bar color APIs:\n${references}`);
  }
  if (!result.r8.isShrinkingEnabled) failures.push('R8 code shrinking is disabled');
  if (!result.r8.isObfuscationEnabled) failures.push('R8 obfuscation is disabled');
  if (!result.r8.isOptimizationsEnabled) failures.push('R8 code optimization is disabled');
  if (!result.r8.isOptimizedResourceShrinkingEnabled) {
    failures.push('R8 optimized resource shrinking is disabled');
  }
  if (failures.length > 0) {
    throw new Error(`Refusing to publish:\n- ${failures.join('\n- ')}`);
  }
  return result;
}

const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const inputPath = process.argv[2] ||
    join(rootDir, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  try {
    const result = assertAndroidEdgeToEdgeAabIsClean(inputPath);
    console.log(
      `Android release artifact audit passed: ${result.dexFiles.length} DEX file(s), no legacy Window color API references, R8 ${result.r8.version} code/resource optimization enabled.`,
    );
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}
