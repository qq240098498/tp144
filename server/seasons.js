// 跨赛季的领域动作：查看赛季、试算升降级、调整规则并对比去向、收官存档、建立新一季
const crypto = require('crypto');
const {
  load,
  save,
  MAX_SEASON_NAME,
  MAX_TEAMS,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const { computeTableForSeason } = require('./standings');

function findSeason(data, seasonId) {
  const season = data.seasons.find((item) => item.id === seasonId);
  if (!season) throw new ApiError(404, 'SEASON_NOT_FOUND', '这个赛季不存在', '');
  return season;
}

function getSeason(data, seasonId) {
  if (seasonId) return findSeason(data, seasonId);
  return data.seasons.find((item) => item.id === data.meta.currentSeasonId) || data.seasons[data.seasons.length - 1];
}

function latestSeason(data) {
  return data.seasons[data.seasons.length - 1] || null;
}

// 完赛条件：参赛队至少两支、有已赛场次、没有待赛与延期（取消的场次按不踢处理）
function completionOf(season) {
  const total = season.matches.length;
  const played = season.matches.filter((m) => m.status === '已赛').length;
  const pending = season.matches.filter((m) => m.status === '待赛').length;
  const postponed = season.matches.filter((m) => m.status === '延期').length;
  const canceled = season.matches.filter((m) => m.status === '取消').length;
  const activeMembers = season.roster.filter((r) => r.status === '参赛').length;
  const blockers = [];
  if (activeMembers < 2) blockers.push(`参赛球队只有 ${activeMembers} 支，至少要有两支才能结算`);
  if (played === 0) blockers.push('还没有任何打完的场次，名次无法确定');
  if (pending > 0) blockers.push(`还有 ${pending} 场待赛，全部打完才能结算`);
  if (postponed > 0) blockers.push(`还有 ${postponed} 场延期未补赛，补赛或取消后才能结算`);
  return {
    total,
    played,
    pending,
    postponed,
    canceled,
    activeMembers,
    complete: blockers.length === 0,
    blockers,
  };
}

function readRules(input) {
  const source = input && typeof input === 'object' ? input : {};
  const promotionCount = Number(source.promotionCount);
  const relegationCount = Number(source.relegationCount);
  if (!Number.isInteger(promotionCount) || promotionCount < 0 || promotionCount > MAX_TEAMS) {
    throw new ApiError(400, 'PROMOTION_COUNT_INVALID', `升级队数要填 0 到 ${MAX_TEAMS} 之间的整数`, 'promotionCount');
  }
  if (!Number.isInteger(relegationCount) || relegationCount < 0 || relegationCount > MAX_TEAMS) {
    throw new ApiError(400, 'RELEGATION_COUNT_INVALID', `降级队数要填 0 到 ${MAX_TEAMS} 之间的整数`, 'relegationCount');
  }
  return { promotionCount, relegationCount };
}

function readPromotedIds(input) {
  const raw = input && input.promotedIds;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, 'PROMOTED_IDS_INVALID', '升级球队要以清单形式提交', 'promotedIds');
  }
  const ids = [];
  raw.forEach((id) => {
    const text = pickText(id);
    if (text && !ids.includes(text)) ids.push(text);
  });
  return ids;
}

