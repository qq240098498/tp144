const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const FIRST_SEASON = '2026 春季联赛';
const MAX_TEAM_NAME = 24;
const MAX_SHORT_NAME = 4;
const MAX_VENUE_NAME = 30;
const MAX_NOTE = 200;
const MAX_TEAMS = 12;          // 单季名册最多 12 支
const MAX_DIRECTORY = 30;      // 全局球队名录（含候选与离队）上限
const DEFAULT_PROMOTION = 2;   // 默认升级（提前 P 名离队）队数
const DEFAULT_RELEGATION = 2;  // 默认降级（榜尾 M 名离队）队数
const SEASON_STATUS = ['进行中', '已结算'];
const ROSTER_STATUS = ['参赛', '退赛'];
const JOIN_FROM = ['创始', '留级', '升级', '增补'];
const MOVEMENT_OUTCOME = ['升级', '降级', '留级'];

// 初始数据：八支球队、六个场地（其中三支球队共用中立体育场）、七轮单循环共二十八场，
// 前三轮已经打完并记了比分，第四轮有一场延期，其余待赛
function seedData() {
  const at = '2026-02-20T02:00:00.000Z';
  const teamRows = [
    { id: 'team-1001', name: '江城铁马', shortName: 'JCTM', city: '江城', venueId: 'venue-2001', seedRank: 1, note: '上赛季冠军' },
    { id: 'team-1002', name: '海陵海燕', shortName: 'HLHY', city: '海陵', venueId: 'venue-2002', seedRank: 2, note: '' },
    { id: 'team-1003', name: '云岭苍狼', shortName: 'YLCW', city: '云岭', venueId: 'venue-2003', seedRank: 3, note: '' },
    { id: 'team-1004', name: '平原飞驰', shortName: 'PYFC', city: '平原', venueId: 'venue-2004', seedRank: 4, note: '' },
    { id: 'team-1005', name: '沙洲锚队', shortName: 'SZMD', city: '沙洲', venueId: 'venue-2004', seedRank: 5, note: '与平原飞驰共用中立体育场' },
    { id: 'team-1006', name: '白鹿白鹭', shortName: 'BLBL', city: '白鹿', venueId: 'venue-2004', seedRank: 6, note: '与平原飞驰共用中立体育场' },
    { id: 'team-1007', name: '青峰青松', shortName: 'QFQS', city: '青峰', venueId: 'venue-2005', seedRank: 7, note: '' },
    { id: 'team-1008', name: '洛水洛神', shortName: 'LSLS', city: '洛水', venueId: 'venue-2006', seedRank: 8, note: '' },
  ];

  const teams = teamRows.map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    city: row.city,
    venueId: row.venueId,
    note: row.note,
    createdAt: at,
    updatedAt: at,
  }));

  const venues = [
    { id: 'venue-2001', name: '江城体育中心', city: '江城', capacity: 32000, weekdays: [6], note: '主场馆', createdAt: at, updatedAt: at },
    { id: 'venue-2002', name: '海陵湾球场', city: '海陵', capacity: 18000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2003', name: '云岭高地', city: '云岭', capacity: 12000, weekdays: [6, 0], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2004', name: '中立体育场', city: '中立', capacity: 24000, weekdays: [6, 0], note: '平原、沙洲、白鹿三家共用', createdAt: at, updatedAt: at },
    { id: 'venue-2005', name: '青峰山球场', city: '青峰', capacity: 9000, weekdays: [0], note: '只有周日可用', createdAt: at, updatedAt: at },
    { id: 'venue-2006', name: '洛水古渡球场', city: '洛水', capacity: 8000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
  ];

  // 单循环轮转表：八支球队七轮，每轮四场，主场按轮次左右交替
  const order = teamRows.map((row) => row.id);
  const scores = {
    '整轮1场1': [2, 0], '整轮1场2': [1, 1], '整轮1场3': [3, 1], '整轮1场4': [0, 2],
    '整轮2场1': [1, 2], '整轮2场2': [2, 2], '整轮2场3': [0, 0], '整轮2场4': [4, 1],
    '整轮3场1': [2, 1], '整轮3场2': [1, 0], '整轮3场3': [1, 3], '整轮3场4': [2, 0],
  };

  const matches = [];
  const rounds = 7;
  let counter = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const date = `2026-03-${String(7 + (round - 1) * 7).padStart(2, '0')}`;
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

  const roster = teamRows
    .slice()
    .sort((a, b) => a.seedRank - b.seedRank)
    .map((row) => ({ teamId: row.id, seedRank: row.seedRank, status: '参赛', joinedFrom: '创始', carryNote: '' }));

  const season = {
    id: 'season-0001',
    name: FIRST_SEASON,
    sequence: 1,
    status: '进行中',
    points: { win: 3, draw: 1, loss: 0 },
    rules: { promotionCount: DEFAULT_PROMOTION, relegationCount: DEFAULT_RELEGATION },
    roster,
    matches,
    finalTable: null,
    movements: null,
    rulesLog: [],
    createdAt: at,
    settledAt: null,
    updatedAt: at,
  };

  return {
    meta: { activeSeasonId: season.id, points: season.points, updatedAt: at },
    venues,
    teams,
    seasons: [season],
  };
}

