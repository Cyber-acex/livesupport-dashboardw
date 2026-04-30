// server.js
const fetch = require("node-fetch");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { db } = require("./db/database");
const { getMistralReply, initDatabase, setDisableAICallback, setHandoffCallback, isTicketCreationRequest, isRequestingStaff } = require("./replies");
const app = express();

const upload = multer({ dest: path.join(__dirname, "uploads") });

// Initialize database connection for replies module
initDatabase(db);

// AI Response Control System
// Track when agents last sent messages per conversation
const agentActivity = new Map(); // conversation_id -> { lastMessage: timestamp, aiDisabled: boolean, timer: timeoutId }
// Track timers for snoozed escalations: conversation_id -> timeoutId
const escalationTimers = new Map();
// Track presence and typing
const onlineAgents = new Map(); // socketId -> { userId, name, role, socketId, lastActive, activeConversation }
const typingIndicators = new Map(); // conversationId -> Set of agent names
// Track user sessions to support force-logout
const userSessions = new Map(); // userId -> Set of sessionIDs

// Disable AI responses for 15 minutes after agent sends a message or after an AI handoff
function disableAIForConversation(conversationId, source = 'agent') {
    // Ensure conversation_id is a number for consistent Map lookups
    const id = Number(conversationId);
    const now = Date.now();
    const fifteenMinutes = 15 * 60 * 1000;

    // Clear any existing timer
    if (agentActivity.has(id)) {
        const existing = agentActivity.get(id);
        if (existing.timer) {
            clearTimeout(existing.timer);
        }
    }

    // Set AI as disabled and start timer
    agentActivity.set(id, {
        lastMessage: now,
        aiDisabled: true,
        source,
        timer: setTimeout(() => {
            // Re-enable AI after 15 minutes
            const data = agentActivity.get(id);
            if (data) {
                data.aiDisabled = false;
                data.timer = null;
                console.log(`✅ AI responses re-enabled for conversation ${id} after 15 minutes`);
            }
        }, fifteenMinutes)
    });

    console.log(`🚫 AI responses DISABLED for conversation ${id} for 15 minutes`, {
        conversationId: id,
        timestamp: new Date().toISOString(),
        mapSize: agentActivity.size
    });
}

// Set the callback for disabling AI in replies module
setDisableAICallback((conversationId) => {
    disableAIForConversation(conversationId, 'handoff');
});

// Check if AI should respond to a conversation
function shouldAIRespond(conversationId) {
    // Ensure conversation_id is a number for consistent Map lookups
    const id = Number(conversationId);
    const data = agentActivity.get(id);
    const should = !data || !data.aiDisabled;
    console.log(`shouldAIRespond check for conversation ${id}:`, {
        originalId: conversationId,
        numericId: id,
        hasData: !!data,
        aiDisabled: data?.aiDisabled,
        shouldRespond: should,
        mapSize: agentActivity.size,
        mapKeys: Array.from(agentActivity.keys())
    });
    return should;
}

function isCustomerGreeting(text) {
    if (!text) return false;
    const normalized = text.toLowerCase().trim();
    const greetings = [
        'hey',
        'hello',
        'hi',
        'hiya',
        'yo',
        'good morning',
        'good afternoon',
        'good evening',
        'what\'s up',
        'sup'
    ];
    return greetings.some(greeting =>
        normalized === greeting ||
        normalized.startsWith(greeting + ' ') ||
        normalized.endsWith(' ' + greeting) ||
        normalized.includes(' ' + greeting + ' ') ||
        normalized === greeting + '!' ||
        normalized === greeting + '.'
    );
}

function enableAIForConversation(conversationId) {
    const id = Number(conversationId);
    const existing = agentActivity.get(id);

    if (existing) {
        if (existing.timer) {
            clearTimeout(existing.timer);
        }
        existing.aiDisabled = false;
        existing.timer = null;
        agentActivity.set(id, existing);
    } else {
        agentActivity.set(id, { lastMessage: Date.now(), aiDisabled: false, timer: null, source: 'agent' });
    }

    console.log(`✅ AI responses re-enabled immediately for conversation ${id} after customer greeting`);
}

function isStaffIdleForThreeMinutes(conversationId) {
    const id = Number(conversationId);
    const data = agentActivity.get(id);
    if (!data || !data.aiDisabled || data.source !== 'agent') {
        return false;
    }

    const threeMinutes = 3 * 60 * 1000;
    return (Date.now() - data.lastMessage) >= threeMinutes;
}

// Create conversations table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(255),
        name VARCHAR(255),
        platform VARCHAR(50) DEFAULT 'whatsapp',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.log("Error creating conversations table:", err);
    } else {
        db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'whatsapp'`, (alterErr) => {
            if (alterErr) console.log("Error adding platform column to conversations:", alterErr);
        });
    }
});

// Create resolved table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS resolved (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        resolved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating resolved table:", err);
});

// Create escalations table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS escalations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT UNIQUE,
        customer_name VARCHAR(255),
        escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating escalations table:", err);
});

// Add extra escalation columns if missing
db.query("ALTER TABLE escalations ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(255) NULL", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding claimed_by to escalations:", err);
});
db.query("ALTER TABLE escalations ADD COLUMN IF NOT EXISTS claim_time TIMESTAMP NULL", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding claim_time to escalations:", err);
});
db.query("ALTER TABLE escalations ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP NULL", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding snoozed_until to escalations:", err);
});
db.query("ALTER TABLE escalations ADD COLUMN IF NOT EXISTS alarm_active TINYINT(1) DEFAULT 1", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding alarm_active to escalations:", err);
});

// Create refunds table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        customer_name VARCHAR(255),
        refunded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating refunds table:", err);
});

db.query("ALTER TABLE refunds ADD INDEX idx_refunds_conversation_id (conversation_id)", (err) => {
    if (err && err.errno !== 1061) {
        console.log("Error adding refunds conversation_id index:", err);
    }
    db.query("ALTER TABLE refunds DROP INDEX conversation_id", (dropErr) => {
        if (dropErr && dropErr.errno !== 1091) {
            console.log("Error dropping refunds unique index:", dropErr);
        }
    });
});

// Create delivery issues table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS delivery_issues (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        customer_name VARCHAR(255),
        reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating delivery_issues table:", err);
});

// Ensure users table has a disabled column (some installations may omit it)
db.query("ALTER TABLE users ADD COLUMN disabled TINYINT(1) DEFAULT 0", (err) => {
    if (err && err.errno !== 1060) {
        console.log("Error adding disabled to users:", err);
    }
});

db.query("ALTER TABLE delivery_issues ADD INDEX idx_delivery_issues_conversation_id (conversation_id)", (err) => {
    if (err && err.errno !== 1061) {
        console.log("Error adding delivery_issues conversation_id index:", err);
    }
    db.query("ALTER TABLE delivery_issues DROP INDEX conversation_id", (dropErr) => {
        if (dropErr && dropErr.errno !== 1091) {
            console.log("Error dropping delivery_issues unique index:", dropErr);
        }
    });
});

// Create whatsapp token storage table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token TEXT,
        expires_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.log("Error creating whatsapp_tokens table:", err);
});

// Create instagram token storage table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS instagram_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token TEXT,
        expires_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`, (err) => {
    if (err) console.log('Error creating instagram_tokens table:', err);
});

function storeInstagramToken(token, expiresInSeconds = null) {
    const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;
    db.query(
        "INSERT INTO instagram_tokens (token, expires_at) VALUES (?, ?)",
        [token, expiresAt],
        (err) => {
            if (err) console.error('Error storing Instagram token:', err);
        }
    );
}

function storeWhatsAppToken(token, expiresInSeconds = null) {
    const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;
    db.query(
        "INSERT INTO whatsapp_tokens (token, expires_at) VALUES (?, ?)",
        [token, expiresAt],
        (err) => {
            if (err) console.error("Error storing WhatsApp token:", err);
        }
    );
}

function getStoredWhatsAppToken() {
    return new Promise((resolve, reject) => {
        db.query(
            "SELECT token, expires_at FROM whatsapp_tokens ORDER BY created_at DESC LIMIT 1",
            (err, results) => {
                if (err) return reject(err);
                if (!results || results.length === 0) return resolve(null);
                resolve(results[0]);
            }
        );
    });
}

async function getWhatsAppToken() {
    if (process.env.WHATSAPP_TOKEN) {
        return process.env.WHATSAPP_TOKEN;
    }

    const row = await getStoredWhatsAppToken();
    if (!row || !row.token) {
        throw new Error("WhatsApp token is not configured. Add it in your .env or save it via /api/whatsapp-token.");
    }

    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
        throw new Error("Stored WhatsApp token has expired. Update it via /api/whatsapp-token.");
    }

    return row.token;
}

async function exchangeWhatsAppToken(shortLivedToken) {
    const clientId = process.env.WHATSAPP_APP_ID;
    const clientSecret = process.env.WHATSAPP_APP_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("Missing WHATSAPP_APP_ID or WHATSAPP_APP_SECRET for token exchange.");
    }

    const url = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data.access_token) {
        throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
    }

    storeWhatsAppToken(data.access_token, data.expires_in);
    return data;
}

app.post('/api/whatsapp-token', (req, res) => {
    const { token, expires_in } = req.body;
    if (!token) {
        return res.status(400).json({ error: "Missing WhatsApp token." });
    }

    storeWhatsAppToken(token, expires_in || null);
    res.json({ success: true });
});

app.post('/api/whatsapp-token/exchange', async (req, res) => {
    const { token } = req.body;
    const sourceToken = token || process.env.WHATSAPP_TOKEN;
    if (!sourceToken) {
        return res.status(400).json({ error: "Missing source token for exchange." });
    }

    try {
        const exchangedData = await exchangeWhatsAppToken(sourceToken);
        res.json({ success: true, expires_in: exchangedData.expires_in || null });
    } catch (error) {
        console.error("WhatsApp token exchange error:", error);
        res.status(500).json({ error: error.message || "Token exchange failed." });
    }
});

// Create user settings table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNIQUE,
        displayName VARCHAR(255),
        email VARCHAR(255),
        password VARCHAR(255),
        autoReply VARCHAR(255),
        chatEnabled VARCHAR(10),
        msgAlert TINYINT(1),
        ticketAlert TINYINT(1),
        soundAlert TINYINT(1),
        priority VARCHAR(20),
        autoAssign VARCHAR(10),
        theme VARCHAR(20),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`, (err) => {
    if (err) console.log("Error creating settings table:", err);
});

// Create messages table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        sender VARCHAR(50),
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating messages table:", err);
});

// Create instagram_conversations table to track IG-specific metadata
db.query(`
    CREATE TABLE IF NOT EXISTS instagram_conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT UNIQUE,
        ig_id VARCHAR(255),
        ig_username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`, (err) => {
    if (err) console.log('Error creating instagram_conversations table:', err);
});

// Create replies table if not exists
 db.query(`
    CREATE TABLE IF NOT EXISTS replies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        sender VARCHAR(50),
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating replies table:", err);
});

// Add user_id to replies so we can attribute replies to staff
db.query("ALTER TABLE replies ADD COLUMN IF NOT EXISTS user_id INT NULL", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding user_id to replies:", err);
});

// Create receipts table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS receipts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content TEXT,
        escalated TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.log("Error creating receipts table:", err);
});

// Create tickets table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content TEXT,
        escalated TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.log("Error creating tickets table:", err);
});

// ---------------------------
// Middleware
// ---------------------------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: "livesupportsecret",
    resave: false,
    saveUninitialized: true
}));

// Middleware to protect HTML pages
app.use((req, res, next) => {
    if (req.path.endsWith('.html') && req.path !== '/login.html') {
        if (!req.session.user) {
            return res.redirect('/login.html');
        }
    }
    next();
});

// Protect admin assets/pages before static middleware: require login + admin role
app.use((req, res, next) => {
    if (req.path === '/admin-users.html' || req.path.startsWith('/js/admin-users')) {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        if (req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
    }
    next();
});

app.use(express.static("public"));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
    fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
}

function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect("/login.html");
    }
}

// ---------------------------
// Auth Routes
// ---------------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    console.log("Login attempt:", email, password);
    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(sql, [email, password], (err, result) => {
        console.log("DB result:", result);
        if (err) throw err;
        if (result.length > 0) {
                req.session.user = result[0];
                req.session.userId = result[0].id;
                // Track this session id for the logged-in user to allow force-logout
                try {
                    const sid = req.sessionID;
                    const uid = String(result[0].id);
                    const set = userSessions.get(uid) || new Set();
                    set.add(sid);
                    userSessions.set(uid, set);
                    try { io.emit('admin:users:changed', { action: 'login', id: uid }); } catch (e) { console.error('Emit admin users changed error', e); }
                } catch (e) {
                    console.error('Failed to track user session', e);
                }
            res.redirect("/dashboard");
        } else {
            res.redirect("/login.html?error=invalid");
        }
    });
});

