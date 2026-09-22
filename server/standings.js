// 积分表的算法：只统计已经打完的场次，按积分、净胜球、进球三项依次比较
// 所有计算都按“某个赛季”进行，历史赛季与当前赛季互不串数据
const { load } = require('./store');
const { findSeason, rosterTeams } = require('./seasonUtil');

function emptyRow(team) {
  return {
    teamId: team.teamId,
    name: team.name,
    shortName: team.shortName,
    city: team.city,
    status: team.status,
    seedRank: team.seedRank,
    played: 0,
    win: 0,
    draw: 0,
    loss: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    latestRound: 0,
  };
}

// 把一轮比赛的结果累加到两支队身上
function applyMatch(rows, match, points) {
  const home = rows.get(match.homeTeamId);
  const away = rows.get(match.awayTeamId);
  if (!home || !away) return;
  const homeGoals = Number(match.homeGoals);
  const awayGoals = Number(match.awayGoals);
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) return;

  home.played += 1;
  away.played += 1;
  home.goalsFor += homeGoals;
  home.goalsAgainst += awayGoals;
  away.goalsFor += awayGoals;
  away.goalsAgainst += homeGoals;

  if (homeGoals > awayGoals) {
    home.win += 1;
    away.loss += 1;
    home.points += points.win;
    away.points += points.loss;
  } else if (homeGoals === awayGoals) {
    home.draw += 1;
    away.draw += 1;
    home.points += points.draw;
    away.points += points.draw;
  } else {
    away.win += 1;
    home.loss += 1;
    away.points += points.win;
    home.points += points.loss;
  }

  home.goalDiff = home.goalsFor - home.goalsAgainst;
  away.goalDiff = away.goalsFor - away.goalsAgainst;
  home.latestRound = Math.max(home.latestRound, match.round);
  away.latestRound = Math.max(away.latestRound, match.round);
}

// 排序口径：积分高的在前，积分相同看净胜球，再看进球数，最后按名称排
function compareRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return a.name < b.name ? -1 : 1;
}

// 纯函数：给定赛季数据与名册视图算出名次表，结算与页面共用这一份口径
function computeForSeason(season, teamsInSeason) {
  const rows = new Map();
  teamsInSeason.forEach((team) => rows.set(team.teamId, emptyRow(team)));

  season.matches
    .filter((match) => match.status === '已赛')
    .forEach((match) => applyMatch(rows, match, season.points));

  const list = Array.from(rows.values()).sort(compareRows);
  list.forEach((row, index) => { row.rank = index + 1; });
  return list;
}

function computeTable(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = findSeason(data, input.seasonId);
  const list = computeForSeason(season, rosterTeams(data, season));

  const keyword = typeof input.keyword === 'string' ? input.keyword.trim().toLowerCase() : '';
  const filtered = keyword
    ? list.filter((row) => row.name.toLowerCase().includes(keyword) || row.city.toLowerCase().includes(keyword))
    : list;

  const played = season.matches.filter((m) => m.status === '已赛');
  // 已结算赛季按冻结的最终名次展示，并把去向带给页面
  let tableRows = filtered;
  if (season.status === '已结算' && Array.isArray(season.finalTable)) {
    const frozenMap = new Map(season.finalTable.map((row) => [row.teamId, row]));
    tableRows = filtered
      .map((row) => (frozenMap.has(row.teamId) ? { ...row, ...frozenMap.get(row.teamId) } : row))
      .sort((a, b) => a.rank - b.rank);
  }
  const outcomeByTeam = {};
  if (Array.isArray(season.movements)) {
    season.movements.forEach((row) => { outcomeByTeam[row.teamId] = row.outcome; });
  }
  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    isActive: season.id === data.meta.activeSeasonId,
    points: season.points,
    playedRounds: new Set(played.map((m) => m.round)).size,
    totalRounds: Math.max(...season.matches.map((m) => m.round), 0),
    playedMatches: played.length,
    pendingMatches: season.matches.filter((m) => m.status === '待赛').length,
    postponedMatches: season.matches.filter((m) => m.status === '延期').length,
    cancelledMatches: season.matches.filter((m) => m.status === '取消').length,
    table: tableRows,
    outcomeByTeam,
    settled: season.status === '已结算',
    computedAt: new Date().toISOString(),
  };
}

// 队伍与场地名称的速查表，供赛程清单展示用；按赛季取名册
function nameMaps(seasonId) {
  const data = load();
  const season = findSeason(data, seasonId);
  const teams = new Map(rosterTeams(data, season).map((item) => [item.teamId, item]));
  const venues = new Map(data.venues.map((item) => [item.id, item]));
  return { data, season, teams, venues };
}

module.exports = { computeTable, computeForSeason, compareRows, nameMaps };
