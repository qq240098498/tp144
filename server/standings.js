// 积分表的算法：只统计已经打完的场次，按积分、净胜球、进球三项依次比较
const { load } = require('./store');

function emptyRow(team, seedRank) {
  return {
    teamId: team.id,
    name: team.name,
    shortName: team.shortName,
    city: team.city,
    status: team.status,
    seedRank: Number.isInteger(Number(seedRank)) ? Number(seedRank) : null,
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

// 按指定赛季计算：名单取自 season.roster，赛程取自 season.matches，与别的赛季完全隔离
function computeTableForSeason(season, teamList) {
  const teamMap = new Map(teamList.map((team) => [team.id, team]));
  const rows = new Map();
  season.roster.forEach((member) => {
    const team = teamMap.get(member.teamId);
    if (team) rows.set(team.id, emptyRow(team, member.seedRank));
  });

  season.matches
    .filter((match) => match.status === '已赛')
    .forEach((match) => applyMatch(rows, match, season.points));

  const list = Array.from(rows.values()).sort(compareRows);
  list.forEach((row, index) => { row.rank = index + 1; });
  return list;
}

function decorateTableResult(season, table) {
  return {
    seasonId: season.id,
    season: season.name,
    seasonStatus: season.status,
    frozen: false,
    points: season.points,
    playedRounds: new Set(season.matches.filter((m) => m.status === '已赛').map((m) => m.round)).size,
    totalRounds: Math.max(...season.matches.map((m) => m.round), 0),
    playedMatches: season.matches.filter((m) => m.status === '已赛').length,
    pendingMatches: season.matches.filter((m) => m.status === '待赛').length,
    postponedMatches: season.matches.filter((m) => m.status === '延期').length,
    canceledMatches: season.matches.filter((m) => m.status === '取消').length,
    table,
    computedAt: new Date().toISOString(),
  };
}

// 快照行转成与实时积分表一致的形状，历史赛季直接读冻结结果
function tableFromSnapshot(season) {
  const rows = (season.finalTable || []).map((row) => ({
    ...row,
    latestRound: season.matches.length ? Math.max(...season.matches.map((m) => m.round), 0) : 0,
  }));
  return {
    seasonId: season.id,
    season: season.name,
    seasonStatus: season.status,
    frozen: true,
    points: season.points,
    playedRounds: new Set(season.matches.filter((m) => m.status === '已赛').map((m) => m.round)).size,
    totalRounds: Math.max(...season.matches.map((m) => m.round), 0),
    playedMatches: season.matches.filter((m) => m.status === '已赛').length,
    pendingMatches: season.matches.filter((m) => m.status === '待赛').length,
    postponedMatches: season.matches.filter((m) => m.status === '延期').length,
    canceledMatches: season.matches.filter((m) => m.status === '取消').length,
    table: rows,
    computedAt: season.finalizedAt || new Date().toISOString(),
  };
}

function computeTable(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  let season = data.seasons.find((item) => item.id === input.seasonId);
  if (!season) season = data.seasons.find((item) => item.id === data.meta.currentSeasonId) || data.seasons[data.seasons.length - 1];

  // 已收官的赛季读冻结名次；进行中的赛季实时算
  const result = season.status === '已收官' && season.finalTable
    ? tableFromSnapshot(season)
    : decorateTableResult(season, computeTableForSeason(season, data.teams));

  const keyword = typeof input.keyword === 'string' ? input.keyword.trim().toLowerCase() : '';
  if (keyword) {
    result.table = result.table.filter((row) => row.name.toLowerCase().includes(keyword) || row.city.toLowerCase().includes(keyword));
  }
  return result;
}

// 队伍与场地名称的速查表，供赛程清单展示用
function nameMaps(data) {
  const source = data || load();
  const teams = new Map(source.teams.map((item) => [item.id, item]));
  const venues = new Map(source.venues.map((item) => [item.id, item]));
  return { teams, venues };
}

module.exports = {
  computeTable,
  computeTableForSeason,
  decorateTableResult,
  tableFromSnapshot,
  compareRows,
  nameMaps,
};
