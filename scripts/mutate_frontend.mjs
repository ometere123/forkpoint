import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const cases = [
  {
    name: 'enable-prediction-on-wrong-chain',
    path: 'app/markets/[id]/detail.tsx',
    target: '!!account && chain === CHAIN && ready',
    replacement: '!!account && ready',
    exercise: 'wallet gating',
    assertion: 'toBeDisabled',
  },
  {
    name: 'confuse-finality-with-execution',
    path: 'lib/chain.ts',
    target: "result === 'SUCCESS' ? 'Finalized · Success'",
    replacement: "true ? 'Finalized · Success'",
    exercise: 'finalized execution error',
    assertion: 'Execution failed',
  },
  {
    name: 'forget-transaction-hash-after-refresh',
    path: 'app/wallet.tsx',
    target: 'localStorage.getItem(key)',
    replacement: 'null',
    exercise: 'wallet gating',
    assertion: 'Finalized',
  },
];

function run(exercise) {
  return spawnSync(process.execPath, [
    'node_modules/playwright/cli.js', 'test', '--project=desktop', '--workers=1', '--grep', exercise,
  ], { encoding: 'utf8', timeout: 180_000 });
}

const clean = run('wallet gating|finalized execution error');
if (clean.status !== 0) {
  process.stdout.write(clean.stdout ?? '');
  process.stderr.write(clean.stderr ?? '');
  throw new Error('Browser baseline failed. No mutation results counted.');
}

let killed = 0;
for (const mutant of cases) {
  const original = readFileSync(mutant.path, 'utf8');
  if (original.split(mutant.target).length !== 2) throw new Error(`Mutation target drifted: ${mutant.name}`);
  let result;
  try {
    writeFileSync(mutant.path, original.replace(mutant.target, mutant.replacement));
    result = run(mutant.exercise);
  } finally {
    writeFileSync(mutant.path, original);
  }
  const evidence = (result.stdout ?? '') + (result.stderr ?? '');
  if (result.status === 1 && evidence.includes('1 failed') && evidence.includes(mutant.assertion)) {
    ++killed;
    console.log(`KILLED ${mutant.name}`);
  } else {
    console.log(`SURVIVED OR INVALID ${mutant.name}\n${evidence}`);
  }
}

console.log(`${killed}/${cases.length} frontend security mutants killed`);
if (killed !== cases.length) process.exitCode = 1;
