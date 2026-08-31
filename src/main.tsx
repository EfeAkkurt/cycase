import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/global.css';

// Imported for its side effect: publishing the build identity on `window`.
// Without a real import the module is tree-shaken and the deployed bundle cannot
// name its own SHA — the unit test would still pass, because vitest imports it
// directly. Verified against the built bundle, not the test.
import './buildInfo';
import { App } from './App';
import { GameProvider } from './app/GameProvider';
import { AudioProvider } from './audio/AudioProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <AudioProvider>
      <GameProvider>
        <App />
      </GameProvider>
    </AudioProvider>
  </StrictMode>,
);
