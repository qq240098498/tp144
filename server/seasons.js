// 跨赛季：按最终名次结出升级/降级/留级清单，按结果生成下一季名册，并冻结上一季的赛程与积分
const crypto = require('crypto');
const {
  load, save, MAX_TEAMS, MAX_NOTE,
  DEFAULT_PROMOTION, DEFAULT_RELEGATION,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const { findSeason, rosterTeams, outsiderTeams } = require('./seasonUtil');
const { computeForSeason } = require('./standings');

const MAX_SEASON_NAME = 40;

// 纯函数：按名次与规则算每支球队的去向。退赛队不计入升级/降级名额，按降级处理
function buildOutcomes(season, teamsInSeason, rules) {
  const table = computeForSeason(season, teamsInSeason);
  const rosterStatus = new Map(season.roster.map((row) => [row.teamId, row.status]));
  const eligible = table.filter((row) => rosterStatus.get(row.teamId) === '参赛');
  const total = eligible.length;
  const P = Math.min(rules.promotionCount, total);
  const M = Math.min(rules.relegationCount, total);
  if (P + M > total) {
    throw new ApiError(400, 'RULES_OVERFLOW', `升级 ${P} 队加降级 ${M} 队超过了参赛球队数 ${total}，名额之和不能超过队数`, 'relegationCount');
  }

  const promotedIds = new Set(eligible.slice(0, P).map((row) => row.teamId));
  const relegatedIds = new Set(eligible.slice(total - M).map((row) => row.teamId));

  const rows = table.map((row) => {
    const withdrawn = rosterStatus.get(row.teamId) === '退赛';
    let outcome = '留级';
    let reason = `第 ${row.rank} 名，留队征战下一季`;
    if (withdrawn) {
      outcome = '降级';
      reason = '本赛季已退赛，按降级处理，不占用降级名额';
    } else if (promotedIds.has(row.teamId)) {
      outcome = '升级';
      reason = `第 ${row.rank} 名（升级区取前 ${P} 名），升入高级别联赛`;
    } else if (relegatedIds.has(row.teamId)) {
      outcome = '降级';
      reason = `第 ${row.rank} 名（降级区为榜尾 ${M} 名），降入低别级联赛`;
    }
    return {
      teamId: row.teamId,
      rank: row.rank,
      played: row.played,
      win: row.win,
      draw: row.draw,
      loss: row.loss,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDiff: row.goalDiff,
      points: row.points,
      status: withdrawn ? '退赛' : '参赛',
      outcome,
      forced: withdrawn,
      reason,
    };
  });

  return { rows, eligibleCount: total, promotionCount: P, relegationCount: M };
}

function readRules(body, fallback) {
  const source = body && typeof body === 'object' ? body : {};
  const promotionCount = source.promotionCount === undefined || source.promotionCount === ''
    ? fallback.promotionCount : Number(source.promotionCount);
  const relegationCount = source.relegationCount === undefined || source.relegationCount === ''
    ? fallback.relegationCount : Number(source.relegationCount);
  if (!Number.isInteger(promotionCount) || promotionCount < 0 || promotionCount > MAX_TEAMS) {
    throw new ApiError(400, 'PROMOTION_COUNT_INVALID', `升级队数要填 0 到 ${MAX_TEAMS} 之间的整数`, 'promotionCount');
  }
  if (!Number.isInteger(relegationCount) || relegationCount < 0 || relegationCount > MAX_TEAMS) {
    throw new ApiError(400, 'RELEGATION_COUNT_INVALID', `降级队数要填 0 到 ${MAX_TEAMS} 之间的整数`, 'relegationCount');
  }
  return { promotionCount, relegationCount };
}

function unfinishedWarning(season) {
  const pending = season.matches.filter((m) => m.status === '待赛' || m.status === '延期').length;
  const cancelled = season.matches.filter((m) => m.status === '取消').length;
  if (pending === 0) return cancelled > 0 ? `还有 ${cancelled} 场取消的场次不计入名次` : '';
  return `还有 ${pending} 场没打完（待赛或延期），现在结算的名次不是最终名次，确认后仍可重算`;
}

// 与已保存的去向对比，列出去属发生变化的球队
function diffMovements(previous, nextRows) {
  if (!Array.isArray(previous)) return [];
  const oldMap = new Map(previous.map((row) => [row.teamId, row.outcome]));
  const changes = [];
  nextRows.forEach((row) => {
    const old = oldMap.get(row.teamId);
    if (old && old !== row.outcome) {
      changes.push({ teamId: row.teamId, rank: row.rank, from: old, to: row.outcome });
    }
  });
  return changes;
}

function settlePreview(options) {
  const input = options && typeof options === 'object' ? options : {};
  const data = load();
  const season = findSeason(data, input.seasonId || data.meta.activeSeasonId);
  const rules = readRules(input, season.rules);
  const teamsInSeason = rosterTeams(data, season);
  const nameMap = new Map(teamsInSeason.map((team) => [team.teamId, team.name]));
  const { rows, eligibleCount } = buildOutcomes(season, teamsInSeason, rules);

  const changes = diffMovements(season.movements, rows)
    .map((change) => ({ ...change, teamName: nameMap.get(change.teamId) || '未知球队' }));

  const laterSeason = data.seasons.find((item) => item.sequence > season.sequence);
  const downstreamWarning = laterSeason
    ? `后续赛季《${laterSeason.name}》已经建立，重算只会更新本季的去向记录，不会改动该季已确定的名册；如需调整请到那一季的名册里增删球队`
    : '';

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonStatus: season.status,
    rules,
    savedRules: { ...season.rules },
    eligibleCount,
    settled: season.status === '已结算',
    warning: unfinishedWarning(season),
    downstreamWarning,
    rows: rows.map((row) => ({ ...row, teamName: nameMap.get(row.teamId) || '未知球队' })),
    changes,
    rulesTouched: rules.promotionCount !== season.rules.promotionCount || rules.relegationCount !== season.rules.relegationCount,
  };
}

