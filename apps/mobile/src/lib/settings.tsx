import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type TemperatureUnit = 'celsius' | 'fahrenheit';

const TEMPERATURE_UNIT_KEY = 'freshness-tracker.temperature-unit';

interface Settings {
  temperatureUnit: TemperatureUnit;
  setTemperatureUnit: (unit: TemperatureUnit) => void;
}

const SettingsContext = createContext<Settings>({
  temperatureUnit: 'celsius',
  setTemperatureUnit: () => undefined,
});

function isTemperatureUnit(value: string | null): value is TemperatureUnit {
  return value === 'celsius' || value === 'fahrenheit';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [temperatureUnit, setTemperatureUnitState] = useState<TemperatureUnit>('celsius');

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(TEMPERATURE_UNIT_KEY)
      .then((stored) => {
        if (active && isTemperatureUnit(stored)) setTemperatureUnitState(stored);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setTemperatureUnit = useCallback((unit: TemperatureUnit) => {
    setTemperatureUnitState(unit);
    void AsyncStorage.setItem(TEMPERATURE_UNIT_KEY, unit).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ temperatureUnit, setTemperatureUnit }),
    [temperatureUnit, setTemperatureUnit],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/** Format a Celsius API value in the user's display unit. */
export function formatTemperature(
  celsius: number,
  unit: TemperatureUnit,
  fractionDigits = 1,
): string {
  const value = unit === 'fahrenheit' ? celsiusToFahrenheit(celsius) : celsius;
  return `${value.toFixed(fractionDigits)} °${unit === 'fahrenheit' ? 'F' : 'C'}`;
}
