const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp } = require('./server');

test('registration, authenticated data persistence, and logout', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskly-api-'));
    const server = createApp({ storePath: path.join(directory, 'store.json') }).listen(0);
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    });
    await new Promise((resolve) => server.once('listening', resolve));

    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    const request = async (route, options = {}) => {
        const response = await fetch(`${base}${route}`, {
            ...options,
            headers: {
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...(cookie ? { cookie } : {}),
                ...options.headers,
            },
        });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
        return response;
    };

    const page = await request('/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /href="style\.css"/);
    assert.match(html, /src="app\.js"/);
    assert.equal((await request('/style.css')).status, 200);
    assert.equal((await request('/app.js')).status, 200);

    const created = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alex Morgan', email: 'alex@example.com', password: 'p@ss', remember: true }),
    });
    assert.equal(created.status, 201);
    const account = await created.json();
    assert.equal(account.data.tasks.length, 0);

    const saved = await request('/api/data', {
        method: 'PUT',
        body: JSON.stringify({ ...account.data, tasks: [{ id: 't1', t: 'Write tests' }] }),
    });
    assert.equal(saved.status, 200);

    const me = await request('/api/auth/me');
    assert.equal((await me.json()).data.tasks[0].t, 'Write tests');

    const logout = await request('/api/auth/logout', { method: 'POST' });
    assert.equal(logout.status, 204);
    assert.equal((await request('/api/data')).status, 401);

    const login = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'alex@example.com', password: 'p@ss' }),
    });
    assert.equal(login.status, 200);

    const stored = JSON.parse(await fs.readFile(path.join(directory, 'store.json'), 'utf8'));
    assert.equal(stored.users[0].passwordHash.includes('correct-horse'), false);
    assert.equal(stored.users[0].data.tasks[0].t, 'Write tests');
});
