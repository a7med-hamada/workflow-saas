const { getDb, withTransaction, newId, nowIso } = require('../db');
const { hasPermission } = require('../auth');
const { logAudit } = require('../audit');

function handleDepartmentRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;

  // GET /api/departments
  if (req.method === 'GET' && pathname === '/api/departments') {
    const statusFilter = query.get('status') || null;
    const clauses = ['d.company_id = ?'];
    const params = [companyId];
    if (statusFilter) {
      clauses.push('d.status = ?');
      params.push(statusFilter);
    }

    const rows = db.prepare(`
      SELECT d.*, u.full_name AS manager_name, u.email AS manager_email
      FROM departments d
      LEFT JOIN users u ON u.id = d.manager_user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.name ASC
    `).all(...params);

    const departments = rows.map((d) => {
      const members = db.prepare(`
        SELECT m.user_id, u.full_name, u.email, u.avatar_url, m.job_title, m.role, m.status
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.company_id = ? AND m.department_id = ?
      `).all(companyId, d.id);

      const projectsCount = Number(
        db.prepare("SELECT COUNT(*) AS c FROM projects WHERE company_id = ? AND department_id = ? AND status != 'archived'")
          .get(companyId, d.id).c
      );
      const tasksCount = Number(
        db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE company_id = ? AND department_id = ? AND status != 'cancelled'")
          .get(companyId, d.id).c
      );

      return {
        ...d,
        members,
        member_count: members.length,
        active_projects_count: projectsCount,
        tasks_count: tasksCount
      };
    });

    return sendJson(res, 200, { departments });
  }

  // POST /api/departments
  if (req.method === 'POST' && pathname === '/api/departments') {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_departments')) {
      return sendJson(res, 403, { error: 'Only the company owner or authorized administrators can create departments.' });
    }

    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const managerUserId = body.manager_user_id || null;

    if (!name) {
      return sendJson(res, 400, { error: 'Department name is required.' });
    }

    const existing = db.prepare('SELECT id FROM departments WHERE company_id = ? AND name = ?').get(companyId, name);
    if (existing) {
      return sendJson(res, 409, { error: 'A department with this name already exists in your company.' });
    }

    if (managerUserId) {
      const mgr = db.prepare('SELECT user_id FROM company_memberships WHERE company_id = ? AND user_id = ?')
        .get(companyId, managerUserId);
      if (!mgr) {
        return sendJson(res, 400, { error: 'Selected department manager does not belong to this company.' });
      }
    }

    const id = newId('dep');
    const now = nowIso();
    db.prepare(`
      INSERT INTO departments (id, company_id, name, description, manager_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, companyId, name, description, managerUserId, now, now);

    if (Array.isArray(body.member_user_ids) && body.member_user_ids.length > 0) {
      const assignStmt = db.prepare('UPDATE company_memberships SET department_id = ?, updated_at = ? WHERE company_id = ? AND user_id = ?');
      for (const uid of body.member_user_ids) {
        assignStmt.run(id, now, companyId, String(uid));
      }
    }

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'department.created',
      entityType: 'department',
      entityId: id,
      newValues: { name, description, manager_user_id: managerUserId }
    });

    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    return sendJson(res, 201, { department: dept });
  }

  // PUT /api/departments/:id
  const deptMatch = pathname.match(/^\/api\/departments\/([^/]+)$/);
  if (req.method === 'PUT' && deptMatch) {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_departments')) {
      return sendJson(res, 403, { error: 'Only authorized administrators can edit departments.' });
    }

    const deptId = deptMatch[1];
    const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(deptId, companyId);
    if (!dept) {
      return sendJson(res, 404, { error: 'Department not found.' });
    }

    const newName = body.name !== undefined ? String(body.name).trim() : dept.name;
    const newDesc = body.description !== undefined ? String(body.description).trim() : dept.description;
    const newManagerId = body.manager_user_id !== undefined ? (body.manager_user_id || null) : dept.manager_user_id;
    const newStatus = body.status && ['active', 'archived'].includes(body.status) ? body.status : dept.status;

    if (!newName) {
      return sendJson(res, 400, { error: 'Department name cannot be empty.' });
    }

    const duplicate = db.prepare('SELECT id FROM departments WHERE company_id = ? AND name = ? AND id != ?')
      .get(companyId, newName, deptId);
    if (duplicate) {
      return sendJson(res, 409, { error: 'Another department with this name already exists.' });
    }

    const now = nowIso();
    db.prepare(`
      UPDATE departments
      SET name = ?, description = ?, manager_user_id = ?, status = ?, updated_at = ?
      WHERE id = ? AND company_id = ?
    `).run(newName, newDesc, newManagerId, newStatus, now, deptId, companyId);

    if (Array.isArray(body.member_user_ids)) {
      db.prepare('UPDATE company_memberships SET department_id = NULL, updated_at = ? WHERE company_id = ? AND department_id = ?')
        .run(now, companyId, deptId);
      const assignStmt = db.prepare('UPDATE company_memberships SET department_id = ?, updated_at = ? WHERE company_id = ? AND user_id = ?');
      for (const uid of body.member_user_ids) {
        assignStmt.run(deptId, now, companyId, String(uid));
      }
    }

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'department.updated',
      entityType: 'department',
      entityId: deptId,
      previousValues: { name: dept.name, status: dept.status, manager_user_id: dept.manager_user_id },
      newValues: { name: newName, status: newStatus, manager_user_id: newManagerId }
    });

    const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId);
    return sendJson(res, 200, { department: updated });
  }

  // DELETE /api/departments/:id (with safe reassignment protection)
  if (req.method === 'DELETE' && deptMatch) {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_departments')) {
      return sendJson(res, 403, { error: 'Only authorized administrators can delete departments.' });
    }

    const deptId = deptMatch[1];
    const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(deptId, companyId);
    if (!dept) {
      return sendJson(res, 404, { error: 'Department not found.' });
    }

    const reassignToId = query.get('reassign_to') || (body && body.reassign_to_department_id) || null;
    const empCount = Number(
      db.prepare('SELECT COUNT(*) AS c FROM company_memberships WHERE company_id = ? AND department_id = ?')
        .get(companyId, deptId).c
    );
    const activeProjCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM projects WHERE company_id = ? AND department_id = ? AND status NOT IN ('completed', 'archived')")
        .get(companyId, deptId).c
    );

    if ((empCount > 0 || activeProjCount > 0) && !reassignToId) {
      return sendJson(res, 409, {
        error: 'Cannot delete a department that contains employees or active projects without reassigning them first.',
        requires_reassignment: true,
        employees_count: empCount,
        active_projects_count: activeProjCount
      });
    }

    withTransaction(() => {
      const now = nowIso();
      if (reassignToId) {
        if (reassignToId === deptId) {
          throw new Error('Cannot reassign department to itself.');
        }
        const targetDept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?')
          .get(reassignToId, companyId);
        if (!targetDept) {
          throw new Error('Target reassignment department not found in this company.');
        }
        db.prepare('UPDATE company_memberships SET department_id = ?, updated_at = ? WHERE company_id = ? AND department_id = ?')
          .run(reassignToId, now, companyId, deptId);
        db.prepare('UPDATE projects SET department_id = ?, updated_at = ? WHERE company_id = ? AND department_id = ?')
          .run(reassignToId, now, companyId, deptId);
        db.prepare('UPDATE tasks SET department_id = ?, updated_at = ? WHERE company_id = ? AND department_id = ?')
          .run(reassignToId, now, companyId, deptId);
      }

      db.prepare('DELETE FROM departments WHERE id = ? AND company_id = ?').run(deptId, companyId);

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'department.deleted',
        entityType: 'department',
        entityId: deptId,
        previousValues: { name: dept.name, employees_count: empCount, active_projects_count: activeProjCount },
        newValues: { reassigned_to: reassignToId }
      });
    });

    return sendJson(res, 200, { ok: true });
  }

  return false;
}

module.exports = {
  handleDepartmentRoutes
};
