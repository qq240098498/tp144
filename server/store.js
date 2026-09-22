const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const SEASON = '2026 春季联赛';
const MAX_TEAM_NAME = 24;
const MAX_SHORT_NAME = 4;
const MAX_VENUE_NAME = 30;
const MAX_SEASON_NAME = 30;
const MAX_NOTE = 200;
const MAX_TEAMS = 12;
const STATUS_POOL = ['待赛', '已赛', '延期', '取消'];
const TEAM_STATUS_POOL = ['参赛', '退赛'];
const DEFAULT_RULES = { promotionCount: 2, relegationCount: 2 };
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

// 初始数据：八支球队、四个场地（其中两支球队共用中立体育场）、七轮单循环共二十八场，
// 前三轮已经打完并记了比分，第四轮有一场延期，其余待赛
function seedData() {
  const at = '2026-02-20T02:00:00.000Z';
  const teams = [
    { id: 'team-1001', name: '江城铁马', shortName: 'JCTM', city: '江城', venueId: 'venue-2001', seedRank: 1, status: '参赛', note: '上赛季冠军', createdAt: at, updatedAt: at },
    { id: 'team-1002', name: '海陵海燕', shortName: 'HLHY', city: '海陵', venueId: 'venue-2002', seedRank: 2, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1003', name: '云岭苍狼', shortName: 'YLCW', city: '云岭', venueId: 'venue-2003', seedRank: 3, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1004', name: '平原飞驰', shortName: 'PYFC', city: '平原', venueId: 'venue-2004', seedRank: 4, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1005', name: '沙洲锚队', shortName: 'SZMD', city: '沙洲', venueId: 'venue-2004', seedRank: 5, status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1006', name: '白鹿白鹭', shortName: 'BLBL', city: '白鹿', venueId: 'venue-2004', seedRank: 6, status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1007', name: '青峰青松', shortName: 'QFQS', city: '青峰', venueId: 'venue-2005', seedRank: 7, status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1008', name: '洛水洛神', shortName: 'LSLS', city: '洛水', venueId: 'venue-2006', seedRank: 8, status: '参赛', note: '', createdAt: at, updatedAt: at },
  ];

  const venues = [
    { id: 'venue-2001', name: '江城体育中心', city: '江城', capacity: 32000, weekdays: [6], note: '主场馆', createdAt: at, updatedAt: at },
    { id: 'venue-2002', name: '海陵湾球场', city: '海陵', capacity: 18000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2003', name: '云岭高地', city: '云岭', capacity: 12000, weekdays: [6, 0], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2004', name: '中立体育场', city: '中立', capacity: 24000, weekdays: [6, 0], note: '平原、沙洲、白鹿三家共用', createdAt: at, updatedAt: at },
    { id: 'venue-2005', name: '青峰山球场', city: '青峰', capacity: 9000, weekdays: [0], note: '只有周日可用', createdAt: at, updatedAt: at },
    { id: 'venue-2006', name: '洛水古渡球场', city: '洛水', capacity: 8000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
  ];

  // 单循环轮转表：八支球队七轮，每轮四场，主场按轮次左右交替
  const order = ['team-1001', 'team-1002', 'team-1003', 'team-1004', 'team-1005', 'team-1006', 'team-1007', 'team-1008'];
  const scores = {
    '整轮1场1': [2, 0], '整轮1场2': [1, 1], '整轮1场3': [3, 1], '整轮1场4': [0, 2],
    '整轮2场1': [1, 2], '整轮2场2': [2, 2], '整轮2场3': [0, 0], '整轮2场4': [4, 1],
    '整轮3场1': [2, 1], '整轮3场2': [1, 0], '整轮3场3': [1, 3], '整轮3场4': [2, 0],
  };

  const matches = [];
  const rounds = 7;
  let counter = 0;
  // 每轮比上一轮晚七天，从 3 月 7 日起；直接按日历推算，避免月末拼出不存在的日期
  const roundDate = (round) => {
    const date = new Date(Date.UTC(2026, 2, 7 + (round - 1) * 7));
    return date.toISOString().slice(0, 10);
  };
  for (let round = 1; round <= rounds; round += 1) {
    const date = roundDate(round);
    for (let i = 0; i < order.length / 2; i += 1) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      counter += 1;
      const key = `整轮${round}场${i + 1}`;
      const played = Object.prototype.hasOwnProperty.call(scores, key);
      const isPostponed = round === 4 && i === 1;
      matches.push({
        id: `match-3001-${String(counter).padStart(2, '0')}`,
        round,
        date,
        kickoff: i % 2 === 0 ? '15:30' : '19:30',
        venueId: i === 3 ? 'venue-2004' : null,
        homeTeamId: i % 2 === 0 ? home : away,
        awayTeamId: i % 2 === 0 ? away : home,
        status: played ? '已赛' : (isPostponed ? '延期' : '待赛'),
        homeGoals: played ? scores[key][0] : null,
        awayGoals: played ? scores[key][1] : null,
        note: isPostponed ? '主队场地检修，日期待定' : '',
        createdAt: at,
        updatedAt: at,
      });
    }
    // 轮转：第一支不动，其余顺时针轮换
    const fixed = order[0];
    const rest = order.slice(1);
    rest.unshift(rest.pop());
    order.splice(0, order.length, fixed, ...rest);
  }

  const season = {
    id: 'season-3001',
    name: SEASON,
    status: '进行中',
    points: { ...DEFAULT_POINTS },
    rules: { ...DEFAULT_RULES },
    // 当季参赛名单：记录每支队在本季占用的档位与状态，球队与场地的档案本身放在顶层
    roster: teams.map((team) => ({ teamId: team.id, seedRank: team.seedRank, status: '参赛', carriedFrom: '' })),
    matches,
    // 收官后才写入：冻结的最终名次与升降级去向
    finalTable: null,
    promotion: null,
    createdAt: at,
    finalizedAt: null,
  };

  return {
    meta: { currentSeasonId: season.id, points: { ...DEFAULT_POINTS }, updatedAt: at },
    seasons: [season],
    teams,
    venues,
  };
}

