import pluginVue from 'eslint-plugin-vue'
import {defineConfigWithVueTs, vueTsConfigs} from '@vue/eslint-config-typescript'

// ESLint 9 flat config. Replaces the legacy .eslintrc.json (which the v9
// CLI could no longer read). Uses the Vue + typescript-eslint flat presets.
export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-extension/**'],
  },

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      // Tightened from the original review. Kept at "warn" so they surface
      // without blocking; promote to "error" over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'vue/no-v-html': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    name: 'app/boundaries/web',
    files: ['src/apps/web/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)extension(/|$)',
          message: 'The web app may not import extension code. Move shared code to src/shared/.',
        }],
      }],
    },
  },
  {
    name: 'app/boundaries/extension',
    files: ['src/apps/extension/**', 'src/ApproveApp.vue', 'src/approve-main.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)web(/|$)',
          message: 'The extension may not import web app code. Move shared code to src/shared/.',
        }],
      }],
    },
  },
  {
    name: 'app/boundaries/small',
    files: ['src/apps/small/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)(web|extension)(/|$)',
          message: 'The small app may not import web or extension code. Use SmallHost (src/apps/small/host.ts) or move shared code to src/shared/.',
        }],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression[source.value=/(^|\\/)(web|extension)(\\/|$)/]',
        message: 'The small app may not import web or extension code. Use SmallHost (src/apps/small/host.ts) or move shared code to src/shared/.',
      }],
      'no-restricted-globals': ['error',
        { name: 'chrome', message: 'The small app runs outside the extension. Use SmallHost (src/apps/small/host.ts).' },
        { name: '__IS_EXTENSION__', message: 'The small app runs outside the extension. Use SmallHost (src/apps/small/host.ts).' },
      ],
    },
  },
  {
    name: 'app/boundaries/shared',
    files: ['src/core/**', 'src/shared/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)apps(/|$)',
          message: 'src/core and src/shared may not import app code from src/apps/.',
        }],
      }],
    },
  },
)
