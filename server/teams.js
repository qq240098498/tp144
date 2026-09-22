const crypto = require('crypto');
const { load, save, MAX_TEAM_NAME, MAX_SHORT_NAME, MAX_NOTE, MAX_TEAMS, TEAM_STATUS } = require('./store');
const { ApiError, pickText, isBlank } = require('./errors');

const SHORT_PATTERN = /^[A-Z]{2,4}$/;

function getSeason(data, seasonId) {
  const id = pickText(seasonId);
  const season = id
    ? data.seasons.find((item) => item.id === id)
    : data.seasons.find((item) => item.id === data.meta.currentSeasonId);
  return season || data.seasons[data.seasons.length - 1];
}

function isWritable(season) {
  return season && season.status === '进行中';
}

// 校验不随赛季变化的球队档案：队名、简称、城市、主场、备注
function validateProfile(input, data, selfId) {
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

// 档位只在同一池内唯一：赛季名单内互不重复，外池球队之间互不重复
function validateTier(seedRank, data, season, selfTeamId, inSeason) {
  const rank = Number(seedRank);
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_TEAMS) {
    throw new ApiError(400, 'SEED_RANK_INVALID', `档位要填 1 到 ${MAX_TEAMS} 之间的整数`, 'seedRank');
  }
  if (inSeason) {
    if (season.roster.some((member) => member.teamId !== selfTeamId && member.seedRank === rank)) {
      throw new ApiError(409, 'SEED_RANK_DUPLICATED', `第 ${rank} 档在本赛季已经有人占着了`, 'seedRank');
    }
  } else {
    const leagueIds = new Set(season.roster.map((member) => member.teamId));
    const clash = data.teams.find((team) => team.id !== selfTeamId
      && team.seedRank === rank && !leagueIds.has(team.id));
    if (clash) {
      throw new ApiError(409, 'SEED_RANK_DUPLICATED', `外池里第 ${rank} 档已经被 ${clash.name} 占了，外池档位也要错开`, 'seedRank');
    }
  }
  return rank;
}

function decorate(team, data, season) {
  const member = season ? season.roster.find((item) => item.teamId === team.id) : null;
  const venueMap = new Map(data.venues.map((item) => [item.id, item]));
  const seasonMatches = season
    ? season.matches.filter((m) => m.homeTeamId === team.id || m.awayTeamId === team.id).length
    : 0;
  const allMatches = data.seasons.reduce(
    (count, s) => count + s.matches.filter((m) => m.homeTeamId === team.id || m.awayTeamId === team.id).length,
    0,
  );

  let membership = '外池';
  let seedRank = team.seedRank;
  let carriedFrom = '';
  if (member) {
    membership = member.status;
    seedRank = member.seedRank;
    carriedFrom = member.carriedFrom;
  }

  let finalRank = null;
  let direction = '';
  if (season && season.status === '已收官') {
    if (season.finalTable) {
      const frozen = season.finalTable.find((row) => row.teamId === team.id);
      if (frozen) finalRank = frozen.rank;
    }
    if (season.promotion) {
      const entry = season.promotion.entries.find((item) => item.teamId === team.id);
      if (entry) direction = entry.direction;
    }
  }

  return {
    ...team,
    seedRank,
    profileRank: team.seedRank,
    membership,
    inSeason: Boolean(member),
    carriedFrom,
    venueName: venueMap.has(team.venueId) ? venueMap.get(team.venueId).name : '未指定',
    matchCount: seasonMatches,
    allTimeMatchCount: allMatches,
    finalRank,
    direction,
    seasonStatus: season ? season.status : '',
    writable: isWritable(season),
  };
}

function listTeams(options) {
  const input = options && typeof options === 'object' ? options : {};
  const keyword = pickText(input.keyword).toLowerCase();
  const status = pickText(input.status);
  const data = load();
  const season = getSeason(data, input.seasonId);

  let list = data.teams.slice();
  if (status) {
    list = list.filter((team) => decorate(team, data, season).membership === status);
  }
  if (keyword) {
    list = list.filter((item) => item.name.toLowerCase().includes(keyword)
      || item.shortName.toLowerCase().includes(keyword)
      || item.city.toLowerCase().includes(keyword));
  }

  const decorated = list.map((team) => decorate(team, data, season));
  // 参赛与退赛按赛季档位排，外池按外池参考档位排，前者排在前面
  decorated.sort((a, b) => {
    if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
    return a.seedRank - b.seedRank;
  });

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    teams: decorated,
    total: data.teams.length,
    activeCount: season.roster.filter((item) => item.status === '参赛').length,
    outsideCount: decorated.filter((item) => !item.inSeason).length,
    venueCount: data.venues.length,
    limit: MAX_TEAMS,
  };
}

