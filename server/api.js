// 对外动作集合：页面只经过这一层，球队、场地、赛程、积分表与跨赛季动作各自管好自己的校验
const { ApiError, pickText } = require('./errors');
const { load } = require('./store');
const teams = require('./teams');
const venues = require('./venues');
const matches = require('./matches');
const seasons = require('./seasons');
const { computeTable } = require('./standings');

function readQuery(query, name) {
  return pickText(query && query[name]);
}

// 概览用的一块数据：几个数字、最近打完的几场、积分榜前三
function summary(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = teams.getSeason(data, input.seasonId);
  const table = computeTable({ seasonId: season.id }).table;
  const played = season.matches.filter((item) => item.status === '已赛');
  const teamMap = new Map(data.teams.map((team) => [team.id, team]));
  const recent = played
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1) || (a.kickoff < b.kickoff ? 1 : -1))
    .slice(0, 5)
    .map((item) => {
      const home = teamMap.get(item.homeTeamId);
      const away = teamMap.get(item.awayTeamId);
      return {
        id: item.id,
        round: item.round,
        date: item.date,
        homeName: home ? home.name : '未知球队',
        awayName: away ? away.name : '未知球队',
        scoreText: `${item.homeGoals} : ${item.awayGoals}`,
      };
    });

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    finalizedAt: season.finalizedAt,
    currentSeasonId: data.meta.currentSeasonId,
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
    canStartNext: season.status === '已收官',
    hasNewerSeason: data.seasons[data.seasons.length - 1].id !== season.id,
    topThree: table.slice(0, 3),
    recent,
  };
}

module.exports = {
  ApiError,
  readQuery,
  summary,
  computeTable,
  ...teams,
  ...venues,
  ...matches,
  ...seasons,
};
