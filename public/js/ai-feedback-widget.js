// Feedback collection widget for AI responses
// Add this to your public/js folder and include it in your chat interface

class AIFeedbackWidget {
    constructor(options = {}) {
        this.apiBase = options.apiBase || '/api/feedback';
        this.learningApiBase = options.learningApiBase || '/api/learning';
        this.showRatings = options.showRatings !== false;
        this.autoHide = options.autoHide !== false;
        this.hideDelay = options.hideDelay || 5000;
    }

    // Create feedback UI element for an AI response
    createFeedbackElement(response, messageId, conversationId) {
        const container = document.createElement('div');
        container.className = 'ai-feedback-widget';
        container.setAttribute('data-message-id', messageId);
        container.setAttribute('data-conversation-id', conversationId);
        
        container.innerHTML = `
            <div class="feedback-prompt">
                <span class="feedback-label">Was this response helpful?</span>
                <div class="feedback-buttons">
                    <button class="feedback-btn helpful" title="This response was helpful">
                        👍 Yes
                    </button>
                    <button class="feedback-btn neutral" title="This response was okay">
                        🤷 Neutral
                    </button>
                    <button class="feedback-btn unhelpful" title="This response was not helpful">
                        👎 No
                    </button>
                </div>
                ${this.showRatings ? `
                    <div class="rating-section" style="display: none;">
                        <label>Rate this response (1-5 stars)</label>
                        <div class="star-rating">
                            <span class="star" data-rating="1">⭐</span>
                            <span class="star" data-rating="2">⭐</span>
                            <span class="star" data-rating="3">⭐</span>
                            <span class="star" data-rating="4">⭐</span>
                            <span class="star" data-rating="5">⭐</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // Add event listeners
        const feedbackBtns = container.querySelectorAll('.feedback-btn');
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const feedback = btn.classList.contains('helpful') ? 'helpful' :
                               btn.classList.contains('unhelpful') ? 'unhelpful' : 'neutral';
                this.submitFeedback(response, messageId, conversationId, feedback, 0);
                this.markFeedbackAsGiven(container);
            });
        });

        // Add star rating listeners
        if (this.showRatings) {
            const stars = container.querySelectorAll('.star');
            stars.forEach(star => {
                star.addEventListener('click', (e) => {
                    const rating = parseInt(star.getAttribute('data-rating'));
                    const feedback = container.querySelector('.feedback-btn.active')?.classList[1] || 'neutral';
                    this.submitFeedback(response, messageId, conversationId, feedback, rating);
                    this.markFeedbackAsGiven(container);
                });
            });
        }

        return container;
    }

    // Submit feedback to the server
    async submitFeedback(response, messageId, conversationId, feedback, rating) {
        try {
            const response_obj = await fetch(this.apiBase + '/ai-response', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId,
                    messageId,
                    response,
                    feedback,
                    rating
                })
            });

            if (response_obj.ok) {
                const data = await response_obj.json();
                console.log('✓ Feedback recorded:', data);
                return true;
            }
        } catch (error) {
            console.error('Error submitting feedback:', error);
        }
        return false;
    }

    // Mark feedback as given and optionally hide
    markFeedbackAsGiven(container) {
        container.classList.add('feedback-given');
        container.querySelector('.feedback-prompt').innerHTML = 
            '<span class="success-message">✓ Thank you for your feedback!</span>';
        
        if (this.autoHide) {
            setTimeout(() => {
                container.style.opacity = '0';
                container.style.transition = 'opacity 0.3s ease';
                setTimeout(() => container.remove(), 300);
            }, this.hideDelay);
        }
    }

    // Record conversation outcome
    async recordOutcome(conversationId, phone, resolved, escalated, resolutionType = null) {
        try {
            const response = await fetch(this.apiBase + '/conversation-outcome', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId,
                    phone,
                    resolved,
                    escalated,
                    resolutionType
                })
            });

            if (response.ok) {
                console.log('✓ Conversation outcome recorded');
                return true;
            }
        } catch (error) {
            console.error('Error recording outcome:', error);
        }
        return false;
    }

    // Record a customer preference
    async recordPreference(phone, type, value) {
        try {
            const response = await fetch(this.apiBase + '/customer-preference', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    phone,
                    type,
                    value
                })
            });

            if (response.ok) {
                console.log('✓ Preference recorded');
                return true;
            }
        } catch (error) {
            console.error('Error recording preference:', error);
        }
        return false;
    }

    // Get performance metrics
    async getPerformanceMetrics() {
        try {
            const response = await fetch(this.learningApiBase + '/performance');
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error getting performance metrics:', error);
        }
        return null;
    }

    // Get learning insights
    async getLearningInsights() {
        try {
            const response = await fetch(this.learningApiBase + '/insights');
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error getting learning insights:', error);
        }
        return null;
    }

    // Get suggested enhancement for a message
    async getSuggestedEnhancement(message) {
        try {
            const response = await fetch(this.learningApiBase + '/suggested-enhancement', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error getting suggestion:', error);
        }
        return null;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIFeedbackWidget;
}
