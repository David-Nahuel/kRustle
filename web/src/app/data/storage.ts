import { type WritableSignal, effect, signal } from '@angular/core';

/** localStorage puede no estar disponible (modo privado, cuota llena): nunca debe romper la app. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento la app sigue funcionando; solo no recuerda el estado.
  }
}

/** Signal que se guarda en localStorage en cada cambio. Requiere contexto de inyección. */
export function persistedSignal<T>(key: string, initial: T): WritableSignal<T> {
  const value = signal<T>(readJson(key, initial));
  effect(() => writeJson(key, value()));
  return value;
}
