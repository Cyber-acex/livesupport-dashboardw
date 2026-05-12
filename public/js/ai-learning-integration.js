// Integration guide for AI Feedback Widget
// Add this to your chat interface (inbox.html or wherever AI responses are displayed)

// 1. Include the feedback widget script in your HTML:
// <script src="js/ai-feedback-widget.js"></script>
// <link rel="stylesheet" href="css/ai-feedback.css">

// 2. Initialize the feedback widget in your app.js or chat script:
const feedbackWidget = new AIFeedbackWidget({
    apiBase: '/api/feedback',
    learningApiBase: '/api/learning',
    showRatings: true,
    autoHide: true,
    hideDelay: 5000
});

// 3. When you display an AI response, attach feedback UI:
function displayAIResponse(message, messageId, conversationId, senderPhone) {
    // Your existing code to display the message...
    const messageElement = document.createElement('div');
    messageElement.className = 'message ai-message';
    messageElement.innerHTML = message;
    
    // Create and append feedback widget
    const feedbackElement = feedbackWidget.createFeedbackElement(
        message,
        messageId,
        conversationId
    );
    
    // Insert after the message
    messageElement.appendChild(feedbackElement);
    
    // Add to chat
    const chatContainer = document.getElementById('chat-container');
    chatContainer.appendChild(messageElement);
    
    // Record the interaction
    recordAIInteraction(conversationId, messageId, message, senderPhone);
}

// 4. Record when agent responds (to disable AI temporarily):
function onAgentResponse(conversationId, agentMessage) {
    // Existing agent response logic...
    
    // Record conversation outcome if needed
    feedbackWidget.recordOutcome(
        conversationId,
        null, // phone if available
        false, // not resolved (agent took over)
        true   // escalated to agent
    );
}

// 5. Record when conversation is resolved:
function onConversationResolved(conversationId, phone, resolutionType = 'resolved') {
    feedbackWidget.recordOutcome(
        conversationId,
        phone,
        true,  // resolved
        false, // not escalated
        resolutionType // 'resolved', 'refunded', 'replaced', etc.
    );
}

// 6. Record customer preferences from their order history:
function recordCustomerPreferences(phone, message) {
    // Example: if customer prefers quick responses
    if (message.toLowerCase().includes('fast') || message.toLowerCase().includes('quick')) {
        feedbackWidget.recordPreference(phone, 'responseType', 'quick');
    }
    
    // Example: if customer prefers refunds for issues
    if (message.toLowerCase().includes('refund')) {
        feedbackWidget.recordPreference(phone, 'resolutionType', 'refund');
    }
}

// 7. Track issue categories for learning:
async function categorizeAndRecord(message, category, resolution) {
    await fetch('/api/feedback/issue-category', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            category: category, // 'delivery_delay', 'wrong_item', 'damaged_food', etc.
            message: message,
            resolution: resolution
        })
    });
}

// 8. Example integration in your message handler:
async function handleMessageReceived(message, phone, conversationId) {
    // Get AI response
    const aiResponse = await getMistralReply(message, phone, conversationId);
    
    // Generate unique message ID
    const messageId = `msg_${Date.now()}`;
    
    // Display with feedback widget
    displayAIResponse(aiResponse, messageId, conversationId, phone);
    
    // Record the interaction for learning
    // This is now handled automatically through the feedback system
    
    // Example: categorize if it's a known issue
    if (message.toLowerCase().includes('late')) {
        await categorizeAndRecord(message, 'delivery_delay', aiResponse);
    } else if (message.toLowerCase().includes('wrong')) {
        await categorizeAndRecord(message, 'wrong_item', aiResponse);
    }
}

// 9. Example: Using learned patterns to enhance responses
async function getEnhancedResponse(message, phone, conversationId) {
    // Get AI response
    const aiResponse = await getMistralReply(message, phone, conversationId);
    
    // Check for similar successful patterns
    const suggestion = await feedbackWidget.getSuggestedEnhancement(message);
    
    if (suggestion && suggestion.confidenceScore > 1) {
        console.log('📚 Using learned pattern:', suggestion.suggestion);
        // You could use this to further refine the response
    }
    
    return aiResponse;
}

// 10. Add feedback buttons to existing messages
function attachFeedbackToMessage(messageElement, messageText, messageId, conversationId) {
    const feedbackElement = feedbackWidget.createFeedbackElement(
        messageText,
        messageId,
        conversationId
    );
    messageElement.appendChild(feedbackElement);
}

// 11. Dashboard link in menu or navigation
function addLearningDashboardLink() {
    const navMenu = document.querySelector('.nav-menu, .sidebar, nav');
    if (navMenu) {
        const link = document.createElement('a');
        link.href = '/learning.html';
        link.className = 'nav-link';
        link.innerHTML = '🤖 AI Learning Dashboard';
        link.style.marginTop = '16px';
        link.style.padding = '10px 16px';
        link.style.display = 'block';
        link.style.borderRadius = '6px';
        link.style.background = 'rgba(102, 126, 234, 0.1)';
        link.style.color = '#667eea';
        link.style.textDecoration = 'none';
        link.style.fontWeight = '600';
        link.style.transition = 'all 0.2s ease';
        
        link.addEventListener('mouseover', () => {
            link.style.background = 'rgba(102, 126, 234, 0.2)';
        });
        
        link.addEventListener('mouseout', () => {
            link.style.background = 'rgba(102, 126, 234, 0.1)';
        });
        
        navMenu.appendChild(link);
    }
}

// 12. Monitor and log AI performance periodically
async function monitorAIPerformance() {
    const metrics = await feedbackWidget.getPerformanceMetrics();
    
    if (metrics) {
        console.log('📊 AI Performance Metrics:', {
            helpfulRate: metrics.helpfulRate,
            resolutionRate: metrics.resolutionRate,
            averageRating: metrics.averageRating,
            totalResponses: metrics.totalResponses
        });
        
        // Alert if performance drops
        if (parseFloat(metrics.helpfulRate) < 50) {
            console.warn('⚠️ AI performance is below 50% helpful rate. Review recent responses.');
        }
    }
}

// 13. Export learned knowledge periodically (e.g., daily)
async function exportLearnedKnowledgeDaily() {
    const lastExport = localStorage.getItem('lastKnowledgeExport');
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    
    if (!lastExport || (now - lastExport) > dayInMs) {
        try {
            const response = await fetch('/api/learning/export-knowledge', {
                method: 'POST'
            });
            
            if (response.ok) {
                localStorage.setItem('lastKnowledgeExport', now.toString());
                console.log('✓ Learned knowledge exported to knowledge base');
            }
        } catch (error) {
            console.error('Error exporting learned knowledge:', error);
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    addLearningDashboardLink();
    monitorAIPerformance();
    exportLearnedKnowledgeDaily();
    
    // Run performance check every hour
    setInterval(monitorAIPerformance, 60 * 60 * 1000);
    setInterval(exportLearnedKnowledgeDaily, 60 * 60 * 1000);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        displayAIResponse,
        onAgentResponse,
        onConversationResolved,
        recordCustomerPreferences,
        categorizeAndRecord,
        handleMessageReceived,
        getEnhancedResponse,
        attachFeedbackToMessage,
        monitorAIPerformance,
        exportLearnedKnowledgeDaily
    };
}
