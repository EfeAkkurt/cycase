import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The removed vocabulary, checked against the tree that ships.
 *
 * `NODELESS_SOC_REDESIGN_2026-08-31.md` §1 removed NODE — the robot that used
 * to stand beside VERA — "completely", and §10 gates the release on "No NODE
 * mesh, label, speaker, current beat or active contract remains". The mesh and
 * the state machine were cleaned first, and the documents were not, which is
 * the failure this file exists to make impossible to repeat: the documents are
 * the precedence-ordered source of truth (`docs/README.md` §Documents), so a
 * stale line there is not a typo, it is a wrong specification that the next
 * contributor implements. The worst instance was a factual misstatement to a
 * competition judge — `SUBMISSION.md` told them "The companion is original
 * CYCASE work" about a character that does not ship.
 *
 * There is one in-world assistant and she is a human operations assistant,
 * VERA. Nothing else in the room talks.
 *
 * Three scans, and one allowlist that is the whole specification of what may
 * survive. Every entry names a file, the exact text that carries the token,
 * and why a player never sees it. Adding an entry is how you argue that an
 * occurrence is legitimate; there is no other way past this test.
 *
 * Scope notes, because both are deliberate:
 *
 *  - The scan reads file *contents*, never paths. Four PNGs under
 *    `docs/screenshots/` are named `…-06-companion-present.png` and they keep
 *    that name because they genuinely show the room while the robot was still
 *    in it. Renaming release evidence to match a later vocabulary would be
 *    falsifying it.
 *  - The file list comes from `git ls-files`, not a directory walk, so an
 *    untracked scratch file in a working tree cannot fail somebody's run.
 */

const ROOT = path.resolve(__dirname, '../..');

/** This file quotes every token it bans, so it cannot be one of its own inputs. */
const SELF = 'tests/unit/vocabulary.test.ts';

/**
 * The product token, spelled the way the character was: all caps, standing
 * alone. Ordinary `node`, `Node` (the runtime, the DOM interface) and `nodes`
 * do not match, which is what keeps this from flagging several hundred honest
 * lines of DOM and Web Audio code. The boundary is alphanumeric rather than
 * `\b`, so the pattern still reaches into a SCREAMING_SNAKE identifier — a
 * leftover `NODE_ANCHOR` or `NODE_MESH` is exactly the shape a removed mesh
 * leaves behind, and it must be argued for like anything else.
 */
const PRODUCT_TOKEN = /(?<![A-Za-z0-9])NODE(?![A-Za-z0-9])/;

/** The other name the same character went by, in any casing or compound. */
const COMPANION = /companion/i;

/**
 * The string table is scanned more strictly than code is. A lowercase "node"
 * in a `src/i18n` message is a word a player reads, so it is checked as prose
 * even though the same spelling is unremarkable in a DOM comment.
 */
const PLAYER_FACING_NODE = /\bnodes?\b/i;

interface Allowance {
  /** Repo-relative paths this entry speaks for. */
  readonly files: readonly string[];
  /**
   * The exact text that is allowed to carry the token, or `null` to exempt the
   * whole file. Use `null` only for a file whose entire subject is the removal.
   */
  readonly token: string | null;
  /** Why it is legitimate, and why a player never reads it. */
  readonly why: string;
}

const ALLOWED: readonly Allowance[] = [
  {
    files: ['docs/NODELESS_SOC_REDESIGN_2026-08-31.md'],
    token: null,
    why:
      'The removal order itself. It has to name what it removes, and it is the ' +
      'binding document every other one defers to; a player never opens it.',
  },
  {
    files: ['docs/VISUAL_RESET.md'],
    token: null,
    why:
      'Superseded art direction, listed under "### Historical" in docs/README.md as ' +
      'a record of what was decided and not a task list to execute. §1 permits the ' +
      'word in text that is clearly marked historical.',
  },
  {
    files: ['tests/unit/speech.test.ts'],
    token: null,
    why:
      'The regression test that pins the removal: it asserts VOICE_PROFILES has no ' +
      'such role and that the set is exactly colleague and system. It cannot assert ' +
      'a name is absent without writing the name.',
  },
  {
    files: ['src/ui/panels/TopologyPanel.tsx'],
    token: 'NODE_',
    why:
      'NODE_W and NODE_H are the width and height of a box in the identity/device ' +
      'graph — network topology vocabulary, unrelated to the character. They are ' +
      'layout numbers fed to SVG attributes and are never rendered as a word.',
  },
  {
    files: ['src/i18n/en.ts'],
    token: "'CyCase Drive node'",
    why:
      'The display name of the fictional file server in Case 001. A player does read ' +
      'this one, and it is correct: a file-server node is what the incident touches.',
  },
  {
    files: ['tests/e2e/intro.spec.ts'],
    token: 'Node.TEXT_NODE',
    why:
      'The DOM nodeType constant, used to walk the typewriter markup inside an ' +
      'evaluated page function. Browser API, not product vocabulary.',
  },
  {
    files: ['src/three/Colleague.tsx', 'tests/e2e/headlook.spec.ts'],
    token: '06-companion-present',
    why:
      'The filename of release captures that are still on disk under ' +
      'docs/screenshots/. Both comments name the file to explain that the name ' +
      'outlived the object, which is the honest record; the PNGs show what the room ' +
      'held when they were taken.',
  },
  {
    files: ['docs/BACKEND_RUNTIME_CONTRACT.md'],
    token: 'companionIntro',
    why:
      'The former name of the ScenarioPlan field now called guidanceIntro, in a ' +
      'sentence that says so and explains why the slot outlived the character. ' +
      'Marked historical in the sense §1 allows, and it is a schema key.',
  },
  {
    files: ['tests/unit/measureCast.test.ts', 'scripts/measure-cast.mjs'],
    token: '1440x900-04-companion.png',
    why:
      'The capture filename that measure-cast kept naming after the frame had been ' +
      'renamed to -04-assistant.png. The instrument filtered the absence away and ' +
      'averaged two frames under a heading promising three; the test that now ' +
      'catches that cannot describe it, or assert on a deliberately absent path, ' +
      'without writing the old name. A script comment and a test fixture — nothing ' +
      'renders it.',
  },
  {
    files: ['tests/e2e/characters.spec.ts'],
    token: 'the colleague and the robot companion',
    why:
      'A retrospective clause in a Playwright spec header — the sentence exists to ' +
      'say the audit contract was written for two characters and now covers one. ' +
      'Spec comments are not shipped and no player reads them.',
  },
];

function textFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--', 'src', 'tests', 'docs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed
    .split('\n')
    .filter((file) => /\.(ts|tsx|md|css)$/.test(file))
    .filter((file) => file !== SELF);
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Every line matching `pattern` that no allowlist entry speaks for. */
function unexplained(files: readonly string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = [];

  for (const file of files) {
    const allowances = ALLOWED.filter((entry) => entry.files.includes(file));
    if (allowances.some((entry) => entry.token === null)) continue;

    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (!pattern.test(text)) return;
      if (allowances.some((entry) => entry.token !== null && text.includes(entry.token))) return;
      hits.push({ file, line: index + 1, text: text.trim() });
    });
  }

  return hits;
}

/** What a failure prints: the location, so the reader can go and read it. */
function report(hits: readonly Hit[]): string[] {
  return hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`);
}

describe('the removed in-world character', () => {
  const files = textFiles();

  it('scans a tree that actually has files in it', () => {
    // A broken `git ls-files` invocation, a moved ROOT or a tightened extension
    // filter would all turn this suite into a green no-op. The three counts
    // below are floors, far under the current tree, not measurements.
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => file.startsWith('docs/')).length).toBeGreaterThan(5);
    expect(files).toContain('src/three/Colleague.tsx');
  });

  it('leaves no NODE in shipped source, tests or documents', () => {
    expect(report(unexplained(files, PRODUCT_TOKEN))).toEqual([]);
  });

  it('leaves no companion in shipped source, tests or documents', () => {
    expect(report(unexplained(files, COMPANION))).toEqual([]);
  });

  it('never puts the word in front of a player through the string table', () => {
    // `src/i18n/index.ts` is the lookup helper, not a message table; the tables
    // are what a player reads. Scanning them under the prose rule is how a
    // lowercase "node" that is really the removed character gets caught, since
    // the all-caps product pattern would walk straight past it.
    const tables = files.filter(
      (file) => file.startsWith('src/i18n/') && file !== 'src/i18n/index.ts',
    );
    expect(tables).toContain('src/i18n/en.ts');
    expect(report(unexplained(tables, PLAYER_FACING_NODE))).toEqual([]);
  });
});

describe('the allowlist', () => {
  /*
   * An allowlist only specifies anything while its entries are true. A dead
   * entry silently widens the test, so the two survivors the redesign named as
   * permanent are asserted to be exactly where they are claimed to be.
   *
   * Only those two. The rest of the tree is being edited concurrently, and a
   * presence assertion on somebody else's comment would fail this suite for a
   * reason that has nothing to do with vocabulary.
   */
  it('still finds the topology layout constant it exempts', () => {
    const source = readFileSync(path.join(ROOT, 'src/ui/panels/TopologyPanel.tsx'), 'utf8');
    expect(source).toMatch(/const NODE_W = \d+;/);
  });

  it('still finds the file-server name it exempts', () => {
    const table = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
    expect(table).toContain("'CyCase Drive node'");
  });

  it('gives every entry a file, and a reason a reader can weigh', () => {
    for (const entry of ALLOWED) {
      expect(entry.files.length).toBeGreaterThan(0);
      // Long enough that "legacy" or "needed" cannot pass as an argument.
      expect(entry.why.length).toBeGreaterThan(60);
    }
  });
});