// 按最终名次结出去向：降级线以下为降级，赛季中退赛的一律降级，其余留级；
// 外池球队按页面选定的顺序填降级队腾出的档位（档位号小的在前）
function computeDestinations(data, season, rules, chosenPromotedIds) {
  const table = computeTableForSeason(season, data.teams);
  const memberMap = new Map(season.roster.map((r) => [r.teamId, r]));
  const leagueIds = new Set(season.roster.map((r) => r.teamId));
  const cut = Math.max(0, table.length - rules.relegationCount);

  const entries = [];
  const relegatedTiers = [];
  table.forEach((row) => {
    const member = memberMap.get(row.teamId);
    let direction;
    let reason;
    if (member && member.status === '退赛') {
      direction = '降级';
      reason = '赛季中退赛，无论名次一律降级';
    } else if (rules.relegationCount > 0 && row.rank > cut) {
      direction = '降级';
      reason = `最终第 ${row.rank} 名，落入垫底 ${rules.relegationCount} 个降级名额`;
    } else {
      direction = '留级';
      reason = rules.relegationCount > 0
        ? `最终第 ${row.rank} 名，在第 ${cut} 名的降级线以上`
        : '本季没有设降级名额';
    }
    const tier = member ? member.seedRank : null;
    entries.push({
      teamId: row.teamId,
      name: row.name,
      rank: row.rank,
      seedRank: tier,
      direction,
      targetTier: direction === '留级' ? tier : null,
      reason,
    });
    if (direction === '降级' && Number.isInteger(tier)) relegatedTiers.push(tier);
  });

  const outside = data.teams.filter((team) => !leagueIds.has(team.id));
  const available = outside.slice().sort((a, b) => {
    const rankA = Number.isInteger(a.seedRank) && a.seedRank > 0 ? a.seedRank : MAX_TEAMS + 1;
    const rankB = Number.isInteger(b.seedRank) && b.seedRank > 0 ? b.seedRank : MAX_TEAMS + 1;
    return rankA - rankB || (a.name < b.name ? -1 : 1);
  });

  const chosen = [];
  const unknown = [];
  chosenPromotedIds.forEach((id) => {
    const team = outside.find((item) => item.id === id);
    if (team) {
      if (!chosen.some((item) => item.id === team.id)) chosen.push(team);
    } else {
      unknown.push(id);
    }
  });

  const vacatedTiers = relegatedTiers.slice().sort((a, b) => a - b);
  chosen.forEach((team, index) => {
    entries.push({
      teamId: team.id,
      name: team.name,
      rank: null,
      seedRank: null,
      direction: '升级',
      targetTier: index < vacatedTiers.length ? vacatedTiers[index] : null,
      reason: `外池升级，按选定顺序排第 ${index + 1}，填第 ${index < vacatedTiers.length ? vacatedTiers[index] : '?'} 档`,
    });
  });

  const warnings = [];
  if (rules.relegationCount >= table.length && table.length > 0) {
    warnings.push(`降级名额（${rules.relegationCount}）不少于参赛队数（${table.length}），所有球队都在降级位`);
  }
  if (rules.promotionCount !== vacatedTiers.length) {
    if (rules.promotionCount > vacatedTiers.length) {
      warnings.push(`升级名额 ${rules.promotionCount} 个比降级腾出的 ${vacatedTiers.length} 个档位多，新赛季需从外池补队或手填档位`);
    } else {
      warnings.push(`降级腾出 ${vacatedTiers.length} 个档位但升级名额只有 ${rules.promotionCount} 个，新赛季第 ${vacatedTiers.slice(rules.promotionCount).join('、')} 档会空出`);
    }
  }
  if (rules.promotionCount > available.length) {
    warnings.push(`外池只有 ${available.length} 支候选队，不够 ${rules.promotionCount} 个升级名额，请先到球队页登记外池球队，或调小升级队数`);
  }
  if (unknown.length > 0) {
    warnings.push(`有 ${unknown.length} 支选定的升级球队不在外池候选里，已忽略`);
  }

  return {
    rules,
    table,
    entries,
    availableOutside: available.map((team) => ({
      teamId: team.id,
      name: team.name,
      shortName: team.shortName,
      city: team.city,
      profileRank: team.seedRank > 0 ? team.seedRank : null,
      note: team.note,
    })),
    promotedSlots: rules.promotionCount,
    chosenCount: chosen.length,
    shortBy: Math.max(0, rules.promotionCount - available.length),
    vacatedTiers,
    warnings,
  };
}

function destinationMap(entries) {
  return new Map(entries.map((entry) => [entry.teamId, entry]));
}