app.get("/dashboard", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/logout", (req, res) => {
    try {
        const uid = req.session && req.session.userId ? String(req.session.userId) : null;
        if (uid && userSessions.has(uid)) {
            const set = userSessions.get(uid);
            set.delete(req.sessionID);
            if (set.size === 0) userSessions.delete(uid);
            else userSessions.set(uid, set);
        }
    } catch (e) { console.error('Error cleaning userSessions on logout', e); }
    try { const uid = req.session && req.session.userId ? String(req.session.userId) : null; req.session.destroy(() => { try { if (uid) io.emit('admin:users:changed', { action: 'logout', id: uid }); } catch (e) {} }); } catch (e) { req.session.destroy(); }
    res.redirect("/login.html");
});

// ---------------------------
// User API
// ---------------------------
app.get("/api/user", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    res.json({
        id: req.session.userId,
        name: req.session.user.name,
        role: req.session.user.role
    });
});

// Admin middleware
function isAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    return res.status(403).json({ error: 'admin_required' });
}

// ---------------------------
// Admin: User management APIs
// ---------------------------
app.get('/api/admin/users', isAuthenticated, isAdmin, (req, res) => {
    db.query('SELECT id, name, email, role, disabled FROM users', (err, rows) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        try {
            const augmented = rows.map(r => {
                const uid = String(r.id);
                const sessions = userSessions.get(uid);
                // check onlineAgents map for any socket with this userId
                let online = false;
                for (const a of onlineAgents.values()) {
                    if (String(a.userId) === uid) { online = true; break; }
                }
                return Object.assign({}, r, { active: !!(sessions && sessions.size > 0) || online });
            });
            res.json(augmented);
        } catch (e) {
            console.error('augment admin users error', e);
            res.json(rows);
        }
    });
});

app.post('/api/admin/users', isAuthenticated, isAdmin, (req, res) => {
    const { name, email, password, role } = req.body;
    console.log('POST /api/admin/users body=', req.body);
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    const sql = 'INSERT INTO users (name, email, password, role, disabled) VALUES (?, ?, ?, ?, 0)';
    db.query(sql, [name || email.split('@')[0], email, password, role || 'agent'], (err, result) => {
        if (err) {
            console.error('Failed to insert user:', err);
            // return helpful error for client
            const payload = { error: 'db_error', code: err.code || null, message: err.sqlMessage || String(err) };
            return res.status(500).json(payload);
        }
        console.log('User created id=', result.insertId);
        try { io.emit('admin:users:changed', { action: 'create', id: result.insertId, email }); } catch (e) { console.error('Emit admin users changed error', e); }
        res.json({ success: true, id: result.insertId });
    });
});

app.put('/api/admin/users/:id', isAuthenticated, isAdmin, (req, res) => {
    const id = req.params.id;
    const { name, role, disabled } = req.body;
    const sql = 'UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), disabled = COALESCE(?, disabled) WHERE id = ?';
    db.query(sql, [name, role, (disabled ? 1 : 0), id], (err) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        try { io.emit('admin:users:changed', { action: 'update', id }); } catch (e) { console.error('Emit admin users changed error', e); }
        res.json({ success: true });
    });
});

app.delete('/api/admin/users/:id', isAuthenticated, isAdmin, (req, res) => {
    const id = req.params.id;
    db.query('DELETE FROM users WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        // destroy tracked sessions
        try {
            const set = userSessions.get(String(id));
            if (set) {
                set.forEach(sid => {
                    // destroy session by id if possible
                    try { req.sessionStore.destroy(sid, () => {}); } catch (e) {}
                });
                userSessions.delete(String(id));
            }
        } catch (e) {}
        res.json({ success: true });
        try { io.emit('admin:users:changed', { action: 'delete', id }); } catch (e) { console.error('Emit admin users changed error', e); }
    });
});

app.post('/api/admin/users/:id/reset-password', isAuthenticated, isAdmin, (req, res) => {
    const id = req.params.id;
    const newPass = Math.random().toString(36).slice(-8);
    db.query('UPDATE users SET password = ? WHERE id = ?', [newPass, id], (err) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        // Optionally email the password; here we just return it so admin can communicate it
        try { io.emit('admin:users:changed', { action: 'reset-password', id }); } catch (e) { console.error('Emit admin users changed error', e); }
        res.json({ success: true, password: newPass });
    });
});

app.post('/api/admin/users/:id/force-logout', isAuthenticated, isAdmin, (req, res) => {
    const id = req.params.id;
    try {
        const set = userSessions.get(String(id));
        if (set) {
            set.forEach(sid => {
                try { req.sessionStore.destroy(sid, () => {}); } catch (e) { console.error('destroy session error', e); }
            });
            userSessions.delete(String(id));
        }
    } catch (e) {
        console.error('force-logout error', e);
        return res.status(500).json({ error: 'internal' });
    }
    try { io.emit('admin:users:changed', { action: 'force-logout', id }); } catch (e) { console.error('Emit admin users changed error', e); }
    res.json({ success: true });
});

// ---------------------------
// Staff Metrics (mock/sample)
// ---------------------------
app.get('/api/staff-metrics', isAuthenticated, (req, res) => {
    // Real implementation: compute per-staff metrics from DB
    // We'll gather: id, name, messages_handled, avg_response_time (sec), avg_resolution_time (sec), last_week array

    // First get staff users (basic list)
    db.query("SELECT id, name FROM users", (err, users) => {
        if (err) {
            console.error('Error fetching users for metrics:', err);
            return res.status(500).json({ error: 'DB error' });
        }

        const tasks = users.map(u => {
            return new Promise((resolve) => {
                const out = { id: u.id, name: u.name, messages_handled: 0, avg_response_time: null, avg_resolution_time: null, satisfaction: null, last_week: [] };

                // messages handled
                db.query('SELECT COUNT(*) AS cnt FROM replies WHERE user_id = ?', [u.id], (err2, r2) => {
                    if (!err2 && r2 && r2[0]) out.messages_handled = r2[0].cnt || 0;

                    // avg response time: average seconds between the most recent customer message before a reply and the reply
                    const avgRespSql = `
                        SELECT AVG(TIMESTAMPDIFF(SECOND, m.prev_created, r.created_at)) AS avg_resp FROM (
                            SELECT r1.id, r1.conversation_id, r1.created_at
                            FROM replies r1
                            WHERE r1.user_id = ?
                        ) r
                        JOIN (
                            SELECT m1.conversation_id, m1.created_at AS prev_created
                            FROM messages m1
                        ) m ON m.conversation_id = r.conversation_id AND m.prev_created = (
                            SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = r.conversation_id AND m2.created_at < r.created_at
                        )
                    `;

                    // Due to MySQL limitations with complex correlated subqueries in JOINs, we'll compute avg response using a simpler approach:
                    const avgRespFallback = `
                        SELECT AVG(TIMESTAMPDIFF(SECOND, (
                            SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = r3.conversation_id AND m2.created_at < r3.created_at
                        ), r3.created_at)) AS avg_resp
                        FROM replies r3
                        WHERE r3.user_id = ? AND EXISTS (
                            SELECT 1 FROM messages m3 WHERE m3.conversation_id = r3.conversation_id AND m3.created_at < r3.created_at
                        )
                    `;

                    db.query(avgRespFallback, [u.id], (err3, r3) => {
                        if (!err3 && r3 && r3[0] && r3[0].avg_resp != null) out.avg_response_time = Math.round(r3[0].avg_resp);

                        // avg resolution time: approximate as average time from conversation creation to the last reply by this user in that conversation
                        const avgResSql = `
                            SELECT AVG(TIMESTAMPDIFF(SECOND, c.created_at, r4.created_at)) AS avg_res
                            FROM (
                                SELECT conversation_id, MAX(created_at) AS created_at
                                FROM replies
                                WHERE user_id = ?
                                GROUP BY conversation_id
                            ) r4
                            JOIN conversations c ON c.id = r4.conversation_id
                        `;
                        db.query(avgResSql, [u.id], (err4, r4) => {
                            if (!err4 && r4 && r4[0] && r4[0].avg_res != null) out.avg_resolution_time = Math.round(r4[0].avg_res);

                            // last_week: counts of replies by day (Mon..Sun) for the last 7 days
                            const lastWeekSql = `
                                SELECT DATE(created_at) AS d, COUNT(*) AS cnt
                                FROM replies
                                WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                                GROUP BY DATE(created_at)
                                ORDER BY DATE(created_at) ASC
                            `;
                            db.query(lastWeekSql, [u.id], (err5, r5) => {
                                if (!err5 && r5) {
                                    // build last_week array of length up to 7
                                    const map = {};
                                    r5.forEach(rr => { 
                                        const key = (rr.d instanceof Date) ? rr.d.toISOString().slice(0,10) : (new Date(rr.d)).toISOString().slice(0,10);
                                        map[key] = rr.cnt; 
                                    });
                                    const arr = [];
                                    for (let i=6;i>=0;i--) {
                                        const d = new Date(); d.setDate(d.getDate() - i);
                                        const key = d.toISOString().slice(0,10);
                                        arr.push(map[key] || 0);
                                    }
                                    out.last_week = arr;
                                }

                                resolve(out);
                            });
                        });
                    });
                });
            });
        });

        Promise.all(tasks).then(results => res.json(results)).catch(e => {
            console.error('Metrics assembly error', e);
            res.status(500).json({ error: 'Failed to build metrics' });
        });
    });
});

// ---------------------------
// Settings API (per-user)
// ---------------------------
// Add columns if missing
db.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS translate_enabled TINYINT(1) DEFAULT 0", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding translate_enabled to settings:", err);
});
db.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS translate_lang VARCHAR(10) DEFAULT 'en'", (err) => {
    if (err && err.errno !== 1060) console.log("Error adding translate_lang to settings:", err);
});

app.get('/api/settings', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    db.query('SELECT * FROM settings WHERE user_id = ? LIMIT 1', [userId], (err, results) => {
        if (err) {
            console.error('GET /api/settings error', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!results || results.length === 0) return res.json({});
        res.json(results[0]);
    });
});

