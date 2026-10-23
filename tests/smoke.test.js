const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

// Harness smoke test. It proves the wiring before any real case is written:
//   - node --env-file=.env.test loaded the test config (no dotenvx in tests)
//   - the app talks to messaging_app_db_test (health does a real SELECT 1)
//   - supertest drives the express app without listening on a port
// Delete nothing here; these two assertions stay valuable forever.

test('GET /api/health -> 200 with a live database', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.checks.database, 'ok');
});

test('unknown route -> 404 in the same JSON error shape', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Route not found: GET /api/definitely-not-a-route' });
});
