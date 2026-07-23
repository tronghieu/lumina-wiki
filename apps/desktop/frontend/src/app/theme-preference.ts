export type ThemePreference = 'dark' | 'light';

export function resolveThemePreference(storedTheme: string | null, systemPrefersDark: boolean): ThemePreference {
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

export function toggleTheme(theme: ThemePreference): ThemePreference {
  return theme === 'dark' ? 'light' : 'dark';
}