app.post('/api/settings', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    const translate_enabled = req.body.translate_enabled ? 1 : 0;
    const translate_lang = req.body.translate_lang || 'en';

    const sql = `INSERT INTO settings (user_id, translate_enabled, translate_lang) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE translate_enabled = VALUES(translate_enabled), translate_lang = VALUES(translate_lang)`;
    db.query(sql, [userId, translate_enabled, translate_lang], (err) => {
        if (err) {
            console.error('POST /api/settings error', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// ---------------------------
// Conversations & Messages
// ---------------------------
app.get("/api/conversations", (req, res) => {
    if (req.query.id) {
        db.query("SELECT * FROM conversations WHERE id = ?", [req.query.id], (err, result) => {
            if (err) throw err;
            res.json(result);
        });
    } else {
        db.query("SELECT * FROM conversations ORDER BY created_at DESC", (err, result) => {
            if (err) throw err;
            res.json(result);
        });
    }
});

// New endpoint: Instagram conversations (joined info)
app.get('/api/instagram/conversations', (req, res) => {
    const sql = `
        SELECT ic.conversation_id AS id, ic.ig_id, ic.ig_username, c.phone, c.name,
            (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.sender <> 'sent') AS unread_count,
            c.created_at
        FROM instagram_conversations ic
        JOIN conversations c ON c.id = ic.conversation_id
        ORDER BY c.created_at DESC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('/api/instagram/conversations db error', err);
            return res.status(500).json({ error: 'DB error' });
        }
        res.json(rows);
    });
});

app.get("/api/messages/:id", (req, res) => {
    const id = req.params.id;
    db.query(
        `SELECT sender, message, created_at FROM messages WHERE conversation_id = ? 
         UNION ALL
         SELECT sender, message, created_at FROM replies WHERE conversation_id = ? 
         ORDER BY created_at ASC`,
        [id, id],
        (err, result) => {
            if (err) throw err;
            res.json(result);
        }
    );
});

app.get("/api/suggest-reply/:id", async (req, res) => {
    const conversationId = req.params.id;
    try {
        db.query(
            "SELECT c.phone FROM conversations c WHERE c.id = ? LIMIT 1",
            [conversationId],
            async (err, convResult) => {
                if (err) {
                    console.error('Error fetching conversation phone for suggestion:', err);
                    return res.status(500).json({ suggestion: "Unable to create AI suggestion." });
                }

                const phone = convResult && convResult[0] ? convResult[0].phone : null;
                db.query(
                    "SELECT message FROM messages WHERE conversation_id = ? AND sender != 'sent' ORDER BY created_at DESC LIMIT 1",
                    [conversationId],
                    async (err2, msgResult) => {
                        if (err2) {
                            console.error('Error fetching latest customer message for suggestion:', err2);
                            return res.status(500).json({ suggestion: "Unable to create AI suggestion." });
                        }

                        const latestCustomerMessage = msgResult && msgResult[0] ? msgResult[0].message : null;
                        if (!latestCustomerMessage) {
                            return res.json({ suggestion: "No customer message yet to suggest a reply." });
                        }

                        const suggestion = await getMistralReply(latestCustomerMessage, phone, conversationId);
                        return res.json({ suggestion });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Suggestion endpoint error:', error);
        res.status(500).json({ suggestion: "Unable to create AI suggestion." });
    }
});

// ---------------------------
// Send Message (Agent)
// ---------------------------
async function sendAutoReply(phone, message) {
    try {
        const token = await getWhatsAppToken();
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: phone,
                    type: "text",
                    text: { body: message }
                })
            }
        );

        const data = await response.json();
        console.log("Auto-reply sent:", data);

        // Find conversation and insert message into DB
        db.query("SELECT id FROM conversations WHERE phone = ?", [phone], (err, result) => {
            if (err) {
                console.log("AUTO-REPLY DB ERROR:", err);
                return;
            }
            if (result && result.length > 0) {
                const conversation_id = result[0].id;
                db.query(
                    "INSERT INTO replies (conversation_id, sender, message, user_id, created_at) VALUES (?, ?, ?, ?, NOW())",
                    [conversation_id, 'sent', message, null],
                    (err) => {
                        if (err) console.log("AUTO-REPLY INSERT ERROR:", err);
                        else {
                            // Emit via Socket.IO
                            const messageData = {
                                conversation_id,
                                sender: "sent",
                                message,
                                created_at: new Date().toISOString()
                            };
                            io.emit("newMessage", messageData);
                        }
                    }
                );
            }
        });
    } catch (error) {
        console.log("AUTO-REPLY ERROR:", error);
    }
}

// ---------------------------
// Instagram Messaging Integration
// Requires env: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID, INSTAGRAM_VERIFY_TOKEN
// ---------------------------
const IG_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || null;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || null;
const IG_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || 'livesupport_verify';

// Webhook verification endpoint for Meta (Instagram)
app.get('/webhook/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token) {
        if (mode === 'subscribe' && token === IG_VERIFY_TOKEN) {
            console.log('✅ Instagram webhook verified');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    res.sendStatus(400);
});

// Webhook receiver for Instagram messaging events
app.post('/webhook/instagram', (req, res) => {
    const body = req.body;
    if (body && body.object) {
        // Example structure: body.entry[].messaging[] or body.entry[].changes
        try {
            const entries = body.entry || [];
            entries.forEach(entry => {
                const changes = entry.changes || [];
                // Newer IG events appear in changes array
                if (changes.length) {
                    changes.forEach(change => {
                        const value = change.value || {};
                        // messages may be under value.messages
                        const messages = value.messages || [];
                        messages.forEach(async (m) => {
                            const senderId = m.from || m.sender || (value && value.sender_id) || null;
                            const text = (m.text && m.text.body) || m.text || null;
                            if (!senderId) return;

                            // Upsert conversation by external id
                            db.query('SELECT id FROM conversations WHERE phone = ? OR name = ? LIMIT 1', [senderId, senderId], (err, rows) => {
                                if (err) return console.error('Instagram webhook DB lookup error', err);
                                if (rows && rows.length > 0) {
                                        const convId = rows[0].id;
                                        db.query('INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())', [convId, 'instagram', text || '[non-text]'], (iErr) => {
                                            if (iErr) console.error('Error inserting IG message', iErr);
                                            else io.emit('newMessage', { conversation_id: convId, sender: 'instagram', message: text, created_at: new Date().toISOString() });
                                        });
                                        // ensure instagram_conversations has a record for this conv
                                        db.query('SELECT id FROM instagram_conversations WHERE conversation_id = ? LIMIT 1', [convId], (icErr, icRows) => {
                                            if (icErr) return console.error('instagram_conversations lookup error', icErr);
                                            if (!icRows || icRows.length === 0) {
                                                db.query('INSERT INTO instagram_conversations (conversation_id, ig_id, ig_username) VALUES (?, ?, ?)', [convId, senderId, (value && value.from && value.from.username) || null], (insErr) => {
                                                    if (insErr) console.error('Error inserting instagram_conversations link', insErr);
                                                });
                                            }
                                        });
                                    } else {
                                        // create conversation
                                        db.query('INSERT INTO conversations (phone, name, platform, created_at) VALUES (?, ?, ?, NOW())', [senderId, senderId, 'instagram'], (cErr, result) => {
                                            if (cErr) return console.error('Error creating IG conversation', cErr);
                                            const newId = result.insertId;
                                            db.query('INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())', [newId, 'instagram', text || '[non-text]'], (mErr) => {
                                                if (mErr) console.error('Error inserting IG message after create', mErr);
                                                else io.emit('newMessage', { conversation_id: newId, sender: 'instagram', message: text, created_at: new Date().toISOString() });
                                            });
                                            // create instagram_conversations link
                                            db.query('INSERT INTO instagram_conversations (conversation_id, ig_id, ig_username) VALUES (?, ?, ?)', [newId, senderId, (value && value.from && value.from.username) || null], (insErr) => {
                                                if (insErr) console.error('Error inserting instagram_conversations after conv create', insErr);
                                            });
                                        });
                                    }
                            });
                        });
                    });
                }
                // legacy messaging field handling
                if (entry.messaging && entry.messaging.length) {
                    entry.messaging.forEach(async (event) => {
                        if (event.message) {
                            const senderId = (event.sender && (event.sender.id || event.sender.user_id)) || event.from || null;
                            const text = event.message.text || null;
                            if (!senderId) return;
                            db.query('SELECT id FROM conversations WHERE phone = ? OR name = ? LIMIT 1', [senderId, senderId], (err, rows) => {
                                if (err) return console.error('Instagram webhook DB lookup error', err);
                                if (rows && rows.length > 0) {
                                    const convId = rows[0].id;
                                    db.query('INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())', [convId, 'instagram', text || '[non-text]'], (iErr) => {
                                        if (iErr) console.error('Error inserting IG message', iErr);
                                        else io.emit('newMessage', { conversation_id: convId, sender: 'instagram', message: text, created_at: new Date().toISOString() });
                                    });
                                    db.query('SELECT id FROM instagram_conversations WHERE conversation_id = ? LIMIT 1', [convId], (icErr, icRows) => {
                                        if (icErr) return console.error('instagram_conversations lookup error', icErr);
                                        if (!icRows || icRows.length === 0) {
                                            db.query('INSERT INTO instagram_conversations (conversation_id, ig_id, ig_username) VALUES (?, ?, ?)', [convId, senderId, (event && event.sender && event.sender.username) || null], (insErr) => {
                                                if (insErr) console.error('Error inserting instagram_conversations link', insErr);
                                            });
                                        }
                                    });
                                } else {
                                    db.query('INSERT INTO conversations (phone, name, platform, created_at) VALUES (?, ?, ?, NOW())', [senderId, senderId, 'instagram'], (cErr, result) => {
                                        if (cErr) return console.error('Error creating IG conversation', cErr);
                                        const newId = result.insertId;
                                        db.query('INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())', [newId, 'instagram', text || '[non-text]'], (mErr) => {
                                            if (mErr) console.error('Error inserting IG message after create', mErr);
                                            else io.emit('newMessage', { conversation_id: newId, sender: 'instagram', message: text, created_at: new Date().toISOString() });
                                        });
                                        db.query('INSERT INTO instagram_conversations (conversation_id, ig_id, ig_username) VALUES (?, ?, ?)', [newId, senderId, (event && event.sender && event.sender.username) || null], (insErr) => {
                                            if (insErr) console.error('Error inserting instagram_conversations after conv create', insErr);
                                        });
                                    });
                                }
                            });
                        }
                    });
                }
            });
        } catch (err) {
            console.error('Instagram webhook processing error', err);
        }

        // Respond quickly to Meta
        return res.status(200).send('EVENT_RECEIVED');
    }
    // Not a page subscription
    return res.sendStatus(404);
});

    // OAuth: Redirect user to Facebook/Instagram for login
    app.get('/auth/instagram', (req, res) => {
        const clientId = process.env.INSTAGRAM_APP_ID;
        const redirectBase = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const redirectUri = `${redirectBase}/auth/instagram/callback`;
        if (!clientId) return res.status(500).send('Missing INSTAGRAM_APP_ID in .env');
        const scope = encodeURIComponent('instagram_basic,instagram_manage_messages,pages_manage_metadata');
        const authUrl = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
        res.redirect(authUrl);
    });

    // OAuth callback: exchange code for access token and store it
    app.get('/auth/instagram/callback', async (req, res) => {
        const code = req.query.code;
        const clientId = process.env.INSTAGRAM_APP_ID;
        const clientSecret = process.env.INSTAGRAM_APP_SECRET;
        const redirectBase = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const redirectUri = `${redirectBase}/auth/instagram/callback`;
        if (!code) return res.status(400).send('Missing code');
        if (!clientId || !clientSecret) return res.status(500).send('Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET in .env');

        try {
            // Exchange code for short-lived token
            const tokenUrl = `https://graph.facebook.com/v17.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`;
            const tokenResp = await fetch(tokenUrl);
            const tokenData = await tokenResp.json();
            if (!tokenResp.ok) {
                console.error('Error exchanging code:', tokenData);
                return res.status(500).send('Token exchange failed: ' + JSON.stringify(tokenData));
            }
            const shortLived = tokenData.access_token;

            // Exchange for long-lived token
            const exchangeUrl = `https://graph.facebook.com/v17.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${encodeURIComponent(shortLived)}`;
            const exchResp = await fetch(exchangeUrl);
            const exchData = await exchResp.json();
            if (!exchResp.ok) {
                console.error('Error exchanging token for long-lived:', exchData);
                // still store short-lived as fallback
                storeInstagramToken(shortLived, tokenData.expires_in || null);
                return res.send('Stored short-lived token (long-lived exchange failed).');
            }
            const longToken = exchData.access_token;
            const expiresIn = exchData.expires_in || null;
            storeInstagramToken(longToken, expiresIn);

            // Optionally set environment var at runtime (only for this process)
            process.env.INSTAGRAM_ACCESS_TOKEN = longToken;

            res.send('<html><body><h3>Instagram login successful.</h3><p>Token saved. You may close this window.</p></body></html>');
        } catch (err) {
            console.error('OAuth callback error', err);
            res.status(500).send('OAuth callback error');
        }
    });

// Endpoint for sending messages via Instagram Graph API (agent action)
app.post('/api/instagram/send', isAuthenticated, async (req, res) => {
    const { recipient, message } = req.body; // recipient: instagram user id or external id
    if (!recipient || (!message && !req.body.attachment)) return res.status(400).json({ error: 'Missing recipient or message/attachment.' });
    if (!IG_ACCESS_TOKEN || !IG_ACCOUNT_ID) return res.status(500).json({ error: 'Instagram not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID in .env.' });

    try {
        const url = `https://graph.facebook.com/v17.0/${IG_ACCOUNT_ID}/messages`;
        const body = { recipient: { id: recipient }, message: {} };
        if (message) body.message.text = message;
        if (req.body.attachment) body.message.attachment = req.body.attachment; // pass-through attachment object (type/url)

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${IG_ACCESS_TOKEN}` },
            body: JSON.stringify(body)
        });
        const data = await resp.json();

        // Store outgoing message in DB (map recipient -> conversation)
        db.query('SELECT id FROM conversations WHERE phone = ? OR name = ? LIMIT 1', [recipient, recipient], (err, rows) => {
            if (err) console.error('IG send DB lookup error', err);
            const doInsert = (convId) => {
                db.query('INSERT INTO replies (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())', [convId, 'sent', message || '[attachment]'], (iErr) => {
                    if (iErr) console.error('Error inserting IG outgoing reply', iErr);
                    else io.emit('newMessage', { conversation_id: convId, sender: 'sent', message: message || '[attachment]', created_at: new Date().toISOString() });
                });
            };
            if (rows && rows.length > 0) doInsert(rows[0].id);
            else {
                db.query('INSERT INTO conversations (phone, name, platform, created_at) VALUES (?, ?, ?, NOW())', [recipient, recipient, 'instagram'], (cErr, result) => {
                    if (cErr) console.error('Error creating conv for IG send', cErr);
                    else doInsert(result.insertId);
                });
            }
        });

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error sending Instagram message', error);
        res.status(500).json({ error: 'Failed to send message via Instagram.' });
    }
});

function isOrderConfirmation(text) {
    const confirmKeywords = ['yes', 'yep', 'yup', 'confirm', 'ok', 'okay', 'sure', 'go', 'order it', 'proceed', 'do it'];
    const lowerText = text.toLowerCase().trim();
    return confirmKeywords.some(keyword => lowerText.includes(keyword));
}

function findMostRecentCustomerOrderMessage(messages) {
    const orderKeywords = ['pizza', 'burger', 'cheese burger', 'cheese burgers', 'large pizzas', 'large pizza', 'meal', 'combo', 'sandwich', 'taco', 'drink', 'food', 'package', 'fries', 'salad', 'sushi', 'pasta', 'rice', 'noodles', 'wrap'];
    for (const msg of messages) {
        if (msg.sender === 'received' || msg.sender === 'customer') {
            const messageText = String(msg.message || '').trim();
            const lowerText = messageText.toLowerCase();

            // Skip responses that are just confirmations, rejections, or short support replies.
            if (isOrderConfirmation(lowerText) || /^\s*(yes|no|yep|nope|sure|ok|okay|please|confirm|cancel|thanks?)\s*$/.test(lowerText)) {
                continue;
            }

            if (orderKeywords.some(keyword => lowerText.includes(keyword))) {
                return messageText;
            }
        }
    }
    return null;
}

function cleanOrderText(text) {
    if (!text) return text;
    return String(text)
        .replace(/(?:let me know if you'd like to make any changes|please let me know if you'd like to make any changes|if you'd like to make any changes.*|let me know if.*)/gi, '')
        .replace(/\s+$/g, '')
        .trim();
}

const MENU_PRICES = {
    pizza: { small: 10, medium: 15, large: 20 },
    burger: { classic: 8, cheese: 9, double: 12 }
};

function parseNumberWord(str) {
    if (!str) return 1;
    const num = parseInt(str, 10);
    if (!isNaN(num)) return num;
    const numberWords = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10
    };
    return numberWords[str.toLowerCase()] || 1;
}

function parseMenuOrderText(text) {
    if (!text) return { items: null, total: 0 };

    const lowerText = text.toLowerCase();
    const counts = { pizza: 0, burger: 0 };
    let total = 0;

    const pizzaPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(small|medium|large)\s*pizzas?\b/gi;
    let pizzaMatch;
    while ((pizzaMatch = pizzaPattern.exec(lowerText)) !== null) {
        const quantity = parseNumberWord(pizzaMatch[1]);
        const size = pizzaMatch[2];
        counts.pizza += quantity;
        total += quantity * MENU_PRICES.pizza[size];
    }

    const burgerPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(classic|cheese|double)\s*burgers?\b/gi;
    let burgerMatch;
    while ((burgerMatch = burgerPattern.exec(lowerText)) !== null) {
        const quantity = parseNumberWord(burgerMatch[1]);
        const type = burgerMatch[2];
        counts.burger += quantity;
        total += quantity * MENU_PRICES.burger[type];
    }

    if (counts.pizza === 0) {
        const genericPizzaPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*pizzas?\b/gi;
        let genericPizzaMatch;
        while ((genericPizzaMatch = genericPizzaPattern.exec(lowerText)) !== null) {
            const quantity = parseNumberWord(genericPizzaMatch[1]);
            counts.pizza += quantity;
            total += quantity * MENU_PRICES.pizza.medium;
        }
    }

    if (counts.burger === 0) {
        const genericBurgerPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*burgers?\b/gi;
        let genericBurgerMatch;
        while ((genericBurgerMatch = genericBurgerPattern.exec(lowerText)) !== null) {
            const quantity = parseNumberWord(genericBurgerMatch[1]);
            counts.burger += quantity;
            total += quantity * MENU_PRICES.burger.cheese;
        }
    }

    if (counts.pizza === 0 && counts.burger === 0) {
        return { items: null, total: 0 };
    }

    const itemParts = [];
    if (counts.pizza > 0) itemParts.push(`${counts.pizza} ${counts.pizza === 1 ? 'pizza' : 'pizzas'}`);
    if (counts.burger > 0) itemParts.push(`${counts.burger} ${counts.burger === 1 ? 'burger' : 'burgers'}`);

    return {
        items: itemParts.join(', '),
        total
    };
}

function extractOrderDetails(aiMessage, customerMessage = null) {
    const cleanCustomerMessage = cleanOrderText(customerMessage || '');
    const cleanAiMessage = cleanOrderText(aiMessage || '');

    const customerParsed = parseMenuOrderText(cleanCustomerMessage);
    const aiParsed = parseMenuOrderText(cleanAiMessage);

    // Extract explicit total from AI confirmation text first, then fallback to customer order text.
    const explicitTotal = extractOrderTotal(cleanAiMessage) || extractOrderTotal(cleanCustomerMessage);

    let total = explicitTotal || 0;
    if (customerParsed.total > 0) {
        if (!total || customerParsed.total !== total) {
            total = customerParsed.total;
        }
    } else if (aiParsed.total > 0 && !total) {
        total = aiParsed.total;
    }

    // Extract product information from customer order text first.
    let items = extractOrderItems(cleanCustomerMessage) || extractOrderItems(cleanAiMessage) || customerParsed.items || aiParsed.items;

    // Only use raw fallback as last resort, and only if it's a real customer order message
    if (!items && cleanCustomerMessage && /(pizza|burger|meal|combo|sandwich|taco|drink|food|fries|salad|sushi|pasta|rice|noodles|wrap)/i.test(cleanCustomerMessage)) {
        const shortMessage = cleanCustomerMessage.substring(0, 100);
        items = shortMessage.length > 3 ? shortMessage : null;
    }

    items = String(items || 'Order').trim();
    if (!items || items.length < 2) items = 'Order';

    return { items, total };
}

function extractOrderTotal(text) {
    if (!text) return null;
    const totalMatch = text.match(/\$(\d+(?:\.\d+)?)/);
    if (totalMatch) return parseFloat(totalMatch[1]);

    const totalAlt = text.match(/(?:total|comes to|is|amount|cost|price)\s*[:]?\s*\$?\s*(\d+(?:\.\d+)?)/i);
    return totalAlt ? parseFloat(totalAlt[1]) : null;
}

function extractOrderItems(text) {
    if (!text) return null;

    // Try specific order statement patterns first
    const itemPatterns = [
        /(?:i(?:'d| would)? like to order|i(?:'d| would)? like|i want to order|i want|can i get|please order|send me|i need|order|give me|add|deliver)\s+(.+?)(?:\s+(?:for|comes to|total|totals?|cost|price|amount)|\s*\$|\s*\(|$)/i,
        /(?:my order is|please can i have|please may i have)\s+(.+?)(?:\s+(?:for|comes to|total|totals?|cost|price|amount)|\s*\$|\s*\(|$)/i
    ];

    for (const pattern of itemPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            let itemText = match[1].trim();
            // Remove trailing phrases
            itemText = itemText.replace(/\s*(?:please|thanks|thank you|ok|okay).*$/i, '').trim();
            if (itemText && !/^yes|no|ok|okay|sure|confirm|cancel$/i.test(itemText) && itemText.length > 2) {
                return itemText;
            }
        }
    }

    // If patterns don't match, try to extract just the food items using a different approach
    const lowerText = text.toLowerCase();
    if (/(pizza|burger|meal|combo|sandwich|taco|drink|food|fries|salad|sushi|pasta|rice|noodles|wrap)/i.test(lowerText)) {
        // Extract quantity + food items pattern: "3 Cheese Burgers", "Large Pizza", etc.
        const foodPattern = /(\d+\s+)?(?:large|small|medium|extra|with)?\s*([a-zA-Z\s&]+(?:pizza|burger|meal|combo|sandwich|taco|drink|food|fries|salad|sushi|pasta|rice|noodles|wrap)[a-zA-Z\s&]*)/gi;
        const foodMatches = text.match(foodPattern);
        
        if (foodMatches && foodMatches.length > 0) {
            // Join all matched food items
            return foodMatches.map(item => item.trim()).join(', ');
        }

        // If pattern still doesn't work, extract up to the price marker
        const beforePrice = text.split(/\$|total|comes to|for a total|cost/i)[0];
        if (beforePrice && beforePrice.length < text.length - 5) {
            let cleaned = beforePrice.trim()
                .replace(/^(?:i(?:'d|'m)?\s+(?:want|like|need|order|order me|please|please order)\s+)/i, '')
                .replace(/\s*(?:please|thanks|thank you)\s*$/i, '')
                .trim();
            if (cleaned && cleaned.length > 2) {
                return cleaned;
            }
        }
    }

    return null;
}

function getConversationCustomerName(conversationId) {
    return new Promise((resolve) => {
        db.query('SELECT name FROM conversations WHERE id = ? LIMIT 1', [conversationId], (err, results) => {
            if (err || !results || results.length === 0) {
                resolve('Customer');
            } else {
                resolve(results[0].name || 'Customer');
            }
        });
    });
}

async function checkAndSaveOrderConfirmation(phone, conversationId, customerMessage) {
    if (!isOrderConfirmation(customerMessage)) {
        return false;
    }

    return new Promise(async (resolve) => {
        // Get last few messages to find AI's order suggestion
        db.query(
            `SELECT sender, message, created_at FROM messages WHERE conversation_id = ?
             UNION ALL
             SELECT sender, message, created_at FROM replies WHERE conversation_id = ?
             ORDER BY created_at DESC LIMIT 10`,
            [conversationId, conversationId],
            async (err, messages) => {
                if (err || !messages || messages.length === 0) {
                    resolve(false);
                    return;
                }

                // Find the AI's most recent message (sender = 'sent')
                const aiMessage = messages.find(m => m.sender === 'sent');
                if (!aiMessage) {
                    resolve(false);
                    return;
                }

                const customerOrderMessage = findMostRecentCustomerOrderMessage(messages);
                const { items, total } = extractOrderDetails(aiMessage.message, customerOrderMessage);

                if (!total || total === 0) {
                    console.log("Order confirmation detected but no valid order total found in AI message or customer order message:", {
                        aiMessage: aiMessage.message,
                        customerOrderMessage
                    });
                    resolve(false);
                    return;
                }

                const customerName = await getConversationCustomerName(conversationId);
                const orderId = `ORD-${Date.now()}`;
                const product = items;
                const amount = total;
                const status = 'confirmed';

                db.query(
                    'INSERT INTO orders (order_id, customer_name, phone, product, amount, total_amount, status, order_date, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
                    [orderId, customerName, phone || null, product, amount, total, status, conversationId],
                    (err, result) => {
                        if (err) {
                            console.log("Order save error:", err);
                            resolve(false);
                        } else {
                            console.log(`Order confirmed and saved: ${product} - $${total} from ${phone}`);
                            // Emit order-created so connected dashboards update immediately
                            try {
                                const orderPayload = {
                                    id: orderId,
                                    customerName: customerName,
                                    product: product,
                                    amount: amount,
                                    status: status,
                                    date: new Date().toLocaleDateString()
                                };
                                if (typeof io !== 'undefined') io.emit('order-created', orderPayload);
                            } catch (emitErr) {
                                console.error('Failed to emit order-created for AI-created order', emitErr);
                            }
                            // Automatically start delivery simulation for this newly created order
                            try {
                                startDeliverySimulationForOrder(orderId, (startErr, rider) => {
                                    if (startErr) {
                                        console.error('Auto-start delivery failed for order', orderId, startErr);
                                    } else {
                                        console.log('Auto-started delivery for order', orderId, 'rider:', rider && rider.name);
                                    }
                                });
                            } catch (ex) {
                                console.error('Exception while auto-starting delivery for order', orderId, ex);
                            }

                            resolve(true);
                        }
                    }
                );
            }
        );
    });
}

app.post("/api/send-message", (req, res) => {
    const { conversation_id, message } = req.body;

    // IMMEDIATELY disable AI responses when staff sends a message
    disableAIForConversation(conversation_id);
    console.log(`📤 Staff message detected for conversation ${conversation_id}, disabling AI immediately`);

    db.query("SELECT phone FROM conversations WHERE id = ?", [conversation_id], async (err, result) => {
        if (err) return res.sendStatus(500);
        if (!result || result.length === 0) return res.send("Conversation not found");

        const phone = result[0].phone;

        try {
            const token = await getWhatsAppToken();
        const response = await fetch(
                `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: phone,
                        type: "text",
                        text: { body: message }
                    })
                }
            );

            const data = await response.json();
            console.log("WhatsApp response:", data);

            // Save to DB
            db.query(
                "INSERT INTO replies (conversation_id, sender, message, user_id, created_at) VALUES (?, ?, ?, ?, NOW())",
                [conversation_id, 'sent', message, req.session ? req.session.userId : null],
                (err) => {
                    if (err) {
                        console.log("MESSAGE INSERT ERROR:", err);
                        return res.status(500).send("Message save failed");
                    }

                    const messageData = {
                        conversation_id,
                        sender: "sent",
                        message,
                        created_at: new Date().toISOString()
                    };

                    // Emit via Socket.IO
                    io.emit("newMessage", messageData);
                    res.json({ success: true, message: messageData });
                }
            );

        } catch (error) {
            console.log("SEND ERROR:", error);
            res.sendStatus(500);
        }
    });
});