// 规则调整后对比两版去向，列出归属发生变化的球队
function diffDestinations(before, after) {
  const beforeMap = destinationMap(before.entries);
  const changes = [];
  after.entries.forEach((entry) => {
    const old = beforeMap.get(entry.teamId);
    if (old && old.direction !== entry.direction) {
      changes.push({
        teamId: entry.teamId,
        name: entry.name,
        rank: entry.rank,
        from: old.direction,
        to: entry.direction,
        fromTier: old.targetTier,
        toTier: entry.targetTier,
      });
    }
  });
  return changes;
}

function brief(data, season) {
  const completion = completionOf(season);
  return {
    id: season.id,
    name: season.name,
    status: season.status,
    points: season.points,
    rules: season.rules,
    teamCount: season.roster.length,
    activeTeamCount: season.roster.filter((r) => r.status === '参赛').length,
    matchCount: season.matches.length,
    playedMatchCount: completion.played,
    createdAt: season.createdAt,
    finalizedAt: season.finalizedAt,
    completion,
    isCurrent: data.meta.currentSeasonId === season.id,
  };
}

function listSeasons() {
  const data = load();
  return {
    currentSeasonId: data.meta.currentSeasonId,
    seasons: data.seasons.map((season) => brief(data, season)).reverse(),
  };
}

function getSeasonDetail(seasonId) {
  const data = load();
  const season = getSeason(data, seasonId);
  const teamMap = new Map(data.teams.map((team) => [team.id, team]));
  const frozenDirection = new Map();
  const frozenReason = new Map();
  if (season.promotion) {
    season.promotion.entries.forEach((entry) => {
      frozenDirection.set(entry.teamId, entry.direction);
      frozenReason.set(entry.teamId, entry.reason);
    });
  }
  const frozenRank = new Map();
  if (season.finalTable) {
    season.finalTable.forEach((row) => frozenRank.set(row.teamId, row.rank));
  }

  const roster = season.roster.map((member) => {
    const team = teamMap.get(member.teamId);
    return {
      teamId: member.teamId,
      name: team ? team.name : '已删除球队',
      shortName: team ? team.shortName : '',
      city: team ? team.city : '',
      venueId: team ? team.venueId : '',
      seedRank: member.seedRank,
      status: member.status,
      carriedFrom: member.carriedFrom,
      finalRank: frozenRank.has(member.teamId) ? frozenRank.get(member.teamId) : null,
      direction: frozenDirection.get(member.teamId) || '',
      directionReason: frozenReason.get(member.teamId) || '',
      missing: !team,
    };
  }).sort((a, b) => a.seedRank - b.seedRank);

  return {
    currentSeasonId: data.meta.currentSeasonId,
    season: brief(data, season),
    roster,
    finalTable: season.finalTable,
    promotion: season.promotion,
  };
}

// 试算：不落盘，按传入的规则与升级候选随时重算
function previewPromotion(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = getSeason(data, pickText(input.seasonId));
  if (season.status === '已收官') {
    // 已收官的赛季直接给冻结结果，规则不再参与重算
    return {
      seasonId: season.id,
      frozen: true,
      completion: completionOf(season),
      rules: season.promotion ? season.promotion.rules : season.rules,
      entries: season.promotion ? season.promotion.entries : [],
      changes: season.promotion ? season.promotion.changes : [],
      table: season.finalTable || [],
      availableOutside: [],
      promotedSlots: season.promotion ? season.promotion.rules.promotionCount : 0,
      chosenCount: season.promotion ? season.promotion.entries.filter((e) => e.direction === '升级').length : 0,
      shortBy: 0,
      vacatedTiers: [],
      warnings: season.status === '已收官' ? ['该季已收官，去向已冻结，调整规则只对进行中的赛季生效'] : [],
    };
  }
  const rules = input.rules === undefined ? season.rules : readRules(input.rules);
  const promotedIds = readPromotedIds(input);
  const result = computeDestinations(data, season, rules, promotedIds);
  return {
    seasonId: season.id,
    frozen: false,
    completion: completionOf(season),
    ...result,
  };
}

