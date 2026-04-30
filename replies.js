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

// Menu items from knowledge base
const MENU_ITEMS = {
    pizza: {
        small: { name: 'Small Pizza', price: 10 },
        medium: { name: 'Medium Pizza', price: 15 },
        large: { name: 'Large Pizza', price: 20 }
    },
    burger: {
        classic: { name: 'Classic Burger', price: 8 },
        cheese: { name: 'Cheese Burger', price: 9 },
        double: { name: 'Double Burger', price: 12 }
    }
};

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
            'SELECT product, total_amount, order_date FROM orders WHERE REPLACE(REPLACE(REPLACE(phone, "+", ""), "-", ""), " ", "") = ? ORDER BY order_date DESC LIMIT 5',
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
                        `- ${order.product} ($${order.total_amount}) on ${new Date(order.order_date).toLocaleDateString()}`
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
                    'SELECT product, total_amount, order_date FROM orders WHERE phone = ? ORDER BY order_date DESC LIMIT 5',
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
                                `- ${order.product} ($${order.total_amount}) on ${new Date(order.order_date).toLocaleDateString()}`
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

function extractOrderId(message) {
    if (!message) return null;
    const match = message.toUpperCase().match(/\bORD[-_\s]?\d+\b/);
    if (!match) return null;
    return match[0].replace(/[_\s]/g, '');
}

function isOrderIdOnlyMessage(message) {
    if (!message) return false;
    const trimmed = message.trim().toUpperCase();
    return /^ORD[-]?\d+$/.test(trimmed);
}

function isOrderStatusInquiry(message) {
    if (!message) return false;
    const lowerMessage = message.toLowerCase();
    const orderStatusKeywords = [
        'order status',
        'status of my order',
        'where is my order',
        'have not seen my order',
        "haven't seen my order",
        'not received my order',
        'track my order',
        'track order',
        'order update',
        'order tracking',
        'check my order',
        'delivery status',
        'where is order',
        'order is',
        'status for order'
    ];
    return orderStatusKeywords.some(keyword => lowerMessage.includes(keyword));
}

function getOrderById(orderId) {
    return new Promise((resolve) => {
        if (!db || !orderId) {
            resolve(null);
            return;
        }

        db.query(
            `SELECT o.order_id, o.customer_name, o.items, COALESCE(o.total_amount, o.amount) AS total_amount,
                    o.status AS order_status, o.order_date,
                    d.delivery_status, d.rider_name, d.vehicle
             FROM orders o
             LEFT JOIN deliveries d ON o.id = d.order_id
             WHERE o.order_id = ?
             LIMIT 1`,
            [orderId],
            (err, results) => {
                if (err) {
                    console.log('getOrderById error:', err);
                    resolve(null);
                    return;
                }
                if (!results || results.length === 0) {
                    resolve(null);
                    return;
                }
                resolve(results[0]);
            }
        );
    });
}

function formatOrderStatusResponse(order) {
    const orderId = order.order_id;
    const customerName = order.customer_name || 'Customer';
    const status = order.delivery_status || order.order_status || 'pending';
    const total = parseFloat(order.total_amount || 0).toFixed(2);
    const orderDate = order.order_date ? new Date(order.order_date).toLocaleDateString() : 'unknown date';
    const riderName = order.rider_name || 'Not assigned';
    const vehicle = order.vehicle || 'Unknown';

    let response = `I found order ${orderId} for ${customerName}. It was placed on ${orderDate}. `;
    response += `Current status: ${status}. `;
    response += `Rider: ${riderName}. `;
    response += `Vehicle: ${vehicle}. `;
    response += `Total amount: $${total}.`;

    return response;
}

