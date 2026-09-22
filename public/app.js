// 页面交互：左侧导航切换赛季与视图，右侧抽屉负责新增、编辑、结算与建季
// 赛季由后端记住“当前查看的赛季”；历史赛季只看不改，当前赛季正常登记

const state = {
  view: 'overview',
  seasonId: '',
  seasons: [],
  season: null,
  teams: [],
  outsiders: [],
  venues: [],
  matches: [],
  rounds: [],
  standings: null,
  summary: null,
  drawer: { mode: '', entity: '', id: '', title: '', submitLabel: '保存', onSubmit: null },
  teamFilter: { scope: 'roster', status: '', keyword: '' },
  venueFilter: { keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度、最近赛果与最终名次', action: '' },
  seasons: { title: '赛季', sub: '按最终名次结出升降级，生成下一季参赛球队', action: '' },
  teams: { title: '球队', sub: '本季名册的档位、状态与上季档位来源；候选名录为下季预备', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  table: { title: '积分榜', sub: '按积分、净胜球、进球依次排序；结算后冻结为最终名次', action: '' },
};

const el = (id) => document.getElementById(id);

function withSeason(params) {
  const search = new URLSearchParams(params || {});
  if (state.seasonId) search.set('seasonId', state.seasonId);
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

const outcomePill = (outcome) => {
  const map = { 升级: 'up', 降级: 'down', 留级: 'stay' };
  return `<span class="pill ${map[outcome] || 'stay'}">${escapeHtml(outcome || '留级')}</span>`;
};

function currentSeason() {
  return state.seasons.find((item) => item.id === state.seasonId) || null;
}

function isLocked() {
  const season = currentSeason();
  return Boolean(season && season.status === '已结算');
}

/* 赛季清单与切换 */
async function loadSeasons(preferId) {
  const payload = await request('/api/seasons');
  state.seasons = payload.seasons;
  state.seasonId = preferId && state.seasons.some((item) => item.id === preferId)
    ? preferId
    : payload.activeSeasonId;
  el('nav-seasons').textContent = String(state.seasons.length);
  renderSeasonSelect();
}

function renderSeasonSelect() {
  const select = el('season-select');
  select.innerHTML = state.seasons.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.seasonId ? 'selected' : ''}>${escapeHtml(item.name)}${item.status === '已结算' ? '（已归档）' : ''}</option>`).join('');
  const season = currentSeason();
  el('season-name').textContent = season ? season.name : '赛季';
  renderArchiveBanner();
}

function renderArchiveBanner() {
  const season = currentSeason();
  const banner = el('archive-banner');
  if (season && season.status === '已结算') {
    banner.hidden = false;
    el('archive-banner-text').textContent = `正在查看《${season.name}》：最终名次、去向、赛程与积分已冻结，仅供查阅，不能增删改。要安排比赛请切到进行中的赛季。`;
  } else {
    banner.hidden = true;
  }
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

async function loadSummary() {
  state.summary = await request(`/api/summary${withSeason()}`);
  renderOverview();
}

async function loadStandings() {
  const params = {};
  if (state.tableFilter.keyword) params.keyword = state.tableFilter.keyword;
  state.standings = await request(`/api/standings${withSeason(params)}`);
  renderStandings();
}

async function loadTeams() {
  const scope = state.teamFilter.scope;
  const params = { scope };
  if (scope === 'roster' && state.teamFilter.status) params.status = state.teamFilter.status;
  if (state.teamFilter.keyword) params.keyword = state.teamFilter.keyword;
  const payload = await request(`/api/teams${withSeason(params)}`);
  if (scope === 'roster') {
    state.teams = payload.teams;
    el('nav-teams').textContent = String(payload.total);
  } else {
    state.outsiders = payload.teams;
  }
  renderTeams();
}

async function loadVenues() {
  const params = {};
  if (state.venueFilter.keyword) params.keyword = state.venueFilter.keyword;
  const payload = await request(`/api/venues${withSeason(params)}`);
  state.venues = payload.venues;
  renderVenues();
}

async function loadMatches() {
  const params = {};
  if (state.matchFilter.round) params.round = state.matchFilter.round;
  if (state.matchFilter.status) params.status = state.matchFilter.status;
  if (state.matchFilter.keyword) params.keyword = state.matchFilter.keyword;
  const payload = await request(`/api/matches${withSeason(params)}`);
  state.matches = payload.matches;
  state.rounds = payload.rounds;
  el('nav-matches').textContent = String(payload.total);
  renderMatches();
}

async function loadSeasonPanel() {
  state.season = await request(`/api/seasons/detail${withSeason()}`);
  renderSeasonsView();
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
  el('podium-title').textContent = data.settled ? '最终名次（已冻结）' : '积分榜前三';
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
        <span class="muted">${data.settled && row.rank === 1 ? '冠军 🏆' : (data.settled ? '已冻结名次' : `净胜 ${row.goalDiff}`)}</span>
        <span class="pts">${row.points} 分</span>
      </li>`).join('')
    : '<li class="muted">暂无排名</li>';
}

function renderTeams() {
  const locked = isLocked();
  const head = el('team-head');
  const body = el('team-rows');
  const empty = el('team-empty');
  if (state.teamFilter.scope === 'outsider') {
    head.innerHTML = '<tr><th>球队</th><th>简称</th><th>城市</th><th>主场</th><th>备注</th><th></th></tr>';
    body.innerHTML = state.outsiders.map((item) => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.shortName)}</td>
        <td>${escapeHtml(item.city)}</td>
        <td>${escapeHtml(item.venueName)}</td>
        <td class="muted">${escapeHtml(item.note || (item.everPlayedSeasons ? `往季出场过 ${item.everPlayedSeasons} 次，本季在候选名录` : '本季在候选名录'))}</td>
        <td>
          <button type="button" class="mini" data-edit-outsider="${escapeHtml(item.id)}">编辑</button>
          <button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>
        </td>
      </tr>`).join('');
    empty.classList.toggle('show', state.outsiders.length === 0);
    empty.textContent = '候选名录为空：在“新增球队”里选“仅登记为候选”，或去更早的赛季查看离队球队';
    return;
  }

  head.innerHTML = '<tr><th>档位</th><th>球队</th><th>简称</th><th>城市</th><th>主场</th><th>来源</th><th>场次</th><th>状态</th><th>上季档位沿用说明</th><th></th></tr>';
  body.innerHTML = state.teams.map((item) => `<tr>
      <td class="num">${item.seedRank}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.shortName)}</td>
      <td>${escapeHtml(item.city)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td><span class="pill wait">${escapeHtml(item.joinedFromText)}</span></td>
      <td class="num">${item.matchCount}</td>
      <td>${item.status === '参赛' ? '<span class="pill done">参赛</span>' : '<span class="pill off">退赛</span>'}${item.outcome ? outcomePill(item.outcome) : ''}</td>
      <td class="muted">${escapeHtml(item.carryNote)}</td>
      <td>
        ${locked ? '<span class="muted">已归档</span>' : `
        <button type="button" class="mini" data-edit-team="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>`}
      </td>
    </tr>`).join('');
  empty.textContent = '没有符合条件的球队';
  empty.classList.toggle('show', state.teams.length === 0);
}

function renderVenues() {
  el('venue-grid').innerHTML = state.venues.map((item) => `<article class="venue-card">
      <h3>${escapeHtml(item.name)}</h3>
      <div class="city">${escapeHtml(item.city)}</div>
      <dl>
        <dt>容量</dt><dd>${item.capacity} 人</dd>
        <dt>可用日</dt><dd>${escapeHtml(item.weekdaysText)}</dd>
        <dt>主场球队</dt><dd>${item.homeTeams.length ? escapeHtml(item.homeTeams.join('、')) : '无'}</dd>
        <dt>本季已排</dt><dd>${item.matchCount} 场</dd>
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
  const locked = isLocked();
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
      <td>
        ${locked ? '<span class="muted">已归档</span>' : `
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>`}
      </td>
    </tr>`).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

function renderStandings() {
  const data = state.standings;
  if (!data) return;
  const settled = data.settled;
  el('table-hint').textContent = settled
    ? `《${data.seasonName}》最终名次（已冻结）　共赛 ${data.playedMatches} 场`
    : `${data.seasonName}　已打 ${data.playedMatches} 场，待赛 ${data.pendingMatches} 场，延期 ${data.postponedMatches} 场`;
  el('table-head').innerHTML = settled
    ? '<tr><th>最终名次</th><th>球队</th><th>档位</th><th>场次</th><th>胜</th><th>平</th><th>负</th><th>进球</th><th>失球</th><th>净胜</th><th>积分</th><th>下季去向</th></tr>'
    : '<tr><th>名次</th><th>球队</th><th>档位</th><th>场次</th><th>胜</th><th>平</th><th>负</th><th>进球</th><th>失球</th><th>净胜</th><th>积分</th></tr>';
  el('table-rows').innerHTML = data.table.map((row) => `<tr>
      <td class="num">${row.rank}</td>
      <td>${escapeHtml(row.name)}${row.status === '退赛' ? ' <span class="pill off">退赛</span>' : ''}</td>
      <td class="num">${row.seedRank}</td>
      <td>${row.played}</td>
      <td>${row.win}</td>
      <td>${row.draw}</td>
      <td>${row.loss}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
      <td><strong>${row.points}</strong></td>
      ${settled ? `<td>${outcomePill(data.outcomeByTeam[row.teamId] || '留级')}</td>` : ''}
    </tr>`).join('');
}

/* 赛季视图：清单、去向、结算与新建下一季 */
async function renderSeasonsView() {
  const panel = el('season-panel');
  const detail = state.season;
  if (!detail) { panel.innerHTML = ''; return; }

  let movementsHtml = '';
  if (detail.movements && detail.movements.length) {
    movementsHtml = `
      <article class="card" style="margin-top:14px">
        <header class="card-head"><h2>《${escapeHtml(detail.name)}》最终名次与去向</h2><span class="hint">升级 ${detail.rules.promotionCount} 队 / 降级 ${detail.rules.relegationCount} 队</span></header>
        <table class="grid">
          <thead><tr><th>最终名次</th><th>球队</th><th>场次</th><th>积分</th><th>净胜</th><th>去向</th></tr></thead>
          <tbody>
            ${detail.movements.map((row) => `<tr>
              <td class="num">${row.rank}</td>
              <td>${escapeHtml(row.teamName)}${row.status === '退赛' ? ' <span class="pill off">退赛</span>' : ''}</td>
              <td>${row.played}</td>
              <td><strong>${row.points}</strong></td>
              <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
              <td>${outcomePill(row.outcome)}${row.forced ? '<span class="hint"> 退赛按降级处理，不占名额</span>' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </article>`;
  }

  const nextSeason = state.seasons.find((item) => item.sequence === detail.sequence + 1);
  const actions = [];
  if (detail.status === '进行中') {
    actions.push('<button type="button" class="primary" data-action="settle">按名次结算升降级</button>');
  } else {
    actions.push('<button type="button" class="ghost" data-action="recalc">调整规则并重算去向</button>');
    if (nextSeason) {
      actions.push(`<span class="hint">下一季《${escapeHtml(nextSeason.name)}》已建立，可在左上方切过去安排赛程</span>`);
    } else {
      actions.push('<button type="button" class="primary" data-action="new-season">按升降级结果新建下一季</button>');
    }
  }

  const logHtml = detail.rulesLog && detail.rulesLog.length ? `
    <article class="card" style="margin-top:14px">
      <header class="card-head"><h2>结算与规则变更记录</h2></header>
      <ul class="log-list">
        ${detail.rulesLog.slice().reverse().map((log) => `<li>
          <span class="round-tag">${log.action === 'settle' ? '首次结算' : '规则重算'}</span>
          <span>升级 ${log.to.promotionCount} 队 / 降级 ${log.to.relegationCount} 队</span>
          ${log.changes && log.changes.length ? `<span class="muted">归属变化：${log.changes.map((c) => `${escapeHtml(c.teamName)} ${c.from}→${c.to}`).join('；')}</span>` : '<span class="muted">本次无球队归属变化</span>'}
        </li>`).join('')}
      </ul>
    </article>` : '';

  panel.innerHTML = `
    <article class="card">
      <header class="card-head">
        <h2>${escapeHtml(detail.name)} <span class="pill ${detail.status === '已结算' ? 'off' : 'done'}">${escapeHtml(detail.status)}</span></h2>
        <div class="card-actions">${actions.join('')}</div>
      </header>
      <p class="hint">共 ${detail.teamCount} 支球队、${detail.matchCount} 场赛程（已赛 ${detail.playedCount} 场）。
        当前升降级规则：名次靠前的 ${detail.rules.promotionCount} 队升级离队，榜尾 ${detail.rules.relegationCount} 队降级离队，其余留级。${detail.status === '已结算' ? `结算时间：${escapeHtml(detail.settledAt || '')}` : ''}</p>
    </article>
    ${movementsHtml}
    ${logHtml}`;
}

/* 结算抽屉：规则可调，右侧实时预览名次去向与归属变化 */
async function openSettleDrawer(recalc) {
  const detail = state.season;
  state.drawer = {
    mode: recalc ? 'recalc' : 'settle',
    entity: 'settle',
    title: recalc ? `调整升降级规则：${detail.name}` : `结算升降级：${detail.name}`,
    submitLabel: recalc ? '按新规则重算去向' : '确认结算并冻结名次',
  };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>升级队数（名次靠前的几队离队升级）</span><input data-name="promotionCount" type="number" min="0" max="12" value="${detail.rules.promotionCount}"></label>
      <label class="field"><span>降级队数（榜尾几队离队降级）</span><input data-name="relegationCount" type="number" min="0" max="12" value="${detail.rules.relegationCount}"></label>
    </div>
    <div id="settle-preview" class="preview-box"><span class="muted">正在生成预览…</span></div>
    <label class="field check"><input type="checkbox" data-name="ignorePending" ${recalc ? 'checked' : ''}> <span>知道了，照当前名次结算（未打完的场次以后也不计入本季名次）</span></label>`;
  showDrawer();
  refreshSettlePreview();
}

let settlePreviewTimer = null;
async function refreshSettlePreview() {
  const form = el('drawer-form');
  const promotionCount = Number(form.querySelector('[data-name="promotionCount"]').value);
  const relegationCount = Number(form.querySelector('[data-name="relegationCount"]').value);
  const box = el('settle-preview');
  try {
    const data = await request('/api/seasons/settle/preview', {
      method: 'POST',
      body: JSON.stringify({ seasonId: state.seasonId, promotionCount, relegationCount }),
    });
    box.innerHTML = `
      ${data.warning ? `<p class="warn-line">⚠ ${escapeHtml(data.warning)}</p>` : ''}
      ${data.downstreamWarning ? `<p class="warn-line">⚠ ${escapeHtml(data.downstreamWarning)}</p>` : ''}
      ${data.changes.length ? `<p class="change-line">规则调整后归属变化：<br>${data.changes.map((c) => `· ${escapeHtml(c.teamName)}：${c.from} → <b>${c.to}</b>（现名次第 ${c.rank}）`).join('<br>')}</p>` : (data.rulesTouched ? '<p class="muted">新规则下没有球队归属发生变化</p>' : '')}
      <table class="grid mini-grid">
        <thead><tr><th>名次</th><th>球队</th><th>积分</th><th>去向</th></tr></thead>
        <tbody>
          ${data.rows.map((row) => `<tr>
            <td class="num">${row.rank}</td>
            <td>${escapeHtml(row.teamName)}${row.status === '退赛' ? ' <span class="pill off">退赛</span>' : ''}</td>
            <td class="num">${row.points}</td>
            <td>${outcomePill(row.outcome)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="hint">${data.rows.map((row) => `${row.teamName}：${row.reason}`).join('；')}</p>`;
  } catch (err) {
    box.innerHTML = `<p class="warn-line">⚠ ${escapeHtml(err.message)}</p>`;
  }
}

/* 新建下一季抽屉：勾选升级队、选档位策略、逐队确认档位，空位与冲突讲清楚 */
let newSeasonPlan = null;
let newSeasonTeamIds = '';

async function openNewSeasonDrawer() {
  const detail = state.season;
  newSeasonPlan = null;
  newSeasonTeamIds = '';
  state.drawer = { mode: 'create', entity: 'new-season', title: `新建下一季（来自《${detail.name}》）`, submitLabel: '建立新赛季' };
  const seq = (detail.sequence || 0) + 1;
  el('drawer-form').innerHTML = `
    <label class="field"><span>新赛季名称</span><input data-name="name" maxlength="40" value="2026 第 ${seq} 赛季" placeholder="例如 2026 秋季联赛"></label>
    <div class="field"><span>档位处理方式</span>
      <div class="weekday-pick">
        <label><input type="radio" name="seedMode" data-name="seedMode" value="keep" checked> 沿用上季档位</label>
        <label><input type="radio" name="seedMode" data-name="seedMode" value="compact"> 按最终名次重排</label>
      </div>
      <span class="hint">沿用：留级队保住原档位，升级队补降级/升级空出的档位；重排：留级队按最终名次从第 1 档顺排，升级队排其后。</span>
    </div>
    <div class="field"><span>升级入赛的候选球队</span><div id="promote-pick" class="promote-pick"><span class="muted">正在读取候选…</span></div></div>
    <div id="new-season-warn"></div>
    <div id="new-season-summary" class="hint"></div>
    <div class="preview-box">
      <table class="grid mini-grid">
        <thead><tr><th>档位</th><th>球队</th><th>来源</th><th>档位说明</th></tr></thead>
        <tbody id="new-season-rows"></tbody>
      </table>
    </div>
    <div id="new-season-holes"></div>`;
  showDrawer();
  formBindNewSeason();
  refreshNewSeasonPreview();
}

function formBindNewSeason() {
  const form = el('drawer-form');
  form.querySelector('[data-name="name"]').addEventListener('input', scheduleNewSeasonPreview);
  form.querySelectorAll('input[name="seedMode"]').forEach((radio) => radio.addEventListener('change', refreshNewSeasonPreview));
}

function collectNewSeasonBody() {
  const form = el('drawer-form');
  const pickBox = el('promote-pick');
  // 候选框首次渲染前拿不到勾选状态，不带该字段，由后端默认勾选全部候选
  const promoteTeamIds = pickBox.dataset.built
    ? Array.from(form.querySelectorAll('[data-promote]:checked')).map((node) => node.value)
    : undefined;
  const seeds = {};
  form.querySelectorAll('[data-seed-input]').forEach((node) => { seeds[node.dataset.seedInput] = Number(node.value); });
  return {
    fromSeasonId: state.seasonId,
    name: form.querySelector('[data-name="name"]').value.trim(),
    seedMode: form.querySelector('input[name="seedMode"]:checked').value,
    promoteTeamIds,
    seeds,
  };
}

async function refreshNewSeasonPreview() {
  const body = collectNewSeasonBody();
  let data;
  try {
    data = await request('/api/seasons/next/preview', { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    el('new-season-warn').innerHTML = `<p class="warn-line">⚠ ${escapeHtml(err.message)}</p>`;
    return;
  }
  newSeasonPlan = data;
  el('new-season-warn').innerHTML = '';
  const form = el('drawer-form');

  // 候选名单只在首次渲染，勾选状态交给用户自己控制
  const pickBox = el('promote-pick');
  if (!pickBox.dataset.built) {
    pickBox.dataset.built = '1';
    pickBox.innerHTML = data.candidates.length
      ? data.candidates.map((team) => `<label><input type="checkbox" data-promote="${escapeHtml(team.teamId)}" ${team.picked ? 'checked' : ''}> ${escapeHtml(team.teamName)}（${escapeHtml(team.shortName)} · ${escapeHtml(team.city)}）</label>`).join('')
      : '<span class="muted">候选名录为空：先到“球队”视图新增“仅登记为候选”的球队</span>';
    pickBox.querySelectorAll('[data-promote]').forEach((node) => node.addEventListener('change', refreshNewSeasonPreview));
  }

  el('new-season-summary').textContent = `留级 ${data.stayers.length} 队 + 升级 ${data.roster.length - data.stayers.length} 队 = ${data.teamCount} 队（上限 ${data.capacity}）`;

  // 球队集合没变就只就地更新档位值与说明，保住正在输入的焦点；集合变了才重建行
  const signature = data.roster.map((row) => row.teamId).join(',');
  const tbody = el('new-season-rows');
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.seedInput : '';
  if (signature !== newSeasonTeamIds) {
    newSeasonTeamIds = signature;
    tbody.innerHTML = data.roster.map((row) => `<tr data-team="${escapeHtml(row.teamId)}">
        <td><input class="seed-input" data-seed-input="${escapeHtml(row.teamId)}" type="number" min="1" max="12" value="${row.seedRank}"></td>
        <td>${escapeHtml(row.teamName)}</td>
        <td class="src">${row.joinedFrom === '留级' ? '<span class="pill stay">留级</span>' : '<span class="pill up">升级</span>'}</td>
        <td class="muted note">${escapeHtml(row.carryNote)}</td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-seed-input]').forEach((node) => node.addEventListener('input', scheduleNewSeasonPreview));
  } else {
    data.roster.forEach((row) => {
      const tr = tbody.querySelector(`tr[data-team="${row.teamId}"]`);
      if (!tr) return;
      const input = tr.querySelector('[data-seed-input]');
      if (row.teamId !== focused) input.value = row.seedRank;
      tr.querySelector('.note').textContent = row.carryNote;
    });
  }

  el('new-season-holes').innerHTML = data.holes.length
    ? `<div class="holes-box"><b>档位空位去向：</b><ul>${data.holes.map((hole) => `<li>第 ${hole.rank} 档：${hole.fromTeamName ? escapeHtml(hole.fromTeamName) + '（' + escapeHtml(hole.fromOutcome) + '）离队空出' : '名册原有空位'} → ${hole.filledBy ? `由 ${escapeHtml(hole.filledBy)} 补位` : '<b style="color:var(--amber)">无人补位，本季留空</b>'}</li>`).join('')}</ul></div>`
    : '<p class="hint">所有档位都已落位，没有空位。</p>';
}

let newSeasonPreviewTimer = null;
function scheduleNewSeasonPreview() {
  window.clearTimeout(newSeasonPreviewTimer);
  newSeasonPreviewTimer = window.setTimeout(refreshNewSeasonPreview, 180);
}

/* 抽屉与表单 */
function optionsHtml(list, selected) {
  return list.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function openTeamDrawer(team) {
  // 候选名录标签下的新增走候选表单；历史归档赛季不能往名册加队，也引导到候选表单
  if (!team && (state.teamFilter.scope === 'outsider' || isLocked())) return openOutsiderDrawer(null);
  if (team && isLocked()) return;
  state.drawer = { mode: team ? 'edit' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑球队：${team.name}` : '新增球队', submitLabel: '保存' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 江城铁马"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="JCTM"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="江城"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    ${team ? `
    <div class="field-row">
      <label class="field"><span>本季档位</span><input data-name="seedRank" maxlength="2" type="number" min="1" max="12" value="${escapeHtml(team ? team.seedRank : '')}"></label>
      <label class="field"><span>本季状态</span><select data-name="status">${optionsHtml([{ value: '参赛', label: '参赛' }, { value: '退赛', label: '退赛' }], team ? team.status : '参赛')}</select></label>
    </div>` : `
    <div class="field"><span>加入方式</span>
      <div class="weekday-pick">
        <label><input type="radio" name="joinMode" data-name="joinMode" value="roster" checked> 加入本季名册</label>
        <label><input type="radio" name="joinMode" data-name="joinMode" value="candidate"> 仅登记为候选（等下季升级）</label>
      </div>
    </div>
    <div class="field-row" id="new-team-rank-row">
      <label class="field"><span>本季档位（留空自动给最小空档位）</span><input data-name="seedRank" type="number" min="1" max="12" value="" placeholder="自动"></label>
    </div>`}
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? team.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
  const radios = el('drawer-form').querySelectorAll('input[name="joinMode"]');
  radios.forEach((radio) => radio.addEventListener('change', () => {
    const row = el('new-team-rank-row');
    if (row) row.style.display = radio.value === 'candidate' && radio.checked ? 'none' : '';
  }));
}

function openOutsiderDrawer(team) {
  state.drawer = { mode: team ? 'edit-outsider' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑候选球队：${team.name}` : '新增球队', submitLabel: '保存' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  el('drawer-form').innerHTML = `
    <p class="hint">候选球队只存在于全局名录，等新建下一季时勾选升级。</p>
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 南岭南风"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="NLNF"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="南岭"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? (team.note || '') : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openVenueDrawer(venue) {
  state.drawer = { mode: venue ? 'edit' : 'create', entity: 'venue', id: venue ? venue.id : '', title: venue ? `编辑场地：${venue.name}` : '新增场地', submitLabel: '保存' };
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
  if (isLocked()) return;
  state.drawer = { mode: match ? 'edit' : 'create', entity: 'match', id: match ? match.id : '', title: match ? `编辑赛程：第 ${match.round} 轮` : '新增赛程', submitLabel: '保存' };
  const teamOptions = state.teams.map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` }));
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
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}`, submitLabel: '登记比分' };
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
  el('drawer-submit').textContent = state.drawer.submitLabel || '保存';
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  const first = el('drawer-form').querySelector('input, select');
  if (first) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  state.drawer = { mode: '', entity: '', id: '', title: '', submitLabel: '保存' };
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => {
    if (node.type === 'radio') {
      const checked = el('drawer-form').querySelector(`input[name="${node.name}"]:checked`);
      if (checked) payload[node.dataset.name] = checked.value;
      return;
    }
    payload[node.dataset.name] = node.value;
  });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  const ignorePending = Boolean(el('drawer-form').querySelector('[data-name="ignorePending"]'))
    && el('drawer-form').querySelector('[data-name="ignorePending"]').checked;
  return { payload, days, ignorePending };
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
  const { payload, days, ignorePending } = collectForm();
  const { mode, entity, id } = state.drawer;
  try {
    if (entity === 'settle') {
      const result = await request('/api/seasons/settle', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: state.seasonId,
          promotionCount: Number(payload.promotionCount),
          relegationCount: Number(payload.relegationCount),
          ignorePending,
        }),
      });
      toast(result.recalculated
        ? `已按新规则重算：${result.changes.length ? result.changes.map((c) => `${c.teamName}${c.from}转${c.to}`).join('、') : '没有球队归属变化'}`
        : '赛季已结算，最终名次与去向已冻结', 'ok');
      closeDrawer();
      await Promise.all([loadSeasons(state.seasonId), loadSeasonPanel()]);
      return;
    }

    if (entity === 'new-season') {
      const promoteTeamIds = Array.from(el('drawer-form').querySelectorAll('[data-promote]:checked')).map((node) => node.value);
      const seeds = {};
      el('drawer-form').querySelectorAll('[data-seed-input]').forEach((node) => { seeds[node.dataset.seedInput] = Number(node.value); });
      const result = await request('/api/seasons', {
        method: 'POST',
        body: JSON.stringify({
          fromSeasonId: state.seasonId,
          name: payload.name,
          seedMode: payload.seedMode || 'keep',
          promoteTeamIds,
          seeds,
        }),
      });
      toast(`新赛季《${result.name}》已建立，${result.teamCount} 支球队按升降级结果落位`, 'ok');
      closeDrawer();
      await loadSeasons(result.id);
      await switchView('seasons');
      return;
    }

    if (entity === 'team') {
      if (mode === 'edit' || mode === 'edit-outsider') {
        const body = mode === 'edit-outsider'
          ? { name: payload.name, shortName: payload.shortName, city: payload.city, venueId: payload.venueId, note: payload.note }
          : { ...payload, seedRank: Number(payload.seedRank) };
        await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const body = { ...payload, seedRank: payload.seedRank === '' ? undefined : Number(payload.seedRank), joinMode: payload.joinMode || 'roster' };
        await request('/api/teams', { method: 'POST', body: JSON.stringify(body) });
      }
      toast(mode === 'edit' ? '球队已保存' : (payload.joinMode === 'candidate' ? '候选球队已登记，建下一季时可勾选升级' : '球队已加入本季名册'), 'ok');
      await Promise.all([loadTeams(), loadVenues(), loadSummary()]);
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
          body: JSON.stringify({ homeGoals: Number(payload.homeGoals), awayGoals: Number(payload.awayGoals) }),
        });
        toast('比分已登记，积分榜已重算', 'ok');
      } else {
        const body = { ...payload, round: Number(payload.round) };
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
  // 历史归档：名册与赛程的新增收起；球队视图在“候选名录”下仍可登记候选队
  const allowAdd = view === 'teams'
    ? (!isLocked() || state.teamFilter.scope === 'outsider')
    : !(isLocked() && view === 'matches');
  const showAdd = Boolean(meta.action) && allowAdd;
  el('head-actions').innerHTML = showAdd ? `<button type="button" class="primary" id="head-add">${meta.action}</button>` : '';
  if (showAdd) el('head-add').addEventListener('click', () => openDrawerFor(view, null));

  try {
    if (view === 'overview') await loadSummary();
    if (view === 'seasons') await loadSeasonPanel();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'table') await loadStandings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
}

async function changeSeason(seasonId) {
  if (seasonId === state.seasonId) return;
  try {
    await request('/api/seasons/switch', { method: 'POST', body: JSON.stringify({ seasonId }) });
    state.seasonId = seasonId;
    renderSeasonSelect();
    await switchView(state.view);
  } catch (err) {
    toast(err.message, 'bad');
    renderSeasonSelect();
  }
}

/* 事件绑定 */
el('season-select').addEventListener('change', (event) => changeSeason(event.target.value));

el('nav').addEventListener('click', (event) => {
  const node = event.target.closest('.nav-item');
  if (node) switchView(node.dataset.view);
});

el('team-scope-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.teamFilter.scope = node.dataset.value;
  el('team-scope-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadTeams().catch((err) => toast(err.message, 'bad'));
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

el('season-panel').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'settle') return openSettleDrawer(false);
  if (btn.dataset.action === 'recalc') return openSettleDrawer(true);
  if (btn.dataset.action === 'new-season') return openNewSeasonDrawer();
});

// 结算抽屉里改规则即时预览
el('drawer-form').addEventListener('input', (event) => {
  if (state.drawer.entity !== 'settle') return;
  if (!['promotionCount', 'relegationCount'].includes(event.target.dataset.name)) return;
  window.clearTimeout(settlePreviewTimer);
  settlePreviewTimer = window.setTimeout(refreshSettlePreview, 180);
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editOutsider) {
    return openOutsiderDrawer(state.outsiders.find((item) => item.id === node.dataset.editOutsider));
  }
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch) {
    const isTeam = Boolean(node.dataset.delTeam);
    const isVenue = Boolean(node.dataset.delVenue);
    const id = node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch;
    const what = isTeam ? '球队' : (isVenue ? '场地' : '这场赛程');
    if (!window.confirm(`确定删除这个${what}吗？历史赛季中出现过的球队与场地不会被删除。`)) return;
    try {
      if (isTeam) { await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadTeams(), loadSummary()]); }
      else if (isVenue) { await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadVenues(); }
      else { await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadMatches(), loadSummary()]); }
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
  try {
    await loadSeasons();
    el('nav-seasons').textContent = String(state.seasons.length);
  } catch (err) {
    toast(err.message, 'bad');
  }
  await switchView('overview');
}

boot();