app.post("/api/send-media", upload.single("file"), (req, res) => {
    const { conversation_id, caption } = req.body;
    const file = req.file;
    if (!conversation_id || !file) {
        if (file && file.path) fs.unlink(file.path, () => {});
        return res.status(400).json({ error: "Missing conversation or file." });
    }

    disableAIForConversation(conversation_id);

    db.query("SELECT phone FROM conversations WHERE id = ?", [conversation_id], async (err, result) => {
        if (err) {
            if (file.path) fs.unlink(file.path, () => {});
            return res.sendStatus(500);
        }
        if (!result || result.length === 0) {
            if (file.path) fs.unlink(file.path, () => {});
            return res.status(404).json({ error: "Conversation not found" });
        }

        const phone = result[0].phone;

        try {
            const fileBuffer = await fs.promises.readFile(file.path);
            const boundary = "----WhatsAppFormBoundary" + Date.now();
            const parts = [];

            parts.push(Buffer.from(`--${boundary}\r\n`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="messaging_product"\r\n\r\n`));
            parts.push(Buffer.from(`whatsapp\r\n`));

            parts.push(Buffer.from(`--${boundary}\r\n`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="type"\r\n\r\n`));
            parts.push(Buffer.from(`${file.mimetype}\r\n`));

            parts.push(Buffer.from(`--${boundary}\r\n`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
            parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
            parts.push(fileBuffer);
            parts.push(Buffer.from(`\r\n`));
            parts.push(Buffer.from(`--${boundary}--\r\n`));

            const multipartBody = Buffer.concat(parts);
            const token = await getWhatsAppToken();
            const uploadResponse = await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/media`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`
                },
                body: multipartBody
            });

            const uploadData = await uploadResponse.json();
            if (!uploadResponse.ok || !uploadData.id) {
                throw new Error(JSON.stringify(uploadData));
            }

            const mediaId = uploadData.id;
            const mediaType = file.mimetype.startsWith("image/") ? "image" : "document";
            const messageBody = {
                messaging_product: "whatsapp",
                to: phone,
                type: mediaType,
                [mediaType]: { id: mediaId }
            };

            if (caption) {
                messageBody[mediaType].caption = caption;
            }
            if (mediaType === "document") {
                messageBody[mediaType].filename = file.originalname;
            }

            const sendResponse = await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(messageBody)
            });

            const sendData = await sendResponse.json();
            if (!sendResponse.ok) {
                throw new Error(JSON.stringify(sendData));
            }

            const savedMessage = caption ? `${caption} [file: ${file.originalname}]` : `[file: ${file.originalname}]`;
            db.query(
                "INSERT INTO replies (conversation_id, sender, message, user_id, created_at) VALUES (?, ?, ?, ?, NOW())",
                [conversation_id, 'sent', savedMessage, req.session ? req.session.userId : null],
                (err) => {
                    if (file.path) fs.unlink(file.path, () => {});
                    if (err) {
                        console.log("MESSAGE INSERT ERROR:", err);
                        return res.status(500).json({ error: "Message save failed" });
                    }

                    const messageData = {
                        conversation_id,
                        sender: "sent",
                        message: savedMessage,
                        created_at: new Date().toISOString()
                    };

                    io.emit("newMessage", messageData);
                    res.json({ success: true, message: messageData });
                }
            );
        } catch (error) {
            console.log("SEND MEDIA ERROR:", error);
            if (file.path) fs.unlink(file.path, () => {});
            res.status(500).json({ error: "Failed to send media." });
        }
    });
});

