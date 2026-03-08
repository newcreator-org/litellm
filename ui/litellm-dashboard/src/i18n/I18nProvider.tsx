"use client";

import React, { createContext, useCallback, useContext, useMemo } from "react";
import jaTranslations from "./translations/ja.json";
import enTranslations from "./translations/en.json";

export type Locale = "ja" | "en";

type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, unknown>;

interface I18nContextType {
  locale: Locale;
  t: (key: string) => string;
  translations: Translations;
}

const translationMap: Record<Locale, Translations> = {
  ja: jaTranslations,
  en: enTranslations,
};

// Default locale - set to "ja" for Japanese localization
const DEFAULT_LOCALE: Locale = "ja";

const I18nContext = createContext<I18nContextType | null>(null);

/**
 * Get a nested value from a translations object using a dot-separated key.
 * e.g. "nav.items.virtualKeys" -> translations.nav.items.virtualKeys
 */
function getNestedValue(obj: Translations, key: string): string {
  const keys = key.split(".");
  let current: unknown = obj;
  for (const k of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return key; // Return the key itself as fallback
    }
    current = (current as Record<string, unknown>)[k];
  }
  if (typeof current === "string") {
    return current;
  }
  return key; // Return the key itself as fallback
}

interface I18nProviderProps {
  children: React.ReactNode;
  locale?: Locale;
}

export function I18nProvider({ children, locale = DEFAULT_LOCALE }: I18nProviderProps) {
  const translations = translationMap[locale] || translationMap[DEFAULT_LOCALE];

  const t = useCallback((key: string): string => {
    const value = getNestedValue(translations, key);
    if (value === key) {
      // Fallback to English if key not found in current locale
      const fallback = getNestedValue(translationMap.en, key);
      return fallback;
    }
    return value;
  }, [translations]);

  const contextValue = useMemo(() => ({ locale, t, translations }), [locale, t, translations]);

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to access translations.
 * Usage: const { t } = useTranslation();
 *        t("nav.items.virtualKeys") -> "仮想キー"
 */
export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Fallback for components outside the provider
    const fallbackTranslations = translationMap[DEFAULT_LOCALE];
    return {
      locale: DEFAULT_LOCALE,
      t: (key: string) => getNestedValue(fallbackTranslations, key),
      translations: fallbackTranslations,
    };
  }
  return context;
}

/**
 * Standalone translation function for use outside React components.
 * Uses the default locale (ja) translations directly.
 */
export function getTranslation(key: string): string {
  const translations = translationMap[DEFAULT_LOCALE];
  const value = getNestedValue(translations, key);
  if (value === key) {
    // Fallback to English if key not found in current locale
    const fallback = getNestedValue(translationMap.en, key);
    return fallback;
  }
  return value;
}

export { DEFAULT_LOCALE };
