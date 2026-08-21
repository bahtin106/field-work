import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const icnsModulePath = require.resolve('image-size/dist/types/icns.js');
const jxlModulePath = require.resolve('image-size/dist/types/jxl.js');

const CASE_TIMEOUT_MS = 1_500;

function runIsolatedCase(name, source) {
  const result = spawnSync(process.execPath, ['--eval', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: CASE_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`${name}: parser exceeded ${CASE_TIMEOUT_MS}ms (possible infinite loop)`);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${name}: regression check failed${details ? `\n${details}` : ''}`);
  }
}

runIsolatedCase(
  'ICNS zero-length entry',
  `
    const { ICNS } = require(${JSON.stringify(icnsModulePath)});
    const input = Uint8Array.from([
      0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10,
      0x69, 0x63, 0x30, 0x37, 0x00, 0x00, 0x00, 0x00,
    ]);
    try {
      ICNS.calculate(input);
      process.exitCode = 1;
    } catch (error) {
      if (!(error instanceof TypeError) || !String(error.message).includes('entry length')) {
        throw error;
      }
    }
  `,
);

runIsolatedCase(
  'JXL zero-size box',
  `
    const { JXL } = require(${JSON.stringify(jxlModulePath)});
    const input = Uint8Array.from([
      0x00, 0x00, 0x00, 0x00, 0x6a, 0x78, 0x6c, 0x70,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    try {
      JXL.calculate(input);
    } catch {
      process.exitCode = 0;
    }
  `,
);

runIsolatedCase(
  'Valid ICNS header',
  `
    const { ICNS } = require(${JSON.stringify(icnsModulePath)});
    const input = Uint8Array.from([
      0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10,
      0x69, 0x63, 0x30, 0x37, 0x00, 0x00, 0x00, 0x08,
    ]);
    const size = ICNS.calculate(input);
    if (size.width !== 128 || size.height !== 128) process.exitCode = 1;
  `,
);

console.log('image-size parser security regressions passed');
