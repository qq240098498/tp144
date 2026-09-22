const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5144;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/summary', (req, res) => {
  res.json(api.summary({ seasonId: api.readQuery(req.query, 'seasonId') }));
});

app.get('/api/teams', (req, res) => {
  res.json(api.listTeams({
    seasonId: api.readQuery(req.query, 'seasonId'),
    keyword: api.readQuery(req.query, 'keyword'),
    status: api.readQuery(req.query, 'status'),
  }));
});

app.post('/api/teams', (req, res) => {
  try {
    res.status(201).json(api.createTeam(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/teams/:id', (req, res) => {
  try {
    res.json(api.updateTeam(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 外池球队编入当前赛季 / 名单球队退回外池
app.post('/api/teams/:id/join', (req, res) => {
  try {
    res.json(api.joinSeason(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/teams/:id/leave', (req, res) => {
  try {
    res.json(api.leaveSeason(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    res.json(api.deleteTeam(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/venues', (req, res) => {
  res.json(api.listVenues({
    seasonId: api.readQuery(req.query, 'seasonId'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/venues', (req, res) => {
  try {
    res.status(201).json(api.createVenue(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/venues/:id', (req, res) => {
  try {
    res.json(api.updateVenue(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/venues/:id', (req, res) => {
  try {
    res.json(api.deleteVenue(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/matches', (req, res) => {
  res.json(api.listMatches({
    seasonId: api.readQuery(req.query, 'seasonId'),
    round: api.readQuery(req.query, 'round'),
    status: api.readQuery(req.query, 'status'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/matches', (req, res) => {
  try {
    res.status(201).json(api.createMatch(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/matches/:id', (req, res) => {
  try {
    res.json(api.updateMatch(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 登记比分：登记完这场自动标成已赛，积分表随之变化
app.post('/api/matches/:id/result', (req, res) => {
  try {
    res.json(api.recordResult(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/matches/:id', (req, res) => {
  try {
    res.json(api.deleteMatch(req.params.id, { seasonId: api.readQuery(req.query, 'seasonId') }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/standings', (req, res) => {
  res.json(api.computeTable({
    seasonId: api.readQuery(req.query, 'seasonId'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

/* 跨赛季：赛季清单、赛季详情、试算升降级、改规则、切换、收官、建新季 */
app.get('/api/seasons', (_req, res) => {
  res.json(api.listSeasons());
});

app.get('/api/seasons/:id', (req, res) => {
  try {
    res.json(api.getSeasonDetail(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 试算：按提交的规则与升级候选随时重算去向，不落盘
app.post('/api/seasons/preview', (req, res) => {
  try {
    res.json(api.previewPromotion(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

// 新一季开赛前先取草稿：留级沿用档位、升级填空档位
app.get('/api/seasons/new/draft', (_req, res) => {
  try {
    res.json(api.draftNewSeason());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons', (req, res) => {
  try {
    res.status(201).json(api.createSeason(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

// 正式收官：冻结最终名次与每支球队的升降级去向
app.post('/api/seasons/finalize', (req, res) => {
  try {
    res.json(api.finalizeSeason(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons/switch', (req, res) => {
  try {
    res.json(api.switchSeason((req.body && req.body.seasonId) || ''));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/seasons/:id', (req, res) => {
  try {
    res.json(api.updateSeason(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp144] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`联赛赛程与积分核算台已启动：http://localhost:${PORT}`);
});