// ---------------------------
// Customer Webhook
// ---------------------------
app.post("/webhook", async (req, res) => {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const text = msg.text?.body || "";
    const sender = msg.from === process.env.PHONE_NUMBER_ID ? 'sent' : 'received';

    console.log(`\n📩 WEBHOOK MESSAGE RECEIVED:`, {
        phone,
        text,
        sender,
        msgFrom: msg.from,
        phoneNumberId: process.env.PHONE_NUMBER_ID,
        isSent: msg.from === process.env.PHONE_NUMBER_ID
    });

    db.query("SELECT * FROM conversations WHERE phone = ?", [phone], async (err, result) => {
        if (err) return console.log("🔥 REAL DB ERROR:", err);

        if (!result || result.length === 0) {
            // Create new conversation
            db.query("INSERT INTO conversations (phone, name, platform) VALUES (?, ?, 'whatsapp')", [phone, phone], async (err, newConv) => {
                if (err) return console.log("INSERT ERROR:", err);
                const convoId = newConv.insertId;
                const targetTable = sender === 'sent' ? 'replies' : 'messages';
                const query = `INSERT INTO ${targetTable} (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())`;
                db.query(
                    query,
                    [convoId, sender, text],
                    async (err) => {
                        if (err) console.log("MESSAGE INSERT ERROR:", err);
                        else {
                            io.emit("newMessage", {
                                conversation_id: convoId,
                                sender: sender,
                                message: text,
                                created_at: new Date().toISOString()
                            });

                            // If this is an agent message, disable AI responses
                            if (sender === 'sent') {
                                disableAIForConversation(convoId);
                                console.log(`Agent message received, AI disabled for conversation ${convoId}`);
                            } else {
                                if (isCustomerGreeting(text) && isStaffIdleForThreeMinutes(convoId)) {
                                    enableAIForConversation(convoId);
                                }
                                // Only process customer messages for AI response
                                // Check if this is an order confirmation
                                const orderConfirmed = await checkAndSaveOrderConfirmation(phone, convoId, text);
                                if (orderConfirmed) {
                                    await sendAutoReply(phone, "Your order has been confirmed an your order is now being prepared for delivery🚚✅");
                                } else {
                                    const forceAI = isTicketCreationRequest(text) || isRequestingStaff(text);
                                    if (forceAI || shouldAIRespond(convoId)) {
                                        const reply = await getMistralReply(text, phone, convoId);
                                        await sendAutoReply(phone, reply);
                                    } else {
                                        console.log(`AI response skipped for conversation ${convoId} - agent recently active`);
                                    }
                                }
                            }

                            // Auto-escalate if refund is mentioned
                            if (text && text.toLowerCase().includes("refund")) {
                                db.query("INSERT INTO escalations (conversation_id, customer_name) VALUES (?, ?)", [convoId, phone], (err) => {
                                    if (err) console.log("ESCALATION INSERT ERROR:", err);
                                });
                            }
                        }
                    }
                );
            });
        } else {
            const convoId = result[0].id;
            db.query(
                "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                [convoId, sender, text],
                async (err) => {
                    if (err) console.log("MESSAGE INSERT ERROR:", err);
                    else {
                        io.emit("newMessage", {
                            conversation_id: convoId,
                            sender: sender,
                            message: text,
                            created_at: new Date().toISOString()
                        });

                        // If this is an agent message, disable AI responses
                        if (sender === 'sent') {
                            disableAIForConversation(convoId);
                            console.log(`Agent message received, AI disabled for conversation ${convoId}`);
                        } else {
                            if (isCustomerGreeting(text)) {
                                enableAIForConversation(convoId);
                            }
                            // Only process customer messages for AI response
                            // Check if this is an order confirmation
                            const orderConfirmed = await checkAndSaveOrderConfirmation(phone, convoId, text);
                            if (orderConfirmed) {
                                await sendAutoReply(phone, "Your order has been confirmed an your order is now being prepared for delivery🚚✅");
                            } else {
                                const forceAI = isTicketCreationRequest(text) || isRequestingStaff(text);
                                if (forceAI || shouldAIRespond(convoId)) {
                                    const reply = await getMistralReply(text, phone, convoId);
                                    await sendAutoReply(phone, reply);
                                } else {
                                    console.log(`AI response skipped for conversation ${convoId} - agent recently active`);
                                }
                            }
                        }

                        if (text && text.toLowerCase().includes("refund")) {
                            db.query("INSERT INTO escalations (conversation_id, customer_name) VALUES (?, ?)", [convoId, phone], (err) => {
                                if (err) console.log("ESCALATION INSERT ERROR:", err);
                            });
                        }
                    }
                }
            );
        }
    });

    res.sendStatus(200);
});

// ---------------------------
// Test endpoint to simulate incoming message
// ---------------------------
// POST /api/test-message?phone=1234567890&message=Hello
app.post("/api/test-message", (req, res) => {
    const phone = req.query.phone || "1234567890";
    const text = req.query.message || "Test message";

    db.query("SELECT * FROM conversations WHERE phone = ?", [phone], async (err, result) => {
        if (err) return res.sendStatus(500);

        if (!result || result.length === 0) {
            // Create new conversation
            db.query("INSERT INTO conversations (phone, name, platform) VALUES (?, ?, 'whatsapp')", [phone, phone], (err, newConv) => {
                if (err) return res.sendStatus(500);
                const convoId = newConv.insertId;
                db.query(
                    "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, 'customer', ?, NOW())",
                    [convoId, text],
                    async (err) => {
                        if (err) return res.sendStatus(500);
                        const messageData = {
                            conversation_id: convoId,
                            sender: "received",
                            message: text,
                            created_at: new Date().toISOString()
                        };
                        io.emit("newMessage", messageData);

                        // Check if this is an order confirmation
                        const orderConfirmed = await checkAndSaveOrderConfirmation(phone, convoId, text);
                        if (orderConfirmed) {
                            await sendAutoReply(phone, "Your order has been confirmed an your order is now being prepared for delivery🚚✅");
                        } else {
                            // Check if AI should respond
                            if (shouldAIRespond(convoId)) {
                                const reply = await getMistralReply(text, phone, convoId);
                                await sendAutoReply(phone, reply);
                            } else {
                                console.log(`AI response skipped for conversation ${convoId} - agent recently active`);
                            }
                        }
                        res.json({ success: true, conversation_id: convoId });
                    }
                );
            });
        } else {
            const convoId = result[0].id;
            db.query(
                "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, 'customer', ?, NOW())",
                [convoId, text],
                async (err) => {
                    if (err) return res.sendStatus(500);
                    const messageData = {
                        conversation_id: convoId,
                        sender: "received",
                        message: text,
                        created_at: new Date().toISOString()
                    };
                    io.emit("newMessage", messageData);

                    if (isCustomerGreeting(text) && isStaffIdleForThreeMinutes(convoId)) {
                        enableAIForConversation(convoId);
                    }
                    const orderConfirmed = await checkAndSaveOrderConfirmation(phone, convoId, text);
                    if (orderConfirmed) {
                        await sendAutoReply(phone, "Your order has been confirmed an your food is now being prepared for delivery🚚✅");
                    } else {
                        const forceAI = isTicketCreationRequest(text) || isRequestingStaff(text);
                        if (forceAI || shouldAIRespond(convoId)) {
                            const reply = await getMistralReply(text, phone, convoId);
                            await sendAutoReply(phone, reply);
                        } else {
                            console.log(`AI response skipped for conversation ${convoId} - agent recently active`);
                        }
                    }
                    res.json({ success: true, conversation_id: convoId });
                }
            );
        }
    });
});

// ---------------------------
// Webhook GET for verification
// ---------------------------
app.get("/webhook", (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
});

// ---------------------------
// Receipts
// ---------------------------
app.post("/api/receipts", (req, res) => {
    const { content } = req.body;
    db.query("INSERT INTO receipts (content) VALUES (?)", [content], (err, result) => {
        if (err) {
            console.error('Error inserting receipt:', err);
            return res.status(500).json({ error: 'Failed to save receipt' });
        }
        const receipt = {
            id: result.insertId,
            content,
            created_at: new Date().toISOString()
        };
        // Emit a socket event so any connected dashboard can display an update instantly
        io.emit("receiptCreated", receipt);
        res.json({ id: result.insertId, success: true });
    });
});

app.get("/api/receipts", (req, res) => {
    db.query("SELECT * FROM receipts ORDER BY created_at DESC", (err, results) => {
        if (err) {
            console.error('Error fetching receipts:', err);
            return res.status(500).json({ error: 'Failed to fetch receipts' });
        }
        res.json(results);
    });
});

// Delete receipt
app.delete("/api/receipts/:id", (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM receipts WHERE id = ?", [id], (err) => {
        if (err) {
            console.error('Error deleting receipt:', err);
            return res.status(500).json({ error: 'Failed to delete receipt' });
        }
        io.emit("receiptDeleted", { id: Number(id) });
        res.json({ success: true });
    });
});

