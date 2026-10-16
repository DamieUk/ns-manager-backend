import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { normalizeSteps, seedExecutive, startServer } from './harness';
import { runScenario } from './scenario';
import { TEST_DB_ENV, resetTestDatabase } from './db';

const GOLDEN = path.join(__dirname, 'golden.json');

// Runs the scenario against a fresh test database and compares every response with
// test/golden.json. UPDATE_GOLDEN=1 records a new snapshot instead.
test('API responses match the recorded snapshot', { timeout: 180_000 }, async () => {
  await resetTestDatabase();
  const execPassword = await seedExecutive(TEST_DB_ENV, 'exec@test.local', 'Ivan Executive');
  const server = await startServer(TEST_DB_ENV);
  let steps;
  try {
    steps = normalizeSteps(await runScenario(server, execPassword));
  } catch (err) {
    console.error(server.output().slice(-4000));
    throw err;
  } finally {
    await server.stop();
  }

  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN, JSON.stringify(steps, null, 2) + '\n');
    console.log(`recorded ${steps.length} steps to ${GOLDEN}`);
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (let i = 0; i < Math.max(steps.length, golden.length); i++) {
    assert.deepStrictEqual(steps[i], golden[i], `step #${i} "${golden[i]?.step ?? steps[i]?.step}" differs from the snapshot`);
  }
});
