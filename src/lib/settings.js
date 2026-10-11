import { useCallback, useEffect, useState } from 'react';

export const SETTINGS_KEY = 'mercheck-settings';
// Key used before the rename; read once so saved preferences carry over.
const LEGACY_SETTINGS_KEY = 'mercheck-hub-settings';

// `themeColor` tints the browser / status bar; `swatch` previews the theme in
// the settings panel (background on one half, accent on the other).
export const THEMES = {
  gold: {
    label: 'Gold',
    themeColor: '#100c05',
    swatch: 'linear-gradient(135deg, #1b1508 0 55%, #e2b53c 55%)',
  },
  rose: {
    label: 'Rosé',
    themeColor: '#f5eee3',
    swatch: 'linear-gradient(135deg, #f5eee3 0 55%, #ec8ca8 55%)',
  },
};

const DEFAULTS = { theme: 'gold', showQuantity: true };

const loadSettings = () => {
  try {
    const raw = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY),
    );
    return {
      theme: raw?.theme in THEMES ? raw.theme : DEFAULTS.theme,
      showQuantity: raw?.showQuantity !== false,
    };
  } catch {
    return DEFAULTS;
  }
};

/** Display preferences, persisted separately from the lists themselves. */
export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEMES[settings.theme].themeColor);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
  }, [settings]);

  const updateSettings = useCallback((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);

  return [settings, updateSettings];
}
