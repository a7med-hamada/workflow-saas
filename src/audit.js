const { getDb, newId, nowIso } = require('./db');

function logAudit({
  companyId,
  actorUserId = null,
  action,
  entityType,
  entityId,
  previousValues = {},
  newValues = {},
  reason = ''
}) {
  if (!companyId || !action || !entityType || !entityId) return null;
  const db = getDb();
  const id = newId('aud');
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO audit_logs (
      id, company_id, actor_user_id, action, entity_type, entity_id,
      previous_values_json, new_values_json, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    companyId,
    actorUserId,
    action,
    entityType,
    entityId,
    JSON.stringify(previousValues || {}),
    JSON.stringify(newValues || {}),
    reason || '',
    createdAt
  );
  return id;
}

function getAuditLogs({ companyId, entityType = null, entityId = null, actorUserId = null, action = null, limit = 100, offset = 0 }) {
  const db = getDb();
  const clauses = ['a.company_id = ?'];
  const params = [companyId];

  if (entityType) {
    clauses.push('a.entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    clauses.push('a.entity_id = ?');
    params.push(entityId);
  }
  if (actorUserId) {
    clauses.push('a.actor_user_id = ?');
    params.push(actorUserId);
  }
  if (action) {
    clauses.push('a.action = ?');
    params.push(action);
  }

  params.push(Number(limit) || 100, Number(offset) || 0);

  const rows = db.prepare(`
    SELECT a.*, u.full_name AS actor_name, u.email AS actor_email, u.avatar_url AS actor_avatar
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  return rows.map((row) => ({
    ...row,
    previous_values: safeParseJson(row.previous_values_json, {}),
    new_values: safeParseJson(row.new_values_json, {})
  }));
}

function safeParseJson(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  logAudit,
  getAuditLogs,
  safeParseJson
};
