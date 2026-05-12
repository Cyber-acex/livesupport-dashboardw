# AI Learning System Documentation

## Overview

The AI Learning System enables your chatbot to improve over time by learning from:
- **Customer feedback** on AI responses (helpful/unhelpful ratings)
- **Successful response patterns** that resolve issues
- **Customer preferences** and interaction history
- **Issue categories** and their common resolutions
- **Conversation outcomes** (resolved vs escalated)

The system automatically tracks, analyzes, and improves AI performance through persistent data storage and pattern recognition.

## Features

### 1. **Feedback Collection**
- Star ratings (1-5) on AI responses
- Thumbs up/down on response quality
- Customer satisfaction metrics
- Automatic feedback aggregation

### 2. **Pattern Learning**
- Identifies successful response patterns
- Tracks pattern frequency and effectiveness
- Suggests improvements based on past successes
- Exports learned patterns back to knowledge base

### 3. **Performance Metrics**
- Response helpfulness rate (%)
- Issue resolution rate (%)
- Customer satisfaction (average rating)
- Escalation rate tracking
- Conversation resolution tracking

### 4. **Customer Profiling**
- Individual customer preferences
- Preferred resolution methods
- Interaction frequency
- Customer-specific insights

### 5. **Issue Categorization**
- Tracks common issue types
- Records resolutions per category
- Identifies patterns in customer problems
- Suggests improvements by category

### 6. **Improvement Areas**
- Automatically identifies weak areas
- Suggests specific improvements
- Severity levels (high/medium/low)
- Actionable recommendations

## Architecture

### Core Files

#### `tools/aiLearningSystem.js`
Main learning engine with functions for:
- Recording feedback
- Tracking conversation outcomes
- Recording customer preferences
- Analyzing patterns
- Generating insights

```javascript
// Initialize
initLearning(database)

// Record feedback
recordFeedback(conversationId, messageId, response, feedback, rating)

// Record outcomes
recordConversationOutcome(conversationId, phone, resolved, escalated, resolutionType)

// Get insights
getLearningInsights()
getPerformanceSummary()
getCustomerInsights(phone)
```

#### `tools/learningRoutes.js`
API endpoints for the learning system:
- `POST /api/feedback/ai-response` - Record AI response feedback
- `POST /api/feedback/conversation-outcome` - Record conversation result
- `POST /api/feedback/customer-preference` - Record customer preference
- `POST /api/feedback/issue-category` - Record issue category
- `GET /api/learning/performance` - Get performance metrics
- `GET /api/learning/insights` - Get learning insights
- `POST /api/learning/export-knowledge` - Export to knowledge base

#### `public/js/ai-feedback-widget.js`
Frontend widget for collecting feedback:
- Displays feedback buttons on AI responses
- Handles user interactions
- Sends feedback to backend
- Displays learning dashboard

#### `public/js/ai-learning-integration.js`
Integration guide for your existing chat interface.

#### `public/learning.html`
Dashboard showing:
- Performance metrics
- Success patterns
- Issue categories
- Recent feedback
- Improvement areas

### Data Storage

Data is persisted in JSON files:
- **`ai-learning.json`** - Feedback history, metrics, customer preferences
- **`ai-patterns.json`** - Success patterns, issue categories, response templates

Also stored in database:
- **`ai_feedback` table** - Persistent feedback records

## Integration Guide

### Step 1: Include Scripts
Add to your HTML:
```html
<script src="js/ai-feedback-widget.js"></script>
<link rel="stylesheet" href="css/ai-feedback.css">
```

### Step 2: Initialize Widget
In your JavaScript:
```javascript
const feedbackWidget = new AIFeedbackWidget({
    apiBase: '/api/feedback',
    learningApiBase: '/api/learning',
    showRatings: true,
    autoHide: true,
    hideDelay: 5000
});
```

### Step 3: Display AI Response with Feedback
```javascript
function displayAIResponse(message, messageId, conversationId, senderPhone) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message ai-message';
    messageElement.innerHTML = message;
    
    const feedbackElement = feedbackWidget.createFeedbackElement(
        message,
        messageId,
        conversationId
    );
    
    messageElement.appendChild(feedbackElement);
    chatContainer.appendChild(messageElement);
}
```

### Step 4: Record Outcomes
When conversation resolves:
```javascript
feedbackWidget.recordOutcome(
    conversationId,
    phone,
    true,   // resolved
    false,  // escalated
    'resolved' // resolution type
);
```

### Step 5: Record Customer Preferences
```javascript
feedbackWidget.recordPreference(
    phone,
    'resolutionType', // preference type
    'refund' // preference value
);
```

### Step 6: Categorize Issues
```javascript
await fetch('/api/feedback/issue-category', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        category: 'delivery_delay',
        message: customerMessage,
        resolution: aiResponse
    })
});
```

## Usage Examples

### Example: Complete Chat Integration
```javascript
async function handleCustomerMessage(message, phone, conversationId) {
    // Get AI response
    const aiResponse = await getMistralReply(message, phone, conversationId);
    
    // Display with feedback
    displayAIResponse(aiResponse, `msg_${Date.now()}`, conversationId, phone);
    
    // Categorize if known issue
    if (message.includes('late')) {
        await categorizeAndRecord(message, 'delivery_delay', aiResponse);
    }
    
    // Record preference
    if (message.includes('refund')) {
        feedbackWidget.recordPreference(phone, 'resolutionType', 'refund');
    }
}
```

