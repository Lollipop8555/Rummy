import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // ---- AI 信息隔离（docs/技术方案.md 第 8 节，第 2 层防护）----
  // AI 不得读取牌堆：禁止引用 engine / rng / scoring。
  // 仅允许 core/cards 与 core/view 的公开类型。
  {
    // 排除测试文件：AI 的测试扮演「驱动者」（相当于真实代码中的 controller），
    // 必须调用引擎来推进对局，这与「AI 决策代码不可读牌堆」是两件事。
    files: ['src/ai/**/*.ts'],
    ignores: ['src/ai/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/core/engine',
                '**/core/engine.*',
                '**/core/rng',
                '**/core/rng.*',
                '**/core/scoring',
                '**/core/scoring.*',
                '**/core/deal',
                '**/core/deal.*',
              ],
              message:
                'AI 只允许基于 GameView 决策，禁止引用引擎/随机数/计分模块（见 docs/技术方案.md 第 8 节）。',
            },
          ],
        },
      ],
    },
  },
);
