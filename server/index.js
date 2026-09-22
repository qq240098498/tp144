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

// 跨赛季：赛季清单、详情、切换查看、结算预览/确认、下一季预览/建季
app.get('/api/seasons', (_req, res) => {
  res.json(api.listSeasons());
});

app.get('/api/seasons/detail', (req, res) => {
  res.json(api.getSeason(api.readQuery(req.query, 'seasonId')));
});

app.post('/api/seasons/switch', (req, res) => {
  try {
    res.json(api.switchSeason(api.readText(req.body && req.body.seasonId)));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons/settle/preview', (req, res) => {
  try {
    res.json(api.settlePreview(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons/settle', (req, res) => {
  try {
    res.json(api.confirmSettle(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons/next/preview', (req, res) => {
  try {
    res.json(api.newSeasonPreview(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/seasons', (req, res) => {
  try {
    res.status(201).json(api.createSeason(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/teams', (req, res) => {
  res.json(api.listTeams({
    keyword: api.readQuery(req.query, 'keyword'),
    status: api.readQuery(req.query, 'status'),
    scope: api.readQuery(req.query, 'scope'),
    seasonId: api.readQuery(req.query, 'seasonId'),
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

app.delete('/api/teams/:id', (req, res) => {
  try {
    res.json(api.deleteTeam(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/venues', (req, res) => {
  res.json(api.listVenues({
    keyword: api.readQuery(req.query, 'keyword'),
    seasonId: api.readQuery(req.query, 'seasonId'),
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
    round: api.readQuery(req.query, 'round'),
    status: api.readQuery(req.query, 'status'),
    keyword: api.readQuery(req.query, 'keyword'),
    seasonId: api.readQuery(req.query, 'seasonId'),
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
    res.json(api.deleteMatch(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/standings', (req, res) => {
  res.json(api.computeTable({
    keyword: api.readQuery(req.query, 'keyword'),
    seasonId: api.readQuery(req.query, 'seasonId'),
  }));
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