function snapshotFinalTable(rows) {
  return rows.map((row) => ({
    teamId: row.teamId,
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
}

// 确认结算：第一次结存冻结名次；之后改规则重算，只更新去向并记下哪些队归属变了
function confirmSettle(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const season = findSeason(data, body.seasonId || data.meta.activeSeasonId);
  const rules = readRules(body, season.rules);
  const teamsInSeason = rosterTeams(data, season);
  const { rows } = buildOutcomes(season, teamsInSeason, rules);
  const nameMap = new Map(teamsInSeason.map((team) => [team.teamId, team.name]));

  const warning = unfinishedWarning(season);
  if (warning && !body.ignorePending) {
    throw new ApiError(409, 'SEASON_UNFINISHED', `${warning}。确认仍要结算请勾选“知道了，照当前名次结算”`, '');
  }

  const changes = diffMovements(season.movements, rows);
  const wasSettled = season.status === '已结算';
  const now = new Date().toISOString();

  season.status = '已结算';
  season.rules = rules;
  season.finalTable = snapshotFinalTable(rows);
  season.movements = rows.map((row) => ({ teamId: row.teamId, rank: row.rank, outcome: row.outcome, forced: Boolean(row.forced) }));
  season.settledAt = season.settledAt || now;
  season.updatedAt = now;
  season.rulesLog.push({
    at: now,
    action: wasSettled ? 'recalc' : 'settle',
    from: wasSettled ? { ...season.rules } : null,
    to: { ...rules },
    changes: changes.map((change) => ({ ...change, teamName: nameMap.get(change.teamId) || '未知球队' })),
  });

  save(data);
  return {
    seasonId: season.id,
    seasonName: season.name,
    settled: true,
    recalculated: wasSettled,
    rules,
    changes: changes.map((change) => ({ ...change, teamName: nameMap.get(change.teamId) || '未知球队' })),
    rows: rows.map((row) => ({ ...row, teamName: nameMap.get(row.teamId) || '未知球队' })),
  };
}

// 下一季名册的档位分配。留级队 = 去向留级；升级队从全局名录里勾选
function planNewSeason(data, priorSeason, payload) {
  const teamsInSeason = rosterTeams(data, priorSeason);
  const nameMap = new Map(data.teams.map((team) => [team.id, team.name]));
  const outcomes = buildOutcomes(priorSeason, teamsInSeason, priorSeason.rules).rows;
  const outcomeByTeam = new Map(outcomes.map((row) => [row.teamId, row]));

  const stayers = outcomes.filter((row) => row.outcome === '留级');
  const priorRank = new Map(priorSeason.roster.map((row) => [row.teamId, row.seedRank]));

  const available = outsiderTeams(data, priorSeason);
  const availableIds = new Set(available.map((team) => team.id));
  const requested = Array.isArray(payload.promoteTeamIds) ? payload.promoteTeamIds.map(pickText).filter(Boolean) : available.map((team) => team.id);
  const promotees = [];
  const seen = new Set();
  requested.forEach((id) => {
    if (!availableIds.has(id)) {
      throw new ApiError(404, 'PROMOTE_TEAM_NOT_FOUND', '勾选的升级球队不在候选名录里（可能已在本季名册或不存在）', 'promoteTeamIds');
    }
    if (seen.has(id)) return;
    seen.add(id);
    promotees.push(data.teams.find((team) => team.id === id));
  });
  promotees.sort((a, b) => (a.name < b.name ? -1 : 1));

  if (stayers.length + promotees.length === 0) {
    throw new ApiError(400, 'NEW_SEASON_EMPTY', '新赛季至少要有一支球队', 'promoteTeamIds');
  }
  if (stayers.length + promotees.length > MAX_TEAMS) {
    throw new ApiError(409, 'NEW_SEASON_TOO_MANY', `留级 ${stayers.length} 队加升级 ${promotees.length} 队超过 ${MAX_TEAMS} 队上限，请少选几支升级队`, 'promoteTeamIds');
  }

  const seedMode = pickText(payload.seedMode) === 'compact' ? 'compact' : 'keep';
  const assignments = [];
  const holes = [];

  if (seedMode === 'compact') {
    stayers.sort((a, b) => a.rank - b.rank).forEach((row, index) => {
      assignments.push({ teamId: row.teamId, seedRank: index + 1, joinedFrom: '留级', carryNote: `按《${priorSeason.name}》最终名次重排档位（原名次第 ${row.rank}）` });
    });
    promotees.forEach((team, index) => {
      assignments.push({ teamId: team.id, seedRank: stayers.length + index + 1, joinedFrom: '升级', carryNote: `升级入赛，排在留级队之后` });
    });
  } else {
    // keep：留级队沿用上季档位；降级队空出来的档位先给升级队补位，多出的顺延到队尾
    const usedRanks = new Set();
    stayers.forEach((row) => {
      const rank = priorRank.get(row.teamId);
      usedRanks.add(rank);
      assignments.push({ teamId: row.teamId, seedRank: rank, joinedFrom: '留级', carryNote: `沿用《${priorSeason.name}》第 ${rank} 档（最终名次第 ${row.rank}）` });
    });

    // 空档位 = 升级与降级（含强制降级的退赛队）腾出来的档位 + 名册中间本来就空着的档
    const priorMax = Math.max(...priorSeason.roster.map((row) => row.seedRank), 0);
    const vacated = outcomes
      .filter((row) => row.outcome !== '留级')
      .map((row) => ({
        rank: priorRank.get(row.teamId),
        teamName: nameMap.get(row.teamId) || '未知球队',
        outcome: row.outcome,
        forced: Boolean(row.forced),
      }))
      .sort((a, b) => a.rank - b.rank);
    const freeRanks = [];
    for (let rank = 1; rank <= priorMax; rank += 1) {
      if (!usedRanks.has(rank)) freeRanks.push(rank);
    }

    promotees.forEach((team, index) => {
      const fillRank = freeRanks.shift();
      if (fillRank) {
        const hole = vacated.find((item) => item.rank === fillRank);
        assignments.push({
          teamId: team.id,
          seedRank: fillRank,
          joinedFrom: '升级',
          carryNote: `升级补位，占第 ${fillRank} 档${hole ? `（${hole.teamName}${hole.forced ? '退赛' : hole.outcome}空出）` : '（原有空位）'}`,
        });
        holes.push({ rank: fillRank, fromTeamName: hole ? hole.teamName : '', fromOutcome: hole ? hole.outcome : '', filledBy: team.name });
        usedRanks.add(fillRank);
      } else {
        let rank = priorMax + 1;
        while (usedRanks.has(rank)) rank += 1;
        assignments.push({
          teamId: team.id,
          seedRank: rank,
          joinedFrom: '升级',
          carryNote: `升级入赛，空档位已补满，顺延到第 ${rank} 档`,
        });
        usedRanks.add(rank);
      }
    });

    // 没人补的空档位也要交代清楚
    freeRanks.forEach((rank) => {
      const hole = vacated.find((item) => item.rank === rank);
      holes.push({ rank, fromTeamName: hole ? hole.teamName : '', fromOutcome: hole ? hole.outcome : '', filledBy: '' });
    });
  }

  // 手动指定档位时在自动方案上覆盖，并检查冲突
  const overrides = payload.seeds && typeof payload.seeds === 'object' ? payload.seeds : {};
  const slotTaken = new Map();
  assignments.forEach((item) => slotTaken.set(item.seedRank, item.teamId));
  assignments.forEach((item) => {
    if (overrides[item.teamId] === undefined || overrides[item.teamId] === '') return;
    const rank = Number(overrides[item.teamId]);
    if (!Number.isInteger(rank) || rank < 1 || rank > MAX_TEAMS) {
      throw new ApiError(400, 'SEED_RANK_INVALID', `档位要填 1 到 ${MAX_TEAMS} 之间的整数`, 'seeds');
    }
    const occupant = slotTaken.get(rank);
    if (occupant && occupant !== item.teamId) {
      throw new ApiError(409, 'SEED_CONFLICT', `第 ${rank} 档同时分给了 ${nameMap.get(item.teamId)} 和 ${nameMap.get(occupant)}，请错开档位或改用自动排档`, 'seeds');
    }
    slotTaken.delete(item.seedRank);
    item.seedRank = rank;
    slotTaken.set(rank, item.teamId);
    item.carryNote = `手动指定第 ${rank} 档`;
  });

  assignments.sort((a, b) => a.seedRank - b.seedRank);

  const relegated = outcomes.filter((row) => row.outcome === '降级');
  return {
    priorSeasonId: priorSeason.id,
    priorSeasonName: priorSeason.name,
    seedMode,
    stayers: stayers.map((row) => ({ teamId: row.teamId, teamName: nameMap.get(row.teamId) || '未知球队', finalRank: row.rank })),
    relegated: relegated.map((row) => ({ teamId: row.teamId, teamName: nameMap.get(row.teamId) || '未知球队', finalRank: row.rank, forced: Boolean(row.forced) })),
    candidates: available.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      shortName: team.shortName,
      city: team.city,
      picked: seen.has(team.id),
    })),
    roster: assignments.map((item) => ({ ...item, teamName: nameMap.get(item.teamId) || '未知球队' })),
    holes,
    capacity: MAX_TEAMS,
    teamCount: assignments.length,
  };
}

