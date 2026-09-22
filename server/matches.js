const crypto = require('crypto');
const { load, save, MAX_NOTE, MATCH_STATUS } = require('./store');
const { ApiError, pickText } = require('./errors');
const { nameMaps } = require('./standings');
const { getSeason } = require('./teams');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_GAP_MINUTES = 120;

function minutesOf(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function checkDate(value) {
  const date = pickText(value);
  if (!DATE_PATTERN.test(date)) {
    throw new ApiError(400, 'DATE_INVALID', '日期要写成四位年加短横线加两位月日，例如 2026-03-14', 'date');
  }
  const [year, month, day] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new ApiError(400, 'DATE_INVALID', '这个日期不存在，请检查月份与日', 'date');
  }
  return date;
}

// 主场场地没填时按主队的主场算，用这块场地去判同日时间冲突
function resolveVenueId(match, data) {
  if (match.venueId) return match.venueId;
  const home = data.teams.find((item) => item.id === match.homeTeamId);
  return home ? home.venueId : '';
}

function validatePayload(input, data, season, selfId) {
  const source = input && typeof input === 'object' ? input : {};
  const memberIds = new Set(season.roster.map((item) => item.teamId));

  const round = Number(source.round);
  if (!Number.isInteger(round) || round < 1 || round > 40) {
    throw new ApiError(400, 'ROUND_INVALID', '轮次要填 1 到 40 之间的整数', 'round');
  }

  const date = checkDate(source.date);

  const kickoff = pickText(source.kickoff);
  if (!TIME_PATTERN.test(kickoff)) {
    throw new ApiError(400, 'KICKOFF_INVALID', '开赛时刻要写成两位小时加冒号加两位分钟，例如 19:30', 'kickoff');
  }

  const homeTeamId = pickText(source.homeTeamId);
  const awayTeamId = pickText(source.awayTeamId);
  if (!memberIds.has(homeTeamId)) {
    throw new ApiError(404, 'HOME_TEAM_NOT_FOUND', '主队不在本赛季的参赛名单里', 'homeTeamId');
  }
  if (!memberIds.has(awayTeamId)) {
    throw new ApiError(404, 'AWAY_TEAM_NOT_FOUND', '客队不在本赛季的参赛名单里', 'awayTeamId');
  }
  if (homeTeamId === awayTeamId) {
    throw new ApiError(400, 'TEAM_SAME', '主队与客队不能是同一支球队', 'awayTeamId');
  }

  const venueId = pickText(source.venueId);
  if (venueId && !data.venues.some((item) => item.id === venueId)) {
    throw new ApiError(404, 'VENUE_NOT_FOUND', '这个场地没有登记过', 'venueId');
  }

  const status = pickText(source.status) || '待赛';
  if (!MATCH_STATUS.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', '状态只能填待赛、已赛、延期或者取消', 'status');
  }

  let homeGoals = null;
  let awayGoals = null;
  if (status === '已赛') {
    homeGoals = Number(source.homeGoals);
    awayGoals = Number(source.awayGoals);
    if (!Number.isInteger(homeGoals) || homeGoals < 0 || homeGoals > 99) {
      throw new ApiError(400, 'GOALS_INVALID', '主队进球数要填 0 到 99 之间的整数', 'homeGoals');
    }
    if (!Number.isInteger(awayGoals) || awayGoals < 0 || awayGoals > 99) {
      throw new ApiError(400, 'GOALS_INVALID', '客队进球数要填 0 到 99 之间的整数', 'awayGoals');
    }
  } else if (source.homeGoals !== undefined && source.homeGoals !== null && source.homeGoals !== '') {
    throw new ApiError(400, 'GOALS_NOT_ALLOWED', '还没打完的场次不能填比分，先把状态改成已赛', 'homeGoals');
  }

  if (source.note !== undefined && source.note !== null && String(source.note).length > MAX_NOTE) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE} 个字`, 'note');
  }

  const candidate = { round, date, kickoff, venueId, homeTeamId, awayTeamId };

  // 取消的场次不占轮次与场地档期；把一场改成取消时也不应被既有冲突拦住
  if (status !== '取消') {
    // 同一轮里一支球队只能出现一次（已取消的场次不占位）
    const sameRound = season.matches.filter((item) => item.id !== selfId && item.status !== '取消' && item.round === round
      && (item.homeTeamId === homeTeamId || item.awayTeamId === homeTeamId
        || item.homeTeamId === awayTeamId || item.awayTeamId === awayTeamId));
    if (sameRound.length > 0) {
      throw new ApiError(409, 'ROUND_CONFLICT', `第 ${round} 轮里这两支球队已经各有一场了，同一轮不能重复出场`, 'round');
    }

    // 同一天同一块场地不能挨得太近（跨赛季共用场地时，历史赛季不参与当季冲突判断）
    const resolved = resolveVenueId(candidate, data);
    if (resolved) {
      const sameDay = season.matches.filter((item) => item.id !== selfId && item.date === date
        && resolveVenueId(item, data) === resolved && item.status !== '取消');
      const clash = sameDay.find((item) => Math.abs(minutesOf(item.kickoff) - minutesOf(kickoff)) < MIN_GAP_MINUTES);
      if (clash) {
        const venue = data.venues.find((item) => item.id === resolved);
        throw new ApiError(409, 'VENUE_TIME_CONFLICT', `${date} 这天 ${venue ? venue.name : '这块场地'} 的 ${clash.kickoff} 已经有一场了，两场之间至少隔两小时`, 'kickoff');
      }
    }
  }

  return {
    round,
    date,
    kickoff,
    venueId,
    homeTeamId,
    awayTeamId,
    status,
    homeGoals,
    awayGoals,
    note: pickText(source.note),
  };
}

function decorate(match, teams, venues, data) {
  const home = teams.get(match.homeTeamId);
  const away = teams.get(match.awayTeamId);
  const venue = venues.get(resolveVenueId(match, data));
  const scoreText = match.status === '已赛' ? `${match.homeGoals} : ${match.awayGoals}` : '';
  let winner = '';
  if (match.status === '已赛') {
    if (match.homeGoals > match.awayGoals) winner = home ? home.name : '';
    else if (match.homeGoals < match.awayGoals) winner = away ? away.name : '';
    else winner = '平局';
  }
  return {
    ...match,
    homeName: home ? home.name : '未知球队',
    awayName: away ? away.name : '未知球队',
    homeShort: home ? home.shortName : '',
    awayShort: away ? away.shortName : '',
    venueName: venue ? venue.name : '未指定',
    scoreText,
    winner,
  };
}

function listMatches(options) {
  const input = options && typeof options === 'object' ? options : {};
  const round = Number(pickText(input.round));
  const status = pickText(input.status);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();
  const season = getSeason(data, input.seasonId);
  const { teams, venues } = nameMaps(data);

  let list = season.matches.slice();
  if (Number.isInteger(round) && round > 0) list = list.filter((item) => item.round === round);
  if (status) list = list.filter((item) => item.status === status);
  if (keyword) {
    list = list.filter((item) => {
      const home = teams.get(item.homeTeamId);
      const away = teams.get(item.awayTeamId);
      const text = `${home ? home.name + home.shortName + home.city : ''}${away ? away.name + away.shortName + away.city : ''}`;
      return text.toLowerCase().includes(keyword);
    });
  }

  list.sort((a, b) => (a.round - b.round) || (a.date < b.date ? -1 : 1) || (a.kickoff < b.kickoff ? -1 : 1));

  const rounds = Array.from(new Set(season.matches.map((item) => item.round))).sort((a, b) => a - b);
  const roundSummaries = rounds.map((item) => ({
    round: item,
    total: season.matches.filter((m) => m.round === item).length,
    played: season.matches.filter((m) => m.round === item && m.status === '已赛').length,
    pending: season.matches.filter((m) => m.round === item && m.status === '待赛').length,
    postponed: season.matches.filter((m) => m.round === item && m.status === '延期').length,
  }));

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    matches: list.map((item) => decorate(item, teams, venues, data)),
    total: season.matches.length,
    filtered: list.length,
    rounds: roundSummaries,
  };
}

function assertWritable(season) {
  if (season.status !== '进行中') {
    throw new ApiError(409, 'SEASON_FINALIZED', '这一季已经收官，赛程与比分都冻结了，只能查看', '');
  }
}

function createMatch(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = getSeason(data, input.seasonId);
  assertWritable(season);
  const checked = validatePayload(input, data, season, '');
  const now = new Date().toISOString();
  const created = { id: crypto.randomUUID(), ...checked, createdAt: now, updatedAt: now };
  season.matches.push(created);
  save(data);
  const { teams, venues } = nameMaps(data);
  return decorate(created, teams, venues, data);
}

function updateMatch(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = getSeason(data, input.seasonId);
  assertWritable(season);
  const found = season.matches.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  const patch = { ...input };
  // 状态改回没打完时把比分一并清掉，否则这场会卡在带比分又不能改的状态里
  if (patch.status && patch.status !== '已赛' && patch.homeGoals === undefined && patch.awayGoals === undefined) {
    patch.homeGoals = null;
    patch.awayGoals = null;
  }
  const merged = { ...found, ...patch };
  const checked = validatePayload(merged, data, season, found.id);
  Object.assign(found, checked);
  found.updatedAt = new Date().toISOString();
  save(data);
  const { teams, venues } = nameMaps(data);
  return decorate(found, teams, venues, data);
}

// 单独登记比分：登记完自动把这场标成已赛
function recordResult(id, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return updateMatch(id, {
    seasonId: source.seasonId,
    status: '已赛',
    homeGoals: source.homeGoals,
    awayGoals: source.awayGoals,
  });
}

function deleteMatch(id, options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = getSeason(data, input.seasonId);
  assertWritable(season);
  const index = season.matches.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  const [removed] = season.matches.splice(index, 1);
  save(data);
  return { id: removed.id, round: removed.round };
}

module.exports = { listMatches, createMatch, updateMatch, recordResult, deleteMatch, resolveVenueId };
