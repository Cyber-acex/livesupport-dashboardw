const http = require("http");
const { Server } = require("socket.io");

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const path = require("path");
const db = require("./db/database");

const app = express();

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

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {

    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";

    db.query(sql, [email, password], (err, result) => {

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

app.get("/api/user", (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({ error: "Not logged in" });
    }

    res.json({
        name: req.session.user.name,
        role: req.session.user.role
    });

});

app.get("/api/conversations", (req, res) => {

    db.query("SELECT * FROM conversations ORDER BY created_at DESC", (err, result) => {
        if (err) throw err;
        res.json(result);
    });

});
app.get("/api/messages/:id", (req, res) => {

    const id = req.params.id;

    db.query(
        "SELECT * FROM messages WHERE conversation_id = ?",
        [id],
        (err, result) => {
            if (err) throw err;
            res.json(result);
        }
    );

});

const axios = require("axios");

app.post("/api/send-message", (req, res) => {
    const { conversation_id, message } = req.body;

    // 1. Get phone number from DB
    db.query(
        "SELECT phone FROM conversations WHERE id = ?",
        [conversation_id],
        async (err, result) => {

            if (err) {
                console.log("DB ERROR:", err);
                return res.sendStatus(500);
            }

            if (!result || result.length === 0) {
                return res.send("Conversation not found");
            }

            const phone = result[0].phone;

            try {
                // 2. Send to WhatsApp API
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

                // 3. Save message to DB
                db.query(
                    "INSERT INTO messages (conversation_id, sender, message) VALUES (?, 'agent', ?)",
                    [conversation_id, message]
                );

                res.send("Message sent");

            } catch (error) {
                console.log("SEND ERROR:", error);
                res.sendStatus(500);
            }
        }
    );
});


app.post("/webhook", (req, res) => {

    const msg =
        req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (msg) {

        const phone = msg.from;
        const text = msg.text?.body;

        // 1️⃣ Check if conversation exists
        db.query(
    "SELECT * FROM conversations WHERE phone = ?",
    [phone],
    (err, result) => {

        if (err) {
            console.log("🔥 REAL DB ERROR:", err);
            return;
        }

        if (!result || result.length === 0) {

            console.log("No conversation found, creating one...");

            db.query(
                "INSERT INTO conversations (phone, name) VALUES (?, ?)",
                [phone, phone],
                (err, newConv) => {

                    if (err) {
                        console.log("INSERT ERROR:", err);
                        return;
                    }

                    const convoId = newConv.insertId;

                    db.query(
                        "INSERT INTO messages (conversation_id, sender, message) VALUES (?, 'customer', ?)",
                        [convoId, text],
                        (err) => {
                            if (err) console.log("MESSAGE INSERT ERROR:", err);
                        }
                    );

                }
            );

        } else {

            console.log("Conversation exists");

            const convoId = result[0].id;

            db.query(
                "INSERT INTO messages (conversation_id, sender, message) VALUES (?, 'customer', ?)",
                [convoId, text],
                (err) => {
                    if (err) console.log("MESSAGE INSERT ERROR:", err);
                }
            );

        }

    }
);

    }

    res.sendStatus(200);

});
//from here//

app.use(express.json());
app.use(express.static('public'));


//Webhook route//
app.get("/webhook", (req, res) => {

    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    console.log("Webhook GET hit");

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
        console.log("Webhook verified!");
        return res.status(200).send(challenge);
    } else {
        console.log("Verification failed");
        return res.sendStatus(403);
    }

});

//API TO SAVE TICKETS//
app.post("/api/tickets", (req, res) => {
    const { content } = req.body;

    db.query(
        "INSERT INTO tickets (content) VALUES (?)",
        [content],
        (err, result) => {
            if (err) {
                console.log(err);
                return res.sendStatus(500);
            }
            res.json({ id: result.insertId });
        }
    );
});

//API TO GET TICKETS//
app.get("/api/tickets", (req, res) => {
    db.query(
        "SELECT * FROM tickets ORDER BY created_at DESC",
        (err, results) => {
            if (err) {
                console.log(err);
                return res.sendStatus(500);
            }
            res.json(results);
        }
    );
});


//Start server👇//

app.listen(3000, () => {
    console.log("✅🎲Server running on http://localhost:3000🎲");
});