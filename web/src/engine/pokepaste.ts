import {
  SP_PER_STAT,
  SP_TOTAL,
  STAT_IDS,
  type StatId,
  type Stats,
  emptyStats,
  getAbility,
  getItem,
  getMove,
  getNature,
  getSpecies,
  previewSpecies,
  statTotal,
} from './champions';

export interface TeamMember {
  nickname?: string;
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  sps: Stats;
  moves: string[];
}

/**
 * Algo del paste que no se ha podido leer tal cual. Es un código con sus datos, no una frase:
 * la interfaz lo explica en el idioma elegido.
 */
export type PasteWarning =
  | { code: 'unknownSpecies'; value: string }
  | {
      code: 'unknownItem' | 'unknownAbility' | 'unknownNature' | 'unknownMove';
      species: string;
      value: string;
    }
  | { code: 'duplicate' | 'tooManyMoves' | 'evsConverted'; species: string }
  | { code: 'tooManyMembers'; count: number }
  | { code: 'spOverflow'; species: string; max: number }
  /** Sin línea de SP (Showdown no exporta los que están a 0); `noNature`: tampoco naturaleza. */
  | { code: 'noSpread'; species: string[]; noNature: boolean };

export interface ParsedTeam {
  members: TeamMember[];
  warnings: PasteWarning[];
}

const STAT_LABELS: Record<string, StatId> = {
  hp: 'hp',
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};

/** Los Pokémon del texto, separados por líneas en blanco. */
function splitBlocks(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Lee un equipo en formato Showdown / Pokepaste. Nunca lanza: lo que no entiende
 * lo ignora y lo explica en `warnings`.
 */
export function parsePokepaste(text: string): ParsedTeam {
  const { members, warnings } = readTeam(text);
  return { members, warnings };
}

/** Como `parsePokepaste`, y además en qué bloque del texto está cada Pokémon. */
function readTeam(text: string): ParsedTeam & { blocks: number[] } {
  const warnings: PasteWarning[] = [];
  const members: TeamMember[] = [];
  const memberBlocks: number[] = [];
  const blocks = splitBlocks(text);

  const noSpread = new Set<TeamMember>();
  blocks.forEach((block, index) => {
    const member = parseMember(block, warnings, noSpread);
    if (!member) return;
    if (members.some((m) => m.species === member.species)) {
      warnings.push({ code: 'duplicate', species: member.species });
      return;
    }
    members.push(member);
    memberBlocks.push(index);
  });

  if (members.length > 6) {
    warnings.push({ code: 'tooManyMembers', count: members.length });
    members.length = 6;
    memberBlocks.length = 6;
  }

  // Showdown no exporta los SPs a 0 ni la naturaleza sin elegir: sin ellos el cálculo se queda corto.
  const unset = members.filter((m) => noSpread.has(m));
  const names = (list: TeamMember[]) => list.map((m) => m.species);
  const withoutNature = unset.filter((m) => !m.nature);
  const withNature = unset.filter((m) => m.nature);
  if (withoutNature.length) {
    warnings.push({ code: 'noSpread', species: names(withoutNature), noNature: true });
  }
  if (withNature.length) {
    warnings.push({ code: 'noSpread', species: names(withNature), noNature: false });
  }
  return { members, warnings, blocks: memberBlocks };
}

const SPREAD_LABELS: Record<StatId, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

/**
 * Un Pokémon en formato Showdown, como lo exporta el editor de equipos. Los Stat Points van en
 * la línea "EVs" (así los exporta Showdown en Champions); si están todos a 0, no se escribe.
 */
export function formatMember(member: TeamMember): string {
  const name = member.nickname ? `${member.nickname} (${member.species})` : member.species;
  const lines = [member.item ? `${name} @ ${member.item}` : name];
  if (member.ability) lines.push(`Ability: ${member.ability}`);
  const spread = STAT_IDS.filter((s) => member.sps[s] > 0)
    .map((s) => `${member.sps[s]} ${SPREAD_LABELS[s]}`)
    .join(' / ');
  if (spread) lines.push(`EVs: ${spread}`);
  if (member.nature) lines.push(`${member.nature} Nature`);
  for (const move of member.moves) lines.push(`- ${move}`);
  return lines.join('\n');
}

/**
 * Cambia el Pokémon `index` del texto (o lo quita, con `null`) reescribiendo solo su bloque:
 * el resto queda tal y como estaba escrito.
 */
export function updateMember(text: string, index: number, member: TeamMember | null): string {
  const { blocks: memberBlocks } = readTeam(text);
  const blocks = splitBlocks(text);
  const block = memberBlocks[index];
  if (block === undefined) return text;
  if (member) blocks[block] = formatMember(member);
  else blocks.splice(block, 1);
  return joinBlocks(blocks);
}

/** Añade un Pokémon al final del texto. */
export function addMember(text: string, member: TeamMember): string {
  return joinBlocks([...splitBlocks(text), formatMember(member)]);
}

/** Un Pokémon por bloque, separados por una línea en blanco, como en Showdown. */
function joinBlocks(blocks: string[]): string {
  return blocks.length ? blocks.join('\n\n') + '\n' : '';
}

function parseMember(
  block: string,
  warnings: PasteWarning[],
  noSpread: Set<TeamMember>,
): TeamMember | null {
  const [header, ...lines] = block.split('\n').map((l) => l.trim());

  const [left, rawItem] = header.split(/\s+@\s+/, 2);
  const withoutGender = left.replace(/\s*\((M|F)\)\s*$/, '');
  const named = withoutGender.match(/^(.*)\s+\(([^()]+)\)$/);
  const rawSpecies = (named ? named[2] : withoutGender).trim();

  const species = getSpecies(rawSpecies);
  if (!species) {
    warnings.push({ code: 'unknownSpecies', value: rawSpecies });
    return null;
  }
  const name = previewSpecies(species.name);
  const member: TeamMember = { species: name, sps: emptyStats(), moves: [] };
  if (named) member.nickname = named[1].trim();

  if (rawItem) {
    member.item = getItem(rawItem)?.name;
    if (!member.item) warnings.push({ code: 'unknownItem', species: name, value: rawItem });
  }

  let hasSpread = false;
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^Ability:\s*(.+)$/i))) {
      member.ability = getAbility(m[1])?.name;
      if (!member.ability) {
        warnings.push({ code: 'unknownAbility', species: name, value: m[1] });
      }
    } else if ((m = line.match(/^(EVs|SPs):\s*(.+)$/i))) {
      member.sps = parseSpread(m[2], m[1].toUpperCase() === 'EVS', name, warnings);
      hasSpread = true;
    } else if ((m = line.match(/^(\w+)\s+Nature$/i))) {
      member.nature = getNature(m[1])?.name;
      if (!member.nature) {
        warnings.push({ code: 'unknownNature', species: name, value: m[1] });
      }
    } else if ((m = line.match(/^[-~]\s*(.+)$/))) {
      const move = getMove(m[1]);
      if (move) member.moves.push(move.name);
      else warnings.push({ code: 'unknownMove', species: name, value: m[1] });
    }
    // Level, IVs, Tera Type, Shiny, Happiness... no aplican a Champions.
  }

  if (!hasSpread) noSpread.add(member);

  if (member.moves.length > 4) {
    warnings.push({ code: 'tooManyMoves', species: name });
    member.moves.length = 4;
  }
  return member;
}