function newSeasonPreview(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const priorSeason = findSeason(data, body.fromSeasonId || data.meta.activeSeasonId);
  if (priorSeason.status !== '已结算') {
    throw new ApiError(409, 'PRIOR_SEASON_NOT_SETTLED', `《${priorSeason.name}》还没结算，先按名次结出升降级再建新赛季`, '');
  }
  if (data.seasons.some((item) => item.sequence > priorSeason.sequence)) {
    throw new ApiError(409, 'NEXT_SEASON_EXISTS', `《${priorSeason.name}》后面的赛季已经建立，不能重复建季`, '');
  }
  return planNewSeason(data, priorSeason, body);
}

function createSeason(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const priorSeason = findSeason(data, body.fromSeasonId || data.meta.activeSeasonId);
  if (priorSeason.status !== '已结算') {
    throw new ApiError(409, 'PRIOR_SEASON_NOT_SETTLED', `《${priorSeason.name}》还没结算，先按名次结出升降级再建新赛季`, '');
  }
  if (data.seasons.some((item) => item.sequence > priorSeason.sequence)) {
    throw new ApiError(409, 'NEXT_SEASON_EXISTS', `《${priorSeason.name}》后面的赛季已经建立，不能重复建季`, '');
  }

  const name = pickText(body.name);
  if (!name) throw new ApiError(400, 'SEASON_NAME_REQUIRED', '请填写新赛季名称', 'name');
  if (name.length > MAX_SEASON_NAME) {
    throw new ApiError(400, 'SEASON_NAME_TOO_LONG', `赛季名称不能超过 ${MAX_SEASON_NAME} 个字`, 'name');
  }
  if (data.seasons.some((season) => season.name === name)) {
    throw new ApiError(409, 'SEASON_NAME_DUPLICATED', `已经有一个叫 ${name} 的赛季了`, 'name');
  }

  const plan = planNewSeason(data, priorSeason, body);
  const now = new Date().toISOString();
  const season = {
    id: crypto.randomUUID(),
    name,
    sequence: Math.max(...data.seasons.map((item) => item.sequence), 0) + 1,
    status: '进行中',
    points: { ...priorSeason.points },
    rules: { ...priorSeason.rules },
    roster: plan.roster.map((row) => ({
      teamId: row.teamId,
      seedRank: row.seedRank,
      status: '参赛',
      joinedFrom: row.joinedFrom,
      carryNote: row.carryNote,
      updatedAt: now,
    })),
    matches: [],
    finalTable: null,
    movements: null,
    rulesLog: [],
    createdAt: now,
    settledAt: null,
    updatedAt: now,
  };

  data.seasons.push(season);
  data.meta.activeSeasonId = season.id;
  data.meta.points = season.points;
  data.meta.updatedAt = now;
  save(data);
  return { ...seasonDetail(data, season), plan };
}