function extractOrderItemsFromMessage(message) {
    const lowerMessage = message.toLowerCase();
    const orderItems = [];
    let total = 0;

    const numberWords = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };

    function parseQuantity(str) {
        if (!str) return 1;
        const num = parseInt(str, 10);
        if (!isNaN(num)) return num;
        return numberWords[str.toLowerCase()] || 1;
    }

    function addItems(count, itemKey) {
        for (let i = 0; i < count; i++) {
            orderItems.push(itemKey);
        }
    }

    const pizzaSizes = {
        'small': 'small pizza',
        'medium': 'medium pizza',
        'large': 'large pizza'
    };

    const burgerTypes = {
        'classic': 'classic burger',
        'cheese': 'cheese burger',
        'double': 'double burger'
    };

    const friesPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*fries/gi;
    let friesMatch;
    let friesCount = 0;
    while ((friesMatch = friesPattern.exec(lowerMessage)) !== null) {
        friesCount += parseQuantity(friesMatch[1]);
    }

    const pizzaPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(small|medium|large)\s*pizza/gi;
    let pizzaMatch;
    while ((pizzaMatch = pizzaPattern.exec(lowerMessage)) !== null) {
        const quantity = parseQuantity(pizzaMatch[1]);
        const size = pizzaMatch[2];
        if (pizzaSizes[size]) {
            addItems(quantity, pizzaSizes[size]);
            total += quantity * MENU_ITEMS.pizza[size].price;
        }
    }

    const burgerPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(classic|cheese|double)\s*burger/gi;
    let burgerMatch;
    while ((burgerMatch = burgerPattern.exec(lowerMessage)) !== null) {
        const quantity = parseQuantity(burgerMatch[1]);
        const type = burgerMatch[2];
        if (burgerTypes[type]) {
            addItems(quantity, burgerTypes[type]);
            total += quantity * MENU_ITEMS.burger[type].price;
        }
    }

    if (orderItems.length === 0) {
        const genericPizzaPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:small|medium|large)?\s*pizzas?\b/gi;
        let genericPizzaMatch;
        while ((genericPizzaMatch = genericPizzaPattern.exec(lowerMessage)) !== null) {
            const quantity = parseQuantity(genericPizzaMatch[1]);
            addItems(quantity, 'pizza');
            total += quantity * MENU_ITEMS.pizza.medium.price;
        }

        const genericBurgerPattern = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:classic|cheese|double)?\s*burgers?\b/gi;
        let genericBurgerMatch;
        while ((genericBurgerMatch = genericBurgerPattern.exec(lowerMessage)) !== null) {
            const quantity = parseQuantity(genericBurgerMatch[1]);
            addItems(quantity, 'burger');
            total += quantity * MENU_ITEMS.burger.cheese.price;
        }
    }

    // If the message only contains fries and no priced items, ignore it for order total extraction.
    if (orderItems.length === 0 && friesCount > 0) {
        return { items: null, total: 0 };
    }

    const counts = orderItems.reduce((acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
    }, {});

    const itemSummary = Object.entries(counts)
        .map(([item, count]) => {
            if (count === 1) return item;
            if (item === 'pizza') return `${count} pizzas`;
            if (item === 'burger') return `${count} burgers`;
            if (item.endsWith('pizza')) return `${count} ${item.replace(/pizza$/, 'pizzas')}`;
            if (item.endsWith('burger')) return `${count} ${item.replace(/burger$/, 'burgers')}`;
            return `${count} ${item}s`;
        })
        .join(' and ');

    return { items: itemSummary, total };
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
        'problem',
        'issue',
        'report',
        'complaint',
        'complain',
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

function shouldAskOrderConfirmation(message) {
    const lowerMessage = message.toLowerCase();
    const orderPhrases = [
        'place this order',
        'place order',
        'i want to order',
        "i'd like to order",
        'i would like to order',
        'i would like',
        'i want',
        'can i get',
        'i need',
        'order now',
        'please order',
        'send me',
        "i'll have",
        "i'll have",
        'i am ordering',
        'i am placing',
        'i am buying',
        'checkout',
        'deliver',
        'deliver to'
    ];
    const hasOrderPhrase = orderPhrases.some(phrase => lowerMessage.includes(phrase));
    const hasFoodKeyword = /\b(pizza|burger|chicken|meal|drink|food|combo|sandwich|taco|order|package|fries)\b/.test(lowerMessage);
    return hasOrderPhrase && hasFoodKeyword;
}

function isOrderConfirmationResponse(message) {
    const lowerMessage = message.toLowerCase().trim();
    const yesPhrases = ['yes', 'yeah', 'yep', 'sure', 'confirm', 'okay', 'ok', 'go ahead', 'please', 'yes please', 'sure thing'];
    const noPhrases = ['no', 'nope', 'nah', 'cancel', 'stop', 'dont', "don't", 'never mind', 'not now'];
    
    return yesPhrases.some(phrase => lowerMessage.includes(phrase)) || noPhrases.some(phrase => lowerMessage.includes(phrase));
}

