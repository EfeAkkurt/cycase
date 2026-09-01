#!/usr/bin/env node
/**
 * Refuses to run the browser suites against someone else's server.
 *
 * Playwright's `webServer` starts its own preview on 4183. When that port is
 * already held — by a preview left running from a debugging session, which is
 * easy to do — Playwright finds the URL responding and quietly uses whatever is
 * there. That server is serving an older `dist/`, and when it later exits every
 * remaining test fails with ERR_CONNECTION_REFUSED.
 *
 * Both halves of that are worse than a crash: the first silently tests the wrong
 * build, and the second looks like a cascade of product failures. It cost an
 * hour of chasing phantom regressions in this repository, so the port is now
 * cleared before the suites run, loudly.
 */
import { execSync } from 'node:child_process';

import { resolveTestPort } from './test-port.mjs';

/*
 * An explicit argument still wins, so `node scripts/free-test-port.mjs 4283`
 * keeps working. Otherwise this clears the port THIS run is about to use — the
 * distinction that lets two runs on two ports coexist, where a hard-coded 4183
 * would have had each of them killing the other's server.
 */
const PORT = process.argv[2] === undefined ? resolveTestPort() : Number(process.argv[2]);

function pidsOn(port) {
  try {
    return execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // lsof exits non-zero when nothing is listening.
    return [];
  }
}

const pids = pidsOn(PORT);
if (pids.length === 0) {
  console.log(`port ${PORT} is free`);
  process.exit(0);
}

console.log(`port ${PORT} held by ${pids.join(', ')} — stopping it so the suite serves the build it just made`);
for (const pid of pids) {
  try {
    process.kill(Number(pid), 'SIGKILL');
  } catch (error) {
    console.error(`could not stop ${pid}: ${error instanceof Error ? error.message : error}`);
  }
}

// Give the socket a moment to close before Playwright tries to bind it.
const until = Date.now() + 3000;
while (Date.now() < until && pidsOn(PORT).length > 0) {
  // Busy-wait: this runs once, before a multi-minute browser suite.
}

if (pidsOn(PORT).length > 0) {
  console.error(`port ${PORT} is still held. Stop it by hand before running the suite.`);
  process.exit(1);
}
console.log(`port ${PORT} freed`);
