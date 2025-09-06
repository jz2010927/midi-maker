/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

let translations: Record<string, string> = {};

/**
 * Loads a language file and updates the application's translations.
 * @param lang The language code to load (e.g., 'en', 'es').
 */
export async function setLanguage(lang: string): Promise<void> {
  // Prevent loading the same language file multiple times
  if (document.documentElement.lang === lang && Object.keys(translations).length > 0) {
    return;
  }
  
  try {
    const response = await fetch(`/locales/${lang}.json`);
    if (!response.ok) {
      throw new Error(`Could not load language file: ${lang}.json`);
    }
    translations = await response.json();
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent('language-changed'));
  } catch (error) {
    console.error(error);
    // Fallback to English if the requested language fails to load
    if (lang !== 'en') {
      await setLanguage('en');
    }
  }
}

/**
 * Translates a given key into the currently loaded language.
 * @param key The translation key.
 * @param replacements Optional replacements for placeholder values.
 * @returns The translated string.
 */
export function t(key: string, replacements?: Record<string, string>): string {
  let translation = translations[key] || key;
  if (replacements) {
    Object.keys(replacements).forEach(rKey => {
      translation = translation.replace(`{{${rKey}}}`, replacements[rKey]);
    });
  }
  return translation;
}

// Initialize with the user's browser language or fallback to English.
const supportedLangs = ['en', 'zh-CN'];
let initialLang = 'en';
const browserLang = navigator.language; // e.g., 'zh-CN', 'de-AT'

// Try for a perfect match first (e.g., 'zh-CN')
if (supportedLangs.includes(browserLang)) {
    initialLang = browserLang;
} else {
    // Fallback to base language match (e.g., 'de' for 'de-AT')
    const baseLang = browserLang.split('-')[0];
    const fallbackLang = supportedLangs.find(l => l.startsWith(baseLang));
    if (fallbackLang) {
        initialLang = fallbackLang;
    }
}

setLanguage(initialLang);