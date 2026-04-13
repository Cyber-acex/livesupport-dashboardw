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

// Create orders table if not exists
db.query(`
    CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT,
        phone VARCHAR(255),
        items TEXT,
        total_amount DECIMAL(10, 2),
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'confirmed',
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
`, (err) => {
    if (err) console.log("Error creating orders table:", err);
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
    req.session.destroy();
    res.redirect("/login.html");
});

// ---------------------------
// User API
// ---------------------------
app.get("/api/user", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    res.json({
        name: req.session.user.name,
        role: req.session.user.role
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
                    "INSERT INTO replies (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                    [conversation_id, 'sent', message],
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

function isOrderConfirmation(text) {
    const confirmKeywords = ['yes', 'yep', 'yup', 'confirm', 'ok', 'okay', 'sure', 'go', 'order it', 'proceed', 'do it'];
    const lowerText = text.toLowerCase().trim();
    return confirmKeywords.some(keyword => lowerText.includes(keyword));
}

function extractOrderDetails(aiMessage) {
    // Extract items and total from AI message
    const totalMatch = aiMessage.match(/\$(\d+(?:\.\d+)?)/);
    let total = totalMatch ? parseFloat(totalMatch[1]) : null;
    if (!total) {
        const totalAlt = aiMessage.match(/(?:total|comes to|is|amount|cost)\s*\$?\s*(\d+(?:\.\d+)?)/i);
        total = totalAlt ? parseFloat(totalAlt[1]) : null;
    }

    let items = "Order";
    const itemsMatch = aiMessage.match(/(?:Your order|Order|I have your order as)\s*(.+?)(?:\s*(?:comes to|is|total|totals?|=|for)\s*\$?\d|\s*\(\s*\$\d)/i);
    if (itemsMatch && itemsMatch[1]) {
        items = itemsMatch[1].trim();
    } else {
        const fallbackMatch = aiMessage.match(/(?:Your order|Order|I have your order as)\s*(.+)/i);
        if (fallbackMatch && fallbackMatch[1]) {
            items = fallbackMatch[1].trim();
        }
    }

    // Normalize items text if needed
    items = items.replace(/\s+\(\s*\$\d+(?:\.\d+)?\s*\)/g, '').trim();
    if (!items) items = "Order";

    return { items, total };
}

function checkAndSaveOrderConfirmation(phone, conversationId, customerMessage) {
    return new Promise((resolve) => {
        if (!isOrderConfirmation(customerMessage)) {
            resolve(false);
            return;
        }

        // Get last few messages to find AI's order suggestion
        db.query(
            'SELECT sender, message FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 5',
            [conversationId],
            (err, messages) => {
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

                const { items, total } = extractOrderDetails(aiMessage.message);

                if (!total || total === 0) {
                    console.log("Order confirmation detected but no valid order total found in AI message:", aiMessage.message);
                    resolve(false);
                    return;
                }

                // Save order to database with order date and confirmed status
                db.query(
                    'INSERT INTO orders (conversation_id, phone, items, total_amount, order_date, status) VALUES (?, ?, ?, ?, NOW(), ?)',
                    [conversationId, phone, items, total, 'confirmed'],
                    (err, result) => {
                        if (err) {
                            console.log("Order save error:", err);
                            resolve(false);
                        } else {
                            console.log(`Order confirmed and saved: ${items} - $${total} from ${phone}`);
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
                "INSERT INTO replies (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                [conversation_id, 'sent', message],
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
                "INSERT INTO replies (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                [conversation_id, 'sent', savedMessage],
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
                                    await sendAutoReply(phone, "Your order has been confirmed an your is now being prepared for delivery🚚✅");
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
                                await sendAutoReply(phone, "Your order has been confirmed an your is now being prepared for delivery🚚✅");
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
                            await sendAutoReply(phone, "Your order has been confirmed an your is now being prepared for delivery🚚✅");
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
                        await sendAutoReply(phone, "Your order has been confirmed an your is now being prepared for delivery🚚✅");
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
app.post('/api/orders', (req, res) => {
    const { phone, items, total_amount, conversation_id } = req.body;
    
    if (!phone || !items || !total_amount) {
        return res.status(400).json({ error: "Missing required fields: phone, items, total_amount" });
    }
    
    db.query(
        'INSERT INTO orders (conversation_id, phone, items, total_amount) VALUES (?, ?, ?, ?)',
        [conversation_id || null, phone, items, total_amount],
        (err, result) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ success: true, order_id: result.insertId });
        }
    );
});

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

// Debug endpoint - see all orders in database
app.get('/api/debug/all-orders', (req, res) => {
    db.query('SELECT * FROM orders ORDER BY order_date DESC LIMIT 20', (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json(results);
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
    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

setHandoffCallback((conversationId) => {
    disableAIForConversation(conversationId);
    io.emit("handoffAlert", { conversationId });
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
httpServer.listen(PORT, () => {
    console.log(`✅🎲Server running on port ${PORT}🎲`);
});