### Example: Get Performance
```javascript
const metrics = await feedbackWidget.getPerformanceMetrics();
console.log(metrics);
// {
//   helpfulResponses: 142,
//   totalResponses: 180,
//   helpfulRate: "78.89%",
//   averageRating: "4.2",
//   resolutionRate: "85.25%"
// }
```

### Example: Get Customer Insights
```javascript
const insights = await feedbackWidget.getCustomerInsights('1234567890');
// Returns customer preferences and interaction history
```

## Learning Dashboard

Access at: `/learning.html`

Shows:
- **Performance Metrics**: Response quality, resolution rate, customer satisfaction
- **Improvement Areas**: High priority issues to address
- **Success Patterns**: Top performing response patterns
- **Issue Categories**: Common problems and their frequencies
- **Recent Feedback**: Latest feedback from customers

**Export Function**: Export high-quality learned patterns back to the knowledge base to continuously improve responses.

## How It Works

### 1. Feedback Loop
```
AI Response → User Rates → Feedback Recorded → Pattern Analyzed → Metric Updated
```

### 2. Pattern Learning
- Successful responses (rated 4-5 stars, marked helpful) are added to success patterns
- Patterns are ranked by frequency × rating
- Similar responses are grouped together
- Top patterns can be exported to knowledge base

### 3. Performance Tracking
- All metrics stored in `ai-learning.json`
- Updated in real-time as feedback comes in
- Automatically identifies improvement areas
- Triggers alerts if performance drops below thresholds

### 4. Continuous Improvement
- System suggests enhancements based on learned patterns
- Identifies weak areas for training
- Tracks customer preferences for personalization
- Exports improvements back to knowledge base

## API Reference

### POST /api/feedback/ai-response
Record feedback on an AI response.

**Request:**
```json
{
  "conversationId": 123,
  "messageId": "msg_12345",
  "response": "Sure! Your order...",
  "feedback": "helpful",
  "rating": 5
}
```

**Response:**
```json
{
  "success": true,
  "record": {
    "conversationId": 123,
    "feedback": "helpful",
    "rating": 5,
    "timestamp": "2024-05-08T12:34:56Z"
  }
}
```

### POST /api/feedback/conversation-outcome
Record how a conversation ended.

**Request:**
```json
{
  "conversationId": 123,
  "phone": "1234567890",
  "resolved": true,
  "escalated": false,
  "resolutionType": "resolved"
}
```

### POST /api/feedback/customer-preference
Record a customer preference.

**Request:**
```json
{
  "phone": "1234567890",
  "type": "resolutionType",
  "value": "refund"
}
```

### GET /api/learning/performance
Get performance metrics.

**Response:**
```json
{
  "totalResponses": 180,
  "helpfulResponses": 142,
  "helpfulRate": "78.89%",
  "averageRating": 4.2,
  "resolutionRate": "85.25%",
  "successPatterns": 24
}
```

### GET /api/learning/insights
Get comprehensive learning insights.

**Response:**
```json
{
  "performance": { ... },
  "recentFeedback": [ ... ],
  "topSuccessPatterns": [ ... ],
  "topIssueCategories": [ ... ],
  "improvementAreas": [ ... ]
}
```

### POST /api/learning/export-knowledge
Export learned patterns to knowledge base.

**Response:**
```json
{
  "success": true,
  "improvements": [
    {
      "title": "Learned Pattern (42 uses, 4.8★)",
      "content": "Your response was great...",
      "frequency": 42,
      "rating": 4.8
    }
  ]
}
```

## Performance Thresholds

The system automatically identifies areas for improvement based on:

- **Response Quality**: < 70% helpful rate triggers warning
- **Resolution Rate**: < 70% triggers suggestion to add more resolution patterns
- **Customer Satisfaction**: < 3.5/5 triggers quality review alert
- **Pattern Frequency**: Patterns with 2+ uses and 4+ rating are promotion candidates

## Best Practices

1. **Regular Review**: Check the learning dashboard weekly
2. **Export Regularly**: Export successful patterns to knowledge base monthly
3. **Monitor Trends**: Watch for changes in performance metrics
4. **Act on Alerts**: Implement suggestions for improvement areas
5. **Customer Feedback**: Encourage customers to rate responses
6. **Categorization**: Properly categorize issues for better analysis
7. **Follow-ups**: Record conversation outcomes (resolved/escalated)

## Troubleshooting

### Feedback not being recorded
- Check browser console for errors
- Verify API endpoints are accessible
- Check database connection in server logs

### Dashboard shows no data
- Ensure at least one feedback has been submitted
- Check that data files exist: `ai-learning.json`, `ai-patterns.json`
- Refresh the page or check server logs

### Low performance metrics
- Review recent unhelpful responses
- Identify patterns in failed interactions
- Update knowledge base with better response examples

## Future Enhancements

Potential improvements to implement:
- ML-based pattern clustering
- Sentiment analysis on responses
- A/B testing different response variations
- Predictive suggestion of best response patterns
- Integration with NLP for better categorization
- Multi-language support for learning
- Export learning data for model fine-tuning

## Support

For issues or questions about the AI Learning System:
1. Check the learning dashboard for current metrics
2. Review recent feedback and patterns
3. Check server logs for errors
4. Verify database connectivity
