//! `meta-analysis.json`: lo que enseña la sección Meta de la web y no sale de `usage.json`.
//!
//! - **Tendencia**: proporción de equipos con cada especie en los últimos días frente a las
//!   semanas anteriores.
//! - **Núcleos**: parejas y tríos de especies que más se llevan juntos y cómo les va.
//! - **Enfrentamientos**: cómo les va a los equipos con X contra los equipos con Y.
//! - **Arquetipos**: equipos con los mismos 6 Pokémon, con sus resultados y su set más llevado.
//!
//! Como en `usage.json`, los winrates no se ponderan (cada partida cuenta igual) y no cuentan
//! los mirrors: una partida solo cuenta para X contra Y si X está en un solo lado e Y en el otro.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::{Match, Set, Team, round4};
use crate::limitless::Tournament;

/// Ventana "reciente" de la tendencia y ventana anterior con la que se compara, en días.
const TREND_DAYS: i64 = 7;
const BASELINE_DAYS: i64 = 21;
/// Núcleos que se publican: los más usados, siempre que los lleve al menos este porcentaje.
const MAX_PAIRS: usize = 40;
const MAX_TRIOS: usize = 30;
const MIN_CORE_SHARE: f64 = 0.01;
/// Enfrentamientos entre especies: partidas mínimas para publicarlos y cuántos por lado.
const MIN_MATCHUP_GAMES: u32 = 40;
const MATCHUPS_PER_SIDE: usize = 6;
/// Al ordenar enfrentamientos se suman estas partidas al 50%, para que unos pocos resultados
/// no manden: un 8-2 queda por detrás de un 60-40.
const MATCHUP_PRIOR_GAMES: f64 = 20.0;
/// Arquetipos (equipos con los mismos 6 Pokémon) que se publican: los más llevados.
const MIN_ARCHETYPE_TEAMS: usize = 15;
const MAX_ARCHETYPES: usize = 50;
/// Victorias y top 8 solo cuentan en torneos de este tamaño: ganar uno de 8 no dice lo mismo.
const MIN_RESULT_PLAYERS: u32 = 32;
const TOP_CUT: u32 = 8;
const BEST_FINISHES: usize = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaAnalysis {
    trend_days: i64,
    baseline_days: i64,
    /// Equipos de cada ventana (con pocos, la web no enseña la tendencia).
    recent_teams: u32,
    baseline_teams: u32,
    species: Vec<SpeciesMeta>,
    pairs: Vec<Core>,
    trios: Vec<Core>,
    archetypes: Vec<Archetype>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Archetype {
    /// Los 6 Pokémon, por orden alfabético.
    species: Vec<String>,
    teams: u32,
    share: f64,
    /// Jugadores distintos que lo han llevado.
    players: u32,
    /// Partidas contra equipos que no son el mismo arquetipo.
    games: u32,
    win_rate: Option<f64>,
    /// Veces que se llevó en torneos de `MIN_RESULT_PLAYERS` jugadores o más, y cuántas de ellas
    /// ganaron el torneo o llegaron al top 8 (la proporción no favorece a lo más jugado).
    large_entries: u32,
    wins: u32,
    top_cuts: u32,
    /// Mejores resultados, por puesto relativo al tamaño del torneo.
    best: Vec<Finish>,
    /// El set más llevado de cada Pokémon en el arquetipo (pesa más lo reciente y lo que gana).
    sets: Vec<ArchetypeSet>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Finish {
    placing: u32,
    players: u32,
    tournament: String,
    date: String,
    player: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchetypeSet {
    species: String,
    item: Option<String>,
    ability: Option<String>,
    nature: Option<String>,
    moves: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeciesMeta {
    species: String,
    /// Proporción de equipos que la llevan en cada ventana.
    recent: f64,
    baseline: f64,
    /// Especies rivales contra las que mejor le va (de mejor a peor) y peor (de peor a mejor).
    best: Vec<Matchup>,
    worst: Vec<Matchup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Matchup {
    species: String,
    games: u32,
    win_rate: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Core {
    species: Vec<String>,
    teams: u32,
    /// Proporción de equipos que lo llevan.
    share: f64,
    /// Partidas contra equipos que no lo llevan entero.
    games: u32,
    win_rate: Option<f64>,
}

/// Puntos y partidas (una victoria vale 1, un empate 0,5).
#[derive(Default, Clone, Copy)]
struct Tally {
    points: f64,
    games: u32,
}

impl Tally {
    fn add(&mut self, points: f64) {
        self.points += points;
        self.games += 1;
    }

    fn win_rate(self) -> Option<f64> {
        (self.games > 0).then(|| round4(self.points / self.games as f64))
    }
}

pub fn build(tournaments: &[&Tournament], teams: &[Team], matches: &[Match]) -> MetaAnalysis {
    let species: Vec<Vec<&str>> = teams
        .iter()
        .map(|t| {
            let mut s: Vec<&str> = t.sets.iter().map(|s| s.species.as_str()).collect();
            s.sort_unstable();
            s
        })
        .collect();

    // Tendencia: días desde el último torneo de la muestra.
    let dates: Vec<_> = tournaments.iter().map(|t| t.date()).collect();
    let last = dates.iter().flatten().max().copied();
    let (mut recent, mut baseline) = (Window::default(), Window::default());
    for (team, names) in teams.iter().zip(&species) {
        let (Some(last), Some(date)) = (last, dates[team.tournament]) else {
            continue;
        };
        let age = (last - date).num_days();
        let window = if age < TREND_DAYS {
            &mut recent
        } else if age < TREND_DAYS + BASELINE_DAYS {
            &mut baseline
        } else {
            continue;
        };
        window.teams += 1;
        for s in names {
            *window.species.entry(s).or_default() += 1;
        }
    }

    // Núcleos: cuántos equipos los llevan y cómo les va.
    let mut core_teams: HashMap<Vec<&str>, u32> = HashMap::new();
    for names in &species {
        for core in cores(names) {
            *core_teams.entry(core).or_default() += 1;
        }
    }

    let mut versus: HashMap<(&str, &str), Tally> = HashMap::new();
    let mut core_record: HashMap<Vec<&str>, Tally> = HashMap::new();
    for m in matches {
        let (a, b) = (&species[m.a], &species[m.b]);
        let points_a = match m.result {
            1 => 1.0,
            2 => 0.0,
            _ => 0.5,
        };
        for (mine, theirs, points) in [(a, b, points_a), (b, a, 1.0 - points_a)] {
            for x in mine.iter().filter(|x| !theirs.contains(x)) {
                for y in theirs.iter().filter(|y| !mine.contains(y)) {
                    versus.entry((x, y)).or_default().add(points);
                }
            }
            for core in cores(mine) {
                if !core.iter().all(|s| theirs.contains(s)) {
                    core_record.entry(core).or_default().add(points);
                }
            }
        }
    }

    let total = teams.len().max(1) as f64;
    let top_cores = |size: usize, max: usize| -> Vec<Core> {
        let mut list: Vec<(&Vec<&str>, u32)> = core_teams
            .iter()
            .filter(|(core, n)| core.len() == size && **n as f64 / total >= MIN_CORE_SHARE)
            .map(|(core, n)| (core, *n))
            .collect();
        list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        list.into_iter()
            .take(max)
            .map(|(core, n)| {
                let record = core_record.get(core).copied().unwrap_or_default();
                Core {
                    species: core.iter().map(|s| s.to_string()).collect(),
                    teams: n,
                    share: round4(n as f64 / total),
                    games: record.games,
                    win_rate: record.win_rate(),
                }
            })
            .collect()
    };

    // Enfrentamientos de cada especie, ordenados con el 50% como punto de partida.
    let mut by_species: HashMap<&str, Vec<(f64, Matchup)>> = HashMap::new();
    for ((x, y), tally) in &versus {
        if tally.games < MIN_MATCHUP_GAMES {
            continue;
        }
        let prior = MATCHUP_PRIOR_GAMES;
        let score = (tally.points + prior / 2.0) / (tally.games as f64 + prior);
        by_species.entry(x).or_default().push((
            score,
            Matchup {
                species: y.to_string(),
                games: tally.games,
                win_rate: round4(tally.points / tally.games as f64),
            },
        ));
    }

    let mut all_species: Vec<&str> = species.iter().flatten().copied().collect();
    all_species.sort_unstable();
    all_species.dedup();
    let species_meta = all_species
        .into_iter()
        .map(|s| {
            let mut matchups = by_species.remove(s).unwrap_or_default();
            matchups.sort_by(|a, b| {
                b.0.total_cmp(&a.0)
                    .then_with(|| a.1.species.cmp(&b.1.species))
            });
            let (best, worst): (Vec<_>, Vec<_>) =
                matchups.into_iter().partition(|(score, _)| *score > 0.5);
            let best = best
                .into_iter()
                .take(MATCHUPS_PER_SIDE)
                .map(|(_, m)| m)
                .collect();
            let worst = worst
                .into_iter()
                .rev()
                .take(MATCHUPS_PER_SIDE)
                .map(|(_, m)| m)
                .collect();
            SpeciesMeta {
                species: s.to_string(),
                recent: recent.share(s),
                baseline: baseline.share(s),
                best,
                worst,
            }
        })
        .collect();

    MetaAnalysis {
        trend_days: TREND_DAYS,
        baseline_days: BASELINE_DAYS,
        recent_teams: recent.teams,
        baseline_teams: baseline.teams,
        species: species_meta,
        pairs: top_cores(2, MAX_PAIRS),
        trios: top_cores(3, MAX_TRIOS),
        archetypes: archetypes(tournaments, teams, &species, matches),
    }
}

/// Los equipos agrupados por sus 6 Pokémon, de más a menos llevados.
fn archetypes(
    tournaments: &[&Tournament],
    teams: &[Team],
    species: &[Vec<&str>],
    matches: &[Match],
) -> Vec<Archetype> {
    let mut groups: HashMap<&[&str], Vec<usize>> = HashMap::new();
    for (i, names) in species.iter().enumerate() {
        groups.entry(names).or_default().push(i);
    }
    let mut ranked: Vec<(&[&str], Vec<usize>)> = groups
        .into_iter()
        .filter(|(_, members)| members.len() >= MIN_ARCHETYPE_TEAMS)
        .collect();
    ranked.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(MAX_ARCHETYPES);

    let mut record: HashMap<&[&str], Tally> = HashMap::new();
    for m in matches {
        let (a, b) = (species[m.a].as_slice(), species[m.b].as_slice());
        if a == b {
            continue;
        }
        let points_a = match m.result {
            1 => 1.0,
            2 => 0.0,
            _ => 0.5,
        };
        record.entry(a).or_default().add(points_a);
        record.entry(b).or_default().add(1.0 - points_a);
    }

    let total = teams.len().max(1) as f64;
    ranked
        .into_iter()
        .map(|(key, members)| {
            let tally = record.get(key).copied().unwrap_or_default();
            let players: HashSet<&str> =
                members.iter().map(|&i| teams[i].player.as_str()).collect();

            // (puesto, jugadores del torneo, equipo)
            let mut finishes: Vec<(u32, u32, usize)> = members
                .iter()
                .filter_map(|&i| {
                    let placing = teams[i].placing?;
                    Some((placing, tournaments[teams[i].tournament].players, i))
                })
                .collect();
            let large_entries = members
                .iter()
                .filter(|&&i| tournaments[teams[i].tournament].players >= MIN_RESULT_PLAYERS)
                .count();
            let counts = |f: &&(u32, u32, usize)| f.1 >= MIN_RESULT_PLAYERS;
            let wins = finishes.iter().filter(counts).filter(|f| f.0 == 1).count();
            let top_cuts = finishes
                .iter()
                .filter(counts)
                .filter(|f| f.0 <= TOP_CUT)
                .count();
            finishes.sort_by(|a, b| {
                let relative = |f: &(u32, u32, usize)| f.0 as f64 / f.1.max(1) as f64;
                relative(a)
                    .total_cmp(&relative(b))
                    .then_with(|| b.1.cmp(&a.1))
            });
            let best = finishes
                .iter()
                .take(BEST_FINISHES)
                .map(|&(placing, players, i)| {
                    let tournament = tournaments[teams[i].tournament];
                    Finish {
                        placing,
                        players,
                        tournament: tournament.name.clone(),
                        date: tournament.date.clone(),
                        player: teams[i].player_name.clone(),
                    }
                })
                .collect();

            Archetype {
                species: key.iter().map(|s| s.to_string()).collect(),
                teams: members.len() as u32,
                share: round4(members.len() as f64 / total),
                players: players.len() as u32,
                games: tally.games,
                win_rate: tally.win_rate(),
                large_entries: large_entries as u32,
                wins: wins as u32,
                top_cuts: top_cuts as u32,
                best,
                sets: key.iter().map(|s| main_set(teams, &members, s)).collect(),
            }
        })
        .collect()
}

/// El set de `species` que más pesa entre los equipos `members`.
fn main_set(teams: &[Team], members: &[usize], species: &str) -> ArchetypeSet {
    let mut weights: HashMap<&Set, f64> = HashMap::new();
    for &i in members {
        if let Some(set) = teams[i].sets.iter().find(|s| s.species == species) {
            *weights.entry(set).or_default() += teams[i].weight;
        }
    }
    let set = weights
        .into_iter()
        .max_by(|a, b| {
            a.1.total_cmp(&b.1).then_with(|| {
                // Empate: el primero por orden alfabético, para que la salida no cambie sola.
                (&b.0.item, &b.0.ability, &b.0.nature, &b.0.moves).cmp(&(
                    &a.0.item,
                    &a.0.ability,
                    &a.0.nature,
                    &a.0.moves,
                ))
            })
        })
        .map(|(set, _)| set);
    ArchetypeSet {
        species: species.to_string(),
        item: set.and_then(|s| s.item.clone()),
        ability: set.and_then(|s| s.ability.clone()),
        nature: set.and_then(|s| s.nature.clone()),
        moves: set.map(|s| s.moves.clone()).unwrap_or_default(),
    }
}

/// Equipos de una ventana de la tendencia y cuántos llevan cada especie.
#[derive(Default)]
struct Window<'a> {
    teams: u32,
    species: HashMap<&'a str, u32>,
}

impl Window<'_> {
    fn share(&self, species: &str) -> f64 {
        if self.teams == 0 {
            return 0.0;
        }
        round4(self.species.get(species).copied().unwrap_or(0) as f64 / self.teams as f64)
    }
}

/// Parejas y tríos de un equipo (con las especies ya ordenadas, salen ordenados).
fn cores<'a>(species: &[&'a str]) -> Vec<Vec<&'a str>> {
    let n = species.len();
    let mut out = Vec::new();
    for i in 0..n {
        for j in i + 1..n {
            out.push(vec![species[i], species[j]]);
            for k in j + 1..n {
                out.push(vec![species[i], species[j], species[k]]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::limitless::Record;

    fn tournament(date: &str) -> Tournament {
        Tournament {
            id: date.into(),
            name: date.into(),
            date: format!("{date}T00:00:00Z"),
            format: Some("M-C".into()),
            players: 8,
        }
    }

    fn team(tournament: usize, species: &[&str]) -> Team {
        Team {
            tournament,
            player: String::new(),
            player_name: String::new(),
            record: Record::default(),
            placing: None,
            weight: 1.0,
            sets: species
                .iter()
                .map(|s| Set {
                    species: s.to_string(),
                    item: None,
                    ability: None,
                    nature: None,
                    moves: Vec::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn trend_compares_the_last_week_with_the_previous_three() {
        let tournaments = [
            // Más de 4 semanas antes del último torneo: no cuenta.
            tournament("2026-09-01"),
            // Ventana anterior (15 días antes).
            tournament("2026-09-25"),
            // Última semana.
            tournament("2026-10-05"),
            tournament("2026-10-10"),
        ];
        let refs: Vec<&Tournament> = tournaments.iter().collect();
        let teams = [
            team(0, &["A", "B"]),
            team(1, &["B", "C"]),
            team(2, &["A", "C"]),
            team(3, &["A", "B"]),
        ];
        let meta = build(&refs, &teams, &[]);
        assert_eq!((meta.recent_teams, meta.baseline_teams), (2, 1));
        let share = |name: &str| {
            let s = meta.species.iter().find(|s| s.species == name).unwrap();
            (s.recent, s.baseline)
        };
        assert_eq!(share("A"), (1.0, 0.0));
        assert_eq!(share("B"), (0.5, 1.0));
    }

    #[test]
    fn cores_count_teams_and_skip_mirrors() {
        let t = tournament("2026-10-10");
        let teams = [
            team(0, &["A", "B", "C"]),
            team(0, &["A", "B", "D"]),
            team(0, &["C", "D", "E"]),
        ];
        let matches = [
            // A+B (equipo 0) gana a un equipo sin el núcleo.
            Match {
                a: 0,
                b: 2,
                result: 1,
            },
            // Mirror de A+B: no cuenta para la pareja.
            Match {
                a: 0,
                b: 1,
                result: 2,
            },
        ];
        let meta = build(&[&t], &teams, &matches);
        let ab = meta.pairs.iter().find(|c| c.species == ["A", "B"]).unwrap();
        assert_eq!(ab.teams, 2);
        assert_eq!((ab.games, ab.win_rate), (1, Some(1.0)));
        assert_eq!(meta.trios.len(), 3);
    }

    #[test]
    fn archetypes_group_identical_teams_with_results_and_main_sets() {
        const SIX: [&str; 6] = ["A", "B", "C", "D", "E", "F"];
        let mut big = tournament("2026-10-05");
        big.players = 64;
        let small = tournament("2026-10-10");
        let mut teams: Vec<Team> = (0..MIN_ARCHETYPE_TEAMS)
            .map(|i| {
                let mut t = team(0, &SIX);
                t.player = format!("p{}", i % 5);
                // A lleva Leftovers en 10 equipos y Sitrus Berry en 5.
                t.sets[0].item = Some(if i < 10 { "Leftovers" } else { "Sitrus Berry" }.into());
                t
            })
            .collect();
        teams[0].placing = Some(1);
        teams[1].placing = Some(5);
        // Ganar un torneo de 8 jugadores no cuenta como victoria.
        let mut winner_of_small = team(1, &SIX);
        winner_of_small.player = "p0".into();
        winner_of_small.placing = Some(1);
        teams.push(winner_of_small);
        teams.push(team(1, &["A", "B", "C", "D", "E", "Z"]));
        let other = teams.len() - 1;
        let matches = [
            Match {
                a: 0,
                b: other,
                result: 1,
            },
            // Mirror: no cuenta.
            Match {
                a: 0,
                b: 1,
                result: 2,
            },
        ];

        let meta = build(&[&big, &small], &teams, &matches);
        assert_eq!(meta.archetypes.len(), 1);
        let a = &meta.archetypes[0];
        assert_eq!(a.species, SIX);
        assert_eq!((a.teams, a.players), (16, 5));
        assert_eq!((a.games, a.win_rate), (1, Some(1.0)));
        assert_eq!((a.large_entries, a.wins, a.top_cuts), (15, 1, 2));
        // El 1.º de 64 va antes que el 1.º de 8 (puesto relativo) y que el 5.º de 64.
        assert_eq!(
            a.best
                .iter()
                .map(|f| (f.placing, f.players))
                .collect::<Vec<_>>(),
            [(1, 64), (5, 64), (1, 8)]
        );
        assert_eq!(a.sets[0].item.as_deref(), Some("Leftovers"));
    }

    #[test]
    fn matchups_list_best_and_worst_opponents() {
        let t = tournament("2026-10-10");
        let teams = [team(0, &["X"]), team(0, &["Y"]), team(0, &["Z"])];
        let mut matches = Vec::new();
        // X gana siempre a Y y pierde 30-20 contra Z.
        for _ in 0..50 {
            matches.push(Match {
                a: 0,
                b: 1,
                result: 1,
            });
        }
        for i in 0..50 {
            matches.push(Match {
                a: 0,
                b: 2,
                result: if i < 20 { 1 } else { 2 },
            });
        }
        let meta = build(&[&t], &teams, &matches);
        let x = meta.species.iter().find(|s| s.species == "X").unwrap();
        assert_eq!(x.best[0].species, "Y");
        assert_eq!(x.best[0].win_rate, 1.0);
        assert_eq!(x.worst[0].species, "Z");
        assert_eq!((x.worst[0].games, x.worst[0].win_rate), (50, 0.4));
        // Cada enfrentamiento va a su lista según quede por encima o por debajo del 50%.
        let y = meta.species.iter().find(|s| s.species == "Y").unwrap();
        assert!(y.best.is_empty());
        assert_eq!(y.worst[0].species, "X");
        let z = meta.species.iter().find(|s| s.species == "Z").unwrap();
        assert_eq!(z.best[0].species, "X");
        assert!(z.worst.is_empty());
    }
}
