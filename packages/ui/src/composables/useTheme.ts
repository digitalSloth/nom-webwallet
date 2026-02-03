import {ref} from 'vue'

export type Theme = 'light' | 'dark'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

const theme = ref<Theme>('light')
const STORAGE_KEY = 'nom-wallet-theme'

export function useTheme() {
  const setTheme = (newTheme: Theme) => {
    theme.value = newTheme

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }

    // Store preference
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {
      // Fallback for extension where localStorage might not be available
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ [STORAGE_KEY]: newTheme })
      }
    }
  }

  const toggleTheme = () => {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  const initTheme = async () => {
    let savedTheme: Theme | null = null

    // Try localStorage first
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      savedTheme = isTheme(stored) ? stored : null
    } catch {
      // Try chrome storage if available
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(STORAGE_KEY)
        savedTheme = isTheme(result[STORAGE_KEY]) ? result[STORAGE_KEY] : null
      }
    }

    // Use saved theme or system preference
    if (savedTheme) {
      setTheme(savedTheme)
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark')
    } else {
      setTheme('light')
    }
  }

  return {
    theme,
    setTheme,
    toggleTheme,
    initTheme,
  }
}
