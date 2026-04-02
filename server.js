// server.js
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const db = require("./db/database");
const { getCustomReply } = require("./replies");
const app = express();

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
    db.query("SELECT * FROM messages WHERE conversation_id = ?", [id], (err, result) => {
        if (err) throw err;
        res.json(result);
    });
});

// ---------------------------
// Send Message (Agent)
// ---------------------------
const axios = require("axios");

async function sendAutoReply(phone, message) {
    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
                    "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
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

app.post("/api/send-message", (req, res) => {
    const { conversation_id, message } = req.body;
    db.query("SELECT phone FROM conversations WHERE id = ?", [conversation_id], async (err, result) => {
        if (err) return res.sendStatus(500);
        if (!result || result.length === 0) return res.send("Conversation not found");

        const phone = result[0].phone;

        try {
            const response = await fetch(
                `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
                "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                [conversation_id, 'sent', message],
                (err) => {
                    if (err) console.log("MESSAGE INSERT ERROR:", err);
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

            res.send("Message sent");

        } catch (error) {
            console.log("SEND ERROR:", error);
            res.sendStatus(500);
        }
    });
});

// ---------------------------
// Customer Webhook
// ---------------------------
app.post("/webhook", (req, res) => {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const text = msg.text?.body;
    const sender = msg.from === process.env.PHONE_NUMBER_ID ? 'sent' : 'received';

    db.query("SELECT * FROM conversations WHERE phone = ?", [phone], (err, result) => {
        if (err) return console.log("🔥 REAL DB ERROR:", err);

        if (!result || result.length === 0) {
            // Create new conversation
            db.query("INSERT INTO conversations (phone, name) VALUES (?, ?)", [phone, phone], (err, newConv) => {
                if (err) return console.log("INSERT ERROR:", err);
                const convoId = newConv.insertId;
                db.query(
                    "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, ?, ?, NOW())",
                    [convoId, sender, text],
                    (err) => {
                        if (err) console.log("MESSAGE INSERT ERROR:", err);
                        else {
                            io.emit("newMessage", {
                                conversation_id: convoId,
                                sender: sender,
                                message: text,
                                created_at: new Date().toISOString()
                            });
                            // Send custom reply based on keywords
                            const reply = getCustomReply(text);
                            sendAutoReply(phone, reply);
                            // Auto-escalate if refund is mentioned
                            if (text.toLowerCase().includes("refund")) {
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
                (err) => {
                    if (err) console.log("MESSAGE INSERT ERROR:", err);
                    else {
                        io.emit("newMessage", {
                            conversation_id: convoId,
                            sender: sender,
                            message: text,
                            created_at: new Date().toISOString()
                        });
                        // Send custom reply based on keywords
                        const reply = getCustomReply(text);
                        sendAutoReply(phone, reply);
                        // Auto-escalate if refund is mentioned
                        if (text.toLowerCase().includes("refund")) {
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

    db.query("SELECT * FROM conversations WHERE phone = ?", [phone], (err, result) => {
        if (err) return res.sendStatus(500);

        if (!result || result.length === 0) {
            // Create new conversation
            db.query("INSERT INTO conversations (phone, name) VALUES (?, ?)", [phone, phone], (err, newConv) => {
                if (err) return res.sendStatus(500);
                const convoId = newConv.insertId;
                db.query(
                    "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, 'customer', ?, NOW())",
                    [convoId, text],
                    (err) => {
                        if (err) return res.sendStatus(500);
                        const messageData = {
                            conversation_id: convoId,
                            sender: "received",
                            message: text,
                            created_at: new Date().toISOString()
                        };
                        io.emit("newMessage", messageData);
                        res.json({ success: true, conversation_id: convoId });
                    }
                );
            });
        } else {
            const convoId = result[0].id;
            db.query(
                "INSERT INTO messages (conversation_id, sender, message, created_at) VALUES (?, 'customer', ?, NOW())",
                [convoId, text],
                (err) => {
                    if (err) return res.sendStatus(500);
                    const messageData = {
                        conversation_id: convoId,
                        sender: "received",
                        message: text,
                        created_at: new Date().toISOString()
                    };
                    io.emit("newMessage", messageData);
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
// Tickets
// ---------------------------
app.post("/api/tickets", (req, res) => {
    const { content } = req.body;
    db.query("INSERT INTO tickets (content) VALUES (?)", [content], (err, result) => {
        if (err) return res.sendStatus(500);
        const ticket = {
            id: result.insertId,
            content,
            created_at: new Date().toISOString()
        };
        // Emit a socket event so any connected dashboard can display an update instantly
        io.emit("ticketCreated", ticket);
        res.json({ id: result.insertId });
    });
});

app.get("/api/tickets", (req, res) => {
    db.query("SELECT * FROM tickets ORDER BY created_at DESC", (err, results) => {
        if (err) return res.sendStatus(500);
        res.json(results);
    });
});

// ---------------------------
// Escalate Ticket
// ---------------------------
app.post("/api/escalate-ticket", (req, res) => {
    const { ticket_id } = req.body;
    db.query("UPDATE tickets SET escalated = 1 WHERE id = ?", [ticket_id], (err) => {
        if (err) return res.sendStatus(500);
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

// Add endpoint to fetch analytics data
app.get('/api/analytics', async (req, res) => {
    try {
        // Number of chats
        const [chats] = await db.promise().query('SELECT COUNT(*) AS count FROM conversations');
        // Number of tickets
        const [tickets] = await db.promise().query('SELECT COUNT(*) AS count FROM tickets');
        // Number of escalated tickets
        const [escalatedTickets] = await db.promise().query('SELECT COUNT(*) AS count FROM tickets WHERE escalated = 1');
        // Number of escalated chats
        const [escalatedChats] = await db.promise().query('SELECT COUNT(*) AS count FROM escalations');
        // Number of resolved chats
        const [resolvedChats] = await db.promise().query('SELECT COUNT(*) AS count FROM resolved');

        res.json({
            numChats: chats[0].count,
            numTickets: tickets[0].count,
            numEscalatedTickets: escalatedTickets[0].count,
            numEscalatedChats: escalatedChats[0].count,
            numResolvedChats: resolvedChats[0].count
        });
    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`✅🎲Server running on port ${PORT}🎲`);
});