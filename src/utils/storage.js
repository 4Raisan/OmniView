const STORAGE_KEYS = {
  RECENT_FILES: 'multiviewer_recent_files',
  THEME: 'multiviewer_theme',
  SIDEBAR_OPEN: 'multiviewer_sidebar_open'
};

export function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
}

export function setStoredTheme(theme) {
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

export function getStoredSidebarState() {
  const val = localStorage.getItem(STORAGE_KEYS.SIDEBAR_OPEN);
  return val === null ? true : val === 'true';
}

export function setStoredSidebarState(isOpen) {
  localStorage.setItem(STORAGE_KEYS.SIDEBAR_OPEN, String(isOpen));
}









