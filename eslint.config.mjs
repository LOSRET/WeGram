// eslint.config.mjs — flat config for the whole workspace.
//
// Two jobs:
//   1. catch the correctness mistakes that `tsc` cannot see,
//   2. encode the architecture rules from docs/HANDOFF.md as machine-checked
//      errors, so an agent cannot "fix" something by moving an import across a
//      layer boundary (see `architecture` below).
//
// Style is Prettier's job (`pnpm format`); ESLint must not fight it.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const TDLIB_ONLY = 'apps/desktop/src/main/telegram/tdlib.ts'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/.cache/**',
      'spikes/tdlib/data/**',
      'apps/desktop/src/renderer/src/lib/preview-bridge.ts',
    ],
  },

  ...tseslint.configs.recommended,

  {
    // The tree predates this config; keep the noisy-but-real findings as
    // warnings so `pnpm lint` stays actionable (errors only for the rules that
    // encode a hard rule).
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'no-empty': 'warn',
    },
  },

  // ---- React: hooks rules actually matter here -----------------------------
  // The transcript and the chat pane own their scroll/anchor timing in hooks;
  // `rules-of-hooks` is an error, and `exhaustive-deps` is a warning because a
  // few effects intentionally depend on a length instead of a list.
  {
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ---- architecture: `tdl` / `prebuilt-tdlib` live in one place only ---------
  // Design doc §2: everything else talks to the `TelegramAdapter` interface, so
  // swapping the protocol library stays inside `telegram/`.
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}', 'apps/desktop/scripts/**/*.ts'],
    ignores: [TDLIB_ONLY, 'apps/desktop/src/main/telegram/tdlib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'tdl',
              message:
                'Only main/telegram/tdlib.ts may import `tdl` — everything else goes through TelegramAdapter (docs/HANDOFF.md "Architecture map").',
            },
            {
              name: 'prebuilt-tdlib',
              message: 'Only main/telegram/tdlib.ts may load tdjson.',
            },
          ],
        },
      ],
    },
  },

  // ---- architecture: all SQL stays in ui-db.ts ------------------------------
  {
    files: ['apps/desktop/src/main/**/*.ts'],
    ignores: ['apps/desktop/src/main/store/ui-db.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:sqlite',
              message:
                'All node:sqlite calls stay inside main/store/ui-db.ts (docs/HANDOFF.md "Hard rules").',
            },
          ],
        },
      ],
    },
  },

  // ---- architecture: the renderer is a sandboxed web page -------------------
  // No Electron, no Node, no TDLib: it only speaks the `window.tg` IPC contract
  // from packages/protocol. `lib/preview-bridge.ts` is dev-only tooling and
  // never runs inside Electron.
  {
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    ignores: ['apps/desktop/src/renderer/src/lib/preview-bridge.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*', 'node:*', 'tdl', 'tdl/*', 'prebuilt-tdlib'],
              message:
                'The renderer may not import Electron, Node or TDLib — it talks to `window.tg` only (docs/HANDOFF.md "Hard rules").',
            },
            {
              group: ['**/main/**', '../../main/*', '../../../main/*'],
              message: 'The renderer must never import main-process code.',
            },
          ],
        },
      ],
    },
  },
)
