// Mistral 7B via Mistral API
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const FALLBACK_REPLY = "Thank you for your message. An agent will respond shortly.";

let knowledgeBase = [];
let db = null;

// Initialize database connection
function initDatabase(database) {
    db = database;
}

function loadKnowledgeBase() {
    try {
        const kbPath = path.join(__dirname, 'knowledge-base.json');
        const data = fs.readFileSync(kbPath, 'utf8');
        knowledgeBase = JSON.parse(data);
    } catch (error) {
        console.log("Error loading knowledge base:", error.message);
        knowledgeBase = [];
    }
}

// Load KB on startup
loadKnowledgeBase();

function findRelevantKB(message) {
    const keywords = ['price', 'cost', 'menu', 'delivery', 'order', 'hours', 'time', 'pizza', 'burger', 'food', 'previous', 'past', 'history', 'ordered', 'account'];
    const lowerMessage = message.toLowerCase();
    const hasKeyword = keywords.some(keyword => lowerMessage.includes(keyword));
    
    if (hasKeyword) {
        return knowledgeBase; // Return all KB if relevant keywords found
    }
    return [];
}

function normalizePhone(phone) {
    // Remove all non-digit characters
    return phone.replace(/\D/g, '');
}

function getOrderHistory(phone) {
    return new Promise((resolve) => {
        if (!db || !phone) {
            console.log("getOrderHistory: No DB or phone", { hasDb: !!db, phone });
            resolve(null);
            return;
        }
        
        const normalizedPhone = normalizePhone(phone);
        console.log("getOrderHistory: Querying for phone:", phone, "normalized:", normalizedPhone);
        
        // First try: exact normalized match
        db.query(
            'SELECT items, total_amount, order_date FROM orders WHERE REPLACE(REPLACE(REPLACE(phone, "+", ""), "-", ""), " ", "") = ? ORDER BY order_date DESC LIMIT 5',
            [normalizedPhone],
            (err, results) => {
                if (err) {
                    console.log("getOrderHistory: Database error on first query:", err);
                    resolve(null);
                    return;
                }
                
                console.log("getOrderHistory: Results found (method 1):", results?.length || 0);
                
                if (results && results.length > 0) {
                    const orderSummary = results.map(order => 
                        `- ${order.items} ($${order.total_amount}) on ${new Date(order.order_date).toLocaleDateString()}`
                    ).join('\n');
                    
                    const totalSpent = results.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);
                    
                    const response = {
                        summary: orderSummary,
                        totalSpent: totalSpent.toFixed(2),
                        count: results.length
                    };
                    console.log("getOrderHistory: Resolved with:", response);
                    resolve(response);
                    return;
                }
                
                // Fallback: try direct phone match
                console.log("getOrderHistory: No results with normalization, trying exact match with:", phone);
                db.query(
                    'SELECT items, total_amount, order_date FROM orders WHERE phone = ? ORDER BY order_date DESC LIMIT 5',
                    [phone],
                    (err2, results2) => {
                        if (err2) {
                            console.log("getOrderHistory: Database error on fallback query:", err2);
                            resolve(null);
                            return;
                        }
                        
                        console.log("getOrderHistory: Results found (method 2 - exact match):", results2?.length || 0);
                        
                        if (results2 && results2.length > 0) {
                            const orderSummary = results2.map(order => 
                                `- ${order.items} ($${order.total_amount}) on ${new Date(order.order_date).toLocaleDateString()}`
                            ).join('\n');
                            
                            const totalSpent = results2.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);
                            
                            const response = {
                                summary: orderSummary,
                                totalSpent: totalSpent.toFixed(2),
                                count: results2.length
                            };
                            console.log("getOrderHistory: Resolved with fallback:", response);
                            resolve(response);
                        } else {
                            console.log("getOrderHistory: No orders found for phone:", phone);
                            // Debug: show what phone formats exist in DB
                            db.query('SELECT DISTINCT phone FROM orders LIMIT 5', [], (err3, samples) => {
                                if (!err3 && samples) {
                                    console.log("getOrderHistory: Sample phone formats in DB:", samples.map(s => s.phone));
                                }
                            });
                            resolve(null);
                        }
                    }
                );
            }
        );
    });
}

let disableAICallback = null;
let handoffCallback = null;

// Set the callback to disable AI (called from server.js)
function setDisableAICallback(callback) {
    disableAICallback = callback;
}

// Set the callback to notify the server when the AI hands off to staff
function setHandoffCallback(callback) {
    handoffCallback = callback;
}

function isRequestingStaff(message) {
    const staffKeywords = ['agent', 'staff', 'human', 'representative', 'speak to', 'talk to', 'connect me', 'call me', 'support team', 'human agent'];
    const lowerMessage = message.toLowerCase();
    return staffKeywords.some(keyword => lowerMessage.includes(keyword));
}