function asInt(value, fallback) {
  return Number.isInteger(Number(value)) ? Number(value) : fallback;
}

function normalizeVenues(source, fallback) {
  const list = Array.isArray(source) ? source : fallback;
  const venues = [];
  const ids = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `venue-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || ids.has(id)) return;
    ids.add(id);
    venues.push({
      id,
      name,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      capacity: asInt(item.capacity, 0),
      weekdays: Array.isArray(item.weekdays)
        ? Array.from(new Set(item.weekdays.map(Number).filter((day) => day >= 0 && day <= 6)))
        : [],
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  return venues;
}

// 全局球队名录：不再挂档位与参赛状态，那些是按赛季存在名册里的
function normalizeTeams(source, fallback, venueIds) {
  const list = Array.isArray(source) ? source : fallback;
  const teams = [];
  const ids = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `team-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const shortName = typeof item.shortName === 'string' ? item.shortName.trim() : '';
    if (!id || !name || !shortName || ids.has(id)) return;
    ids.add(id);
    teams.push({
      id,
      name,
      shortName,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  return teams;
}

function normalizePoints(source, fallback) {
  return {
    win: asInt(source && source.win, fallback.win),
    draw: asInt(source && source.draw, fallback.draw),
    loss: asInt(source && source.loss, fallback.loss),
  };
}

function normalizeRoster(source, teamIds, fallbackNow) {
  const roster = [];
  const seenTeams = new Set();
  const seenRanks = new Set();
  (Array.isArray(source) ? source : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (!teamIds.has(item.teamId) || seenTeams.has(item.teamId)) return;
    let seedRank = asInt(item.seedRank, 0);
    if (seedRank < 1 || seedRank > MAX_TEAMS) seedRank = (seenRanks.size || 0) + 1;
    // 档位冲突的脏数据不直接丢，顺到最近的空档位上，并在备注里说明
    let moved = false;
    while (seenRanks.has(seedRank)) { seedRank += 1; moved = true; }
    if (seedRank > MAX_TEAMS) return;
    seenTeams.add(item.teamId);
    seenRanks.add(seedRank);
    roster.push({
      teamId: item.teamId,
      seedRank,
      status: ROSTER_STATUS.includes(item.status) ? item.status : '参赛',
      joinedFrom: JOIN_FROM.includes(item.joinedFrom) ? item.joinedFrom : '创始',
      carryNote: typeof item.carryNote === 'string' ? item.carryNote : (moved ? '档位冲突，已顺移到空位' : ''),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : fallbackNow,
    });
  });
  roster.sort((a, b) => a.seedRank - b.seedRank);
  return roster;
}

function normalizeMatches(source, rosterIds, venueIds, fallbackNow) {
  const matches = [];
  const ids = new Set();
  (Array.isArray(source) ? source : []).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `match-restored-${index + 1}`;
    const home = rosterIds.has(item.homeTeamId) ? item.homeTeamId : '';
    const away = rosterIds.has(item.awayTeamId) ? item.awayTeamId : '';
    if (!id || !home || !away || home === away || ids.has(id)) return;
    ids.add(id);
    const status = ['待赛', '已赛', '延期', '取消'].includes(item.status) ? item.status : '待赛';
    matches.push({
      id,
      round: Math.max(1, Math.min(40, asInt(item.round, 1))),
      date: typeof item.date === 'string' ? item.date : '',
      kickoff: typeof item.kickoff === 'string' ? item.kickoff : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      homeTeamId: home,
      awayTeamId: away,
      status,
      homeGoals: status === '已赛' && item.homeGoals !== null && item.homeGoals !== undefined ? Number(item.homeGoals) : null,
      awayGoals: status === '已赛' && item.awayGoals !== null && item.awayGoals !== undefined ? Number(item.awayGoals) : null,
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : fallbackNow,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : fallbackNow,
    });
  });
  return matches;
}

