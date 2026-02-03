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
)
