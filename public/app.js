// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层
// 跨赛季：左上下拉切换查看的赛季，历史赛季只读，赛季页完成升降级结算与新建一季

const state = {
  view: 'overview',
  seasons: [],
  currentSeasonId: '',
  selectedSeasonId: '',
  seasonDetail: null,
  preview: null,
  newSeasonDraft: null,
  teams: [],
  venues: [],
  matches: [],
  rounds: [],
  standings: null,
  summary: null,
  drawer: { mode: '', entity: '', id: '', title: '' },
  teamFilter: { status: '', keyword: '' },
  venueFilter: { keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
  promotedPick: [],
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度与最近赛果', action: '' },
  seasons: { title: '赛季', sub: '按最终名次结算升降级，并开启下一季', action: '' },
  teams: { title: '球队', sub: '登记参赛球队、简称、主场与档位；外池球队等待升级', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  table: { title: '积分榜', sub: '按积分、净胜球、进球依次排序', action: '' },
};

const el = (id) => document.getElementById(id);

function seasonParam() {
  return state.selectedSeasonId ? { seasonId: state.selectedSeasonId } : {};
}

function withSeason(params) {
  return { ...seasonParam(), ...(params || {}) };
}

function qs(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function request(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'ok' ? 'ok' : 'bad'}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const statusPill = (status) => {
  const map = { 已赛: 'done', 待赛: 'wait', 延期: 'late', 取消: 'off' };
  return `<span class="pill ${map[status] || 'wait'}">${escapeHtml(status)}</span>`;
};

const directionPill = (direction) => {
  const map = { 升级: 'up', 留级: 'stay', 降级: 'down' };
  return direction ? `<span class="pill dir-${map[direction] || 'stay'}">${escapeHtml(direction)}</span>` : '<span class="muted">—</span>';
};

const membershipPill = (item) => {
  if (!item.inSeason) return '<span class="pill wait">外池</span>';
  return item.membership === '参赛' ? '<span class="pill done">参赛</span>' : '<span class="pill off">退赛</span>';
};

function formatDate(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

async function loadHealth() {
  const node = el('link-state');
  try {
    await request('/api/health');
    node.className = 'link-state ok';
    node.innerHTML = '<span class="dot"></span>服务正常';
  } catch (err) {
    node.className = 'link-state bad';
    node.innerHTML = '<span class="dot"></span>服务连不上';
  }
}

/* 赛季清单与切换 */
async function loadSeasons(preferId) {
  const payload = await request('/api/seasons');
  state.seasons = payload.seasons;
  state.currentSeasonId = payload.currentSeasonId;
  if (preferId && state.seasons.some((item) => item.id === preferId)) {
    state.selectedSeasonId = preferId;
  } else if (!state.seasons.some((item) => item.id === state.selectedSeasonId)) {
    state.selectedSeasonId = payload.currentSeasonId;
  }
  renderSeasonSelect();
}

function renderSeasonSelect() {
  const select = el('season-select');
  select.innerHTML = state.seasons.map((item) => {
    const tag = item.status === '已收官' ? '〔已收官〕' : '〔进行中〕';
    const current = item.isCurrent ? '（当前）' : '';
    return `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedSeasonId ? 'selected' : ''}>${escapeHtml(tag + item.name + current)}</option>`;
  }).join('');
  const current = state.seasons.find((item) => item.id === state.selectedSeasonId);
  el('season-name').textContent = current ? current.name : '赛季';
}

async function selectSeason(seasonId) {
  if (seasonId === state.selectedSeasonId) return;
  state.selectedSeasonId = seasonId;
  renderSeasonSelect();
  try {
    await request('/api/seasons/switch', { method: 'POST', body: JSON.stringify({ seasonId }) });
    await refreshActiveView();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function viewedSeason() {
  return state.seasons.find((item) => item.id === state.selectedSeasonId) || null;
}

function isViewWritable() {
  const season = viewedSeason();
  return Boolean(season && season.status === '进行中');
}

/* 各视图数据加载，都带上正在查看的 seasonId */
async function loadSummary() {
  state.summary = await request(`/api/summary${qs(seasonParam())}`);
  renderOverview();
}

async function loadStandings() {
  const params = withSeason({ keyword: state.tableFilter.keyword || '' });
  state.standings = await request(`/api/standings${qs(params)}`);
  renderStandings();
}

async function loadTeams() {
  const params = withSeason({ status: state.teamFilter.status, keyword: state.teamFilter.keyword });
  const payload = await request(`/api/teams${qs(params)}`);
  state.teams = payload.teams;
  el('nav-teams').textContent = String(payload.total);
  renderTeams();
}

async function loadVenues() {
  const params = withSeason({ keyword: state.venueFilter.keyword });
  const payload = await request(`/api/venues${qs(params)}`);
  state.venues = payload.venues;
  el('nav-venues').textContent = String(payload.total);
  renderVenues();
}

async function loadMatches() {
  const params = withSeason({
    round: state.matchFilter.round,
    status: state.matchFilter.status,
    keyword: state.matchFilter.keyword,
  });
  const payload = await request(`/api/matches${qs(params)}`);
  state.matches = payload.matches;
  state.rounds = payload.rounds;
  el('nav-matches').textContent = String(payload.total);
  renderMatches();
}

function renderFreezeBanner() {
  const banner = el('freeze-banner');
  const season = viewedSeason();
  if (!season || season.status !== '已收官') {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  const isLatest = state.seasons[0] && state.seasons[0].id === season.id;
  banner.hidden = false;
  banner.innerHTML = `
    <span class="freeze-tag">已收官 · 冻结存档</span>
    <span>《${escapeHtml(season.name)}》的赛程、比分、最终名次与升降级去向都封存于 ${escapeHtml(formatDate(season.finalizedAt))}，只能查看不能修改。</span>
    ${isLatest ? '<button type="button" class="mini" id="banner-new-season">按升降级结果建立新一季</button>' : ''}`;
  const btn = el('banner-new-season');
  if (btn) btn.addEventListener('click', () => { state.view === 'seasons' ? loadSeasonView() : switchView('seasons'); });
}

function renderOverview() {
  const data = state.summary;
  if (!data) return;
  el('stat-row').innerHTML = [
    ['球队', `${data.activeTeamCount} / ${data.teamCount}`, '参赛中的队数'],
    ['场地', String(data.venueCount), '已登记的比赛场地'],
    ['赛程进度', `${data.playedRounds} / ${data.totalRounds}`, '打完的轮次'],
    ['已赛 / 待赛', `${data.playedMatches} / ${data.pendingMatches}`, `延期 ${data.postponedMatches} 场`],
  ].map(([label, value, note], index) => `<div class="stat ${index === 0 ? 'accent' : ''}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}　${escapeHtml(note)}</span></div>`).join('');

  el('points-hint').textContent = `胜 ${data.points.win} 分 / 平 ${data.points.draw} 分`;
  el('recent-feed').innerHTML = data.recent.length
    ? data.recent.map((item) => `<li>
        <span class="round-tag">第 ${item.round} 轮</span>
        <span>${escapeHtml(item.homeName)}</span>
        <span class="score">${escapeHtml(item.scoreText)}</span>
        <span>${escapeHtml(item.awayName)}</span>
        <span class="muted" style="margin-left:auto">${escapeHtml(item.date)}</span>
      </li>`).join('')
    : '<li class="muted">还没有打完的场次</li>';

  el('podium').innerHTML = data.topThree.length
    ? data.topThree.map((row) => `<li>
        <span class="rank-badge">${row.rank}</span>
        <span>${escapeHtml(row.name)}</span>
        <span class="muted">净胜 ${row.goalDiff}</span>
        <span class="pts">${row.points} 分</span>
      </li>`).join('')
    : '<li class="muted">暂无排名</li>';
}

function renderTeams() {
  const writable = isViewWritable();
  el('team-rows').innerHTML = state.teams.map((item) => `<tr>
      <td class="num">${item.seedRank}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.shortName)}</td>
      <td>${escapeHtml(item.city)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td>${membershipPill(item)}</td>
      <td class="num">${item.finalRank ? `<strong>${item.finalRank}</strong>` : '<span class="muted">—</span>'}</td>
      <td class="num">${item.matchCount}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td class="row-actions">
        ${item.inSeason && item.direction ? directionPill(item.direction) : ''}
        ${writable && item.inSeason ? `<button type="button" class="mini" data-edit-team="${escapeHtml(item.id)}">编辑</button>` : ''}
        ${writable && !item.inSeason ? `<button type="button" class="mini" data-join-team="${escapeHtml(item.id)}">编入本季</button>` : ''}
        ${writable && item.inSeason && item.matchCount === 0 ? `<button type="button" class="mini" data-leave-team="${escapeHtml(item.id)}">移出外池</button>` : ''}
        ${writable && !item.inSeason ? `<button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>` : ''}
      </td>
    </tr>`).join('');
  el('team-empty').classList.toggle('show', state.teams.length === 0);
}

function renderVenues() {
  el('venue-grid').innerHTML = state.venues.map((item) => `<article class="venue-card">
      <h3>${escapeHtml(item.name)}</h3>
      <div class="city">${escapeHtml(item.city)}</div>
      <dl>
        <dt>容量</dt><dd>${item.capacity} 人</dd>
        <dt>可用日</dt><dd>${escapeHtml(item.weekdaysText)}</dd>
        <dt>本季主场球队</dt><dd>${item.homeTeams.length ? escapeHtml(item.homeTeams.join('、')) : '无'}</dd>
        <dt>本季已排 / 历史总场次</dt><dd>${item.matchCount} 场 / ${item.allTimeMatchCount} 场</dd>
      </dl>
      <div class="card-actions">
        <button type="button" class="mini" data-edit-venue="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-venue="${escapeHtml(item.id)}">删除</button>
      </div>
    </article>`).join('');
  el('venue-empty').classList.toggle('show', state.venues.length === 0);
}

function renderRounds() {
  const chips = [{ round: '', label: '全部轮次' }].concat(state.rounds.map((item) => ({
    round: String(item.round),
    label: `第 ${item.round} 轮 ${item.played}/${item.total}`,
  })));
  el('round-chips').innerHTML = chips.map((chip) => `<button type="button" class="${String(state.matchFilter.round) === chip.round ? 'is-active' : ''}" data-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');
}

function renderMatches() {
  renderRounds();
  const writable = isViewWritable();
  el('match-rows').innerHTML = state.matches.map((item) => `<tr>
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)}</td>
      <td class="num">${item.scoreText ? escapeHtml(item.scoreText) : '—'}</td>
      <td>${escapeHtml(item.awayName)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td class="row-actions">
        ${writable && item.status !== '已赛' ? `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>` : ''}
        ${writable ? `<button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>` : ''}
        ${writable ? `<button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>` : ''}
      </td>
    </tr>`).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

function renderStandings() {
  const data = state.standings;
  if (!data) return;
  const frozenTag = data.frozen ? '　<span class="pill dir-stay">名次已冻结</span>' : '';
  el('table-hint').innerHTML = `${escapeHtml(data.season)}${frozenTag}　已打 ${data.playedMatches} 场，待赛 ${data.pendingMatches} 场，延期 ${data.postponedMatches} 场`;
  const directionMap = new Map();
  const detail = state.seasonDetail;
  if (data.frozen && detail && detail.promotion) {
    detail.promotion.entries.forEach((entry) => directionMap.set(entry.teamId, entry));
  }
  el('table-rows').innerHTML = data.table.map((row) => {
    const dest = directionMap.get(row.teamId);
    return `<tr>
      <td class="num">${row.rank}</td>
      <td class="num">${row.seedRank === null || row.seedRank === undefined ? '—' : row.seedRank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.played}</td>
      <td>${row.win}</td>
      <td>${row.draw}</td>
      <td>${row.loss}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
      <td><strong>${row.points}</strong></td>
      <td>${dest ? `${directionPill(dest.direction)}<span class="muted" title="${escapeHtml(dest.reason)}"> ${dest.targetTier ? `第${dest.targetTier}档` : ''}</span>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
}

/* 赛季页：完赛进度、规则、升降级试算、收官、建新季 */
async function loadSeasonView() {
  const seasonId = state.selectedSeasonId;
  const [detail] = await Promise.all([
    request(`/api/seasons/${encodeURIComponent(seasonId)}`),
    state.view === 'table' ? loadStandings() : Promise.resolve(),
  ]);
  state.seasonDetail = detail;
  state.newSeasonDraft = null;

  if (detail.season.status === '进行中') {
    // 默认勾选前 N 支外池候选
    const preview = await request('/api/seasons/preview', {
      method: 'POST',
      body: JSON.stringify({ seasonId, rules: detail.season.rules, promotedIds: [] }),
    });
    state.preview = preview;
    state.promotedPick = preview.availableOutside.slice(0, preview.promotedSlots).map((item) => item.teamId);
    await refreshPreview();
  } else {
    state.preview = null;
    state.promotedPick = [];
  }
  renderSeasonPanels();
}

async function refreshPreview() {
  const detail = state.seasonDetail;
  if (!detail || detail.season.status !== '进行中') return;
  // 常规试算只按已保存的规则重算，避免输入框里没保存的数字与收官口径不一致
  state.preview = await request('/api/seasons/preview', {
    method: 'POST',
    body: JSON.stringify({
      seasonId: detail.season.id,
      promotedIds: state.promotedPick,
    }),
  });
  renderSeasonPanels();
}

function collectRules() {
  const promoNode = el('rule-promotion');
  const relegateNode = el('rule-relegation');
  const fallback = state.seasonDetail ? state.seasonDetail.season.rules : { promotionCount: 2, relegationCount: 2 };
  return {
    promotionCount: promoNode ? Number(promoNode.value) : fallback.promotionCount,
    relegationCount: relegateNode ? Number(relegateNode.value) : fallback.relegationCount,
  };
}

function renderCompletion(season, completion) {
  if (season.status === '已收官') {
    return `<div class="callout ok">
      <strong>本季已收官</strong>
      <span>共赛 ${completion.played} 场，最终名次与升降级去向已冻结（${escapeHtml(formatDate(season.finalizedAt))}）。</span>
    </div>`;
  }
  if (completion.complete) {
    return `<div class="callout ok"><strong>已经具备结算条件</strong><span>${completion.played} 场全部打完，没有待赛或延期，可以结算升降级。</span></div>`;
  }
  return `<div class="callout warn">
      <strong>还不能结算</strong>
      <ul>${completion.blockers.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
    </div>`;
}

function renderSeasonPanels() {
  const detail = state.seasonDetail;
  if (!detail) return;
  const { season } = detail;
  const panels = el('season-panels');

  if (season.status === '进行中') {
    panels.innerHTML = renderActiveSeason(detail);
    bindActiveSeasonEvents(detail);
  } else {
    panels.innerHTML = renderFinalizedSeason(detail);
    bindFinalizedSeasonEvents(detail);
  }
}

function renderActiveSeason(detail) {
  const { season } = detail;
  const preview = state.preview;
  const completion = season.completion;
  const leagueEntries = preview ? preview.entries.filter((entry) => entry.rank !== null)
    .slice().sort((a, b) => a.rank - b.rank) : [];
  const outsideEntries = preview ? preview.entries.filter((entry) => entry.direction === '升级') : [];
  const pickedSet = new Set(state.promotedPick);
  const liveRules = preview ? preview.rules : season.rules;
  const canFinalize = completion.complete
    && state.promotedPick.length === liveRules.promotionCount
    && (!preview || preview.shortBy === 0);

  return `
    ${renderCompletion(season, completion)}
    <div class="season-grid">
      <article class="card">
        <header class="card-head">
          <h2>升降级规则</h2>
          <span class="hint">改完点“应用并重算”，页面会列出归属变化</span>
        </header>
        <div class="rule-row">
          <label class="field"><span>升级队数（外池升入本季）</span>
            <input id="rule-promotion" type="number" min="0" max="12" value="${preview ? preview.rules.promotionCount : season.rules.promotionCount}"></label>
          <label class="field"><span>降级队数（垫底名次降级）</span>
            <input id="rule-relegation" type="number" min="0" max="12" value="${preview ? preview.rules.relegationCount : season.rules.relegationCount}"></label>
        </div>
        <div class="card-actions">
          <button type="button" class="primary" id="apply-rules">应用并重算去向</button>
        </div>
        <div id="rule-changes" class="change-box"></div>
      </article>

      <article class="card">
        <header class="card-head">
          <h2>外池升级候选</h2>
          <span class="hint">勾选 ${preview ? preview.rules.promotionCount : season.rules.promotionCount} 支，已选 <b id="picked-count">${state.promotedPick.length}</b> 支</span>
        </header>
        <div id="outside-pick" class="pick-list">
          ${preview && preview.availableOutside.length ? preview.availableOutside.map((team) => `
            <label class="pick-item ${pickedSet.has(team.teamId) ? 'on' : ''}">
              <input type="checkbox" value="${escapeHtml(team.teamId)}" ${pickedSet.has(team.teamId) ? 'checked' : ''}>
              <span>${escapeHtml(team.name)}（${escapeHtml(team.shortName)}）</span>
              <span class="muted">${escapeHtml(team.city)} · 外池参考档 ${team.profileRank || '—'}</span>
            </label>`).join('') : '<p class="muted">外池没有候选球队，先到球队页点“新增球队”并选择“先放外池”。</p>'}
        </div>
      </article>
    </div>

    <article class="card" style="margin-top:14px">
      <header class="card-head">
        <h2>升降级去向（试算）</h2>
        <span class="hint">按当前积分名次实时试算，收官后才正式冻结</span>
      </header>
      <div id="preview-warnings">${renderWarnings(preview ? preview.warnings : [])}</div>
      <table class="grid">
        <thead><tr><th>最终名次</th><th>档位</th><th>球队</th><th>去向</th><th>下季档位</th><th>说明</th></tr></thead>
        <tbody>
          ${leagueEntries.map((entry) => `<tr>
            <td class="num">${entry.rank}</td>
            <td class="num">${entry.seedRank === null ? '—' : entry.seedRank}</td>
            <td>${escapeHtml(entry.name)}</td>
            <td>${directionPill(entry.direction)}</td>
            <td class="num">${entry.targetTier === null ? '<span class="muted">出季</span>' : entry.targetTier}</td>
            <td class="muted">${escapeHtml(entry.reason)}</td>
          </tr>`).join('')}
          ${outsideEntries.map((entry) => `<tr class="row-up">
            <td class="num muted">外池</td>
            <td class="num muted">—</td>
            <td>${escapeHtml(entry.name)}</td>
            <td>${directionPill('升级')}</td>
            <td class="num">${entry.targetTier === null ? '<span class="muted">待定</span>' : entry.targetTier}</td>
            <td class="muted">${escapeHtml(entry.reason)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="card-actions" style="margin-top:12px">
        <button type="button" class="primary" id="finalize-season" ${canFinalize ? '' : 'disabled'}>
          确认完赛并冻结升降级结果
        </button>
        <span class="hint" id="finalize-hint"></span>
      </div>
      <p class="hint" id="finalize-block">${canFinalize ? '' : escapeHtml(finalizeBlockReason(completion, state.promotedPick.length, liveRules.promotionCount, preview ? preview.shortBy : 0))}</p>
    </article>`;
}

function finalizeBlockReason(completion, picked, slots, shortBy) {
  if (!completion.complete) return '赛季全部打完后才能结算。';
  if (shortBy > 0) return `外池候选球队不够 ${slots} 个升级名额，请先补齐外池球队，或调小升级队数。`;
  if (picked !== slots) return `升级名额是 ${slots} 个，现在勾选了 ${picked} 支，数量一致才能结算。`;
  return '';
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return `<ul class="warn-list">${warnings.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
}

function renderFinalizedSeason(detail) {
  const { season, roster, finalTable, promotion } = detail;
  const isLatest = state.seasons[0] && state.seasons[0].id === season.id;
  const directionMap = new Map((promotion ? promotion.entries : []).map((entry) => [entry.teamId, entry]));
  const rules = promotion ? promotion.rules : season.rules;

  const tableRows = (finalTable || []).map((row) => {
    const dest = directionMap.get(row.teamId);
    return `<tr>
      <td class="num">${row.rank}</td>
      <td class="num">${row.seedRank === null ? '—' : row.seedRank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.played}</td><td>${row.points}</td>
      <td>${dest ? directionPill(dest.direction) : '<span class="muted">—</span>'}</td>
      <td>${dest && dest.targetTier !== null ? `第 ${dest.targetTier} 档` : '<span class="muted">出季</span>'}</td>
      <td class="muted">${dest ? escapeHtml(dest.reason) : ''}</td>
    </tr>`;
  }).join('');

  const promoted = promotion ? promotion.entries.filter((entry) => entry.direction === '升级') : [];
  const relegated = promotion ? promotion.entries.filter((entry) => entry.direction === '降级') : [];

  return `
    ${renderCompletion(season, season.completion)}
    <div class="season-grid">
      <article class="card">
        <header class="card-head"><h2>升级名单（${promoted.length}）</h2><span class="hint">外池升入，按序填补腾出的档位</span></header>
        ${promoted.length ? `<ul class="name-list">${promoted.map((entry) => `<li>${directionPill('升级')} ${escapeHtml(entry.name)} <span class="muted">→ 第 ${entry.targetTier} 档</span></li>`).join('')}</ul>` : '<p class="muted">本季没有升级名额。</p>'}
      </article>
      <article class="card">
        <header class="card-head"><h2>降级名单（${relegated.length}）</h2><span class="hint">名次进入降级线或赛季中退赛</span></header>
        ${relegated.length ? `<ul class="name-list">${relegated.map((entry) => `<li>${directionPill('降级')} ${escapeHtml(entry.name)} <span class="muted">第 ${entry.rank} 名 · 原第 ${entry.seedRank} 档</span></li>`).join('')}</ul>` : '<p class="muted">本季没有降级名额。</p>'}
      </article>
    </div>

    <article class="card" style="margin-top:14px">
      <header class="card-head">
        <h2>《${escapeHtml(season.name)}》最终名次（冻结）</h2>
        <span class="hint">规则：升级 ${rules.promotionCount} 队 / 降级 ${rules.relegationCount} 队 · 封存于 ${escapeHtml(formatDate(season.finalizedAt))}</span>
      </header>
      <table class="grid">
        <thead><tr><th>名次</th><th>档位</th><th>球队</th><th>场次</th><th>积分</th><th>去向</th><th>下季档位</th><th>说明</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </article>

    <article class="card" style="margin-top:14px" id="new-season-card">
      <header class="card-head">
        <h2>建立新一季</h2>
        <span class="hint">留级队沿用档位，升级队按上面的分配填入；档位空位可在此调整</span>
      </header>
      <div id="new-season-body">
        ${isLatest
          ? '<div class="card-actions"><button type="button" class="primary" id="open-new-season">按升降级结果生成新赛季名单</button></div>'
          : '<p class="muted">这不是最新一季，后续赛季已经建立，请在左上下拉切换到更新的赛季查看。</p>'}
      </div>
    </article>`;
}

function renderWarningsBox(warnings) {
  return renderWarnings(warnings);
}

function renderNewSeasonEditor(draft) {
  const rows = draft.assignments.map((item) => {
    const meta = draft.stay.concat(draft.promoted).find((entry) => entry.teamId === item.teamId) || {};
    return `<tr>
      <td>${escapeHtml(meta.name || item.teamId)}</td>
      <td class="num">${meta.rank === null || meta.rank === undefined ? '<span class="muted">外池</span>' : `第 ${meta.rank} 名`}</td>
      <td>${item.source === '留级' ? directionPill('留级') : directionPill('升级')}</td>
      <td><input type="number" min="1" max="12" class="tier-input" data-team="${escapeHtml(item.teamId)}" value="${item.seedRank}"></td>
    </tr>`;
  }).join('');
  const extraRows = draft.unassignedPromoted.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="num muted">外池</td>
      <td>${directionPill('升级')}</td>
      <td><input type="number" min="1" max="12" class="tier-input" data-team="${escapeHtml(item.teamId)}" value="" placeholder="填档位"></td>
    </tr>`).join('');

  return `
    <div class="rule-row">
      <label class="field" style="max-width:320px"><span>新赛季名称</span>
        <input id="new-season-name" maxlength="30" value="${escapeHtml(draft.suggestedName)}"></label>
    </div>
    ${renderWarnings(draft.warnings)}
    <table class="grid">
      <thead><tr><th>球队</th><th>上季名次</th><th>来源</th><th>新赛季档位（可调整）</th></tr></thead>
      <tbody>${rows}${extraRows}</tbody>
    </table>
    <div class="card-actions" style="margin-top:12px">
      <button type="button" class="primary" id="submit-new-season">确认建立新一季</button>
      <button type="button" class="ghost" id="cancel-new-season">取消</button>
      <span class="hint">同档位不能排两支球队；留级队的档位默认沿用，升级队按顺序填入腾出的档位。</span>
    </div>`;
}

function bindActiveSeasonEvents(detail) {
  el('apply-rules').addEventListener('click', async () => {
    const rules = collectRules();
    try {
      const result = await request(`/api/seasons/${encodeURIComponent(detail.season.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ rules }),
      });
      const changeBox = el('rule-changes');
      const changes = result.rulesChange ? result.rulesChange.changes : [];
      if (changes.length === 0) {
        changeBox.innerHTML = '<p class="hint">规则已保存，没有球队的去向发生变化。</p>';
      } else {
        changeBox.innerHTML = `<p class="hint">这些球队的归属变了：</p><ul class="change-list">${changes.map((c) => `<li>${escapeHtml(c.name)}（第 ${c.rank} 名）：<span class="pill dir-${c.from === '升级' ? 'up' : c.from === '降级' ? 'down' : 'stay'}">${escapeHtml(c.from)}</span> → <span class="pill dir-${c.to === '升级' ? 'up' : c.to === '降级' ? 'down' : 'stay'}">${escapeHtml(c.to)}</span></li>`).join('')}</ul>`;
      }
      await refreshPreview();
      toast('升降级规则已更新并重算', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  el('outside-pick').addEventListener('change', async (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const id = checkbox.value;
    const slots = state.preview ? state.preview.rules.promotionCount : 0;
    if (checkbox.checked) {
      if (state.promotedPick.length >= slots) {
        checkbox.checked = false;
        toast(`升级名额只有 ${slots} 个，先取消一支再选`, 'bad');
        return;
      }
      state.promotedPick.push(id);
    } else {
      state.promotedPick = state.promotedPick.filter((item) => item !== id);
    }
    try {
      await refreshPreview();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  el('finalize-season').addEventListener('click', async () => {
    if (!window.confirm(`确认《${detail.season.name}》全部完赛并冻结升降级结果吗？冻结后赛程、名次与去向都不能再改。`)) return;
    try {
      await request('/api/seasons/finalize', {
        method: 'POST',
        body: JSON.stringify({ seasonId: detail.season.id, promotedIds: state.promotedPick }),
      });
      toast('赛季已收官，最终名次与升降级去向已冻结', 'ok');
      await loadSeasons(detail.season.id);
      renderFreezeBanner();
      await loadSeasonView();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

function bindFinalizedSeasonEvents(detail) {
  const open = el('open-new-season');
  if (!open) return;
  open.addEventListener('click', async () => {
    try {
      const draft = await request('/api/seasons/new/draft');
      state.newSeasonDraft = draft;
      el('new-season-body').innerHTML = renderNewSeasonEditor(draft);
      bindNewSeasonEditor(detail);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

function bindNewSeasonEditor(detail) {
  el('cancel-new-season').addEventListener('click', () => {
    state.newSeasonDraft = null;
    renderSeasonPanels();
  });

  el('submit-new-season').addEventListener('click', async () => {
    const name = el('new-season-name').value.trim();
    const assignments = Array.from(document.querySelectorAll('.tier-input')).map((node) => ({
      teamId: node.dataset.team,
      seedRank: node.value === '' ? null : Number(node.value),
    })).filter((item) => item.seedRank !== null);

    try {
      const created = await request('/api/seasons', {
        method: 'POST',
        body: JSON.stringify({ name, assignments }),
      });
      toast(`新一季《${name}》已建立，留级队沿用了上季档位`, 'ok');
      await loadSeasons(created.season.id);
      await request('/api/seasons/switch', { method: 'POST', body: JSON.stringify({ seasonId: created.season.id }) });
      state.selectedSeasonId = created.season.id;
      renderSeasonSelect();
      renderFreezeBanner();
      await refreshActiveView();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

/* 抽屉与表单 */
function optionsHtml(list, selected) {
  return list.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function openTeamDrawer(team) {
  state.drawer = { mode: team ? 'edit' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑球队：${team.name}` : '新增球队' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  // 编辑时按它当前所在的池给档位；新建时正在查看的赛季若已收官，只能登记成外池
  const inSeason = team ? team.inSeason : true;
  const createLockedOutside = !team && !isViewWritable();
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 江城铁马"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="JCTM"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="江城"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    ${team ? '' : `<label class="field"><span>归属</span><select data-name="inSeason" ${createLockedOutside ? 'disabled' : ''}>
      <option value="season">编入本赛季（占一个档位）</option>
      <option value="outside" ${createLockedOutside ? 'selected' : ''}>先放外池（等升降级时升入）</option>
    </select>${createLockedOutside ? '<input type="hidden" data-name="inSeason" value="outside"><span class="hint">查看的赛季已收官，新登记的球队先放进外池，供建立新一季时选用。</span>' : ''}</label>`}
    <div class="field-row">
      <label class="field"><span>档位（同池内不能重复）</span><input data-name="seedRank" maxlength="2" value="${escapeHtml(team ? team.seedRank : '')}" placeholder="1"></label>
      ${(!team || inSeason) ? `<label class="field" id="status-field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '参赛', label: '参赛' }, { value: '退赛', label: '退赛' }], team && team.inSeason ? team.membership : '参赛')}</select></label>` : ''}
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? team.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
  // 新增时切换归属：外池没有参赛状态，状态选择随之隐藏
  const inSeasonNode = el('drawer-form').querySelector('select[data-name="inSeason"]');
  if (inSeasonNode) {
    inSeasonNode.addEventListener('change', () => {
      const outside = inSeasonNode.value === 'outside';
      const statusField = el('status-field');
      if (statusField) statusField.style.display = outside ? 'none' : '';
    });
  }
}

function openVenueDrawer(venue) {
  state.drawer = { mode: venue ? 'edit' : 'create', entity: 'venue', id: venue ? venue.id : '', title: venue ? `编辑场地：${venue.name}` : '新增场地' };
  const picked = venue ? venue.weekdays.map(String) : ['6'];
  el('drawer-form').innerHTML = `
    <label class="field"><span>场地名称</span><input data-name="name" maxlength="30" value="${escapeHtml(venue ? venue.name : '')}" placeholder="例如 江城体育中心"></label>
    <div class="field-row">
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(venue ? venue.city : '')}" placeholder="江城"></label>
      <label class="field"><span>容量（人）</span><input data-name="capacity" maxlength="6" value="${escapeHtml(venue ? venue.capacity : '')}" placeholder="32000"></label>
    </div>
    <div class="field"><span>可用日</span><div class="weekday-pick">
      ${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" data-weekday="${value}" ${picked.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
    </div></div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(venue ? venue.note : '')}" placeholder="例如 三家共用"></label>`;
  showDrawer();
}

function openMatchDrawer(match) {
  state.drawer = { mode: match ? 'edit' : 'create', entity: 'match', id: match ? match.id : '', title: match ? `编辑赛程：第 ${match.round} 轮` : '新增赛程' };
  const teamOptions = state.teams.filter((item) => item.inSeason).map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` }));
  const venueOptions = [{ value: '', label: '留空表示用主队主场' }].concat(state.venues.map((item) => ({ value: item.id, label: item.name })));
  const statusOptions = ['待赛', '已赛', '延期', '取消'].map((value) => ({ value, label: value }));
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>轮次</span><input data-name="round" maxlength="2" value="${escapeHtml(match ? match.round : '1')}" placeholder="1"></label>
      <label class="field"><span>日期</span><input data-name="date" maxlength="10" value="${escapeHtml(match ? match.date : '')}" placeholder="2026-03-14"></label>
      <label class="field"><span>开赛时刻</span><input data-name="kickoff" maxlength="5" value="${escapeHtml(match ? match.kickoff : '15:30')}" placeholder="15:30"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>主队</span><select data-name="homeTeamId">${optionsHtml(teamOptions, match ? match.homeTeamId : '')}</select></label>
      <label class="field"><span>客队</span><select data-name="awayTeamId">${optionsHtml(teamOptions, match ? match.awayTeamId : '')}</select></label>
    </div>
    <label class="field"><span>场地</span><select data-name="venueId">${optionsHtml(venueOptions, match ? match.venueId : '')}</select></label>
    <div class="field-row">
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml(statusOptions, match ? match.status : '待赛')}</select></label>
      <label class="field"><span>主队进球</span><input data-name="homeGoals" maxlength="2" value="${match && match.homeGoals !== null ? match.homeGoals : ''}" placeholder="留空表示未赛"></label>
      <label class="field"><span>客队进球</span><input data-name="awayGoals" maxlength="2" value="${match && match.awayGoals !== null ? match.awayGoals : ''}" placeholder="留空表示未赛"></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(match ? match.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openResultDrawer(match) {
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}` };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.homeName)} 进球</span><input data-name="homeGoals" maxlength="2" value="" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.awayName)} 进球</span><input data-name="awayGoals" maxlength="2" value="" placeholder="0"></label>
    </div>
    <p class="hint">登记完成后这场标成已赛，积分榜与名次立即重算。</p>`;
  showDrawer();
}

function showDrawer() {
  el('drawer-title').textContent = state.drawer.title;
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  const first = el('drawer-form').querySelector('input, select');
  if (first) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  state.drawer = { mode: '', entity: '', id: '', title: '' };
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => { payload[node.dataset.name] = node.value; });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  return { payload, days };
}

function markField(field) {
  const node = el('drawer-form').querySelector(`[data-name="${field}"]`);
  if (!node) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.add('invalid');
  node.focus();
}

async function submitDrawer() {
  el('drawer-form').querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  const { payload, days } = collectForm();
  const { mode, entity, id } = state.drawer;
  try {
    if (entity === 'team') {
      const body = { ...payload, seedRank: Number(payload.seedRank), seasonId: state.selectedSeasonId };
      if (mode === 'edit') {
        delete body.inSeason;
        await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        body.inSeason = payload.inSeason !== 'outside';
        await request('/api/teams', { method: 'POST', body: JSON.stringify(body) });
      }
      toast(mode === 'edit' ? '球队已保存' : '球队已新增', 'ok');
      await Promise.all([loadTeams(), loadSummary()]);
    } else if (entity === 'venue') {
      const body = { ...payload, capacity: Number(payload.capacity), weekdays: days };
      if (mode === 'edit') await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/venues', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '场地已保存' : '场地已新增', 'ok');
      await Promise.all([loadVenues(), loadTeams()]);
    } else if (entity === 'match') {
      if (mode === 'result') {
        await request(`/api/matches/${encodeURIComponent(id)}/result`, {
          method: 'POST',
          body: JSON.stringify({ homeGoals: Number(payload.homeGoals), awayGoals: Number(payload.awayGoals), seasonId: state.selectedSeasonId }),
        });
        toast('比分已登记，积分榜已重算', 'ok');
      } else {
        const body = { ...payload, round: Number(payload.round), seasonId: state.selectedSeasonId };
        if (mode === 'edit') await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await request('/api/matches', { method: 'POST', body: JSON.stringify(body) });
        toast(mode === 'edit' ? '赛程已保存' : '赛程已新增', 'ok');
      }
      await Promise.all([loadMatches(), loadSummary()]);
      if (state.view === 'table') await loadStandings();
    }
    closeDrawer();
  } catch (err) {
    toast(err.message, 'bad');
    markField(err.field);
  }
}

/* 视图切换 */
async function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('is-active', node.id === `view-${view}`));
  const meta = VIEW_META[view];
  el('view-title').textContent = meta.title;
  el('view-sub').textContent = meta.sub;
  const writable = isViewWritable();
  // 已收官的赛季不能加参赛队，但仍允许登记外池球队，为下一季升级做准备
  let action = '';
  if (meta.action) {
    if (writable) action = meta.action;
    else if (view === 'teams') action = '新增外池球队';
  }
  el('head-actions').innerHTML = action ? `<button type="button" class="primary" id="head-add">${action}</button>` : '';
  const addBtn = el('head-add');
  if (addBtn) addBtn.addEventListener('click', () => openDrawerFor(view, null));
  await refreshActiveView();
}

async function refreshActiveView() {
  renderFreezeBanner();
  const view = state.view;
  try {
    if (view === 'overview') await loadSummary();
    if (view === 'seasons') await loadSeasonView();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'table') { await Promise.all([loadSeasonDetailLite(), loadStandings()]); }
  } catch (err) {
    toast(err.message, 'bad');
  }
}

// 积分榜只需要详情里的冻结去向来配列
async function loadSeasonDetailLite() {
  const season = viewedSeason();
  if (season && season.status === '已收官') {
    state.seasonDetail = await request(`/api/seasons/${encodeURIComponent(season.id)}`);
  } else {
    state.seasonDetail = null;
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
}

/* 事件绑定 */
el('nav').addEventListener('click', (event) => {
  const node = event.target.closest('.nav-item');
  if (node) switchView(node.dataset.view);
});

el('season-select').addEventListener('change', (event) => {
  selectSeason(event.target.value);
});

el('team-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.teamFilter.status = node.dataset.value;
  el('team-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('team-search').addEventListener('click', () => {
  state.teamFilter.keyword = el('team-keyword').value.trim();
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('venue-search').addEventListener('click', () => {
  state.venueFilter.keyword = el('venue-keyword').value.trim();
  loadVenues().catch((err) => toast(err.message, 'bad'));
});
el('match-search').addEventListener('click', () => {
  state.matchFilter.keyword = el('match-keyword').value.trim();
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('match-status').addEventListener('change', () => {
  state.matchFilter.status = el('match-status').value;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('table-search').addEventListener('click', () => {
  state.tableFilter.keyword = el('table-keyword').value.trim();
  loadStandings().catch((err) => toast(err.message, 'bad'));
});
el('round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.matchFilter.round = node.dataset.round;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.joinTeam) {
    try {
      const tier = window.prompt('给这支外池球队安排本赛季的档位（1-12，不能与本季已有档位重复）：', '1');
      if (tier === null) return;
      await request(`/api/teams/${encodeURIComponent(node.dataset.joinTeam)}/join`, {
        method: 'POST',
        body: JSON.stringify({ seasonId: state.selectedSeasonId, seedRank: Number(tier) }),
      });
      toast('已编入本赛季', 'ok');
      await Promise.all([loadTeams(), loadMatches(), loadSummary()]);
    } catch (err) {
      toast(err.message, 'bad');
    }
    return;
  }
  if (node.dataset.leaveTeam) {
    if (!window.confirm('把这支球队移出本赛季名单、退回外池吗？')) return;
    try {
      await request(`/api/teams/${encodeURIComponent(node.dataset.leaveTeam)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ seasonId: state.selectedSeasonId }),
      });
      toast('已移出本赛季名单', 'ok');
      await Promise.all([loadTeams(), loadSummary()]);
    } catch (err) {
      toast(err.message, 'bad');
    }
    return;
  }
  if (node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch) {
    const isTeam = Boolean(node.dataset.delTeam);
    const isVenue = Boolean(node.dataset.delVenue);
    const id = node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch;
    const what = isTeam ? '球队' : (isVenue ? '场地' : '这场赛程');
    if (!window.confirm(`确定删除这个${what}吗？`)) return;
    try {
      if (isTeam) { await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadTeams(), loadSummary()]); }
      else if (isVenue) { await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadVenues(); }
      else {
        await request(`/api/matches/${encodeURIComponent(id)}?seasonId=${encodeURIComponent(state.selectedSeasonId)}`, { method: 'DELETE' });
        await Promise.all([loadMatches(), loadSummary()]);
      }
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
});

el('drawer-submit').addEventListener('click', submitDrawer);
el('drawer-cancel').addEventListener('click', closeDrawer);
el('drawer-close').addEventListener('click', closeDrawer);
el('backdrop').addEventListener('click', closeDrawer);
el('drawer-form').addEventListener('submit', (event) => { event.preventDefault(); submitDrawer(); });
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, el('operator').value.trim());
});

async function boot() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
  await loadHealth();
  await loadSeasons();
  await switchView('overview');
}

boot();