function normalizeMovements(source, rosterIds) {
  if (!Array.isArray(source)) return null;
  const rows = [];
  const seen = new Set();
  source.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (!rosterIds.has(item.teamId) || seen.has(item.teamId)) return;
    if (!MOVEMENT_OUTCOME.includes(item.outcome)) return;
    seen.add(item.teamId);
    rows.push({ teamId: item.teamId, rank: Math.max(1, asInt(item.rank, 0)), outcome: item.outcome, forced: Boolean(item.forced) });
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

function normalizeFinalTable(source, rosterIds) {
  if (!Array.isArray(source)) return null;
  const rows = [];
  const seen = new Set();
  source.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (!rosterIds.has(item.teamId) || seen.has(item.teamId)) return;
    seen.add(item.teamId);
    rows.push({
      teamId: item.teamId,
      rank: Math.max(1, asInt(item.rank, 0)),
      played: Math.max(0, asInt(item.played, 0)),
      win: Math.max(0, asInt(item.win, 0)),
      draw: Math.max(0, asInt(item.draw, 0)),
      loss: Math.max(0, asInt(item.loss, 0)),
      goalsFor: Math.max(0, asInt(item.goalsFor, 0)),
      goalsAgainst: Math.max(0, asInt(item.goalsAgainst, 0)),
      goalDiff: asInt(item.goalDiff, 0),
      points: Math.max(0, asInt(item.points, 0)),
    });
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

function normalizeRules(source, fallback) {
  return {
    promotionCount: Math.max(0, Math.min(MAX_TEAMS, asInt(source && source.promotionCount, fallback.promotionCount))),
    relegationCount: Math.max(0, Math.min(MAX_TEAMS, asInt(source && source.relegationCount, fallback.relegationCount))),
  };
}

function normalizeSeasons(source, fallback, teamIds, venueIds) {
  const list = Array.isArray(source) && source.length ? source : fallback;
  const now = new Date().toISOString();
  const seasons = [];
  const ids = new Set();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `season-restored-${index + 1}`;
    if (ids.has(id)) return;
    ids.add(id);
    const base = fallback[index] || fallback[fallback.length - 1] || {};
    const roster = normalizeRoster(item.roster, teamIds, now);
    const rosterIds = new Set(roster.map((row) => row.teamId));
    const rules = normalizeRules(item.rules, base.rules || { promotionCount: DEFAULT_PROMOTION, relegationCount: DEFAULT_RELEGATION });
    const settled = item.status === '已结算';
    seasons.push({
      id,
      name: typeof item.name === 'string' && item.name ? item.name : (base.name || `第 ${index + 1} 赛季`),
      sequence: Math.max(1, asInt(item.sequence, index + 1)),
      status: settled ? '已结算' : '进行中',
      points: normalizePoints(item.points, base.points || { win: 3, draw: 1, loss: 0 }),
      rules,
      roster,
      matches: normalizeMatches(item.matches, rosterIds, venueIds, now),
      finalTable: settled ? normalizeFinalTable(item.finalTable, rosterIds) : null,
      movements: settled ? normalizeMovements(item.movements, rosterIds) : null,
      rulesLog: Array.isArray(item.rulesLog) ? item.rulesLog.filter((log) => log && typeof log === 'object') : [],
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
      settledAt: settled && typeof item.settledAt === 'string' ? item.settledAt : null,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
    });
  });
  seasons.sort((a, b) => a.sequence - b.sequence || (a.createdAt < b.createdAt ? -1 : 1));
  return seasons;
}