// ---------------------------
// Tickets
// ---------------------------
app.post("/api/tickets", (req, res) => {
    const { content } = req.body;
    db.query("INSERT INTO tickets (content) VALUES (?)", [content], (err, result) => {
        if (err) {
            console.error('Error inserting ticket:', err);
            return res.status(500).json({ error: 'Failed to save ticket' });
        }
        const ticket = {
            id: result.insertId,
            content,
            created_at: new Date().toISOString(),
            escalated: 0
        };
        io.emit("ticketCreated", ticket);
        res.json({ id: result.insertId, success: true });
    });
});

app.get("/api/tickets", (req, res) => {
    db.query("SELECT * FROM tickets ORDER BY created_at DESC", (err, results) => {
        if (err) {
            console.error('Error fetching tickets:', err);
            return res.status(500).json({ error: 'Failed to fetch tickets' });
        }
        res.json(results);
    });
});

app.delete("/api/tickets/:id", (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM tickets WHERE id = ?", [id], (err) => {
        if (err) {
            console.error('Error deleting ticket:', err);
            return res.status(500).json({ error: 'Failed to delete ticket' });
        }
        io.emit("ticketDeleted", { id: Number(id) });
        res.json({ success: true });
    });
});

// ---------------------------
// Escalate Ticket
// ---------------------------
app.post("/api/escalate-ticket", (req, res) => {
    const { ticket_id } = req.body;
    db.query("UPDATE tickets SET escalated = 1 WHERE id = ?", [ticket_id], (err) => {
        if (err) {
            console.error('Error escalating ticket:', err);
            return res.status(500).json({ error: 'Failed to escalate ticket' });
        }
        io.emit("ticketEscalated", { ticket_id });
        res.json({ success: true });
    });
});

// ---------------------------
// Escalate Receipt
// ---------------------------
app.post("/api/escalate-receipt", (req, res) => {
    const { receipt_id } = req.body;
    db.query("UPDATE receipts SET escalated = 1 WHERE id = ?", [receipt_id], (err) => {
        if (err) {
            console.error('Error escalating receipt:', err);
            return res.status(500).json({ error: 'Failed to escalate receipt' });
        }
        io.emit("receiptEscalated", { receipt_id });
        res.json({ success: true });
    });
});

// ---------------------------
// Escalations
// ---------------------------
app.post("/api/escalate", (req, res) => {
    const { conversation_id, name } = req.body;
    const checkSql = "SELECT * FROM escalations WHERE conversation_id = ?";
    db.query(checkSql, [conversation_id], (err, result) => {
        if (result.length > 0) return res.json({ success: true, message: "Already escalated" });

        const insertSql = "INSERT INTO escalations (conversation_id, customer_name) VALUES (?, ?)";
        db.query(insertSql, [conversation_id, name], (err) => {
            if (err) return res.status(500).send("DB error");
            res.json({ success: true });
        });
    });
});

// Claim an escalation (staff accepts the conversation)
app.post('/api/claim-escalation', (req, res) => {
    const { conversation_id, staff_name } = req.body;
    const sql = "UPDATE escalations SET claimed_by = ?, claim_time = CURRENT_TIMESTAMP, alarm_active = 0 WHERE conversation_id = ?";
    db.query(sql, [staff_name || null, conversation_id], (err) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        // clear any existing snooze timers
        if (escalationTimers.has(conversation_id)) {
            clearTimeout(escalationTimers.get(conversation_id));
            escalationTimers.delete(conversation_id);
        }
        io.emit('escalationClaimed', { conversation_id, claimed_by: staff_name });
        io.emit('stopAlarm', { conversation_id });
        res.json({ success: true });
    });
});

// Snooze an escalation for N seconds (stop alarm temporarily)
app.post('/api/snooze-escalation', (req, res) => {
    const { conversation_id, staff_name, seconds } = req.body;
    const snoozeSeconds = Number(seconds) || 60;
    const updateSql = "UPDATE escalations SET snoozed_until = DATE_ADD(NOW(), INTERVAL ? SECOND), alarm_active = 0 WHERE conversation_id = ?";
    db.query(updateSql, [snoozeSeconds, conversation_id], (err) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        // clear any existing timer first
        if (escalationTimers.has(conversation_id)) {
            clearTimeout(escalationTimers.get(conversation_id));
            escalationTimers.delete(conversation_id);
        }
        // set timer to reactivate alarm after snooze
        const t = setTimeout(() => {
            // Reactivate alarm if still not claimed
            db.query('SELECT claimed_by FROM escalations WHERE conversation_id = ?', [conversation_id], (qErr, rows) => {
                if (qErr) return console.log('Error checking claimed status after snooze:', qErr);
                if (rows && rows[0] && !rows[0].claimed_by) {
                    db.query('UPDATE escalations SET alarm_active = 1, snoozed_until = NULL WHERE conversation_id = ?', [conversation_id], (uErr) => {
                        if (uErr) return console.log('Error reactivating escalation alarm:', uErr);
                        io.emit('escalationRaised', { conversationId: conversation_id });
                        io.emit('handoffAlert', { conversationId: conversation_id });
                    });
                }
            });
            escalationTimers.delete(conversation_id);
        }, snoozeSeconds * 1000);
        escalationTimers.set(conversation_id, t);

        io.emit('escalationSnoozed', { conversation_id, by: staff_name, seconds: snoozeSeconds });
        io.emit('stopAlarm', { conversation_id });
        res.json({ success: true });
    });
});

app.get("/api/escalations", (req, res) => {
    db.query(`
        SELECT e.*, c.phone, c.name, c.created_at
        FROM escalations e
        JOIN conversations c ON e.conversation_id = c.id
        ORDER BY e.escalated_at DESC
    `, (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(results);
    });
});

app.delete("/api/escalate/:conversation_id", (req, res) => {
    const convoId = req.params.conversation_id;
    db.query("DELETE FROM escalations WHERE conversation_id = ?", [convoId], (err) => {
        if (err) return res.status(500).send("DB error");
        res.json({ success: true });
    });
});

// Resolve escalation
app.post("/api/resolve", (req, res) => {
    const { conversation_id } = req.body;
    // Delete from escalations
    db.query("DELETE FROM escalations WHERE conversation_id = ?", [conversation_id], (err) => {
        if (err) return res.status(500).json({ error: "DB error" });
        // Insert into resolved
        db.query("INSERT INTO resolved (conversation_id) VALUES (?)", [conversation_id], (err) => {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        });
    });
});

app.get("/api/resolved", (req, res) => {
    db.query(`
        SELECT r.*, c.phone, c.name, c.created_at
        FROM resolved r
        JOIN conversations c ON r.conversation_id = c.id
        ORDER BY r.resolved_at DESC
    `, (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(results);
    });
});

app.post("/api/refund", (req, res) => {
    const { conversation_id, name } = req.body;
    db.query("DELETE FROM escalations WHERE conversation_id = ?", [conversation_id], (err) => {
        if (err) return res.status(500).json({ error: "DB error" });
        db.query("INSERT INTO resolved (conversation_id) VALUES (?)", [conversation_id], (resolvedErr) => {
            if (resolvedErr) {
                console.warn('Resolved insert failed, continuing to refund insert:', resolvedErr);
            }
            db.query(
                "INSERT INTO refunds (conversation_id, customer_name) VALUES (?, ?)",
                [conversation_id, name || null],
                (err) => {
                    if (err) return res.status(500).json({ error: "DB error" });
                    res.json({ success: true });
                }
            );
        });
    });
});

app.post("/api/delivery-issue", (req, res) => {
    const { conversation_id, name } = req.body;
    db.query("DELETE FROM escalations WHERE conversation_id = ?", [conversation_id], (err) => {
        if (err) return res.status(500).json({ error: "DB error" });
        db.query("INSERT INTO resolved (conversation_id) VALUES (?)", [conversation_id], (resolvedErr) => {
            if (resolvedErr) {
                console.warn('Resolved insert failed, continuing to delivery insert:', resolvedErr);
            }
            db.query(
                "INSERT INTO delivery_issues (conversation_id, customer_name) VALUES (?, ?)",
                [conversation_id, name || null],
                (err) => {
                    if (err) return res.status(500).json({ error: "DB error" });
                    res.json({ success: true });
                }
            );
        });
    });
});

app.get("/api/refunds", (req, res) => {
    db.query(`
        SELECT f.*, c.phone, c.name, c.platform
        FROM refunds f
        LEFT JOIN conversations c ON f.conversation_id = c.id
        ORDER BY f.refunded_at DESC
    `, (err, results) => {
        if (err) {
            console.error('Refunds query error:', err);
            return res.status(500).json({ error: err.message || "Database error" });
        }
        res.json(results);
    });
});

app.get("/api/delivery-issues", (req, res) => {
    db.query(`
        SELECT d.*, c.phone, c.name, c.platform
        FROM delivery_issues d
        LEFT JOIN conversations c ON d.conversation_id = c.id
        ORDER BY d.reported_at DESC
    `, (err, results) => {
        if (err) {
            console.error('Delivery issues query error:', err);
            return res.status(500).json({ error: err.message || "Database error" });
        }
        res.json(results);
    });
});

// ---------------------------
// Orders
// ---------------------------
app.get('/api/orders/:phone', (req, res) => {
    const phone = req.params.phone;
    
    db.query(
        'SELECT * FROM orders WHERE phone = ? ORDER BY order_date DESC LIMIT 10',
        [phone],
        (err, results) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json(results);
        }
    );
});

app.get('/api/orders-summary/:phone', (req, res) => {
    const phone = req.params.phone;
    
    db.query(
        'SELECT COUNT(*) as total_orders, SUM(total_amount) as total_spent FROM orders WHERE phone = ?',
        [phone],
        (err, results) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json(results[0]);
        }
    );
});

// Get all orders (for Orders page)
app.get('/api/orders', isAuthenticated, (req, res) => {
    db.query(
        'SELECT id, order_id, customer_name, phone, product, amount, COALESCE(total_amount, amount) AS total_amount, status, order_date FROM orders ORDER BY order_date DESC',
        (err, results) => {
            if (err) {
                console.error('Error fetching orders:', err);
                return res.status(500).json({ error: "Database error" });
            }
            // Format results for frontend
            const formattedResults = results.map(order => ({
                id: order.order_id,
                customerName: order.customer_name,
                product: order.product,
                amount: parseFloat(order.total_amount) || 0,
                status: order.status,
                date: new Date(order.order_date).toLocaleDateString()
            }));
            res.json(formattedResults);
        }
    );
});

// Create new order
app.post('/api/orders', isAuthenticated, (req, res) => {
    const { customerName, phone, product, amount, status } = req.body;
    
    if (!customerName || !product || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Generate order ID
    const orderId = `ORD-${Date.now()}`;
    
    db.query(
        'INSERT INTO orders (order_id, customer_name, phone, product, amount, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, customerName, phone || null, product, amount, amount, status || 'confirmed'],
        (err, result) => {
            if (err) {
                console.error('Error creating order:', err);
                return res.status(500).json({ error: "Database error" });
            }

            const responsePayload = { success: true, orderId, id: result.insertId };

            startDeliverySimulationForOrder(orderId, (deliveryErr) => {
                if (deliveryErr) {
                    console.error('Failed to auto-start delivery for order:', orderId, deliveryErr);
                }
                res.json(responsePayload);
            });
        }
    );
});

// Update order status
app.put('/api/orders/:orderId', isAuthenticated, (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    
    if (!status) {
        return res.status(400).json({ error: "Status is required" });
    }

    db.query(
        'UPDATE orders SET status = ? WHERE order_id = ?',
        [status, orderId],
        (err, result) => {
            if (err) {
                console.error('Error updating order:', err);
                return res.status(500).json({ error: "Database error" });
            }
            res.json({ success: true, message: "Order updated" });
        }
    );
});

// Debug endpoint - see all orders in database
app.get('/api/debug/all-orders', (req, res) => {
    db.query('SELECT * FROM orders ORDER BY order_date DESC LIMIT 20', (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(results);
    });
});

// ---------------------------
// Delivery Tracking System
// ---------------------------

// Get tracking info for an order
app.get('/api/tracking/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    
    db.query(
        `SELECT o.id as order_id_num, o.order_id, o.customer_name, o.phone, o.product, o.items, o.amount, o.total_amount, o.status, o.order_date, o.created_at, o.updated_at, o.conversation_id,
         d.id as delivery_id, d.rider_name, d.vehicle, d.current_lat, d.current_lng, d.customer_lat, d.customer_lng, d.delivery_status, 
         d.order_confirmed_time, d.rider_assigned_time, d.picked_up_time, d.in_transit_time, d.arriving_time, d.delivered_time
         FROM orders o 
         LEFT JOIN deliveries d ON o.id = d.order_id 
         WHERE o.order_id = ?`,
        [orderId],
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: "Database error" });
            }
            
            if (!results || results.length === 0) {
                return res.status(404).json({ error: "Order not found" });
            }
            
            const order = results[0];
            res.json({
                id: order.order_id_num,
                order_id: order.order_id,
                customer_name: order.customer_name,
                phone: order.phone,
                product: order.product,
                items: order.items,
                total_amount: order.total_amount,
                status: order.status,
                order_date: order.order_date,
                delivery: order.delivery_status ? {
                    id: order.delivery_id,
                    status: order.delivery_status || 'pending',
                    rider_name: order.rider_name || 'Assigned Rider',
                    vehicle: order.vehicle || 'Motorcycle',
                    current_lat: order.current_lat,
                    current_lng: order.current_lng,
                    customer_lat: order.customer_lat,
                    customer_lng: order.customer_lng,
                    order_confirmed_time: order.order_confirmed_time,
                    rider_assigned_time: order.rider_assigned_time,
                    picked_up_time: order.picked_up_time,
                    in_transit_time: order.in_transit_time,
                    arriving_time: order.arriving_time,
                    delivered_time: order.delivered_time
                } : null
            });
        }
    );
});

