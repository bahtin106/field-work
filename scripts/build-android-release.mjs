import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASKS = {
  apk: 'assembleRelease',
  aab: 'bundleRelease',
  clean: 'clean',
};

const target = process.argv[2];
const task = TASKS[target];

if (!task) {
  console.error('Usage: npm run build:android:apk | build:android:aab | build:android:clean');
  process.exit(1);
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const androidDir = join(rootDir, 'android');
const gradleCommand = process.platform === 'win32' ? 'cmd.exe' : './gradlew';
const gradleArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat', task] : [task];

const child = spawn(gradleCommand, gradleArgs, {
  cwd: androidDir,
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Gradle stopped by signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
