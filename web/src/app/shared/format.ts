import type { ComboOdds } from '../../engine/combined';
import type { DamageOdds } from '../../engine/damage';
import type { I18n } from '../i18n/i18n.service';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export function pct(x: number): string {
  if (x > 0.995) return '100%';
  if (x > 0 && x < 0.005) return '<1%';
  return `${Math.round(x * 100)}%`;
}

/**
 * Resumen corto del daño para leerlo de un vistazo. `attacking` indica si el que golpea soy
 * yo (un KO es bueno) o el rival (un KO es malo).
 */
export function koSummary(
  odds: DamageOdds,
  attacking: boolean,
  t: I18n['t'],
): { label: string; tone: Tone } {
  const good: Tone = attacking ? 'good' : 'bad';
  const meh: Tone = 'warn';
  if (odds.ohkoChance >= 0.995) return { label: t('ko.ohko'), tone: good };
  if (odds.ohkoChance >= 0.05) {
    return { label: t('ko.ohkoChance', { pct: pct(odds.ohkoChance) }), tone: meh };
  }
  if (odds.twoHkoChance >= 0.995) return { label: t('ko.2hko'), tone: meh };
  if (odds.twoHkoChance >= 0.05)
    return { label: t('ko.2hkoChance', { pct: pct(odds.twoHkoChance) }), tone: 'neutral' };
  const hits = odds.likely.ko.hits;
  return { label: hits ? t('ko.nhko', { n: hits }) : t('ko.many'), tone: 'neutral' };
}

/** Lo mismo para el golpe doble: si lo debilitan entre los dos este turno. */
export function comboSummary(
  odds: ComboOdds,
  attacking: boolean,
  t: I18n['t'],
): { label: string; tone: Tone } {
  if (odds.koChance >= 0.995) return { label: t('combo.ko'), tone: attacking ? 'good' : 'bad' };
  if (odds.koChance >= 0.05) {
    return { label: t('combo.koChance', { pct: pct(odds.koChance) }), tone: 'warn' };
  }
  return { label: t('combo.noKo'), tone: 'neutral' };
}

/**
 * Colores de un resultado (te mueves antes, cubres bien a un rival...). Verde = bueno, naranja =
 * malo: el rosa queda para identificar al rival y el ámbar para la selección y los avisos.
 */
/** Lo mínimo que tiene que alejarse un winrate del 50% para destacarlo, aunque sea seguro. */
const MIN_EDGE = 0.03;

/**
 * Verde si un winrate está por encima del 50% con claridad, naranja si está por debajo y neutro
 * si no se puede asegurar: tiene que alejarse al menos 3 puntos y más de lo que daría el azar con
 * esas partidas (al 95%: ±1,96·√(0,25 / partidas)). Un 76% en 43 partidas cuenta; un 52% en 50, no.
 */
export function winRateTone(winRate: number | null, games: number): Tone {
  if (winRate === null || games <= 0) return 'neutral';
  const edge = winRate - 0.5;
  const noise = 1.96 * Math.sqrt(0.25 / games);
  if (Math.abs(edge) < Math.max(MIN_EDGE, noise)) return 'neutral';
  return edge > 0 ? 'good' : 'bad';
}

export const TONE_CLASSES: Record<Tone, string> = {
  good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  warn: 'bg-yellow-500/10 text-yellow-200 ring-yellow-500/40',
  bad: 'bg-orange-500/15 text-orange-300 ring-orange-500/40',
  neutral: 'bg-slate-500/15 text-slate-300 ring-slate-500/40',
};

export const TYPE_CLASSES: Record<string, string> = {
  Normal: 'bg-stone-400 text-stone-950',
  Fire: 'bg-orange-500 text-orange-950',
  Water: 'bg-sky-500 text-sky-950',
  Electric: 'bg-yellow-400 text-yellow-950',
  Grass: 'bg-green-500 text-green-950',
  Ice: 'bg-cyan-300 text-cyan-950',
  Fighting: 'bg-red-700 text-red-50',
  Poison: 'bg-purple-500 text-purple-50',
  Ground: 'bg-amber-600 text-amber-950',
  Flying: 'bg-indigo-300 text-indigo-950',
  Psychic: 'bg-pink-500 text-pink-50',
  Bug: 'bg-lime-500 text-lime-950',
  Rock: 'bg-yellow-700 text-yellow-50',
  Ghost: 'bg-violet-700 text-violet-50',
  Dragon: 'bg-indigo-600 text-indigo-50',
  Dark: 'bg-neutral-700 text-neutral-50',
  Steel: 'bg-slate-400 text-slate-950',
  Fairy: 'bg-pink-300 text-pink-950',
};