// Get all active deliveries
app.get('/api/deliveries/active', (req, res) => {
    db.query(
        `SELECT d.id, d.order_id, o.order_id as order_code, d.rider_name, d.vehicle, d.current_lat, d.current_lng, d.customer_lat, d.customer_lng, d.delivery_status 
         FROM deliveries d 
         LEFT JOIN orders o ON d.order_id = o.id 
         WHERE d.delivery_status != 'delivered' AND d.delivery_status != 'cancelled'
         ORDER BY d.updated_at DESC`,
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: "Database error" });
            }
            
            const deliveries = (results || []).map(d => ({
                id: d.id,
                order_id: d.order_code,
                rider_name: d.rider_name,
                vehicle: d.vehicle,
                current_lat: parseFloat(d.current_lat),
                current_lng: parseFloat(d.current_lng),
                customer_lat: parseFloat(d.customer_lat),
                customer_lng: parseFloat(d.customer_lng),
                delivery_status: d.delivery_status || 'pending'
            }));
            
            res.json(deliveries);
        }
    );
});

const deliveryTimers = new Map();

function clearDeliveryTimers(deliveryId) {
    const timers = deliveryTimers.get(deliveryId);
    if (timers) {
        timers.forEach((timer) => clearTimeout(timer));
        deliveryTimers.delete(deliveryId);
    }
}

function broadcastDeliveryUpdate(orderId, callback) {
    db.query(`SELECT o.*, d.* FROM orders o LEFT JOIN deliveries d ON o.id = d.order_id WHERE o.order_id = ?`, [orderId], (err, results) => {
        if (err) return callback(err);
        if (!results || results.length === 0) return callback(new Error('Order not found'));
        const order = results[0];
        const responseData = {
            id: order.id,
            order_id: order.order_id,
            customer_name: order.customer_name,
            total_amount: order.total_amount,
            items: order.items,
            delivery: order.delivery_status ? {
                status: order.delivery_status,
                rider_name: order.rider_name,
                vehicle: order.vehicle,
                current_lat: order.current_lat,
                current_lng: order.current_lng,
                customer_lat: order.customer_lat,
                customer_lng: order.customer_lng,
                order_confirmed_time: order.order_confirmed_time,
                rider_assigned_time: order.rider_assigned_time,
                picked_up_time: order.picked_up_time,
                in_transit_time: order.in_transit_time,
                arriving_time: order.arriving_time,
                delivered_time: order.delivered_time
            } : null
        };
        io.emit('delivery-update', responseData);
        callback(null, responseData);
    });
}

function updateDeliveryStatus(deliveryId, orderDbId, orderId, newStatus, timeField, callback) {
    const queries = [];
    const params = [];

    if (timeField) {
        queries.push(`${timeField} = NOW()`);
    }
    queries.push(`delivery_status = ?`);
    params.push(newStatus, deliveryId);

    const sql = `UPDATE deliveries SET ${queries.join(', ')} WHERE id = ?`;
    db.query(sql, params, (err) => {
        if (err) return callback(err);
        db.query(`UPDATE orders SET status = ? WHERE id = ?`, [newStatus, orderDbId], (err) => {
            if (err) console.error('Failed to update order status:', err);
            broadcastDeliveryUpdate(orderId, () => callback(null));
        });
    });
}

function moveRiderTowardsCustomer(deliveryId, orderId, intervalRef) {
    db.query('SELECT * FROM deliveries WHERE id = ?', [deliveryId], (err, results) => {
        if (err || !results || results.length === 0) {
            clearInterval(intervalRef);
            return;
        }

        const delivery = results[0];
        const currentLat = parseFloat(delivery.current_lat);
        const currentLng = parseFloat(delivery.current_lng);
        const customerLat = parseFloat(delivery.customer_lat);
        const customerLng = parseFloat(delivery.customer_lng);
        const distance = Math.sqrt(Math.pow(customerLat - currentLat, 2) + Math.pow(customerLng - currentLng, 2));
        const step = 0.0004;

        if (distance <= step) {
            db.query(`UPDATE deliveries SET current_lat = ?, current_lng = ? WHERE id = ?`, [customerLat, customerLng, deliveryId], (err) => {
                if (err) console.error('Failed to update rider location:', err);
                broadcastDeliveryUpdate(orderId, () => {});
            });
            clearInterval(intervalRef);
            return;
        }

        const newLat = currentLat + ((customerLat - currentLat) * (step / distance));
        const newLng = currentLng + ((customerLng - currentLng) * (step / distance));
        db.query(`UPDATE deliveries SET current_lat = ?, current_lng = ? WHERE id = ?`, [newLat, newLng, deliveryId], (err) => {
            if (err) {
                console.error('Failed to update rider location:', err);
                return;
            }
            broadcastDeliveryUpdate(orderId, () => {});
        });
    });
}

function scheduleDeliveryLifecycle(deliveryId, orderId, orderDbId, customerLat, customerLng) {
    clearDeliveryTimers(deliveryId);
    const timers = [];
    deliveryTimers.set(deliveryId, timers);

    const assignDelay = 20 + Math.floor(Math.random() * 15); // 20-35 seconds
    const pickupDelay = assignDelay + 90 + Math.floor(Math.random() * 45); // 1.5-2.25 min after assign
    const transitDelay = pickupDelay + 35 + Math.floor(Math.random() * 25); // 35-60 sec after pickup
    const arrivingDelay = transitDelay + 180 + Math.floor(Math.random() * 80); // 3-4.5 min after in transit
    const deliveredDelay = arrivingDelay + 80 + Math.floor(Math.random() * 40); // 1.5-2.5 min after arriving

    // Rider assigned
    timers.push(setTimeout(() => {
        updateDeliveryStatus(deliveryId, orderDbId, orderId, 'rider_assigned', 'rider_assigned_time', () => {});
    }, assignDelay * 1000));

    // Food picked up after rider assignment
    timers.push(setTimeout(() => {
        updateDeliveryStatus(deliveryId, orderDbId, orderId, 'picked_up', 'picked_up_time', () => {});
    }, pickupDelay * 1000));

    // In transit after pickup
    timers.push(setTimeout(() => {
        updateDeliveryStatus(deliveryId, orderDbId, orderId, 'in_transit', 'in_transit_time', () => {
            const movementInterval = setInterval(() => moveRiderTowardsCustomer(deliveryId, orderId, movementInterval), 2500);
            timers.push(movementInterval);
        });
    }, transitDelay * 1000));

    // Arriving soon
    timers.push(setTimeout(() => {
        updateDeliveryStatus(deliveryId, orderDbId, orderId, 'arriving', 'arriving_time', () => {});
    }, arrivingDelay * 1000));

    // Delivered
    timers.push(setTimeout(() => {
        updateDeliveryStatus(deliveryId, orderDbId, orderId, 'delivered', 'delivered_time', () => {
            clearDeliveryTimers(deliveryId);
        });
    }, deliveredDelay * 1000));
}

