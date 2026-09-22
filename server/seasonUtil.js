// 赛季维度的读取辅助：当前赛季定位、名册与全局名录的拼装
const { ApiError } = require('./errors');

// 取当前查看的赛季：没指定就用 meta.activeSeasonId
function findSeason(data, seasonId) {
  const wanted = typeof seasonId === 'string' && seasonId ? seasonId : data.meta.activeSeasonId;
  const season = data.seasons.find((item) => item.id === wanted);
  if (!season) {
    throw new ApiError(404, 'SEASON_NOT_FOUND', '指定的赛季不存在，可能已经被删除', 'seasonId');
  }
  return season;
}

function getActiveSeason(data) {
  return data.seasons.find((item) => item.id === data.meta.activeSeasonId) || data.seasons[data.seasons.length - 1];
}

// 名册行 + 全局名录拼成一个赛季里的“球队视图”
function rosterTeams(data, season) {
  return season.roster.map((row) => {
    const team = data.teams.find((item) => item.id === row.teamId);
    return {
      teamId: row.teamId,
      id: row.teamId,
      name: team ? team.name : '未知球队',
      shortName: team ? team.shortName : '',
      city: team ? team.city : '',
      venueId: team ? team.venueId : '',
      note: team ? team.note : '',
      seedRank: row.seedRank,
      status: row.status,
      joinedFrom: row.joinedFrom,
      carryNote: row.carryNote || '',
      rosterUpdatedAt: row.updatedAt,
    };
  });
}

function rosterTeamMap(data, season) {
  return new Map(rosterTeams(data, season).map((item) => [item.teamId, item]));
}

// 不在本赛季名册里的全局名录球队：新建赛季时的升级候选
function outsiderTeams(data, season) {
  const inside = new Set(season.roster.map((row) => row.teamId));
  return data.teams
    .filter((team) => !inside.has(team.id))
    .map((team) => ({ ...team }));
}

// 写操作只允许发生在进行中的赛季；历史赛季一律只读
function requireWritable(data, seasonId) {
  const season = findSeason(data, seasonId);
  if (season.status !== '进行中') {
    throw new ApiError(409, 'SEASON_LOCKED', `《${season.name}》已经结算，赛程与积分作为历史归档只读`, '');
  }
  return season;
}

module.exports = { findSeason, getActiveSeason, rosterTeams, rosterTeamMap, outsiderTeams, requireWritable };
