// Enhanced getMistralReply with automatic learning integration
// Add this to replies.js to enable automatic learning tracking

import * as learningSystem from './tools/aiLearningSystem.js';

// Store for tracking interaction flow
const interactionTracker = new Map(); // conversationId -> { messageId, response, timestamp }

// Wrap getMistralReply to track all responses for learning
async function getMistralReplyWithLearning(message, phone = null, conversationId = null) {
    try {
        // Call the original getMistralReply function
        const response = await getMistralReply(message, phone, conversationId);
        
        if (response && conversationId) {
            // Generate a unique message ID for tracking
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Track this interaction for later feedback
            interactionTracker.set(messageId, {
                conversationId,
                phone,
                response,
                message,
                timestamp: new Date().toISOString(),
                responseLength: response.length,
                messageKeywords: extractKeywords(message)
            });
            
            // Attach metadata to response
            return {
                text: response,
                messageId: messageId,
                conversationId: conversationId,
                trackingEnabled: true
            };
        }
        
        return response;
    } catch (error) {
        console.error('Error in getMistralReplyWithLearning:', error);
        return null;
    }
}

// Extract keywords from message for categorization
function extractKeywords(message) {
    const keywords = {
        order: ['order', 'pizza', 'burger', 'delivery', 'food', 'menu'],
        issue: ['problem', 'issue', 'wrong', 'damaged', 'late', 'missing', 'complaint', 'refund'],
        tracking: ['track', 'where', 'status', 'update', 'delivery'],
        complaint: ['angry', 'upset', 'frustrated', 'terrible', 'awful', 'bad', 'hate']
    };
    
    const lowerMessage = message.toLowerCase();
    const foundKeywords = {};
    
    for (const [category, words] of Object.entries(keywords)) {
        foundKeywords[category] = words.some(word => lowerMessage.includes(word));
    }
    
    return foundKeywords;
}

// Categorize and record issues automatically
function autoCategorizeResponse(message, response) {
    const keywords = extractKeywords(message);
    
    if (keywords.issue || keywords.complaint) {
        const category = keywords.complaint ? 'complaint' : 'issue';
        learningSystem.recordIssueCategory(category, message, response);
    } else if (keywords.tracking) {
        learningSystem.recordIssueCategory('order_tracking', message, response);
    } else if (keywords.order) {
        learningSystem.recordIssueCategory('order_processing', message, response);
    }
}

// Handle feedback from frontend
function recordResponseFeedback(messageId, feedback, rating) {
    const interaction = interactionTracker.get(messageId);
    
    if (interaction) {
        learningSystem.recordFeedback(
            interaction.conversationId,
            messageId,
            interaction.response,
            feedback,
            rating
        );
        
        // Auto-categorize based on feedback
        if (feedback === 'unhelpful' && rating <= 2) {
            autoCategorizeResponse(interaction.message, interaction.response);
        }
        
        console.log(`✓ Feedback recorded for message ${messageId}: ${feedback} (${rating}/5)`);
        
        return true;
    }
    
    return false;
}

// Handle conversation completion
function recordConversationCompletion(conversationId, phone, resolved, escalated) {
    learningSystem.recordConversationOutcome(
        conversationId,
        phone,
        resolved,
        escalated,
        resolved ? 'resolved' : 'escalated'
    );
}

// Get suggested response enhancement
async function getResponseEnhancement(message) {
    const suggestion = learningSystem.getSuggestedPromptEnhancement(message);
    
    if (suggestion) {
        console.log('📚 Using learned pattern with confidence:', suggestion.confidenceScore);
        return suggestion;
    }
    
    return null;
}

// Get customer insights for personalization
function getCustomerContextFromLearning(phone) {
    const insights = learningSystem.getCustomerInsights(phone);
    
    if (insights) {
        console.log('📊 Customer insights found:', {
            interactions: insights.interactionCount,
            preferredResolution: insights.preferredResolutionType
        });
        
        return insights;
    }
    
    return null;
}

// Enhance getMistralReply prompt with customer insights
async function getMistralReplyWithPersonalization(message, phone = null, conversationId = null) {
    try {
        // Check if order confirmation response needed
        if (conversationId && isOrderConfirmationResponse(message)) {
            if (isPositiveConfirmation(message)) {
                const order = await createOrderFromConversation(conversationId, phone);
                if (order) {
                    const response = `Great! Your order has been confirmed and placed. Order ID: ${order.orderId}. Your ${order.product} will be prepared and delivered soon. Total: $${order.total.toFixed(2)}. Thank you for your business!`;
                    
                    // Track the response
                    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    interactionTracker.set(messageId, {
                        conversationId, phone, response, message,
                        timestamp: new Date().toISOString()
                    });
                    
                    learningSystem.recordIssueCategory('order_confirmation', message, response);
                    
                    return { text: response, messageId, conversationId, trackingEnabled: true };
                }
            }
        }
        
        // Get customer insights for context
        let customerContext = '';
        if (phone) {
            const insights = getCustomerContextFromLearning(phone);
            if (insights && insights.preferredResolutionType) {
                customerContext = `\n\nCustomer Preference: They prefer ${insights.preferredResolutionType} for issue resolution based on ${insights.interactionCount} interactions.`;
            }
        }
        
        // Get the original response
        const response = await getMistralReply(message, phone, conversationId);
        
        // Track it
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        interactionTracker.set(messageId, {
            conversationId, phone, response, message,
            timestamp: new Date().toISOString(),
            personalized: !!customerContext
        });
        
        // Auto-categorize
        autoCategorizeResponse(message, response);
        
        return { text: response, messageId, conversationId, trackingEnabled: true };
    } catch (error) {
        console.error('Error in getMistralReplyWithPersonalization:', error);
        return null;
    }
}

// Export enhanced functions
export {
    getMistralReplyWithLearning,
    getMistralReplyWithPersonalization,
    recordResponseFeedback,
    recordConversationCompletion,
    getResponseEnhancement,
    getCustomerContextFromLearning,
    autoCategorizeResponse,
    extractKeywords,
    interactionTracker
};