function asPoints(source, fallback) {
  const base = fallback || DEFAULT_POINTS;
  const points = source && typeof source === 'object' ? source : {};
  return {
    win: Number.isInteger(Number(points.win)) ? Number(points.win) : base.win,
    draw: Number.isInteger(Number(points.draw)) ? Number(points.draw) : base.draw,
    loss: Number.isInteger(Number(points.loss)) ? Number(points.loss) : base.loss,
  };
}

function asRules(source) {
  const rules = source && typeof source === 'object' ? source : {};
  const promotionCount = Number(rules.promotionCount);
  const relegationCount = Number(rules.relegationCount);
  return {
    promotionCount: Number.isInteger(promotionCount) && promotionCount >= 0 && promotionCount <= MAX_TEAMS
      ? promotionCount : DEFAULT_RULES.promotionCount,
    relegationCount: Number.isInteger(relegationCount) && relegationCount >= 0 && relegationCount <= MAX_TEAMS
      ? relegationCount : DEFAULT_RULES.relegationCount,
  };
}

function normalizeVenues(source, fallback) {
  const list = Array.isArray(source) ? source : fallback;
  const venues = [];
  const venueIds = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `venue-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || venueIds.has(id)) return;
    venueIds.add(id);
    venues.push({
      id,
      name,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      capacity: Number.isInteger(Number(item.capacity)) ? Number(item.capacity) : 0,
      weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  return { venues, venueIds };
}

function normalizeTeams(source, fallback, venueIds) {
  const list = Array.isArray(source) ? source : fallback;
  const teams = [];
  const teamIds = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `team-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const shortName = typeof item.shortName === 'string' ? item.shortName.trim() : '';
    if (!id || !name || !shortName || teamIds.has(id)) return;
    teamIds.add(id);
    teams.push({
      id,
      name,
      shortName,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      seedRank: Number.isInteger(Number(item.seedRank)) ? Number(item.seedRank) : index + 1,
      status: TEAM_STATUS_POOL.includes(item.status) ? item.status : '参赛',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  return { teams, teamIds };
}

function normalizeMatches(source, teamIds, venueIds) {
  const list = Array.isArray(source) ? source : [];
  const matches = [];
  const matchIds = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `match-restored-${index + 1}`;
    const home = teamIds.has(item.homeTeamId) ? item.homeTeamId : '';
    const away = teamIds.has(item.awayTeamId) ? item.awayTeamId : '';
    if (!id || !home || !away || home === away || matchIds.has(id)) return;
    matchIds.add(id);
    const status = STATUS_POOL.includes(item.status) ? item.status : '待赛';
    matches.push({
      id,
      round: Number.isInteger(Number(item.round)) ? Number(item.round) : 1,
      date: typeof item.date === 'string' ? item.date : '',
      kickoff: typeof item.kickoff === 'string' ? item.kickoff : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      homeTeamId: home,
      awayTeamId: away,
      status,
      homeGoals: status === '已赛' && item.homeGoals !== null && item.homeGoals !== undefined ? Number(item.homeGoals) : null,
      awayGoals: status === '已赛' && item.awayGoals !== null && item.awayGoals !== undefined ? Number(item.awayGoals) : null,
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  return matches;
}

// 收官时冻结的最终名次：只留展示用得到的字段，之后球队改名也不影响历史
function normalizeFinalTable(source) {
  if (!Array.isArray(source)) return null;
  const rows = [];
  source.forEach((item) => {
    if (!item || typeof item !== 'object' || !item.teamId) return;
    const intOf = (value) => (Number.isInteger(Number(value)) ? Number(value) : 0);
    rows.push({
      teamId: String(item.teamId),
      name: typeof item.name === 'string' ? item.name : '',
      shortName: typeof item.shortName === 'string' ? item.shortName : '',
      city: typeof item.city === 'string' ? item.city : '',
      status: TEAM_STATUS_POOL.includes(item.status) ? item.status : '参赛',
      seedRank: intOf(item.seedRank),
      rank: intOf(item.rank),
      played: intOf(item.played),
      win: intOf(item.win),
      draw: intOf(item.draw),
      loss: intOf(item.loss),
      goalsFor: intOf(item.goalsFor),
      goalsAgainst: intOf(item.goalsAgainst),
      goalDiff: intOf(item.goalDiff),
      points: intOf(item.points),
    });
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

function normalizePromotion(source) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.entries)) return null;
  const allowed = ['升级', '留级', '降级'];
  const entries = [];
  const seen = new Set();
  source.entries.forEach((item) => {
    if (!item || typeof item !== 'object' || !item.teamId || seen.has(item.teamId)) return;
    if (!allowed.includes(item.direction)) return;
    seen.add(item.teamId);
    entries.push({
      teamId: String(item.teamId),
      name: typeof item.name === 'string' ? item.name : '',
      rank: Number.isInteger(Number(item.rank)) ? Number(item.rank) : null,
      seedRank: Number.isInteger(Number(item.seedRank)) ? Number(item.seedRank) : null,
      direction: item.direction,
      targetTier: Number.isInteger(Number(item.targetTier)) ? Number(item.targetTier) : null,
      reason: typeof item.reason === 'string' ? item.reason : '',
    });
  });
  const changes = Array.isArray(source.changes)
    ? source.changes.filter((item) => item && typeof item === 'object' && item.teamId)
      .map((item) => ({
        teamId: String(item.teamId),
        name: typeof item.name === 'string' ? item.name : '',
        from: typeof item.from === 'string' ? item.from : '',
        to: typeof item.to === 'string' ? item.to : '',
      }))
    : [];
  return {
    decidedAt: typeof source.decidedAt === 'string' && source.decidedAt ? source.decidedAt : new Date().toISOString(),
    rules: asRules(source.rules),
    entries,
    changes,
  };
}

// 一个赛季的参赛名单：球队在场但状态为退赛的也保留档位记录，历史档位才能查得回来。
// rawRoster 为 null 说明是旧数据迁移或字段缺失，才按球队档案补齐；正常落盘时严格信任名单，
// 否则新建的外池球队会被每次保存自动拉进赛季
function normalizeRoster(rawRoster, teams) {
  const roster = [];
  const known = new Set();
  const byId = new Map(teams.map((team) => [team.id, team]));
  if (Array.isArray(rawRoster)) {
    const usedTiers = new Set();
    rawRoster.forEach((item, index) => {
      if (!item || typeof item !== 'object' || !item.teamId || !byId.has(item.teamId) || known.has(item.teamId)) return;
      let seedRank = Number(item.seedRank);
      if (!Number.isInteger(seedRank) || seedRank < 1 || seedRank > MAX_TEAMS) seedRank = index + 1;
      while (usedTiers.has(seedRank)) seedRank += 1;
      if (seedRank > MAX_TEAMS) seedRank = index + 1;
      usedTiers.add(seedRank);
      known.add(item.teamId);
      roster.push({
        teamId: item.teamId,
        seedRank,
        status: TEAM_STATUS_POOL.includes(item.status) ? item.status : '参赛',
        carriedFrom: typeof item.carriedFrom === 'string' ? item.carriedFrom : '',
      });
    });
  } else {
    const usedTiers = new Set();
    teams.forEach((team, index) => {
      let seedRank = team.seedRank;
      while (usedTiers.has(seedRank)) seedRank += 1;
      if (seedRank > MAX_TEAMS) seedRank = index + 1;
      usedTiers.add(seedRank);
      roster.push({ teamId: team.id, seedRank, status: team.status, carriedFrom: '' });
    });
  }
  roster.sort((a, b) => a.seedRank - b.seedRank);
  return roster;
}

function normalizeSeason(raw, index, teamIds, venueIds) {
  const fallback = seedData().seasons[0];
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = typeof source.id === 'string' && source.id ? source.id : `season-restored-${index + 1}`;
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : `${SEASON}（${index + 1}）`;
  const status = source.status === '已收官' ? '已收官' : '进行中';
  // 旧格式里赛程挂在顶层，迁移时由 normalize 透传进来；新格式在 season.matches
  const matchSource = Array.isArray(source.matches) ? source.matches : (Array.isArray(source._matches) ? source._matches : []);
  const matches = normalizeMatches(matchSource, teamIds, venueIds);
  return {
    id,
    name,
    status,
    points: asPoints(source.points, fallback.points),
    rules: asRules(source.rules),
    roster: [],
    matches,
    finalTable: status === '已收官' ? normalizeFinalTable(source.finalTable) : null,
    promotion: status === '已收官' ? normalizePromotion(source.promotion) : null,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    finalizedAt: status === '已收官' && typeof source.finalizedAt === 'string' ? source.finalizedAt : null,
    _rawRoster: Array.isArray(source.roster) ? source.roster : null,
  };
}

// 球队、场地、赛季三块各自整理成固定结构，引用不存在的场地或球队的记录一律丢弃
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = seedData();

  const { venues, venueIds } = normalizeVenues(source.venues, base.venues);
  const { teams, teamIds } = normalizeTeams(source.teams, base.teams, venueIds);

  let seasons;
  let currentSeasonId;
  if (Array.isArray(source.seasons) && source.seasons.length > 0) {
    seasons = source.seasons.map((item, index) => normalizeSeason(item, index, teamIds, venueIds));
    const ids = new Set(seasons.map((item) => item.id));
    currentSeasonId = ids.has(source.meta && source.meta.currentSeasonId)
      ? source.meta.currentSeasonId
      : seasons[seasons.length - 1].id;
  } else {
    // 旧的扁平结构（{ meta, teams, venues, matches }）整体迁成唯一一个进行中的赛季
    const legacy = normalizeSeason(
      { ...(source.meta ? { points: source.meta.points } : {}), _matches: source.matches },
      0,
      teamIds,
      venueIds,
    );
    legacy.id = base.seasons[0].id;
    legacy.name = source.meta && typeof source.meta.season === 'string' && source.meta.season.trim()
      ? source.meta.season.trim() : base.seasons[0].name;
    seasons = [legacy];
    currentSeasonId = legacy.id;
  }

  const seasonIds = new Set();
  const dedupedSeasons = [];
  seasons.forEach((season, index) => {
    let id = season.id;
    if (seasonIds.has(id)) id = `${id}-${index + 1}`;
    seasonIds.add(id);
    season.id = id;
    season.roster = normalizeRoster(season._rawRoster || null, teams);
    delete season._rawRoster;
    dedupedSeasons.push(season);
  });
  if (!seasonIds.has(currentSeasonId)) currentSeasonId = dedupedSeasons[dedupedSeasons.length - 1].id;

  const meta = {
    currentSeasonId,
    points: asPoints(source.meta && source.meta.points, base.meta.points),
    updatedAt: typeof (source.meta && source.meta.updatedAt) === 'string' ? source.meta.updatedAt : base.meta.updatedAt,
  };

  return { meta, seasons: dedupedSeasons, teams, venues };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedData,
  normalize,
  SEASON,
  MAX_TEAM_NAME,
  MAX_SHORT_NAME,
  MAX_VENUE_NAME,
  MAX_SEASON_NAME,
  MAX_NOTE,
  MAX_TEAMS,
  DEFAULT_RULES,
  DEFAULT_POINTS,
  MATCH_STATUS: STATUS_POOL,
  TEAM_STATUS: TEAM_STATUS_POOL,
  DATA_FILE,
};
