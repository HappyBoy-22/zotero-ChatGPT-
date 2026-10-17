'use strict';

const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tests = readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.cjs')).sort();
if (!tests.length) throw new Error('No test files found');

let failed = 0;
for (const name of tests) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [path.join(root, 'tests', name)], {
    cwd: root, stdio: 'inherit', timeout: 30000
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed++;
}
console.log(`\n${tests.length - failed}/${tests.length} test files passed.`);
process.exitCode = failed ? 1 : 0;
