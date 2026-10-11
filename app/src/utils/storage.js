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

export function getRecentFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_FILES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentFile(meta) {
  try {
    let list = getRecentFiles();
    // Remove if already exists with same name
    list = list.filter(item => item.name !== meta.name);
    // Add to start
    list.unshift({
      name: meta.name,
      type: meta.type,
      size: meta.size,
      lastOpened: Date.now()
    });
    // Keep the last 25 entries in the browser fallback.
    if (list.length > 25) list = list.slice(0, 25);
    localStorage.setItem(STORAGE_KEYS.RECENT_FILES, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save recent file', e);
  }
}

export function clearRecentFiles() {
  localStorage.removeItem(STORAGE_KEYS.RECENT_FILES);
}

export function getStoredSidebarWidth() {
  const value = Number(localStorage.getItem('multiviewer_sidebar_width'));
  return Number.isFinite(value) && value >= 180 ? Math.min(value, 520) : 280;
}
export function setStoredSidebarWidth(width) {
  localStorage.setItem('multiviewer_sidebar_width', String(Math.round(width)));
}