// 改赛季名称或升降级规则；规则只允许在进行中改，改完返回与旧规则的去向差异
function updateSeason(seasonId, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = findSeason(data, seasonId);

  if (input.name !== undefined) {
    const name = pickText(input.name);
    if (!name) throw new ApiError(400, 'SEASON_NAME_REQUIRED', '请填写赛季名称', 'name');
    if (name.length > MAX_SEASON_NAME) {
      throw new ApiError(400, 'SEASON_NAME_TOO_LONG', `赛季名称不能超过 ${MAX_SEASON_NAME} 个字`, 'name');
    }
    if (data.seasons.some((item) => item.id !== season.id && item.name === name)) {
      throw new ApiError(409, 'SEASON_NAME_DUPLICATED', `${name} 已经有一个赛季在用了`, 'name');
    }
    season.name = name;
  }

  let changes = null;
  let rulesApplied = null;
  if (input.rules !== undefined && input.rules !== null) {
    if (season.status === '已收官') {
      throw new ApiError(409, 'SEASON_FINALIZED', '该季已经收官，升降级结果与规则已冻结，不能再改', '');
    }
    const oldDestinations = computeDestinations(data, season, season.rules, []);
    const rules = readRules(input.rules);
    const newDestinations = computeDestinations(data, season, rules, []);
    changes = diffDestinations(oldDestinations, newDestinations);
    season.rules = rules;
    rulesApplied = { rules, changes, warnings: newDestinations.warnings };
  }

  save(data);
  return { season: brief(data, season), rulesChange: rulesApplied };
}

function switchSeason(seasonId) {
  const data = load();
  const season = findSeason(data, pickText(seasonId));
  data.meta.currentSeasonId = season.id;
  save(data);
  return { currentSeasonId: season.id };
}

// 正式收官：校验完赛与升级候选，冻结最终名次与每支球队的去向
function finalizeSeason(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = getSeason(data, pickText(input.seasonId));
  if (season.status === '已收官') {
    throw new ApiError(409, 'SEASON_FINALIZED', '该季已经收官，不能重复结算', '');
  }
  if (latestSeason(data) && latestSeason(data).id !== season.id) {
    throw new ApiError(409, 'SEASON_NOT_LATEST', '只能结算最新一个赛季', '');
  }

  const completion = completionOf(season);
  if (!completion.complete) {
    throw new ApiError(409, 'SEASON_NOT_COMPLETE', `赛季还没打完：${completion.blockers.join('；')}`, '');
  }

  const promotedIds = readPromotedIds(input);
  const result = computeDestinations(data, season, season.rules, promotedIds);
  if (result.shortBy > 0 || promotedIds.length !== season.rules.promotionCount) {
    throw new ApiError(
      409,
      'PROMOTION_PICK_MISMATCH',
      `升级名额是 ${season.rules.promotionCount} 个，外池候选有 ${result.availableOutside.length} 支、已选 ${promotedIds.length} 支；请到球队页补齐外池球队，或调整升级队数`,
      'promotedIds',
    );
  }

  const table = computeTableForSeason(season, data.teams);
  const memberMap = new Map(season.roster.map((r) => [r.teamId, r]));
  season.finalTable = table.map((row) => ({
    teamId: row.teamId,
    name: row.name,
    shortName: row.shortName,
    city: row.city,
    status: row.status,
    seedRank: memberMap.has(row.teamId) ? memberMap.get(row.teamId).seedRank : null,
    rank: row.rank,
    played: row.played,
    win: row.win,
    draw: row.draw,
    loss: row.loss,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalDiff,
    points: row.points,
  }));
  season.promotion = {
    decidedAt: new Date().toISOString(),
    rules: { ...season.rules },
    entries: result.entries.map((entry) => ({ ...entry })),
    changes: [],
  };
  season.status = '已收官';
  season.finalizedAt = new Date().toISOString();
  save(data);
  return { season: brief(data, season), finalTable: season.finalTable, promotion: season.promotion };
}

