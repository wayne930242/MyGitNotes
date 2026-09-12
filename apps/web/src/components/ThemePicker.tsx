import React, { useState, useRef, useEffect } from 'react';
import { Palette, Check, Sun, Moon } from 'lucide-react';
import { ThemeDefinition, THEMES } from '../lib/themes.js';
import { useTranslation } from '../lib/i18n/index.js';

interface ThemePickerProps {
  currentTheme: ThemeDefinition;
  onSelectTheme: (theme: ThemeDefinition) => void;
}

export const ThemePicker: React.FC<ThemePickerProps> = ({
  currentTheme,
  onSelectTheme,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={t('theme.current', {
          name: currentTheme.name,
          mode: currentTheme.mode === 'dark' ? t('theme.dark') : t('theme.light'),
        })}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition"
      >
        <Palette className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        {/* Visual tiny swatch preview on button */}
        <div className="flex items-center gap-0.5 ml-0.5">
          {currentTheme.swatches.map((color, idx) => (
            <span
              key={idx}
              className="w-2 h-2 rounded-full border border-black/10 dark:border-white/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 p-2 text-xs animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {t('theme.palettes')}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {t('theme.presets', { count: THEMES.length })}
            </span>
          </div>

          <div className="py-1 space-y-1 max-h-80 overflow-y-auto">
            {THEMES.map((theme) => {
              const isSelected = theme.id === currentTheme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => {
                    onSelectTheme(theme);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {theme.mode === 'dark' ? (
                      <Moon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                    ) : (
                      <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <div>
                      <div className="text-xs font-semibold leading-tight">{theme.name}</div>
                      <div className="text-[10px] text-slate-400 capitalize">
                        {theme.mode === 'dark' ? t('theme.dark') : t('theme.light')}
                      </div>
                    </div>
                  </div>

                  {/* Palette Swatch Preview */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                      {theme.swatches.map((swatch, idx) => (
                        <span
                          key={idx}
                          className="w-3 h-3 rounded-full border border-black/10 dark:border-white/15"
                          style={{ backgroundColor: swatch }}
                          title={swatch}
                        />
                      ))}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
