require('dotenv').config();

const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const FRONTEND_PATH = path.join(FRONTEND_DIR, 'index.html');
const DEFAULT_CATEGORIES = [
    { id: 'work', n: 'Work', c: 0, i: 'briefcase' },
    { id: 'personal', n: 'Personal', c: 1, i: 'user' },
    { id: 'study', n: 'Study', c: 2, i: 'book' },
    { id: 'projects', n: 'Projects', c: 5, i: 'rocket' },
    { id: 'health', n: 'Health', c: 4, i: 'heart' },
];
const emptyData = (name) => ({
    tasks: [],
    cats: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    mail: [],
    theme: 'light',
    name,
});

function createApp({ storePath = process.env.TASKLY_DATA_FILE || path.join(__dirname, 'data', 'store.json') } = {}) {
    if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET must be set in production.');
    }

    const app = express();
    const store = { users: [], invitations: [] };
    let loaded = false;
    let writeQueue = Promise.resolve();
    const sessionSecret = process.env.SESSION_SECRET || 'taskly-local-development-secret-change-me';

    async function loadStore() {
        if (loaded) return;
        try {
            const contents = await fs.readFile(storePath, 'utf8');
            const saved = JSON.parse(contents);
            store.users = Array.isArray(saved.users) ? saved.users : [];
            store.invitations = Array.isArray(saved.invitations) ? saved.invitations : [];
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await fs.mkdir(path.dirname(storePath), { recursive: true });
            await persistStore();
        }
        loaded = true;
    }

    function persistStore() {
        const snapshot = JSON.stringify(store, null, 2);
        writeQueue = writeQueue.then(async () => {
            await fs.mkdir(path.dirname(storePath), { recursive: true });
            const tempPath = `${storePath}.tmp`;
            await fs.writeFile(tempPath, snapshot, 'utf8');
            await fs.rename(tempPath, storePath);
        });
        return writeQueue;
    }

    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieSession({
        name: 'taskly_session',
        keys: [sessionSecret],
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    }));
    app.use(async (req, res, next) => {
        try {
            await loadStore();
            next();
        } catch (error) {
            next(error);
        }
    });

    const currentUser = (req) => store.users.find((user) => user.id === req.session?.userId);
    const requireUser = (req, res, next) => {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ error: 'Please log in to continue.' });
        req.user = user;
        next();
    };
    const publicUser = ({ id, email, name }) => ({ id, email, name });
    const accountResponse = (user) => ({ user: publicUser(user), data: user.data });
    const validEmail = (email) => typeof email === 'string' && /^\S+@\S+\.\S+$/.test(email);

    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    app.get('/', (req, res) => res.sendFile(FRONTEND_PATH));
    app.get('/style.css', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'style.css')));
    app.get('/app.js', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'app.js')));

    app.post('/api/auth/register', async (req, res, next) => {
        try {
            const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const password = req.body?.password;
            if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter a name between 2 and 80 characters.', field: 'name' });
            if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.', field: 'email' });
            if (typeof password !== 'string' || password.length === 0 || password.length > 200) return res.status(400).json({ error: 'Enter a password of 1 to 200 characters.', field: 'pw' });
            if (store.users.some((user) => user.email === email)) return res.status(409).json({ error: 'An account with this email already exists.', field: 'email' });

            const user = {
                id: randomUUID(),
                email,
                name,
                passwordHash: await bcrypt.hash(password, 12),
                data: emptyData(name),
            };
            store.users.push(user);
            await persistStore();
            req.session = { userId: user.id };
            if (req.body.remember) req.sessionOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
            res.status(201).json(accountResponse(user));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/auth/login', async (req, res, next) => {
        try {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const password = req.body?.password;
            const user = store.users.find((item) => item.email === email);
            if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
                return res.status(401).json({ error: 'Incorrect email or password.', field: 'pw' });
            }
            req.session = { userId: user.id };
            if (req.body.remember) req.sessionOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
            res.json(accountResponse(user));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/auth/logout', (req, res) => {
        req.session = null;
        res.status(204).end();
    });

    app.get('/api/auth/me', requireUser, (req, res) => res.json(accountResponse(req.user)));

    app.get('/api/data', requireUser, (req, res) => res.json(req.user.data));
    app.put('/api/data', requireUser, async (req, res, next) => {
        try {
            const { tasks, cats, mail, theme, name } = req.body || {};
            if (!Array.isArray(tasks) || !Array.isArray(cats) || !Array.isArray(mail)) {
                return res.status(400).json({ error: 'Tasks, categories, and mail must be arrays.' });
            }
            if (tasks.length > 1000 || cats.length > 100 || mail.length > 1000) {
                return res.status(413).json({ error: 'The submitted data exceeds the allowed limit.' });
            }
            const cleanName = typeof name === 'string' ? name.trim() : req.user.name;
            if (cleanName.length < 2 || cleanName.length > 80) return res.status(400).json({ error: 'Enter a name between 2 and 80 characters.', field: 'name' });
            if (theme !== 'light' && theme !== 'dark') return res.status(400).json({ error: 'Theme must be light or dark.' });

            req.user.data = { tasks, cats, mail, theme, name: cleanName };
            req.user.name = cleanName;
            await persistStore();
            res.json(req.user.data);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/invitations', requireUser, async (req, res, next) => {
        try {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
            if (email === req.user.email) return res.status(400).json({ error: 'You cannot invite yourself.' });
            const invitation = {
                id: randomUUID(),
                email,
                invitedBy: req.user.id,
                createdAt: new Date().toISOString(),
            };
            store.invitations.push(invitation);
            await persistStore();
            res.status(201).json({ invitation, message: 'Invitation recorded. Email delivery is not configured.' });
        } catch (error) {
            next(error);
        }
    });

    app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use((error, req, res, next) => {
        console.error(error);
        if (res.headersSent) return next(error);
        res.status(500).json({ error: 'An unexpected server error occurred.' });
    });

    return app;
}

if (require.main === module) {
    const app = createApp();
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, () => console.log(`Taskly API listening at http://localhost:${port}`));
}

module.exports = { createApp };
