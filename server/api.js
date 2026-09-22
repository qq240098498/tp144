// 对外动作集合：页面只经过这一层，球队、场地、赛程、积分表与跨赛季各自管好自己的校验
const { ApiError, pickText } = require('./errors');
const { load } = require('./store');
const teams = require('./teams');
const venues = require('./venues');
const matches = require('./matches');
const seasons = require('./seasons');
const { findSeason, rosterTeams } = require('./seasonUtil');
const { computeTable, computeForSeason } = require('./standings');

function readQuery(query, name) {
  return pickText(query && query[name]);
}

// 概览用的一块数据：几个数字、最近打完的几场、积分榜前三，全部限定在查看的那一季
function summary(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = findSeason(data, input.seasonId);
  const teamsInSeason = rosterTeams(data, season);
  const table = computeForSeason(season, teamsInSeason);
  const played = season.matches.filter((item) => item.status === '已赛');
  const recent = played
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1) || (a.kickoff < b.kickoff ? 1 : -1))
    .slice(0, 5)
    .map((item) => {
      const home = teamsInSeason.find((t) => t.teamId === item.homeTeamId);
      const away = teamsInSeason.find((t) => t.teamId === item.awayTeamId);
      return {
        id: item.id,
        round: item.round,
        date: item.date,
        homeName: home ? home.name : '未知球队',
        awayName: away ? away.name : '未知球队',
        scoreText: `${item.homeGoals} : ${item.awayGoals}`,
      };
    });

  const champion = season.status === '已结算' && season.finalTable && season.finalTable.length
    ? (teamsInSeason.find((t) => t.teamId === season.finalTable[0].teamId) || {}).name || ''
    : '';

  // 已结算赛季概览也用冻结的最终名次，避免归档后数字还在“实时变”
  const overviewTable = season.status === '已结算' && Array.isArray(season.finalTable)
    ? season.finalTable
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((row) => {
        const team = teamsInSeason.find((t) => t.teamId === row.teamId);
        return {
          teamId: row.teamId,
          name: team ? team.name : '未知球队',
          shortName: team ? team.shortName : '',
          city: team ? team.city : '',
          ...row,
        };
      })
    : table;

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    isActive: season.id === data.meta.activeSeasonId,
    activeSeasonId: data.meta.activeSeasonId,
    points: season.points,
    rules: season.rules,
    teamCount: season.roster.length,
    activeTeamCount: season.roster.filter((item) => item.status === '参赛').length,
    venueCount: data.venues.length,
    totalMatches: season.matches.length,
    playedMatches: played.length,
    pendingMatches: season.matches.filter((item) => item.status === '待赛').length,
    postponedMatches: season.matches.filter((item) => item.status === '延期').length,
    playedRounds: new Set(played.map((item) => item.round)).size,
    totalRounds: Math.max(...season.matches.map((item) => item.round), 0),
    topThree: overviewTable.slice(0, 3),
    recent,
    champion,
    settled: season.status === '已结算',
  };
}

module.exports = {
  ApiError,
  readQuery,
  readText: pickText,
  summary,
  computeTable,
  ...teams,
  ...venues,
  ...matches,
  ...seasons,
};