function isTicketCreationRequest(message) {
    const lowerMessage = message.toLowerCase();
    const ticketKeywords = [
        'open a ticket',
        'file a ticket',
        'create a ticket',
        'raise a ticket',
        'log a ticket',
        'make a ticket',
        'support ticket',
        'i want to file a complaint',
        'i want to file a ticket',
        'i want a refund',
        'i want to report a problem',
        'I am having trouble',
        'issue with',
        'problem with',
        'not working',
        'bug report'
    ];
    return ticketKeywords.some(keyword => lowerMessage.includes(keyword));
}

function isProblemReportRequest(message) {
    const lowerMessage = message.toLowerCase();
    const problemKeywords = [
        'i need help',
        'need help with',
        'issue with',
        'problem with',
        'report a problem',
        'report an issue',
        'i have a complaint',
        'this is urgent',
        'please help me',
        "can't resolve",
        'cannot resolve',
        'not working',
        'service down',
        'bug report',
        'technical issue',
        'support needed'
    ];
    return problemKeywords.some(keyword => lowerMessage.includes(keyword));
}

function isHandoffReply(message) {
    const lowerMessage = message.toLowerCase();
    const handoffPhrases = [
        'follow up shortly',
        'our team will follow up',
        'one of our agents will be with you shortly',
        'an agent will be with you shortly',
        'connecting you with our support team',
        'connecting you with support',
        'transfer you to',
        'transferring you to',
        'handing you over',
        'please wait while i connect',
        'please wait while i transfer',
        'i m connecting you with',
        'i am connecting you with',
        'support agent will assist',
        'support team will assist',
        'human agent will assist',
        'i will transfer you',
        'i will connect you',
        'you are being transferred'
    ];
    return handoffPhrases.some(keyword => lowerMessage.includes(keyword));
}

function getCustomerName(phone, conversationId) {
    return new Promise((resolve) => {
        if (!db) {
            resolve('Unknown');
            return;
        }

        if (conversationId) {
            db.query('SELECT name FROM conversations WHERE id = ?', [conversationId], (err, results) => {
                if (err || !results || results.length === 0) {
                    resolve('Unknown');
                } else {
                    resolve(results[0].name || 'Unknown');
                }
            });
            return;
        }

        if (phone) {
            db.query('SELECT name FROM conversations WHERE phone = ? LIMIT 1', [phone], (err, results) => {
                if (err || !results || results.length === 0) {
                    resolve('Unknown');
                } else {
                    resolve(results[0].name || 'Unknown');
                }
            });
            return;
        }

        resolve('Unknown');
    });
}

async function getRecentConversationMessages(conversationId, limit = 8) {
    return new Promise((resolve) => {
        if (!db || !conversationId) {
            resolve([]);
            return;
        }

        db.query(
            `SELECT sender, message, created_at FROM messages WHERE conversation_id = ? 
             UNION ALL
             SELECT sender, message, created_at FROM replies WHERE conversation_id = ? 
             ORDER BY created_at DESC LIMIT ${Number(limit)}`,
            [conversationId, conversationId],
            (err, results) => {
                if (err || !results) {
                    console.log("getRecentConversationMessages error:", err);
                    resolve([]);
                    return;
                }
                resolve(results.reverse());
            }
        );
    });
}

function formatTicketTime(now) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const month = monthNames[now.getMonth()];
    const year = now.getFullYear();
    return `${hours}:${minutes}, ${day} ${month} ${year}`;
}

