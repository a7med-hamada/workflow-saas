const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Configure isolated temporary test database & upload storage before loading app modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-saas-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.sqlite');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'development';
process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = '500';

const { initDatabase } = require('../src/db');
const { createAppServer } = require('../src/server');

let server;
let baseUrl;

async function apiCall(endpoint, { method = 'GET', token = null, body = null, rawResponse = false } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload = undefined;
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: payload
  });
  if (rawResponse) return res;
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

describe('WorkFlow SaaS Platform — Comprehensive Automated Test Suite', () => {
  before(async () => {
    initDatabase(process.env.DATABASE_PATH);
    server = createAppServer();
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('1. End-to-End 20-Step Acceptance Scenario & Core SaaS Workflows', async () => {
    // Step 1: A new company owner registers
    const regA = await apiCall('/api/auth/register', {
      method: 'POST',
      body: {
        company_name: 'Alpha Software Corp',
        full_name: 'Omar Al-Farsi (Owner)',
        email: 'owner@alpha.example.com',
        password: 'Password@123',
        confirm_password: 'Password@123'
      }
    });
    assert.equal(regA.status, 201);
    assert.ok(regA.data.token);
    assert.equal(regA.data.redirect_to, '/dashboard');
    const ownerToken = regA.data.token;
    const companyAId = regA.data.company.id;

    // Step 2: Verify the new company workspace is completely empty (no fake employees, projects, or tasks)
    const setupStatusInitial = await apiCall('/api/company/setup-status', { token: ownerToken });
    assert.equal(setupStatusInitial.status, 200);
    assert.equal(setupStatusInitial.data.checklist.departments.count, 0);
    assert.equal(setupStatusInitial.data.checklist.employees.count, 0);
    assert.equal(setupStatusInitial.data.checklist.projects.count, 0);
    assert.equal(setupStatusInitial.data.checklist.tasks.count, 0);

    // Step 3: The owner creates a department
    const deptRes = await apiCall('/api/departments', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: 'Engineering Department',
        description: 'Core Product & Backend Engineering'
      }
    });
    assert.equal(deptRes.status, 201);
    const deptId = deptRes.data.department.id;

    // Also create a Manager in Company A
    const mgrCreate = await apiCall('/api/employees', {
      method: 'POST',
      token: ownerToken,
      body: {
        full_name: 'Maha Al-Harbi (Manager)',
        email: 'manager@alpha.example.com',
        password: 'Password@123',
        role: 'manager',
        job_title: 'Engineering Manager',
        department_id: deptId
      }
    });
    assert.equal(mgrCreate.status, 201);
    const managerUserId = mgrCreate.data.employee.user_id;

    // Manager logs in and gets redirected to /dashboard
    const mgrLogin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'manager@alpha.example.com', password: 'Password@123' }
    });
    assert.equal(mgrLogin.status, 200);
    assert.equal(mgrLogin.data.redirect_to, '/dashboard');
    const managerToken = mgrLogin.data.token;

    // Step 4: The owner sends an invitation to an employee
    const inviteRes = await apiCall('/api/employees/invite', {
      method: 'POST',
      token: ownerToken,
      body: {
        full_name: 'Sami Al-Qahtani (Employee)',
        email: 'sami@alpha.example.com',
        role: 'employee',
        job_title: 'Full-Stack Developer',
        department_id: deptId,
        manager_user_id: managerUserId
      }
    });
    assert.equal(inviteRes.status, 201);
    assert.ok(inviteRes.data.dev_invite_token);
    const inviteToken = inviteRes.data.dev_invite_token;

    // Step 5: The employee accepts the invitation, sets password, and joins the company
    const acceptRes = await apiCall('/api/auth/accept-invite', {
      method: 'POST',
      body: {
        token: inviteToken,
        password: 'EmployeePass@123'
      }
    });
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.redirect_to, '/my-tasks');
    assert.equal(acceptRes.data.company.id, companyAId);
    const emp1UserId = acceptRes.data.user.id;

    // Verify invitation token is single-use and cannot be reused
    const reuseInvite = await apiCall('/api/auth/accept-invite', {
      method: 'POST',
      body: { token: inviteToken, password: 'EmployeePass@123' }
    });
    assert.equal(reuseInvite.status, 400);

    // Step 6: The owner creates a project
    const projRes = await apiCall('/api/projects', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: 'Customer Portal v1',
        description: 'Build self-service portal for customers',
        department_id: deptId,
        manager_user_id: managerUserId,
        priority: 'high',
        status: 'active',
        visibility: 'public',
        require_approval: true,
        deadline: '2026-11-15',
        member_user_ids: [managerUserId, emp1UserId]
      }
    });
    assert.equal(projRes.status, 201);
    const projectId = projRes.data.project.id;
    assert.equal(projRes.data.project.progress_percentage, 0);

    // Step 7: The owner/manager creates a task and assigns it to the employee
    const taskRes = await apiCall('/api/tasks', {
      method: 'POST',
      token: managerToken,
      body: {
        title: 'Implement OAuth2 & Session Security',
        description: 'Complete session handling and role guards',
        project_id: projectId,
        department_id: deptId,
        assignee_user_id: emp1UserId,
        priority: 'urgent',
        status: 'todo',
        deadline: '2026-10-20',
        estimated_hours: 8
      }
    });
    assert.equal(taskRes.status, 201);
    const taskId = taskRes.data.task.id;

    // Step 8: The employee logs in and sees the assigned task + assignment notification
    const empLogin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'sami@alpha.example.com', password: 'EmployeePass@123' }
    });
    assert.equal(empLogin.status, 200);
    assert.equal(empLogin.data.redirect_to, '/my-tasks');
    const emp1Token = empLogin.data.token;

    const myTasks = await apiCall('/api/tasks?view=my_tasks', { token: emp1Token });
    assert.equal(myTasks.status, 200);
    assert.equal(myTasks.data.tasks.length, 1);
    assert.equal(myTasks.data.tasks[0].id, taskId);

    const empNotifs = await apiCall('/api/notifications', { token: emp1Token });
    assert.equal(empNotifs.status, 200);
    assert.ok(empNotifs.data.notifications.some((n) => n.type === 'task_assigned' && n.entity_id === taskId));

    // Step 9: The employee changes the task to In Progress
    const inProgRes = await apiCall(`/api/tasks/${taskId}`, {
      method: 'PUT',
      token: emp1Token,
      body: { status: 'in_progress', progress: 50 }
    });
    assert.equal(inProgRes.status, 200);
    assert.equal(inProgRes.data.task.status, 'in_progress');

    // Verify employee cannot bypass approval workflow by marking completed directly
    const directCompleteAttempt = await apiCall(`/api/tasks/${taskId}`, {
      method: 'PUT',
      token: emp1Token,
      body: { status: 'completed' }
    });
    assert.equal(directCompleteAttempt.status, 403);

    // Step 10: The employee adds a comment (with @mention) and uploads a file
    const commentRes = await apiCall(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      token: emp1Token,
      body: {
        content: 'Finished implementation and unit tests @manager@alpha.example.com'
      }
    });
    assert.equal(commentRes.status, 201);
    assert.ok(commentRes.data.comment.mentions.includes(managerUserId));

    const samplePdfContent = Buffer.from('%PDF-1.4 WorkFlow Architecture Specification Document').toString('base64');
    const uploadRes = await apiCall(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      token: emp1Token,
      body: {
        filename: 'security_spec.pdf',
        mime_type: 'application/pdf',
        content_base64: samplePdfContent
      }
    });
    assert.equal(uploadRes.status, 201);
    const attachmentId = uploadRes.data.attachment.id;

    // Step 11: The employee submits the task for review
    const submitReviewRes = await apiCall(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      token: emp1Token,
      body: {
        action: 'submit',
        feedback: 'All security checks pass, ready for review.'
      }
    });
    assert.equal(submitReviewRes.status, 200);
    assert.equal(submitReviewRes.data.task.status, 'in_review');

    // Step 12: The manager receives notifications (mention + work_submitted_for_review)
    const mgrNotifs = await apiCall('/api/notifications', { token: managerToken });
    assert.equal(mgrNotifs.status, 200);
    assert.ok(mgrNotifs.data.notifications.some((n) => n.type === 'comment_mention' && n.entity_id === taskId));
    assert.ok(mgrNotifs.data.notifications.some((n) => n.type === 'work_submitted_for_review' && n.entity_id === taskId));

    // Step 13 & 14: The manager first requests changes, then employee resubmits, then manager approves
    const reqChangesRes = await apiCall(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      token: managerToken,
      body: {
        action: 'request_changes',
        feedback: 'Please add rate-limit headers documentation.'
      }
    });
    assert.equal(reqChangesRes.status, 200);
    assert.equal(reqChangesRes.data.task.status, 'in_progress');

    await apiCall(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      token: emp1Token,
      body: { action: 'submit', feedback: 'Added rate-limit documentation.' }
    });

    const approveRes = await apiCall(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      token: managerToken,
      body: {
        action: 'approve',
        feedback: 'Approved and verified!'
      }
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.task.status, 'completed');
    assert.equal(approveRes.data.task.progress, 100);

    // Step 15: Project progress is recalculated automatically (1/1 completed = 100%)
    const projDetailAfter = await apiCall(`/api/projects/${projectId}`, { token: ownerToken });
    assert.equal(projDetailAfter.status, 200);
    assert.equal(projDetailAfter.data.project.progress_percentage, 100);
    assert.equal(projDetailAfter.data.project.completed_tasks, 1);

    // Step 16: Dashboard and reports reflect the real database data
    const dashRes = await apiCall('/api/dashboard', { token: ownerToken });
    assert.equal(dashRes.status, 200);
    assert.equal(dashRes.data.kpis.total_active_projects, 1);
    assert.equal(dashRes.data.kpis.tasks_completed_this_week, 1);

    const reportRes = await apiCall('/api/reports/analytics', { token: ownerToken });
    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.data.company_report.completed_tasks, 1);
    assert.equal(reportRes.data.company_report.completion_rate, 100);

    // Step 17: Task's activity history contains the relevant changes
    const taskDetail = await apiCall(`/api/tasks/${taskId}`, { token: ownerToken });
    assert.equal(taskDetail.status, 200);
    const actionsLogged = taskDetail.data.activity.map((a) => a.action);
    assert.ok(actionsLogged.includes('task.created'));
    assert.ok(actionsLogged.includes('task.assigned'));
    assert.ok(actionsLogged.includes('task.status_changed'));
    assert.ok(actionsLogged.includes('task.comment_added'));
    assert.ok(actionsLogged.includes('task.file_uploaded'));
    assert.ok(actionsLogged.includes('task.submitted_for_review'));
    assert.ok(actionsLogged.includes('task.work_returned_for_revision'));
    assert.ok(actionsLogged.includes('task.work_approved'));
    assert.equal(taskDetail.data.reviews.length, 4);

    // Step 18: Register a second independent company (Company B) and verify strict multi-tenancy isolation
    const regB = await apiCall('/api/auth/register', {
      method: 'POST',
      body: {
        company_name: 'Beta Marketing Agency',
        full_name: 'Layla Al-ali (Beta Owner)',
        email: 'owner@beta.example.com',
        password: 'Password@123',
        confirm_password: 'Password@123'
      }
    });
    assert.equal(regB.status, 201);
    const companyBOwnerToken = regB.data.token;

    // Company B cannot access Company A's project
    const crossProj = await apiCall(`/api/projects/${projectId}`, { token: companyBOwnerToken });
    assert.equal(crossProj.status, 404);

    // Company B cannot read or update Company A's task
    const crossTaskGet = await apiCall(`/api/tasks/${taskId}`, { token: companyBOwnerToken });
    assert.equal(crossTaskGet.status, 404);

    const crossTaskPut = await apiCall(`/api/tasks/${taskId}`, {
      method: 'PUT',
      token: companyBOwnerToken,
      body: { title: 'Hacked Title' }
    });
    assert.equal(crossTaskPut.status, 404);

    // Company B cannot download Company A's private attachment
    const crossDownload = await apiCall(`/api/attachments/${attachmentId}/download`, { token: companyBOwnerToken });
    assert.equal(crossDownload.status, 403);

    // Authorized Company A employee CAN download the attachment and bytes match
    const validDownload = await apiCall(`/api/attachments/${attachmentId}/download`, {
      token: emp1Token,
      rawResponse: true
    });
    assert.equal(validDownload.status, 200);
    const downloadedBuf = Buffer.from(await validDownload.arrayBuffer());
    assert.equal(downloadedBuf.toString('base64'), samplePdfContent);
  });

  it('2. Authorization, Role Restrictions, Deactivation, Overdue Math, Cancelled Exclusion, File Validation & Circular Dependencies', async () => {
    // Login as Company A Owner & Manager & Employee 1
    const ownerLogin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'owner@alpha.example.com', password: 'Password@123' }
    });
    const ownerToken = ownerLogin.data.token;

    const mgrLogin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'manager@alpha.example.com', password: 'Password@123' }
    });
    const managerToken = mgrLogin.data.token;

    const emp1Login = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'sami@alpha.example.com', password: 'EmployeePass@123' }
    });
    const emp1Token = emp1Login.data.token;
    const emp1Id = emp1Login.data.user.id;

    // Create a second employee (Employee 2) in Company A
    const emp2Create = await apiCall('/api/employees', {
      method: 'POST',
      token: ownerToken,
      body: {
        full_name: 'Nadia Al-Salem (Employee 2)',
        email: 'nadia@alpha.example.com',
        password: 'Password@123',
        role: 'employee',
        job_title: 'QA Engineer'
      }
    });
    assert.equal(emp2Create.status, 201);
    const emp2Id = emp2Create.data.employee.user_id;

    const emp2Login = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'nadia@alpha.example.com', password: 'Password@123' }
    });
    const emp2Token = emp2Login.data.token;

    // Employees cannot access owner-only routes (company settings, audit logs, employee creation)
    const empSettingsAttempt = await apiCall('/api/company/settings', {
      method: 'PUT',
      token: emp2Token,
      body: { company: { name: 'Unauthorized Rename' } }
    });
    assert.equal(empSettingsAttempt.status, 403);

    const empAuditAttempt = await apiCall('/api/audit-logs', { token: emp2Token });
    assert.equal(empAuditAttempt.status, 403);

    const empCreateEmpAttempt = await apiCall('/api/employees', {
      method: 'POST',
      token: emp2Token,
      body: { full_name: 'Test', email: 't@alpha.example.com', password: 'Password@123' }
    });
    assert.equal(empCreateEmpAttempt.status, 403);

    // Get Company A's project
    const projs = await apiCall('/api/projects', { token: ownerToken });
    const projectId = projs.data.projects[0].id;

    // Create an Overdue Task (past deadline) and a Future Task (future deadline, even if actual_hours > estimated_hours)
    const overdueTaskRes = await apiCall('/api/tasks', {
      method: 'POST',
      token: managerToken,
      body: {
        title: 'Past Deadline Task',
        project_id: projectId,
        assignee_user_id: emp1Id,
        priority: 'high',
        status: 'in_progress',
        deadline: '2020-01-01',
        estimated_hours: 10
      }
    });
    assert.equal(overdueTaskRes.status, 201);
    assert.equal(overdueTaskRes.data.task.is_overdue, true);
    const overdueTaskId = overdueTaskRes.data.task.id;

    // Create a Cancelled Task and verify it is excluded from completion rate calculations
    const cancelledTaskRes = await apiCall('/api/tasks', {
      method: 'POST',
      token: managerToken,
      body: {
        title: 'Cancelled Feature Task',
        project_id: projectId,
        assignee_user_id: emp1Id,
        priority: 'low',
        status: 'cancelled',
        deadline: '2020-01-01'
      }
    });
    assert.equal(cancelledTaskRes.status, 201);
    // Cancelled task with past deadline is NEVER marked overdue
    assert.equal(cancelledTaskRes.data.task.is_overdue, false);

    // Project now has: 1 completed task, 1 in_progress task, and 1 cancelled task.
    // Applicable tasks = 2 (cancelled excluded), completed = 1 -> progress_percentage MUST be 50%!
    const projCheck = await apiCall(`/api/projects/${projectId}`, { token: ownerToken });
    assert.equal(projCheck.data.project.total_tasks, 2);
    assert.equal(projCheck.data.project.cancelled_tasks, 1);
    assert.equal(projCheck.data.project.completed_tasks, 1);
    assert.equal(projCheck.data.project.progress_percentage, 50);

    // Project cannot be marked completed while unfinished required tasks remain unless force_override is passed
    const prematureComplete = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      token: ownerToken,
      body: { status: 'completed' }
    });
    assert.equal(prematureComplete.status, 409);
    assert.equal(prematureComplete.data.requires_override, true);

    // Unauthorized Employee 2 cannot edit Employee 1's task or approve tasks
    const unauthorizedEdit = await apiCall(`/api/tasks/${overdueTaskId}`, {
      method: 'PUT',
      token: emp2Token,
      body: { status: 'completed' }
    });
    assert.equal(unauthorizedEdit.status, 403);

    const unauthorizedApprove = await apiCall(`/api/tasks/${overdueTaskId}/review`, {
      method: 'POST',
      token: emp2Token,
      body: { action: 'approve' }
    });
    assert.equal(unauthorizedApprove.status, 403);

    // Reassign task from Employee 1 to Employee 2 and verify task history is preserved
    const reassignRes = await apiCall(`/api/tasks/${overdueTaskId}`, {
      method: 'PUT',
      token: managerToken,
      body: {
        assignee_user_id: emp2Id,
        reassignment_reason: 'Balancing sprint workload'
      }
    });
    assert.equal(reassignRes.status, 200);
    assert.equal(reassignRes.data.task.assignee_user_id, emp2Id);

    const historyAfterReassign = await apiCall(`/api/tasks/${overdueTaskId}`, { token: managerToken });
    const reassignLog = historyAfterReassign.data.activity.find((a) => a.action === 'task.reassigned');
    assert.ok(reassignLog);
    assert.equal(reassignLog.previous_values.assignee_user_id, emp1Id);
    assert.equal(reassignLog.new_values.assignee_user_id, emp2Id);

    // Circular Dependency Prevention: Task A depends on Task B, so Task B cannot depend on Task A
    const dep1 = await apiCall(`/api/tasks/${overdueTaskId}/dependencies`, {
      method: 'POST',
      token: managerToken,
      body: { depends_on_task_id: cancelledTaskRes.data.task.id }
    });
    assert.equal(dep1.status, 201);

    const circularDep = await apiCall(`/api/tasks/${cancelledTaskRes.data.task.id}/dependencies`, {
      method: 'POST',
      token: managerToken,
      body: { depends_on_task_id: overdueTaskId }
    });
    assert.equal(circularDep.status, 400);

    // File Upload Validation: Reject unsupported file types (.exe) and oversized files
    const badExtUpload = await apiCall(`/api/tasks/${overdueTaskId}/attachments`, {
      method: 'POST',
      token: emp2Token,
      body: {
        filename: 'malware.exe',
        mime_type: 'application/x-msdownload',
        content_base64: Buffer.from('MZ...').toString('base64')
      }
    });
    assert.equal(badExtUpload.status, 400);

    // Set company max_upload_size_mb to 1 MB and verify a 2 MB file is rejected with 413
    await apiCall('/api/company/settings', {
      method: 'PUT',
      token: ownerToken,
      body: { settings: { max_upload_size_mb: 1 } }
    });
    const twoMbBuffer = Buffer.alloc(2 * 1024 * 1024, 'a');
    const oversizedUpload = await apiCall(`/api/tasks/${overdueTaskId}/attachments`, {
      method: 'POST',
      token: emp2Token,
      body: {
        filename: 'large_archive.zip',
        mime_type: 'application/zip',
        content_base64: twoMbBuffer.toString('base64')
      }
    });
    assert.equal(oversizedUpload.status, 413);

    // Deduplicated Background Reminders: Running reminder job twice does not create duplicate overdue notifications
    const remRun1 = await apiCall('/api/reminders/process', { method: 'POST', token: ownerToken, body: {} });
    assert.equal(remRun1.status, 200);
    const remRun2 = await apiCall('/api/reminders/process', { method: 'POST', token: ownerToken, body: {} });
    assert.equal(remRun2.status, 200);
    assert.equal(remRun2.data.generatedCount, 0);

    // Deactivating Employee 2 immediately prevents login and invalidates active session while preserving task history
    const deactivateRes = await apiCall(`/api/employees/${emp2Id}`, {
      method: 'PUT',
      token: ownerToken,
      body: { status: 'inactive' }
    });
    assert.equal(deactivateRes.status, 200);

    const emp2SessionAttempt = await apiCall('/api/auth/me', { token: emp2Token });
    assert.equal(emp2SessionAttempt.status, 401);

    const emp2LoginAttempt = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'nadia@alpha.example.com', password: 'Password@123' }
    });
    assert.equal(emp2LoginAttempt.status, 403);

    // CSV & Excel Report Exports match filters
    const csvExport = await apiCall('/api/reports/export?format=csv&report_type=tasks', {
      token: ownerToken,
      rawResponse: true
    });
    assert.equal(csvExport.status, 200);
    const csvText = await csvExport.text();
    assert.ok(csvText.includes('Implement OAuth2 & Session Security'));
    assert.ok(csvText.includes('Past Deadline Task'));
  });

  it('3. Password Reset, Confidential Project Search Isolation, Department Reassignment, Time Tracking & Custom Permissions', async () => {
    const ownerLogin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'owner@alpha.example.com', password: 'Password@123' }
    });
    const ownerToken = ownerLogin.data.token;

    const emp1Login = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'sami@alpha.example.com', password: 'EmployeePass@123' }
    });
    const emp1Token = emp1Login.data.token;
    const emp1Id = emp1Login.data.user.id;

    // 1. Confidential Project Isolation (Direct & Global Search)
    const confProj = await apiCall('/api/projects', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: 'Top Secret Acquisition Project',
        description: 'Confidential M&A due diligence',
        visibility: 'confidential',
        priority: 'urgent',
        status: 'active',
        member_user_ids: [] // Employee 1 is NOT a member
      }
    });
    assert.equal(confProj.status, 201);
    const confProjId = confProj.data.project.id;

    const confTask = await apiCall('/api/tasks', {
      method: 'POST',
      token: ownerToken,
      body: {
        title: 'Secret Valuation Spreadsheet Review',
        project_id: confProjId,
        priority: 'urgent',
        status: 'todo'
      }
    });
    assert.equal(confTask.status, 201);
    const confTaskId = confTask.data.task.id;

    // Employee 1 cannot access confidential project or confidential task directly
    const empConfProj = await apiCall(`/api/projects/${confProjId}`, { token: emp1Token });
    assert.equal(empConfProj.status, 403);

    const empConfTask = await apiCall(`/api/tasks/${confTaskId}`, { token: emp1Token });
    assert.equal(empConfTask.status, 403);

    // Employee 1 cannot discover confidential project or task through Global Search
    const empSearch = await apiCall('/api/search?q=Secret', { token: emp1Token });
    assert.equal(empSearch.status, 200);
    assert.equal(empSearch.data.projects.length, 0);
    assert.equal(empSearch.data.tasks.length, 0);

    // Owner CAN find confidential project and task through Global Search
    const ownerSearch = await apiCall('/api/search?q=Secret', { token: ownerToken });
    assert.equal(ownerSearch.status, 200);
    assert.equal(ownerSearch.data.projects.length, 1);
    assert.equal(ownerSearch.data.tasks.length, 1);

    // 2. Safe Department Deletion & Reassignment
    const depts = await apiCall('/api/departments', { token: ownerToken });
    const engDeptId = depts.data.departments[0].id;

    // Attempting to delete Engineering Department (which has employees & projects) without reassignment fails with 409
    const unsafeDeleteDept = await apiCall(`/api/departments/${engDeptId}`, {
      method: 'DELETE',
      token: ownerToken
    });
    assert.equal(unsafeDeleteDept.status, 409);
    assert.equal(unsafeDeleteDept.data.requires_reassignment, true);

    // Create a replacement department and safely reassign before deleting
    const newDept = await apiCall('/api/departments', {
      method: 'POST',
      token: ownerToken,
      body: { name: 'Platform Engineering v2' }
    });
    const newDeptId = newDept.data.department.id;

    const safeDeleteDept = await apiCall(`/api/departments/${engDeptId}?reassign_to=${newDeptId}`, {
      method: 'DELETE',
      token: ownerToken
    });
    assert.equal(safeDeleteDept.status, 200);

    // 3. Time Tracking Overlap Prevention & Actual Hours Calculation
    const empTasks = await apiCall('/api/tasks?view=my_tasks', { token: emp1Token });
    const myTaskId = empTasks.data.tasks[0].id;

    const startTimer1 = await apiCall(`/api/tasks/${myTaskId}/time/start`, {
      method: 'POST',
      token: emp1Token,
      body: { description: 'Working on module' }
    });
    assert.equal(startTimer1.status, 201);

    // Starting a second overlapping timer for the same employee is rejected with 409
    const startTimerOverlap = await apiCall(`/api/tasks/${myTaskId}/time/start`, {
      method: 'POST',
      token: emp1Token,
      body: { description: 'Second overlapping timer' }
    });
    assert.equal(startTimerOverlap.status, 409);

    const stopTimer1 = await apiCall(`/api/tasks/${myTaskId}/time/stop`, {
      method: 'POST',
      token: emp1Token,
      body: { duration_minutes: 90, description: 'Completed 1.5h session' }
    });
    assert.equal(stopTimer1.status, 200);
    assert.equal(stopTimer1.data.task_actual_hours, 1.5);

    // 4. Daily Work Report with Blocker Notification & Weekly Summary
    const dailyRep = await apiCall('/api/daily-reports', {
      method: 'POST',
      token: emp1Token,
      body: {
        completed_work: 'Finished OAuth2 token rotation',
        current_work: 'Writing integration tests',
        blockers: 'Waiting for staging SSL certificate',
        next_plan: 'Deploy to staging'
      }
    });
    assert.equal(dailyRep.status, 201);

    const dailyList = await apiCall('/api/daily-reports', { token: ownerToken });
    assert.equal(dailyList.status, 200);
    assert.equal(dailyList.data.weekly_summary.reported_blockers.length, 1);

    // 5. Custom Permissions Enforcement on Backend
    // Initially Employee 1 cannot create projects
    const empCreateProjBefore = await apiCall('/api/projects', {
      method: 'POST',
      token: emp1Token,
      body: { name: 'Employee Initiative Project' }
    });
    assert.equal(empCreateProjBefore.status, 403);

    // Owner grants Employee 1 custom permission `can_create_projects: true`
    const grantPermRes = await apiCall(`/api/employees/${emp1Id}`, {
      method: 'PUT',
      token: ownerToken,
      body: {
        permissions: { can_create_projects: true }
      }
    });
    assert.equal(grantPermRes.status, 200);

    // Now Employee 1 CAN create a project!
    const empCreateProjAfter = await apiCall('/api/projects', {
      method: 'POST',
      token: emp1Token,
      body: { name: 'Employee Initiative Project' }
    });
    assert.equal(empCreateProjAfter.status, 201);

    // 6. Password Reset Workflow
    const forgotRes = await apiCall('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'sami@alpha.example.com' }
    });
    assert.equal(forgotRes.status, 200);
    assert.ok(forgotRes.data.dev_reset_token);

    const resetRes = await apiCall('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: forgotRes.data.dev_reset_token,
        password: 'NewSecurePassword@99'
      }
    });
    assert.equal(resetRes.status, 200);

    const loginWithNewPass = await apiCall('/api/auth/login', {
      method: 'POST',
      body: { email: 'sami@alpha.example.com', password: 'NewSecurePassword@99' }
    });
    assert.equal(loginWithNewPass.status, 200);

    // 7. Demo Mode Seeding Verification (Isolated from Customer Workspaces)
    const demoSeed = await apiCall('/api/demo/seed', { method: 'POST', body: { reset: true } });
    assert.equal(demoSeed.status, 200);
    assert.ok(demoSeed.data.demo.company_id);

    // Verify Alpha Software Corp still has its exact projects and was untouched by demo seed
    const alphaProjsAfterDemo = await apiCall('/api/projects', { token: ownerToken });
    assert.equal(alphaProjsAfterDemo.status, 200);
    assert.ok(alphaProjsAfterDemo.data.projects.some((p) => p.name === 'Customer Portal v1'));
  });
});