function startDeliverySimulationForOrder(orderId, callback) {
    db.query('SELECT * FROM orders WHERE order_id = ?', [orderId], (err, results) => {
        if (err || !results || results.length === 0) {
            return callback(err || new Error('Order not found'));
        }

        const order = results[0];
        const restaurantLat = 9.0765;
        const restaurantLng = 7.3986;
        const customerLat = 9.0865 + (Math.random() - 0.5) * 0.1;
        const customerLng = 7.4086 + (Math.random() - 0.5) * 0.1;

        const riders = [
            { name: 'Chioma Adeyemi', vehicle: 'Motorcycle' },
            { name: 'Tunde Okafor', vehicle: 'Motorcycle' },
            { name: 'Zainab Hassan', vehicle: 'Motorcycle' }
        ];
        const rider = riders[Math.floor(Math.random() * riders.length)];

        db.query(
            `INSERT INTO deliveries (order_id, rider_name, vehicle, current_lat, current_lng, customer_lat, customer_lng, delivery_status, order_confirmed_time) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [order.id, rider.name, rider.vehicle, restaurantLat, restaurantLng, customerLat, customerLng, 'order_confirmed'],
            (err, result) => {
                if (err) {
                    console.error('Delivery start error:', err);
                    return callback(err);
                }
                const deliveryId = result.insertId;
                scheduleDeliveryLifecycle(deliveryId, orderId, order.id, customerLat, customerLng);
                callback(null, rider);
            }
        );
    });
}

// Start delivery simulation for an order
app.post('/api/delivery/start', (req, res) => {
    const orderId = req.body.order_id;

    startDeliverySimulationForOrder(orderId, (err, rider) => {
        if (err) {
            if (err.message === 'Order not found') {
                return res.status(404).json({ error: 'Order not found' });
            }
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ success: true, message: 'Delivery started', rider });
    });
});

// Update rider location during delivery
app.post('/api/delivery/update-location', (req, res) => {
    const orderId = req.body.order_id;
    
    db.query('SELECT * FROM deliveries WHERE order_id = (SELECT id FROM orders WHERE order_id = ?)', [orderId], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.status(404).json({ error: "Delivery not found" });
        }
        
        const delivery = results[0];
        const currentLat = parseFloat(delivery.current_lat);
        const currentLng = parseFloat(delivery.current_lng);
        const customerLat = parseFloat(delivery.customer_lat);
        const customerLng = parseFloat(delivery.customer_lng);
        
        // Move rider toward customer location
        const distance = Math.sqrt(Math.pow(customerLat - currentLat, 2) + Math.pow(customerLng - currentLng, 2));
        const step = Math.max(0.0003, Math.min(0.0015, distance * 0.18));

        let newLat = currentLat;
        let newLng = currentLng;
        let newStatus = delivery.delivery_status;
        let updateFields = [];

        if (delivery.delivery_status === 'picked_up' || delivery.delivery_status === 'in_transit' || delivery.delivery_status === 'arriving') {
            if (distance > step) {
                newLat = currentLat + (customerLat - currentLat) * (step / distance);
                newLng = currentLng + (customerLng - currentLng) * (step / distance);

                if (delivery.delivery_status === 'picked_up') {
                    newStatus = 'in_transit';
                    updateFields.push(`in_transit_time = NOW()`);
                } else if (delivery.delivery_status === 'in_transit' && distance < 1.2) {
                    newStatus = 'arriving';
                    if (delivery.delivery_status !== 'arriving') {
                        updateFields.push(`arriving_time = NOW()`);
                    }
                } else {
                    newStatus = delivery.delivery_status;
                }
            } else {
                newLat = customerLat;
                newLng = customerLng;
                newStatus = 'delivered';
                if (delivery.delivery_status !== 'delivered') {
                    updateFields.push(`arriving_time = NOW()`);
                    updateFields.push(`delivered_time = NOW()`);
                }
            }
        } else {
            // Rider waiting for assignment or pickup
            newStatus = delivery.delivery_status;
        }

        // Update only if changed
        if (newStatus !== delivery.delivery_status && !updateFields.includes(`${newStatus}_time = NOW()`)) {
            if (newStatus === 'in_transit' && delivery.delivery_status !== 'in_transit') {
                updateFields.push(`in_transit_time = NOW()`);
            } else if (newStatus === 'arriving' && delivery.delivery_status !== 'arriving') {
                updateFields.push(`arriving_time = NOW()`);
            }
        }
        
        const fieldsStr = updateFields.length > 0 ? ', ' + updateFields.join(', ') : '';
        
        db.query(
            `UPDATE deliveries SET current_lat = ?, current_lng = ?, delivery_status = ? ${fieldsStr} 
             WHERE id = ?`,
            [newLat, newLng, newStatus, delivery.id],
            (err) => {
                if (err) {
                    console.error('Location update error:', err);
                    return res.status(500).json({ error: "Database error" });
                }
                
                // Fetch updated delivery
                db.query(`SELECT o.*, d.* FROM orders o LEFT JOIN deliveries d ON o.id = d.order_id WHERE o.order_id = ?`, [orderId], (err, updated) => {
                    if (err) return res.status(500).json({ error: "Database error" });
                    
                    const order = updated[0];
                    const responseData = {
                        id: order.id,
                        order_id: order.order_id,
                        customer_name: order.customer_name,
                        total_amount: order.total_amount,
                        items: order.items,
                        delivery: {
                            status: order.delivery_status,
                            rider_name: order.rider_name,
                            current_lat: order.current_lat,
                            current_lng: order.current_lng,
                            customer_lat: order.customer_lat,
                            customer_lng: order.customer_lng
                        }
                    };
                    
                    // Broadcast update via Socket.io
                    io.emit('delivery-update', responseData);
                    res.json(responseData);
                });
            }
        );
    });
});

// Complete delivery
app.post('/api/delivery/complete', (req, res) => {
    const orderId = req.body.order_id;
    
    db.query('SELECT id FROM orders WHERE order_id = ?', [orderId], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }
        
        const orderId_db = results[0].id;
        
        db.query(
            `UPDATE deliveries SET delivery_status = ?, delivered_time = NOW() WHERE order_id = ?`,
            ['delivered', orderId_db],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: "Database error" });
                }
                
                // Also update order status
                db.query(`UPDATE orders SET status = ? WHERE id = ?`, ['delivered', orderId_db], (err) => {
                    if (err) console.error('Order status update error:', err);
                });
                
                res.json({ success: true, message: "Delivery completed" });
            }
        );
    });
});

// ---------------------------
// Settings
// ---------------------------
app.get('/api/settings', (req, res) => {
    const userId = req.session.userId;
    db.query('SELECT * FROM settings WHERE user_id = ?', [userId], (err, result) => {
        if (err) return res.json({});
        res.json(result[0] || {});
    });
});

app.post('/api/settings', (req, res) => {
    const userId = req.session.userId;
    const data = req.body;
    const query = `
        INSERT INTO settings 
        (user_id, displayName, email, autoReply, chatEnabled, msgAlert, ticketAlert, soundAlert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          displayName = VALUES(displayName),
          email = VALUES(email),
          autoReply = VALUES(autoReply),
          chatEnabled = VALUES(chatEnabled),
          msgAlert = VALUES(msgAlert),
          ticketAlert = VALUES(ticketAlert),
          soundAlert = VALUES(soundAlert)
    `;
    db.query(query, [
        userId,
        data.displayName,
        data.email,
        data.autoReply,
        data.chatEnabled,
        data.msgAlert,
        data.ticketAlert,
        data.soundAlert
    ], (err) => {
        if (err) return res.sendStatus(500);
        res.sendStatus(200);
    });
});

// ---------------------------
// Create HTTP server & Socket.IO
// ---------------------------
const httpServer = http.createServer(app);
const io = new Server(httpServer);

io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // Agent registers after connecting with their user info
    socket.on("agent:register", (agent) => {
        // agent: { userId, name, role }
        const record = Object.assign({}, agent, { socketId: socket.id, lastActive: Date.now(), activeConversation: null });
        onlineAgents.set(socket.id, record);
        // Broadcast presence list to all clients
        const list = Array.from(onlineAgents.values()).map(a => ({ userId: a.userId, name: a.name, role: a.role, activeConversation: a.activeConversation }));
        io.emit("presenceUpdate", list);
        console.log("Agent registered for presence:", record);
    });

    // Agent notifies which conversation they're viewing/active on
    socket.on("agent:activeConversation", (data) => {
        const rec = onlineAgents.get(socket.id);
        if (rec) {
            rec.activeConversation = data && data.conversationId ? data.conversationId : null;
            rec.lastActive = Date.now();
            onlineAgents.set(socket.id, rec);
        }
        const list = Array.from(onlineAgents.values()).map(a => ({ userId: a.userId, name: a.name, role: a.role, activeConversation: a.activeConversation }));
        io.emit("presenceUpdate", list);
    });

    // Typing indicators
    socket.on("typing", (data) => {
        // data: { conversationId, userId, name }
        if (!data || !data.conversationId) return;
        socket.broadcast.emit("typing", data);
    });

    socket.on("stopTyping", (data) => {
        if (!data || !data.conversationId) return;
        socket.broadcast.emit("stopTyping", data);
    });

    socket.on("disconnect", () => {
        onlineAgents.delete(socket.id);
        const list = Array.from(onlineAgents.values()).map(a => ({ userId: a.userId, name: a.name, role: a.role, activeConversation: a.activeConversation }));
        io.emit("presenceUpdate", list);
        console.log("Client disconnected:", socket.id);
    });
});

// Debug route: emit a newMessage event (useful for testing the UI/websocket)
// POST JSON: { conversation_id: 123, sender: 'instagram', message: 'hello' }
// GET query: /debug/emit-new-message?conversation_id=123&message=hello
app.all('/debug/emit-new-message', (req, res) => {
    const data = Object.assign({}, req.method === 'GET' ? req.query : req.body || {});
    const conversation_id = data.conversation_id || data.conversationId || data.id;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id required' });
    const payload = {
        conversation_id: conversation_id,
        sender: data.sender || 'instagram',
        message: data.message || data.msg || 'Debug message',
        created_at: new Date().toISOString()
    };
    try {
        io.emit('newMessage', payload);
        console.log('Debug emit newMessage', payload);
        res.json({ ok: true, emitted: payload });
    } catch (err) {
        console.error('Debug emit failed', err);
        res.status(500).json({ error: 'emit failed', details: String(err) });
    }
});

setHandoffCallback((conversationId) => {
    disableAIForConversation(conversationId);
    // Insert or update escalations table and emit an escalation event with details
    db.query("SELECT c.phone, c.id FROM conversations c WHERE c.id = ?", [conversationId], (err, results) => {
        const phone = (results && results[0] && results[0].phone) ? results[0].phone : null;
        const customerName = phone || 'Unknown';
        const upsertSql = `INSERT INTO escalations (conversation_id, customer_name, alarm_active) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE escalated_at = CURRENT_TIMESTAMP, alarm_active = 1, snoozed_until = NULL, claimed_by = NULL, claim_time = NULL`;
        db.query(upsertSql, [conversationId, customerName], (uErr) => {
            if (uErr) console.log('Escalation upsert error:', uErr);
            io.emit("escalationRaised", { conversationId, customerName });
            // legacy event for other clients
            io.emit("handoffAlert", { conversationId });
        });
    });
});

// Add endpoint to fetch analytics data
app.get('/api/analytics', isAuthenticated, async (req, res) => {
    try {
        // Number of chats
        const [chats] = await db.promise().query('SELECT COUNT(*) AS count FROM conversations');
        // Number of tickets
        const [tickets] = await db.promise().query('SELECT COUNT(*) AS count FROM tickets');
        // Number of escalated tickets
        const [escalatedTickets] = await db.promise().query('SELECT COUNT(*) AS count FROM tickets WHERE escalated = 1');
        // Number of receipts
        const [receipts] = await db.promise().query('SELECT COUNT(*) AS count FROM receipts');
        // Number of escalated receipts
        const [escalatedReceipts] = await db.promise().query('SELECT COUNT(*) AS count FROM receipts WHERE escalated = 1');
        // Number of escalated chats
        const [escalatedChats] = await db.promise().query('SELECT COUNT(*) AS count FROM escalations');
        // Number of resolved chats
        const [resolvedChats] = await db.promise().query('SELECT COUNT(*) AS count FROM resolved');

        res.json({
            numChats: chats[0].count,
            numTickets: tickets[0].count,
            numEscalatedTickets: escalatedTickets[0].count,
            numReceipts: receipts[0].count,
            numEscalatedReceipts: escalatedReceipts[0].count,
            numEscalatedChats: escalatedChats[0].count,
            numResolvedChats: resolvedChats[0].count
        });
    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
});

// API endpoint for ticket counts by time period
app.get('/api/tickets-by-period', async (req, res) => {
    try {
        const [rows] = await db.promise().query(`
            SELECT
                SUM(DATE(created_at) = CURDATE()) AS daily,
                SUM(YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)) AS weekly,
                SUM(YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())) AS monthly
            FROM tickets
        `);

        const counts = rows[0] || { daily: 0, weekly: 0, monthly: 0 };
        console.log('tickets-by-period counts', counts);

        res.json({
            daily: Number(counts.daily) || 0,
            weekly: Number(counts.weekly) || 0,
            monthly: Number(counts.monthly) || 0
        });
    } catch (error) {
        console.error('Error fetching tickets by period:', error);
        res.status(500).json({ error: 'Failed to fetch tickets by period' });
    }
});

// API endpoint for message counts by time period (received messages only)
app.get('/api/messages-by-period', isAuthenticated, async (req, res) => {
    try {
        const [dailyMessages] = await db.promise().query(`
            SELECT COUNT(*) AS count FROM messages
            WHERE sender <> 'sent' AND DATE(created_at) = CURDATE()
        `);

        const [weeklyMessages] = await db.promise().query(`
            SELECT COUNT(*) AS count FROM messages
            WHERE sender <> 'sent' AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)
        `);

        const [monthlyMessages] = await db.promise().query(`
            SELECT COUNT(*) AS count FROM messages
            WHERE sender <> 'sent' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())
        `);

        const [totalMessages] = await db.promise().query(`
            SELECT COUNT(*) AS count FROM messages
            WHERE sender <> 'sent'
        `);

        console.log('Messages counts:', {
            daily: dailyMessages[0].count,
            weekly: weeklyMessages[0].count,
            monthly: monthlyMessages[0].count,
            total: totalMessages[0].count
        });

        res.json({
            daily: dailyMessages[0].count,
            weekly: weeklyMessages[0].count,
            monthly: monthlyMessages[0].count
        });
    } catch (error) {
        console.error('Error fetching messages by period:', error);
        res.status(500).json({ error: 'Failed to fetch messages by period' });
    }
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 3000;
// Ensure `deliveries` table exists for delivery simulation
db.query(`
    CREATE TABLE IF NOT EXISTS deliveries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        rider_name VARCHAR(255),
        vehicle VARCHAR(128),
        current_lat DOUBLE,
        current_lng DOUBLE,
        customer_lat DOUBLE,
        customer_lng DOUBLE,
        delivery_status VARCHAR(64) DEFAULT 'pending',
        order_confirmed_time DATETIME,
        rider_assigned_time DATETIME,
        picked_up_time DATETIME,
        in_transit_time DATETIME,
        arriving_time DATETIME,
        delivered_time DATETIME,
        created_at DATETIME DEFAULT NOW(),
        updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
        INDEX (order_id),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`, (err) => {
    if (err) {
        console.error('Could not create deliveries table:', err);
    } else {
        console.log('Deliveries table ready');
    }
});
httpServer.listen(PORT, () => {
    console.log(`✅🎲Server running on port ${PORT}🎲`);
});

// ---------------------------
// Translation API
// ---------------------------
app.post('/api/translate', async (req, res) => {
    try {
        const { text, target } = req.body;
        if (!text) return res.status(400).json({ error: 'Missing text to translate' });
        const tgt = (target || 'en').toString();

        // Prefer configured provider via env, otherwise use LibreTranslate public instance
        if (process.env.TRANSLATE_PROVIDER === 'google' && process.env.GOOGLE_API_KEY) {
            // Google Translate v2 simple request
            const apiKey = process.env.GOOGLE_API_KEY;
            const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: text, target: tgt, format: 'text' })
            });
            const data = await resp.json();
            const translated = data?.data?.translations?.[0]?.translatedText || null;
            return res.json({ translatedText: translated });
        }

        // Fallback to LibreTranslate
        const libreUrl = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com/translate';
        const headers = { 'Content-Type': 'application/json' };
        if (process.env.LIBRETRANSLATE_API_KEY) headers['Authorization'] = `Bearer ${process.env.LIBRETRANSLATE_API_KEY}`;

        const r = await fetch(libreUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ q: text, source: 'auto', target: tgt, format: 'text' })
        });
        const json = await r.json();
        const translated = json?.translatedText || json?.translated_text || null;
        if (!translated) {
            return res.status(500).json({ error: 'Translation provider error', raw: json });
        }
        res.json({ translatedText: translated });
    } catch (err) {
        console.error('Translation error:', err);
        res.status(500).json({ error: 'Translation failed' });
    }
});