// 新增球队：默认直接编进当前赛季；inSeason 为假时只登记成外池候选，等升降级时升级
function createTeam(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = getSeason(data, input.seasonId);
  const inSeason = !(input.inSeason === false || pickText(input.inSeason) === 'false');

  if (inSeason) {
    if (!isWritable(season)) {
      throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，不能再往里加球队；新增的球队可以先放进外池', 'name');
    }
    const active = season.roster.filter((item) => item.status === '参赛').length;
    if (active >= MAX_TEAMS) {
      throw new ApiError(409, 'TEAM_LIMIT_REACHED', `本赛季最多 ${MAX_TEAMS} 支参赛球队，可以先登记成外池球队`, 'name');
    }
  }

  const profile = validateProfile(input, data, '');
  const seedRank = validateTier(input.seedRank, data, season, '', inSeason);
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    ...profile,
    seedRank,
    status: '参赛',
    createdAt: now,
    updatedAt: now,
  };
  data.teams.push(created);
  if (inSeason) {
    season.roster.push({ teamId: created.id, seedRank, status: '参赛', carriedFrom: '' });
  }
  save(data);
  return decorate(created, data, season);
}

function updateTeam(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.teams.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');
  const season = getSeason(data, input.seasonId);
  const member = season.roster.find((item) => item.teamId === id);

  const merged = { ...found, ...input };
  const profile = validateProfile(merged, data, found.id);
  Object.assign(found, profile);

  // 档位：名单成员改的是赛季名单里的档位，外池球队改的是外池参考档位
  if (input.seedRank !== undefined) {
    if (member) {
      if (!isWritable(season)) {
        throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，档位与名次都冻结了', 'seedRank');
      }
      const rank = validateTier(input.seedRank, data, season, found.id, true);
      member.seedRank = rank;
      found.seedRank = rank;
    } else {
      found.seedRank = validateTier(input.seedRank, data, season, found.id, false);
    }
  }

  if (input.status !== undefined) {
    const status = pickText(input.status) || '参赛';
    if (!TEAM_STATUS.includes(status)) {
      throw new ApiError(400, 'STATUS_INVALID', '状态只能填参赛或者退赛', 'status');
    }
    if (member) {
      if (!isWritable(season)) {
        throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，参赛状态已冻结', 'status');
      }
      member.status = status;
      found.status = status;
    } else if (status === '退赛') {
      throw new ApiError(409, 'TEAM_OUTSIDE', '这支球队在外池、本来就不在本赛季，不需要退赛；要参赛请用编入本赛季', 'status');
    }
  }

  found.updatedAt = new Date().toISOString();
  save(data);
  return decorate(found, data, season);
}

// 把外池球队编进当前赛季，占一个还空着的档位
function joinSeason(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.teams.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');
  const season = getSeason(data, input.seasonId);
  if (!isWritable(season)) {
    throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，不能再编入球队', '');
  }
  if (season.roster.some((member) => member.teamId === id)) {
    throw new ApiError(409, 'TEAM_ALREADY_IN_SEASON', `${found.name} 已经在本赛季名单里了`, '');
  }
  const active = season.roster.filter((member) => member.status === '参赛').length;
  if (active >= MAX_TEAMS) {
    throw new ApiError(409, 'TEAM_LIMIT_REACHED', `本赛季最多 ${MAX_TEAMS} 支参赛球队`, '');
  }
  const rank = validateTier(input.seedRank, data, season, id, true);
  season.roster.push({ teamId: id, seedRank: rank, status: '参赛', carriedFrom: '' });
  found.seedRank = rank;
  found.status = '参赛';
  found.updatedAt = new Date().toISOString();
  save(data);
  return decorate(found, data, season);
}

// 把球队移出当前赛季名单（退回外池）；本赛季已有赛程挂着时不允许，请改用退赛
function leaveSeason(id, options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const found = data.teams.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');
  const season = getSeason(data, input.seasonId);
  if (!isWritable(season)) {
    throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，名单已冻结', '');
  }
  const index = season.roster.findIndex((member) => member.teamId === id);
  if (index === -1) throw new ApiError(409, 'TEAM_OUTSIDE', `${found.name} 本来就不在本赛季名单里`, '');
  const related = season.matches.filter((m) => m.homeTeamId === id || m.awayTeamId === id).length;
  if (related > 0) {
    throw new ApiError(409, 'TEAM_IN_USE', `这支球队本赛季还有 ${related} 场赛程挂着，不能移出名单，请把状态改成退赛`, '');
  }
  const [removed] = season.roster.splice(index, 1);
  found.seedRank = removed.seedRank;
  found.status = '参赛';
  found.updatedAt = new Date().toISOString();
  save(data);
  return decorate(found, data, season);
}

function deleteTeam(id) {
  const data = load();
  const index = data.teams.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队不存在或已被删除', '');

  // 历史赛季的赛程、名次与去向都按球队 id 冻结，进过任何赛季名单的球队不能删
  const referenced = data.seasons.reduce(
    (count, season) => count + season.matches.filter((m) => m.homeTeamId === id || m.awayTeamId === id).length,
    0,
  );
  if (referenced > 0) {
    throw new ApiError(409, 'TEAM_IN_USE', `这支球队在历史赛季里还有 ${referenced} 场赛程记录，不能删除，以免旧名次对不上`, '');
  }
  const inRoster = data.seasons.some((season) => season.roster.some((member) => member.teamId === id));
  if (inRoster) {
    throw new ApiError(409, 'TEAM_IN_SEASON', '这支球队还在某个赛季的名单里，当前赛季可先移出名单退回外池，历史名单不能动', '');
  }

  const [removed] = data.teams.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = { listTeams, createTeam, updateTeam, deleteTeam, joinSeason, leaveSeason, getSeason };
