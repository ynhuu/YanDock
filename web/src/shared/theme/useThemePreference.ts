import { useEffect, useLayoutEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light'
export type ThemePreference = 'system' | ThemeMode

const THEME_STORAGE_KEY = 'yandock-theme-preference'

function storedPreference(): ThemePreference {
  try {
    const preference = localStorage.getItem(THEME_STORAGE_KEY)
    if (
      preference === 'system' ||
      preference === 'dark' ||
      preference === 'light'
    )
      return preference
  } catch {
    // Follow the system when browser storage is unavailable.
  }
  return 'system'
}

export function useThemePreference() {
  const [preference, setPreference] =
    useState<ThemePreference>(storedPreference)
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )

  const theme = preference === 'system' ? systemTheme : preference
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b0f14' : '#f3f6fa')
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // The selected appearance still applies for this page.
    }
  }, [preference])

  const cycleTheme = () => {
    const order: ThemePreference[] = ['system', 'dark', 'light']
    setPreference(order[(order.indexOf(preference) + 1) % order.length])
  }

  return {
    theme,
    preference,
    cycleTheme,
  }
}
