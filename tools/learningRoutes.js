// API endpoints for AI learning and feedback
// Add these routes to your express app in server.js

export function setupLearningRoutes(app, db, learningSystem) {
    // Record feedback on an AI response
    app.post('/api/feedback/ai-response', (req, res) => {
        const { conversationId, messageId, response, feedback, rating } = req.body;

        if (!conversationId || !response || !feedback) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            const record = learningSystem.recordFeedback(
                conversationId,
                messageId,
                response,
                feedback, // 'helpful', 'unhelpful', 'neutral'
                rating || 0
            );

            res.json({
                success: true,
                message: 'Feedback recorded',
                record: record
            });
        } catch (error) {
            console.error('Error recording feedback:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Record conversation outcome
    app.post('/api/feedback/conversation-outcome', (req, res) => {
        const { conversationId, phone, resolved, escalated, resolutionType } = req.body;

        if (!conversationId) {
            return res.status(400).json({ error: 'Missing conversationId' });
        }

        try {
            learningSystem.recordConversationOutcome(
                conversationId,
                phone,
                resolved,
                escalated,
                resolutionType
            ).then(outcome => {
                res.json({
                    success: true,
                    message: 'Conversation outcome recorded',
                    outcome: outcome
                });
            });
        } catch (error) {
            console.error('Error recording conversation outcome:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Record customer preference
    app.post('/api/feedback/customer-preference', (req, res) => {
        const { phone, type, value } = req.body;

        if (!phone || !type || !value) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            learningSystem.recordCustomerPreference(phone, {
                type,
                value
            });

            res.json({
                success: true,
                message: 'Customer preference recorded'
            });
        } catch (error) {
            console.error('Error recording preference:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Record issue category
    app.post('/api/feedback/issue-category', (req, res) => {
        const { category, message, resolution } = req.body;

        if (!category || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            learningSystem.recordIssueCategory(category, message, resolution);

            res.json({
                success: true,
                message: 'Issue category recorded'
            });
        } catch (error) {
            console.error('Error recording issue:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get performance summary
    app.get('/api/learning/performance', (req, res) => {
        try {
            const summary = learningSystem.getPerformanceSummary();
            res.json(summary);
        } catch (error) {
            console.error('Error getting performance summary:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get learning insights
    app.get('/api/learning/insights', (req, res) => {
        try {
            const insights = learningSystem.getLearningInsights();
            res.json(insights);
        } catch (error) {
            console.error('Error getting learning insights:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get customer insights
    app.get('/api/learning/customer-insights/:phone', (req, res) => {
        try {
            const insights = learningSystem.getCustomerInsights(req.params.phone);
            res.json(insights || { message: 'No insights found for this customer' });
        } catch (error) {
            console.error('Error getting customer insights:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get suggested prompt enhancement for a message
    app.post('/api/learning/suggested-enhancement', (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        try {
            const suggestion = learningSystem.getSuggestedPromptEnhancement(message);
            res.json(suggestion || { message: 'No similar patterns found' });
        } catch (error) {
            console.error('Error getting suggestion:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Export learned knowledge to improve knowledge base
    app.post('/api/learning/export-knowledge', (req, res) => {
        try {
            learningSystem.exportLearnedKnowledge().then(improvements => {
                res.json({
                    success: true,
                    message: `Exported ${improvements.length} learned patterns`,
                    improvements: improvements
                });
            });
        } catch (error) {
            console.error('Error exporting knowledge:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Get improvement areas
    app.get('/api/learning/improvement-areas', (req, res) => {
        try {
            const areas = learningSystem.identifyImprovementAreas();
            res.json(areas);
        } catch (error) {
            console.error('Error getting improvement areas:', error);
            res.status(500).json({ error: error.message });
        }
    });

    console.log('✓ AI Learning routes configured');
}