function isPositiveConfirmation(message) {
    const lowerMessage = message.toLowerCase().trim();
    const yesPhrases = ['yes', 'yeah', 'yep', 'sure', 'confirm', 'okay', 'ok', 'go ahead', 'please', 'yes please', 'sure thing'];
    return yesPhrases.some(phrase => lowerMessage.includes(phrase));
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

async function createOrderFromConversation(conversationId, phone) {
    return new Promise(async (resolve) => {
        if (!db || !conversationId) {
            console.log("createOrderFromConversation: No DB or conversationId");
            resolve(null);
            return;
        }

        // Get recent conversation messages to find the order details
        const recentMessages = await getRecentConversationMessages(conversationId, 10);
        
        // Find the customer's order message and extract items
        let orderDetails = null;
        for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            if (msg.sender === 'received' || msg.sender === 'customer') { // Customer message
                const extracted = extractOrderItemsFromMessage(msg.message);
                if (extracted.items && extracted.total > 0) {
                    orderDetails = extracted;
                    break;
                }
            }
        }

        if (!orderDetails) {
            console.log("createOrderFromConversation: Could not find order details in conversation");
            resolve(null);
            return;
        }

        // Get customer name
        const customerName = await getCustomerName(phone, conversationId);

        // Generate order ID
        const orderId = `ORD-${Date.now()}`;

        db.query(
            'INSERT INTO orders (order_id, customer_name, phone, product, amount, total_amount, status, order_date, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
            [orderId, customerName, phone || null, orderDetails.items, orderDetails.total, orderDetails.total, 'confirmed', conversationId],
            (err, result) => {
                if (err) {
                    console.log("createOrderFromConversation: Database error:", err);
                    resolve(null);
                    return;
                }

                const order = {
                    id: result.insertId,
                    orderId: orderId,
                    product: orderDetails.items,
                    total: orderDetails.total,
                    status: 'confirmed'
                };
                console.log("createOrderFromConversation: Order created:", order);

                // Automatically start the delivery simulation using the server route
                fetch('http://localhost:3000/api/delivery/start', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ order_id: order.orderId })
                }).then((response) => {
                    if (!response.ok) {
                        throw new Error('Delivery start failed');
                    }
                    return response.json();
                }).then((data) => {
                    console.log('createOrderFromConversation: Auto delivery simulation started for order', order.orderId, data);
                }).catch((deliveryErr) => {
                    console.error('createOrderFromConversation: Failed to auto-start delivery:', deliveryErr);
                }).finally(() => {
                    resolve(order);
                });
            }
        );
    });
}

async function getMistralReply(message, phone = null, conversationId = null) {
    try {
        console.log("getMistralReply called with phone:", phone, "conversationId:", conversationId);
        
        // Check if this is a response to an order confirmation
        if (conversationId && isOrderConfirmationResponse(message)) {
            if (isPositiveConfirmation(message)) {
                console.log("Customer confirmed order - creating order");
                const order = await createOrderFromConversation(conversationId, phone);
                if (order) {
                    return `Great! Your order has been confirmed and placed. Order ID: ${order.orderId}. Your ${order.product} will be prepared and delivered soon. Total: $${order.total.toFixed(2)}. Thank you for your business!`;
                } else {
                    return "I apologize, but I couldn't process your order at this time. Please try again or contact our support team for assistance.";
                }
            } else {
                console.log("Customer declined order confirmation");
                return "No problem! Your order has not been placed. If you'd like to modify your order or try again, just let me know!";
            }
        }
        
        const orderId = extractOrderId(message);
        const orderStatusRequest = isOrderStatusInquiry(message);

        if (orderId && (orderStatusRequest || isOrderIdOnlyMessage(message))) {
            const order = await getOrderById(orderId);
            if (order) {
                return formatOrderStatusResponse(order);
            }
            return `I couldn't find an order with ID ${orderId}. Please double-check the order ID and send it again.`;
        }

        if (orderStatusRequest && !orderId) {
            return "Sure! Please provide your Order ID (for example ORD-12345) so I can look up the status of your order.";
        }

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
        let userPrompt = `Customer message: "${message}"${kbContext}${orderContext}${conversationHistory}

If the customer reports a problem, ask clarifying questions and gather details before suggesting a solution. Only offer a human agent connection if the customer explicitly requests a live agent. Keep the response helpful and concise.`;
        if (shouldAskOrderConfirmation(message)) {
            const { items, total } = extractOrderItemsFromMessage(message);
            if (items && total > 0) {
                userPrompt += `

The customer appears to be placing an order for: ${items}, which comes to $${total}. Ask them exactly: ARE YOU SURE YOU WANT TO PLACE THIS ORDER?

IMPORTANT: Confirm the order details exactly as specified above. Do not add or change items. Do not confirm or save the order until the customer explicitly replies with a positive confirmation.`;
            } else {
                userPrompt += `

The customer appears to be placing an order but I couldn't identify the specific items. Ask them to clarify what they want to order from our menu (Pizzas: Small $10, Medium $15, Large $20; Burgers: Classic $8, Cheese $9, Double $12).`;
            }
        }

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