function seasonDetail(data, season) {
  const teamsInSeason = rosterTeams(data, season);
  const nameMap = new Map(teamsInSeason.map((team) => [team.teamId, team.name]));
  const played = season.matches.filter((m) => m.status === '已赛').length;
  let movements = null;
  if (season.movements) {
    const outcomeMap = new Map(season.movements.map((row) => [row.teamId, row]));
    movements = (season.finalTable || []).map((row) => {
      const saved = outcomeMap.get(row.teamId);
      const team = teamsInSeason.find((item) => item.teamId === row.teamId);
      return {
        ...row,
        teamName: nameMap.get(row.teamId) || '未知球队',
        shortName: team ? team.shortName : '',
        city: team ? team.city : '',
        status: team ? team.status : '参赛',
        outcome: saved ? saved.outcome : '留级',
        forced: saved ? Boolean(saved.forced) : false,
      };
    });
  }
  return {
    id: season.id,
    name: season.name,
    sequence: season.sequence,
    status: season.status,
    points: season.points,
    rules: season.rules,
    isActive: season.id === data.meta.activeSeasonId,
    teamCount: season.roster.length,
    activeCount: season.roster.filter((row) => row.status === '参赛').length,
    matchCount: season.matches.length,
    playedCount: played,
    pendingCount: season.matches.filter((m) => m.status === '待赛').length,
    movements,
    rulesLog: season.rulesLog,
    createdAt: season.createdAt,
    settledAt: season.settledAt,
  };
}

