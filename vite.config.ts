import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

import { audioDefines } from './scripts/audioAssets';
import { buildInfo, definesFor, type BuildIdentity } from './scripts/buildDefines';

// Resolved once and shared by the `define` substitution and the emitted JSON, so the
// two surfaces can never name different builds. See `scripts/buildDefines.ts`.
const BUILD: BuildIdentity = buildInfo();

/**
 * Writes `dist/build-info.json` next to the bundle.
 *
 * `window.__CYCASE_BUILD__` already names the build, but reading it needs a browser
 * with the app booted. Verifying a deployment — did the upload land, did the rollback
 * actually take at the edge — should not require WebGL to come up first, so the same
 * identity is emitted as a static file that `curl` can read. It is emitted rather
 * than committed under `public/`: a checked-in copy would ship whatever SHA it was
 * written at and be wrong from the next commit onward.
 */
function buildIdentityFile(info: BuildIdentity): Plugin {
  return {
    name: 'cycase-build-identity-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: `${JSON.stringify(info, null, 2)}\n`,
      });
    },
  };
}

/**
 * Restarts the dev server when audio appears in or disappears from `public/`.
 *
 * `__CYCASE_INSTALLED_AUDIO__` is resolved once, at config time, which is right
 * for a build and one step short for `vite dev`: dropping the alarm files in
 * while the server is up would otherwise leave the page believing the old
 * answer until someone restarted by hand. A restart re-runs the scan, so the
 * files are picked up while the owner is still holding the mouse.
 *
 * Deliberately not a full-reload: the value is baked into the module graph by
 * `define`, so only a config reload can change it.
 */
function audioPresenceWatcher(): Plugin {
  return {
    name: 'cycase-audio-presence-watcher',
    apply: 'serve',
    configureServer(server) {
      const audioDir = fileURLToPath(new URL('./public/audio', import.meta.url));
      server.watcher.add(audioDir);
      const rescan = (changed: string) => {
        if (!changed.startsWith(audioDir)) return;
        void server.restart();
      };
      server.watcher.on('add', rescan);
      server.watcher.on('unlink', rescan);
    },
  };
}

export default defineConfig({
  define: { ...definesFor(BUILD), ...audioDefines() },
  plugins: [react(), buildIdentityFile(BUILD), audioPresenceWatcher()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is already isolated in its own lazily-imported chunk and never
    // touches the critical path, so the default 500 kB warning is noise here.
    // The number that matters is the initial transfer, which stays ~120 kB
    // gzipped against a 12 MB budget.
    chunkSizeWarningLimit: 1000,
  },
});