// 旧版本数据是 { meta, teams(带档位/状态), venues, matches } 的单赛季扁平结构，
// 整队搬到第一个赛季里：全局名录只留身份信息，档位与状态进名册
function migrateLegacy(raw) {
  const base = seedData();
  const source = raw && typeof raw === 'object' ? raw : {};
  const venues = normalizeVenues(source.venues, base.venues);
  const venueIds = new Set(venues.map((item) => item.id));

  const legacyTeams = Array.isArray(source.teams) ? source.teams : base.teams;
  const teams = [];
  const roster = [];
  const usedRanks = new Set();
  legacyTeams.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `team-legacy-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const shortName = typeof item.shortName === 'string' ? item.shortName.trim() : '';
    if (!name || !shortName) return;
    let seedRank = asInt(item.seedRank, index + 1);
    if (seedRank < 1 || seedRank > MAX_TEAMS) seedRank = index + 1;
    while (usedRanks.has(seedRank)) seedRank += 1;
    usedRanks.add(seedRank);
    teams.push({
      id,
      name,
      shortName,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
    roster.push({
      teamId: id,
      seedRank,
      status: ROSTER_STATUS.includes(item.status) ? item.status : '参赛',
      joinedFrom: '创始',
      carryNote: '',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  roster.sort((a, b) => a.seedRank - b.seedRank);

  const teamIds = new Set(teams.map((item) => item.id));
  const rosterIds = new Set(roster.map((item) => item.teamId));
  const now = new Date().toISOString();
  const season = {
    id: 'season-0001',
    name: typeof (source.meta && source.meta.season) === 'string' && source.meta.season ? source.meta.season : FIRST_SEASON,
    sequence: 1,
    status: '进行中',
    points: normalizePoints(source.meta && source.meta.points, base.seasons[0].points),
    rules: { promotionCount: DEFAULT_PROMOTION, relegationCount: DEFAULT_RELEGATION },
    roster,
    matches: normalizeMatches(source.matches, rosterIds, venueIds, now),
    finalTable: null,
    movements: null,
    rulesLog: [],
    createdAt: now,
    settledAt: null,
    updatedAt: now,
  };

  return {
    meta: { activeSeasonId: season.id, points: season.points, updatedAt: now },
    venues,
    teams,
    seasons: [season],
  };
}

// 整理成固定结构：新结构直接规范化；旧的扁平结构先迁移
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(source.seasons)) {
    return normalize(migrateLegacy(source));
  }

  const base = seedData();
  const venues = normalizeVenues(source.venues, base.venues);
  const venueIds = new Set(venues.map((item) => item.id));
  const teams = normalizeTeams(source.teams, base.teams, venueIds);
  const teamIds = new Set(teams.map((item) => item.id));
  const seasons = normalizeSeasons(source.seasons, base.seasons, teamIds, venueIds);

  let activeSeasonId = typeof source.meta === 'object' && source.meta && typeof source.meta.activeSeasonId === 'string'
    ? source.meta.activeSeasonId
    : '';
  if (!seasons.some((season) => season.id === activeSeasonId)) {
    // 进行中的赛季优先，没有就取最后一季
    const inProgress = seasons.find((season) => season.status === '进行中');
    activeSeasonId = (inProgress || seasons[seasons.length - 1] || seasons[0]).id;
  }

  const active = seasons.find((season) => season.id === activeSeasonId);
  return {
    meta: {
      activeSeasonId,
      points: normalizePoints(source.meta && source.meta.points, active ? active.points : base.meta.points),
      updatedAt: typeof (source.meta && source.meta.updatedAt) === 'string' ? source.meta.updatedAt : new Date().toISOString(),
    },
    venues,
    teams,
    seasons,
  };
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
  FIRST_SEASON,
  MAX_TEAM_NAME,
  MAX_SHORT_NAME,
  MAX_VENUE_NAME,
  MAX_NOTE,
  MAX_TEAMS,
  MAX_DIRECTORY,
  DEFAULT_PROMOTION,
  DEFAULT_RELEGATION,
  MATCH_STATUS: ['待赛', '已赛', '延期', '取消'],
  TEAM_STATUS: ROSTER_STATUS,
  SEASON_STATUS,
  ROSTER_STATUS,
  JOIN_FROM,
  MOVEMENT_OUTCOME,
  DATA_FILE,
};