function listSeasons() {
  const data = load();
  return {
    activeSeasonId: data.meta.activeSeasonId,
    seasons: data.seasons
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((season) => {
        const detail = seasonDetail(data, season);
        const champion = season.status === '已结算' && season.finalTable && season.finalTable.length
          ? (data.teams.find((team) => team.id === season.finalTable[0].teamId) || {}).name || ''
          : '';
        const canCreateNext = season.status === '已结算'
          && data.seasons.every((item) => item.sequence <= season.sequence || item.status === '已结算');
        return {
          id: detail.id,
          name: detail.name,
          sequence: detail.sequence,
          status: detail.status,
          isActive: detail.isActive,
          teamCount: detail.teamCount,
          matchCount: detail.matchCount,
          playedCount: detail.playedCount,
          rules: detail.rules,
          champion,
          settledAt: detail.settledAt,
          canCreateNext,
        };
      }),
  };
}

function getSeason(seasonId) {
  const data = load();
  const season = findSeason(data, seasonId || data.meta.activeSeasonId);
  return seasonDetail(data, season);
}

// 切换正在查看的赛季；历史赛季可以看赛程与积分，但增删改按钮会收起
function switchSeason(seasonId) {
  const data = load();
  const season = findSeason(data, seasonId);
  data.meta.activeSeasonId = season.id;
  data.meta.updatedAt = new Date().toISOString();
  save(data);
  return seasonDetail(data, season);
}

module.exports = {
  listSeasons,
  getSeason,
  switchSeason,
  settlePreview,
  confirmSettle,
  newSeasonPreview,
  createSeason,
  buildOutcomes,
};
