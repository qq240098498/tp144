// 球队分两层：全局名录存身份（队名、简称、城市、主场），赛季名册存档位、参赛状态与入队来源
const crypto = require('crypto');
const { load, save, MAX_TEAM_NAME, MAX_SHORT_NAME, MAX_NOTE, MAX_TEAMS, MAX_DIRECTORY, ROSTER_STATUS, JOIN_FROM } = require('./store');
const { ApiError, pickText, isBlank } = require('./errors');
const { findSeason, rosterTeams, outsiderTeams, requireWritable } = require('./seasonUtil');

const SHORT_PATTERN = /^[A-Z]{2,4}$/;

function validateIdentity(input, data, selfId) {
  const source = input && typeof input === 'object' ? input : {};

  const name = pickText(source.name);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写球队名称', 'name');
  if (name.length > MAX_TEAM_NAME) throw new ApiError(400, 'NAME_TOO_LONG', `球队名称不能超过 ${MAX_TEAM_NAME} 个字`, 'name');
  if (data.teams.some((item) => item.id !== selfId && item.name === name)) {
    throw new ApiError(409, 'NAME_DUPLICATED', `${name} 已经登记过了`, 'name');
  }

  const shortName = pickText(source.shortName).toUpperCase();
  if (!shortName) throw new ApiError(400, 'SHORT_REQUIRED', '请填写球队简称', 'shortName');
  if (!SHORT_PATTERN.test(shortName)) {
    throw new ApiError(400, 'SHORT_INVALID', '球队简称用两到四个大写字母，例如 JCTM', 'shortName');
  }
  if (data.teams.some((item) => item.id !== selfId && item.shortName === shortName)) {
    throw new ApiError(409, 'SHORT_DUPLICATED', `简称 ${shortName} 已经有人用了`, 'shortName');
  }

  const city = pickText(source.city);
  if (!city) throw new ApiError(400, 'CITY_REQUIRED', '请填写所属城市', 'city');

  const venueId = pickText(source.venueId);
  if (!venueId) throw new ApiError(400, 'VENUE_REQUIRED', '请指定主场场地', 'venueId');
  if (!data.venues.some((item) => item.id === venueId)) {
    throw new ApiError(404, 'VENUE_NOT_FOUND', '这个场地没有登记过', 'venueId');
  }

  if (!isBlank(source.note) && String(source.note).length > MAX_NOTE) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE} 个字`, 'note');
  }

  return { name, shortName, city, venueId, note: pickText(source.note) };
}

function nextFreeRank(roster) {
  const used = new Set(roster.map((row) => row.seedRank));
  for (let rank = 1; rank <= MAX_TEAMS; rank += 1) {
    if (!used.has(rank)) return rank;
  }
  return 0;
}

function decorateRosterTeam(item, data, season) {
  const venue = data.venues.find((v) => v.id === item.venueId);
  const matchCount = season.matches.filter((m) => m.homeTeamId === item.teamId || m.awayTeamId === item.teamId).length;
  const finalRow = season.finalTable ? season.finalTable.find((row) => row.teamId === item.teamId) : null;
  const movement = season.movements ? season.movements.find((row) => row.teamId === item.teamId) : null;
  return {
    id: item.teamId,
    teamId: item.teamId,
    name: item.name,
    shortName: item.shortName,
    city: item.city,
    venueId: item.venueId,
    venueName: venue ? venue.name : '未指定',
    seedRank: item.seedRank,
    status: item.status,
    joinedFrom: item.joinedFrom,
    joinedFromText: { 创始: '创始', 留级: '上季留级', 升级: '低级别升级', 增补: '季中增补' }[item.joinedFrom] || item.joinedFrom,
    carryNote: item.carryNote,
    note: item.note,
    matchCount,
    finalRank: finalRow ? finalRow.rank : null,
    finalPoints: finalRow ? finalRow.points : null,
    outcome: movement ? movement.outcome : '',
  };
}

// scope=roster 某一季的名册（默认）；outsider 不在该季名册里的名录球队；all 全局名录
function listTeams(options) {
  const input = options && typeof options === 'object' ? options : {};
  const keyword = pickText(input.keyword).toLowerCase();
  const status = pickText(input.status);
  const scope = pickText(input.scope) || 'roster';
  const data = load();
  const season = findSeason(data, input.seasonId);
  const venueMap = new Map(data.venues.map((item) => [item.id, item]));

  const matchKeyword = (item) => !keyword
    || item.name.toLowerCase().includes(keyword)
    || item.shortName.toLowerCase().includes(keyword)
    || item.city.toLowerCase().includes(keyword);

  if (scope === 'roster') {
    let list = rosterTeams(data, season);
    if (status) list = list.filter((item) => item.status === status);
    list = list.filter(matchKeyword);
    list.sort((a, b) => a.seedRank - b.seedRank);
    return {
      scope: 'roster',
      seasonId: season.id,
      seasonName: season.name,
      seasonStatus: season.status,
      writable: season.status === '进行中' && season.id === data.meta.activeSeasonId,
      teams: list.map((item) => decorateRosterTeam(item, data, season)),
      total: season.roster.length,
      activeCount: season.roster.filter((item) => item.status === '参赛').length,
      venueCount: data.venues.length,
      limit: MAX_TEAMS,
    };
  }

  if (scope === 'outsider') {
    let list = outsiderTeams(data, season).filter(matchKeyword);
    list.sort((a, b) => a.name < b.name ? -1 : 1);
    return {
      scope: 'outsider',
      seasonId: season.id,
      teams: list.map((team) => ({
        ...team,
        venueName: venueMap.has(team.venueId) ? venueMap.get(team.venueId).name : '未指定',
        everPlayedSeasons: data.seasons.filter((s) => s.roster.some((row) => row.teamId === team.id)).length,
      })),
      total: list.length,
    };
  }

  let all = data.teams.slice().filter(matchKeyword);
  all.sort((a, b) => a.name < b.name ? -1 : 1);
  return {
    scope: 'all',
    seasonId: season.id,
    teams: all.map((team) => ({
      ...team,
      venueName: venueMap.has(team.venueId) ? venueMap.get(team.venueId).name : '未指定',
      inRoster: season.roster.some((row) => row.teamId === team.id),
    })),
    total: all.length,
  };
}

// 新增球队：joinMode=candidate 只进全局名录（建好下一季再选），roster 同时加进当前赛季名册
function createTeam(payload) {
  const data = load();
  const source = payload && typeof payload === 'object' ? payload : {};
  const joinMode = pickText(source.joinMode) === 'candidate' ? 'candidate' : 'roster';
  // 候选只进全局名录（为下一季预备），不碰任何赛季的数据，赛季结算后也能登记；
  // 直接加入名册才要求当前赛季进行中
  const season = joinMode === 'candidate'
    ? (data.seasons.find((item) => item.id === data.meta.activeSeasonId) || data.seasons[data.seasons.length - 1])
    : requireWritable(data);

  if (data.teams.length >= MAX_DIRECTORY) {
    throw new ApiError(409, 'TEAM_DIRECTORY_FULL', `全局名录最多 ${MAX_DIRECTORY} 支球队`, 'name');
  }
  if (joinMode === 'roster' && season.roster.length >= MAX_TEAMS) {
    throw new ApiError(409, 'TEAM_LIMIT_REACHED', `本赛季最多 ${MAX_TEAMS} 支球队，本季只能先登记为候选球队`, 'name');
  }

  const identity = validateIdentity(source, data, '');
  const now = new Date().toISOString();
  const created = { id: crypto.randomUUID(), ...identity, createdAt: now, updatedAt: now };
  data.teams.push(created);

  let rosterRow = null;
  if (joinMode === 'roster') {
    let seedRank = Number(source.seedRank);
    if (!Number.isInteger(seedRank) || seedRank < 1 || seedRank > MAX_TEAMS) {
      seedRank = nextFreeRank(season.roster);
    }
    if (season.roster.some((row) => row.seedRank === seedRank)) {
      throw new ApiError(409, 'SEED_RANK_DUPLICATED', `第 ${seedRank} 档已经有人占着了`, 'seedRank');
    }
    rosterRow = {
      teamId: created.id, seedRank, status: '参赛', joinedFrom: '增补', carryNote: '', updatedAt: now,
    };
    season.roster.push(rosterRow);
    season.roster.sort((a, b) => a.seedRank - b.seedRank);
    season.updatedAt = now;
  }

  save(data);
  return {
    id: created.id,
    teamId: created.id,
    ...identity,
    joined: joinMode === 'roster',
    seedRank: rosterRow ? rosterRow.seedRank : null,
    status: rosterRow ? '参赛' : '候选',
  };
}

// 修改球队：身份字段改进全局名录；档位与状态只改当前进行中赛季的名册。
// 候选队（不在当前赛季名册）只能改身份，任何赛季都允许
function updateTeam(id, payload) {
  const data = load();
  const found = data.teams.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');
  const activeSeason = data.seasons.find((item) => item.id === data.meta.activeSeasonId);
  const inRoster = Boolean(activeSeason && activeSeason.roster.find((row) => row.teamId === id));
  const season = inRoster ? requireWritable(data) : activeSeason;
  const source = payload && typeof payload === 'object' ? payload : {};
  const merged = { ...found, ...source };
  const identity = validateIdentity(merged, data, found.id);
  Object.assign(found, identity);
  found.updatedAt = new Date().toISOString();

  let rosterRow = null;
  if (season) rosterRow = season.roster.find((row) => row.teamId === id);
  if (rosterRow) {
    if (source.seedRank !== undefined) {
      const seedRank = Number(source.seedRank);
      if (!Number.isInteger(seedRank) || seedRank < 1 || seedRank > MAX_TEAMS) {
        throw new ApiError(400, 'SEED_RANK_INVALID', `档位要填 1 到 ${MAX_TEAMS} 之间的整数`, 'seedRank');
      }
      if (season.roster.some((row) => row.teamId !== id && row.seedRank === seedRank)) {
        throw new ApiError(409, 'SEED_RANK_DUPLICATED', `第 ${seedRank} 档已经有人占着了`, 'seedRank');
      }
      rosterRow.seedRank = seedRank;
      season.roster.sort((a, b) => a.seedRank - b.seedRank);
    }
    if (source.status !== undefined) {
      const status = pickText(source.status);
      if (!ROSTER_STATUS.includes(status)) {
        throw new ApiError(400, 'STATUS_INVALID', '状态只能填参赛或者退赛', 'status');
      }
      rosterRow.status = status;
    }
    if (source.joinedFrom !== undefined && JOIN_FROM.includes(pickText(source.joinedFrom))) {
      rosterRow.joinedFrom = pickText(source.joinedFrom);
    }
    if (source.carryNote !== undefined) {
      rosterRow.carryNote = String(source.carryNote || '').slice(0, MAX_NOTE);
    }
    rosterRow.updatedAt = new Date().toISOString();
    season.updatedAt = rosterRow.updatedAt;
  }

  save(data);
  const view = rosterTeams(data, season).find((item) => item.teamId === id);
  return view ? decorateRosterTeam(view, data, season) : { ...found };
}

// 删除球队：任何一季名册里出现过就不能删，历史不能凭空消失
function deleteTeam(id) {
  const data = load();
  const index = data.teams.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');
  const appeared = data.seasons.filter((s) => s.roster.some((row) => row.teamId === id));
  if (appeared.length > 0) {
    throw new ApiError(409, 'TEAM_IN_HISTORY', `这支球队在 ${appeared.length} 个赛季的名册里，历史赛季不能删；本赛季不参赛把状态改成退赛即可`, '');
  }
  const [removed] = data.teams.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = { listTeams, createTeam, updateTeam, deleteTeam, nextFreeRank };
