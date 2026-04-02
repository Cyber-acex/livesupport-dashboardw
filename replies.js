// Custom AI replies based on keywords
const replies = {
    "hello": "Hello! How can I help you today?",
    "hi": "Hi there! What can I assist you with?",
    "good morning": "Hi there! What can I assist you with?",
    "order": "I'd be happy to help with your order. Can you provide your order number?",
    "status": "To check your order status, please provide your order ID.",
    "menu": "Our menu includes burgers, pizzas, and salads. What would you like to know more about?",
    "delivery": "Delivery typically takes 30-45 minutes. Would you like to track your order?",
    "refund": "For refunds, please contact our support team with your order details.",
    "complaint": "I'm sorry to hear that. Please tell me more so I can assist you.",
    "thank": "You're welcome! Is there anything else I can help with?",
    "bye": "Goodbye! Have a great day!",
    "default": "Thank you for your message. An agent will respond shortly."
};

function getCustomReply(message) {
    const lowerMsg = message.toLowerCase();
    for (const [key, reply] of Object.entries(replies)) {
        if (key !== "default" && lowerMsg.includes(key)) {
            return reply;
        }
    }
    return replies.default;
}

module.exports = { getCustomReply };