// 建议的新赛季名称：春→秋，跨年则年份加一
function suggestSeasonName(sourceName) {
  const yearMatch = String(sourceName).match(/(\d{4})/);
  if (!yearMatch) return `${sourceName} 下一季`;
  const year = Number(yearMatch[1]);
  if (sourceName.includes('春')) return sourceName.replace('春', '秋');
  if (sourceName.includes('秋')) return sourceName.replace(String(year), String(year + 1)).replace('秋', '春');
  return `${sourceName}（${year + 1}）`;
}

// 新赛季草稿：留级队沿用档位，升级队填腾出的档位；列出空位供页面调整
function draftNewSeason() {
  const data = load();
  const source = latestSeason(data);
  if (!source) throw new ApiError(409, 'NO_SEASON', '还没有任何赛季', '');
  if (source.status !== '已收官') {
    throw new ApiError(409, 'SOURCE_NOT_FINALIZED', '最新一季还没收官，先在赛季页完成升降级结算', '');
  }

  const entries = source.promotion.entries;
  const stay = entries.filter((e) => e.direction === '留级').slice().sort((a, b) => a.rank - b.rank);
  const promoted = entries.filter((e) => e.direction === '升级');
  const relegated = entries.filter((e) => e.direction === '降级').slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));

  const assignments = []
    .concat(stay.map((e) => ({ teamId: e.teamId, seedRank: e.targetTier, source: '留级' })))
    .concat(promoted.map((e) => ({ teamId: e.teamId, seedRank: e.targetTier, source: '升级' })));

  const usedTiers = new Set(assignments.map((a) => a.seedRank).filter((tier) => Number.isInteger(tier)));
  const expectedMax = Math.max(source.roster.length, ...Array.from(usedTiers), 0);
  const emptyTiers = [];
  for (let tier = 1; tier <= expectedMax; tier += 1) {
    if (!usedTiers.has(tier)) emptyTiers.push(tier);
  }

  return {
    sourceSeasonId: source.id,
    sourceSeasonName: source.name,
    suggestedName: suggestSeasonName(source.name),
    rules: { ...source.rules },
    points: { ...source.points },
    stay,
    promoted,
    relegated,
    assignments: assignments.filter((a) => Number.isInteger(a.seedRank)),
    unassignedPromoted: assignments.filter((a) => !Number.isInteger(a.seedRank)),
    emptyTiers,
    warnings: emptyTiers.length
      ? [`第 ${emptyTiers.join('、')} 档没有球队，可在下方调整档位，或先到球队页把外池球队补进来后重建`]
      : [],
  };
}

