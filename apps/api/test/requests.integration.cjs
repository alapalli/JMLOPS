// Run only against a disposable database after building the workspace packages.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const { prisma } = require('@jml-ops/db');
let parsedIntent;
let failQueue = false;
const queued = [];
for (const [file, exports] of [
  ['../dist/queue', { enqueueJmlJob: async job => { if (failQueue) throw new Error('offline'); queued.push(job); } }],
  ['../dist/litellm-client', { parsePromptToIntent: async () => ({ success: true, intent: parsedIntent }) }],
]) { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports }; }
const { changeRequestRoutes } = require('../dist/routes/requests');
const { selfServiceRoutes } = require('../dist/routes/self-service');
const { assetRoutes } = require('../dist/routes/assets');
const { jmlRoutes } = require('../dist/routes/jml');
const app = Fastify();
const accounts = {};
app.addHook('onRequest', async (req, reply) => {
  const user = accounts[req.headers['x-test-user']];
  if (!user) return reply.code(401).send({ error: 'Unauthenticated' });
  req.user = { userId: user.id, companyId: user.companyId, role: user.role };
});
app.register(changeRequestRoutes); app.register(selfServiceRoutes); app.register(assetRoutes); app.register(jmlRoutes);
const call = (who, method, url, payload) => app.inject({ method, url, headers: { 'x-test-user': who }, ...(payload === undefined ? {} : { payload }) });
after(async () => { await app.close(); await prisma.$disconnect(); });
test('approval and asset boundaries with a real database', async t => {
  assert.match(process.env.DATABASE_URL, /jmlops_test/, 'Use an isolated test database');
  const company = await prisma.company.create({ data: { name: 'Test', domain: randomUUID(), slug: randomUUID() } });
  const other = await prisma.company.create({ data: { name: 'Other', domain: randomUUID(), slug: randomUUID() } });
  const employee = await prisma.employee.create({ data: { companyId: company.id, name: 'Employee', firstName: 'Test', lastName: 'Person', email: 'employee@example.test' } });
  const foreign = await prisma.employee.create({ data: { companyId: other.id, name: 'Other', firstName: 'Other', lastName: 'Person', email: 'other@example.test' } });
  for (const [name, role, companyId, employeeId] of [['staff', 'VIEWER', company.id, employee.id], ['admin', 'ADMIN', company.id, null], ['other', 'ADMIN', other.id, null], ['unlinked', 'VIEWER', company.id, null]]) {
    accounts[name] = await prisma.user.create({ data: { name, role, companyId, employeeId, email: `${name}@example.test`, authProvider: 'MICROSOFT', providerAccountId: randomUUID() } });
  }
  parsedIntent = { eventType: 'MOVER', employeeEmail: employee.email, confidence: 0.95, mover: { groupsToAdd: ['test'], groupsToRemove: [] }, ambiguousFields: [] };
  const submit = async () => { const r = await call('staff', 'POST', '/api/self-service/request', { requestType: 'ACCESS_REQUEST', details: 'Give me test group access' }); assert.equal(r.statusCode, 201, r.body); return r.json().id; };
  await t.test('authentication and role checks', async () => {
    assert.equal((await call('unknown', 'GET', '/api/requests')).statusCode, 401);
    assert.equal((await call('staff', 'POST', '/api/jml/submit', { prompt: 'offboard somebody else' })).statusCode, 403);
    assert.equal((await call('staff', 'POST', '/api/requests', { prompt: 'change somebody' })).statusCode, 403);
    assert.equal((await call('staff', 'GET', '/api/assets')).statusCode, 403);
    assert.equal((await call('unlinked', 'POST', '/api/self-service/request', { requestType: 'ACCESS_REQUEST', details: 'access' })).statusCode, 403);
    assert.equal((await call('staff', 'POST', '/api/self-service/request', { requestType: 'ACCESS_REQUEST', details: 42 })).statusCode, 400);
  });
  await t.test('tenant-scoped employee links and asset assignment', async () => {
    assert.equal((await call('admin', 'POST', `/api/request-users/${accounts.staff.id}/employee`, { employeeId: foreign.id })).statusCode, 404);
    assert.equal((await call('admin', 'POST', '/api/assets', { type: 'LAPTOP', label: 'Laptop', employeeId: foreign.id })).statusCode, 404);
    assert.equal((await call('admin', 'POST', '/api/assets', { type: 'LAPTOP', label: 'Laptop', employeeId: employee.id })).statusCode, 201);
    assert.equal((await call('admin', 'POST', '/api/assets', { type: 'LAPTOP', label: 'Spare' })).json().status, 'AVAILABLE');
    assert.equal((await call('other', 'GET', '/api/assets')).json().length, 0);
    const rows = (await call('admin', 'GET', '/api/assets')).json();
    const assigned = rows.find(a => a.status === 'ASSIGNED');
    assert.equal((await call('other', 'POST', `/api/assets/${assigned.id}/return`)).statusCode, 404);
    assert.equal((await call('admin', 'POST', `/api/assets/${assigned.id}/return`)).json().status, 'RETURNED');
    await assert.rejects(prisma.asset.create({ data: { companyId: company.id, employeeId: foreign.id, type: 'LAPTOP', label: 'Invalid cross-tenant' } }));
  });
  await t.test('only owner sees self-service history; other tenant cannot review', async () => {
    const id = await submit();
    assert.equal((await call('unlinked', 'GET', '/api/self-service/requests')).json().length, 0);
    assert.equal((await call('other', 'POST', `/api/requests/${id}/approve`)).statusCode, 404);
    assert.equal((await call('staff', 'POST', `/api/requests/${id}/approve`)).statusCode, 403);
  });
  await t.test('self approval and repeated rejection are denied', async () => {
    const created = await call('admin', 'POST', '/api/requests', { prompt: 'Move person to test team' });
    assert.equal((await call('admin', 'POST', `/api/requests/${created.json().id}/approve`)).statusCode, 409);
    const id = await submit();
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/reject`, { note: 'Not needed' })).statusCode, 200);
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/approve`)).statusCode, 409);
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/reject`, {})).statusCode, 409);
  });
  await t.test('parsed target and action cannot escape the self-service scope', async () => {
    const id = await submit();
    const valid = parsedIntent;
    parsedIntent = { ...valid, employeeEmail: foreign.email };
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/approve`)).statusCode, 422);
    parsedIntent = { ...valid, eventType: 'LEAVER' };
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/approve`)).statusCode, 422);
    parsedIntent = { ...valid, confidence: 0.2 };
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/approve`)).statusCode, 422);
    parsedIntent = valid;
    assert.equal((await prisma.changeRequest.findUnique({ where: { id } })).status, 'PENDING');
  });
  await t.test('concurrent approvals create and enqueue exactly one job', async () => {
    const id = await submit(); const before = queued.length;
    const results = await Promise.all([call('admin', 'POST', `/api/requests/${id}/approve`), call('admin', 'POST', `/api/requests/${id}/approve`)]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal(queued.length - before, 1);
    const row = await prisma.changeRequest.findUnique({ where: { id } });
    assert.equal(row.status, 'APPROVED'); assert.ok(row.resultingJobId);
    assert.equal(queued.at(-1).jobId, row.resultingJobId);
  });
  await t.test('queue failure remains visible and cannot double-approve', async () => {
    const id = await submit(); failQueue = true;
    const response = await call('admin', 'POST', `/api/requests/${id}/approve`);
    assert.equal(response.statusCode, 503);
    const job = await prisma.provisioningJob.findUnique({ where: { id: response.json().resultingJobId } });
    assert.equal(job.status, 'FAILED');
    assert.equal((await call('admin', 'POST', `/api/requests/${id}/approve`)).statusCode, 409);
    failQueue = false;
  });
});