async function createTicket(content, phone = null, conversationId = null) {
    const customerName = await getCustomerName(phone, conversationId);
    const submittedBy = 'AI';
    const now = new Date();
    const formattedTime = formatTicketTime(now);
    const safeReason = content.trim().replace(/\s+/g, ' ').replace(/"/g, "'");
    const placeholderContent = `---------------------------------------------\nTicket ID: #TBD\nSubmitted by: ${submittedBy}\nCustomer name: ${customerName}\nTime: ${formattedTime}\nStatus: Open\nReason: "${safeReason}"\n---------------------------------------------`;

    return new Promise((resolve) => {
        if (!db) {
            console.log("createTicket: No database connection available");
            resolve(null);
            return;
        }

        db.query("INSERT INTO tickets (content) VALUES (?)", [placeholderContent], (err, result) => {
            if (err) {
                console.log("createTicket: Database error:", err);
                resolve(null);
                return;
            }

            const ticketId = result.insertId;
            const finalContent = `---------------------------------------------\nTicket ID: #${ticketId}\nSubmitted by: ${submittedBy}\nCustomer name: ${customerName}\nTime: ${formattedTime}\nStatus: Open\nReason: "${safeReason}"\n---------------------------------------------`;

            db.query("UPDATE tickets SET content = ? WHERE id = ?", [finalContent, ticketId], (updateErr) => {
                if (updateErr) {
                    console.log("createTicket: Warning: failed to update ticket content with ID:", updateErr);
                }

                const ticket = {
                    id: ticketId,
                    content: finalContent,
                    escalated: 0,
                    created_at: now.toISOString()
                };
                resolve(ticket);
            });
        });
    });
}

async function getMistralReply(message, phone = null, conversationId = null) {
    try {
        console.log("getMistralReply called with phone:", phone, "conversationId:", conversationId);
        
        const ticketRequest = isTicketCreationRequest(message);
        const problemReportRequest = isProblemReportRequest(message);

        // Check if customer is explicitly asking to speak with a staff agent
        if (isRequestingStaff(message)) {
            console.log("Customer requesting staff member - disabling AI and returning connection message");
            if (conversationId && disableAICallback) {
                disableAICallback(conversationId);
            }
            if (conversationId && handoffCallback) {
                handoffCallback(conversationId);
            }
            return "Thank you for reaching out! 👋 I'm connecting you with our support team. One of our agents will be with you shortly to assist you.";
        }

        // If the customer is reporting a problem, ask for more detail and try to help first.
        if (problemReportRequest && !ticketRequest) {
            console.log("Customer is reporting a problem. Asking for details before escalating.");
            return "I'm sorry you're having an issue. Can you please describe the problem in more detail so I can help resolve it?";
        }

        // Check if customer is requesting a ticket to be created
        if (ticketRequest) {
            console.log("Customer requested ticket creation. Attempting to create ticket.");
            const ticket = await createTicket(message, phone, conversationId);
            if (ticket) {
                return `A support ticket has been created for you as Ticket #${ticket.id}. I will continue helping you here while your request is recorded. Can you please tell me more about the problem or let me know what I can assist you with next?`;
            }
            return "I've noted your request and a ticket will be created shortly. I'll continue helping you here in the meantime. Can you please tell me more about the problem or what I can assist you with next?";
        }
        
        // Find relevant knowledge base entries
        const relevantKB = findRelevantKB(message);
        let kbContext = "";
        if (relevantKB.length > 0) {
            kbContext = "\n\nRelevant knowledge base information:\n" + relevantKB.map(item => 
                `Title: ${item.title || item.question}\nContent: ${item.content || item.answer}`
            ).join('\n\n');
        }
        
        // Get customer order history
        let orderContext = "";
        if (phone) {
            console.log("Fetching order history for phone:", phone);
            const orderHistory = await getOrderHistory(phone);
            console.log("Order history result:", orderHistory);
            if (orderHistory) {
                orderContext = `\n\nCustomer Order History:\nTotal Orders: ${orderHistory.count}\nTotal Spent: $${orderHistory.totalSpent}\nRecent Orders:\n${orderHistory.summary}`;
            } else {
                orderContext = "\n\nCustomer Order History: No previous orders found in the system.";
            }
        } else {
            console.log("No phone provided to getMistralReply");
        }

        // Include recent conversation history so Mistral remembers ongoing orders
        let conversationHistory = "";
        if (conversationId) {
            const recentMessages = await getRecentConversationMessages(conversationId, 8);
            if (recentMessages.length > 0) {
                conversationHistory = "\n\nConversation history:\n" + recentMessages.map(msg => {
                    const role = msg.sender === 'received' ? 'Customer' : 'Agent';
                    return `${role}: ${msg.message}`;
                }).join('\n');
            }
        }

        // Craft a system prompt and user prompt for the support agent
        const systemPrompt = `You are a professional customer support assistant for a food delivery service. Reply directly to the customer without any meta-commentary. Do not start with "Got it", "Here’s how I’d respond", "I would", "As a support agent", or any other explanation of how you are generating the reply. Keep the answer polite, clear, and concise as if you were replying directly to the customer.`;
        const userPrompt = `Customer message: "${message}"${kbContext}${orderContext}${conversationHistory}

If the customer reports a problem, ask clarifying questions and gather details before suggesting a solution. Only offer a human agent connection if the customer explicitly requests a live agent. Keep the response helpful and concise.`;

        console.log("Sending to Mistral with prompt context (KB: " + (kbContext ? "yes" : "no") + ", Orders: " + (orderContext ? "yes" : "no") + ")");
        
        const response = await fetch(MISTRAL_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "mistral-large-latest",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 150,
                temperature: 0.35
            })
        });

        if (!response.ok) {
            console.log("Mistral API error:", response.status, await response.text());
            return FALLBACK_REPLY;
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim();

        if (!reply) {
            return FALLBACK_REPLY;
        }

        if (conversationId && isHandoffReply(reply)) {
            console.log("Detected Mistral handoff reply, disabling AI and emitting handoff alert for conversation:", conversationId);
            if (disableAICallback) {
                disableAICallback(conversationId);
            }
            if (handoffCallback) {
                handoffCallback(conversationId);
            }
        }

        return reply;
    } catch (error) {
        console.log("Mistral reply error:", error.message);
        return FALLBACK_REPLY;
    }
}

module.exports = { getMistralReply, initDatabase, setDisableAICallback, setHandoffCallback, isTicketCreationRequest, isRequestingStaff };