function createSeason(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const source = latestSeason(data);
  if (!source) throw new ApiError(409, 'NO_SEASON', '还没有任何赛季', '');
  if (source.status !== '已收官') {
    throw new ApiError(409, 'SOURCE_NOT_FINALIZED', '上一季还没收官，不能建新赛季', '');
  }

  const name = pickText(input.name);
  if (!name) throw new ApiError(400, 'SEASON_NAME_REQUIRED', '请填写新赛季的名称', 'name');
  if (name.length > MAX_SEASON_NAME) {
    throw new ApiError(400, 'SEASON_NAME_TOO_LONG', `赛季名称不能超过 ${MAX_SEASON_NAME} 个字`, 'name');
  }
  if (data.seasons.some((item) => item.name === name)) {
    throw new ApiError(409, 'SEASON_NAME_DUPLICATED', `${name} 已经有一个赛季在用了`, 'name');
  }

  const allowed = new Map(
    source.promotion.entries
      .filter((entry) => entry.direction === '留级' || entry.direction === '升级')
      .map((entry) => [entry.teamId, entry]),
  );
  const requiredIds = Array.from(allowed.keys());

  let rawAssignments = input.assignments;
  if (!Array.isArray(rawAssignments) || rawAssignments.length === 0) {
    throw new ApiError(400, 'ASSIGNMENTS_REQUIRED', '请提交新赛季的参赛球队与档位', 'assignments');
  }

  const teamMap = new Map(data.teams.map((team) => [team.id, team]));
  const assignments = [];
  const seen = new Set();
  rawAssignments.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const teamId = pickText(item.teamId);
    const tier = Number(item.seedRank);
    if (!teamId) return;
    if (!teamMap.has(teamId)) {
      throw new ApiError(404, 'TEAM_NOT_FOUND', `球队 ${teamId} 没有登记过`, 'assignments');
    }
    if (!allowed.has(teamId)) {
      throw new ApiError(409, 'TEAM_NOT_IN_PLAN', `${teamMap.get(teamId).name} 不在上季升降级确定的参赛集合里，留级与升级的球队才能参加新一季`, 'assignments');
    }
    if (seen.has(teamId)) {
      throw new ApiError(409, 'ASSIGNMENT_DUPLICATED', `${teamMap.get(teamId).name} 被排了两次`, 'assignments');
    }
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TEAMS) {
      throw new ApiError(400, 'SEED_RANK_INVALID', `${teamMap.get(teamId).name} 的档位要填 1 到 ${MAX_TEAMS} 之间的整数`, 'assignments');
    }
    seen.add(teamId);
    assignments.push({ teamId, tier });
  });

  const missing = requiredIds.filter((id) => !seen.has(id))
    .map((id) => teamMap.get(id).name);
  if (missing.length > 0) {
    throw new ApiError(409, 'STAY_TEAM_MISSING', `这些留级或升级球队还没排进新赛季：${missing.join('、')}`, 'assignments');
  }
  if (assignments.length < 2) {
    throw new ApiError(409, 'NOT_ENOUGH_TEAMS', '新赛季至少要有两支球队', 'assignments');
  }

  // 档位冲突：同一档位排了两支球队
  const tierOwners = new Map();
  assignments.forEach((a) => {
    if (!tierOwners.has(a.tier)) tierOwners.set(a.tier, []);
    tierOwners.get(a.tier).push(a.teamId);
  });
  const conflicts = Array.from(tierOwners.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([tier, ids]) => ({ tier, teams: ids.map((id) => teamMap.get(id).name) }));
  if (conflicts.length > 0) {
    const text = conflicts.map((c) => `第 ${c.tier} 档：${c.teams.join('、')}`).join('；');
    throw new ApiError(409, 'SEED_TIER_CONFLICT', `档位冲突，${text}；请把其中一支改到空档位`, 'assignments');
  }

  const usedTiers = new Set(assignments.map((a) => a.tier));
  const maxTier = Math.max(...Array.from(usedTiers), assignments.length);
  const emptyTiers = [];
  for (let tier = 1; tier <= maxTier; tier += 1) {
    if (!usedTiers.has(tier)) emptyTiers.push(tier);
  }

  const now = new Date().toISOString();
  const season = {
    id: crypto.randomUUID(),
    name,
    status: '进行中',
    points: { ...source.points },
    rules: source.rules && typeof source.rules === 'object' ? { ...source.rules } : { promotionCount: 2, relegationCount: 2 },
    roster: assignments
      .slice()
      .sort((a, b) => a.tier - b.tier)
      .map((a) => ({ teamId: a.teamId, seedRank: a.tier, status: '参赛', carriedFrom: source.id })),
    matches: [],
    finalTable: null,
    promotion: null,
    createdAt: now,
    finalizedAt: null,
  };
  data.seasons.push(season);
  data.meta.currentSeasonId = season.id;
  save(data);

  return {
    season: brief(data, season),
    emptyTiers,
    warnings: emptyTiers.length
      ? [`第 ${emptyTiers.join('、')} 档空着，开赛后可以在球队页让外池球队补进，或调整各队档位`]
      : [],
  };
}

module.exports = {
  listSeasons,
  getSeasonDetail,
  previewPromotion,
  updateSeason,
  switchSeason,
  finalizeSeason,
  draftNewSeason,
  createSeason,
  completionOf,
  computeDestinations,
  diffDestinations,
};
