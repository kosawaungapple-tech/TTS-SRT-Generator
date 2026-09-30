
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, translations } from '../translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('VBS_LANGUAGE');
    return (saved === 'en' || saved === 'mm') ? saved : 'mm';
  });

  useEffect(() => {
    localStorage.setItem('VBS_LANGUAGE', language);
    // Apply font family globally based on language
    if (language === 'mm') {
      document.documentElement.classList.add('mm-font');
    } else {
      document.documentElement.classList.remove('mm-font');
    }
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  // Type-safe translation helper
  const t = (path: string): string => {
    const keys = path.split('.');
    let current: Record<string, unknown> = translations as unknown as Record<string, unknown>;
    
    for (const key of keys) {
      if (!current || (current as Record<string, unknown>)[key] === undefined) {
        console.warn(`Translation key not found: ${path}`);
        return path;
      }
      current = (current as Record<string, unknown>)[key] as Record<string, unknown>;
    }
    
    return (current as unknown as Record<Language, string>)[language] || path;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