function parseSpread(
  text: string,
  labelledEvs: boolean,
  name: string,
  warnings: PasteWarning[],
): Stats {
  const raw = emptyStats();
  for (const part of text.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(\w+)$/);
    const stat = m && STAT_LABELS[m[2].toLowerCase()];
    if (m && stat) raw[stat] = Number(m[1]);
  }

  // Un paste de Showdown de Champions puede traer SPs bajo la etiqueta "EVs":
  // solo se convierte si los números no caben como SPs.
  const looksLikeEvs =
    labelledEvs && (STAT_IDS.some((s) => raw[s] > SP_PER_STAT) || statTotal(raw) > SP_TOTAL);
  const sps = emptyStats();
  for (const s of STAT_IDS) {
    // A nivel 50, 1 SP ≈ 8 EVs (252 → 32, 4 → 1).
    const value = looksLikeEvs ? Math.ceil(raw[s] / 8) : raw[s];
    sps[s] = Math.min(SP_PER_STAT, value);
  }
  if (looksLikeEvs) warnings.push({ code: 'evsConverted', species: name });

  let excess = statTotal(sps) - SP_TOTAL;
  if (excess > 0) {
    warnings.push({ code: 'spOverflow', species: name, max: SP_TOTAL });
    // Se recorta empezando por el stat con menos inversión, que suele ser el "sobrante".
    for (const s of [...STAT_IDS].sort((a, b) => sps[a] - sps[b])) {
      const cut = Math.min(sps[s], excess);
      sps[s] -= cut;
      excess -= cut;
      if (excess === 0) break;
    }
  }
  return sps;
}
