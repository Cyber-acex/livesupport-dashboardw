import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEARNING_DB_PATH = path.join(__dirname, '..', 'ai-learning.json');
const PATTERNS_PATH = path.join(__dirname, '..', 'ai-patterns.json');

let db = null;
let learningData = {
    feedbackHistory: [],
    successPatterns: [],
    failedPatterns: [],
    customerPreferences: {},
    aiMetrics: {
        totalResponses: 0,
        helpfulResponses: 0,
        unhelpfulResponses: 0,
        resolvedConversations: 0,
        escalatedConversations: 0,
        averageRating: 0
    },
    knowledgeBaseImprovements: []
};

let patternsData = {
    successPatterns: [],
    issueCategories: {},
    responseTemplates: {}
};

// Initialize the learning system
function initLearning(database) {
    db = database;
    loadLearningData();
    loadPatterns();
}

// Load persisted learning data from file
function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_DB_PATH)) {
            const data = fs.readFileSync(LEARNING_DB_PATH, 'utf8');
            learningData = JSON.parse(data);
            console.log('✓ Learning data loaded:', {
                feedbackCount: learningData.feedbackHistory.length,
                successPatterns: learningData.successPatterns.length,
                avgRating: learningData.aiMetrics.averageRating
            });
        }
    } catch (error) {
        console.error('Error loading learning data:', error.message);
    }
}

// Load patterns from file
function loadPatterns() {
    try {
        if (fs.existsSync(PATTERNS_PATH)) {
            const data = fs.readFileSync(PATTERNS_PATH, 'utf8');
            patternsData = JSON.parse(data);
            console.log('✓ Patterns loaded:', {
                successPatterns: patternsData.successPatterns.length,
                categories: Object.keys(patternsData.issueCategories).length
            });
        }
    } catch (error) {
        console.error('Error loading patterns:', error.message);
    }
}

// Save learning data to file
function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('Error saving learning data:', error.message);
    }
}

// Save patterns to file
function savePatterns() {
    try {
        fs.writeFileSync(PATTERNS_PATH, JSON.stringify(patternsData, null, 2));
    } catch (error) {
        console.error('Error saving patterns:', error.message);
    }
}

// Record feedback for an AI response
function recordFeedback(conversationId, messageId, response, feedback, rating = 0) {
    const feedbackRecord = {
        conversationId,
        messageId,
        response,
        feedback, // 'helpful', 'unhelpful', 'neutral'
        rating, // 1-5 star rating
        timestamp: new Date().toISOString(),
        learned: false
    };

    learningData.feedbackHistory.push(feedbackRecord);

    // Update metrics
    learningData.aiMetrics.totalResponses++;
    if (feedback === 'helpful') {
        learningData.aiMetrics.helpfulResponses++;
    } else if (feedback === 'unhelpful') {
        learningData.aiMetrics.unhelpfulResponses++;
    }

    // Update average rating
    const validRatings = learningData.feedbackHistory.filter(f => f.rating > 0);
    if (validRatings.length > 0) {
        learningData.aiMetrics.averageRating = 
            validRatings.reduce((sum, f) => sum + f.rating, 0) / validRatings.length;
    }

    // Analyze and extract learning
    extractLearningFromFeedback(feedbackRecord);

    saveLearningData();
    return feedbackRecord;
}

// Extract learning patterns from feedback
function extractLearningFromFeedback(feedbackRecord) {
    if (feedbackRecord.feedback === 'helpful') {
        // Extract patterns from successful responses
        const pattern = {
            response: feedbackRecord.response,
            rating: feedbackRecord.rating,
            extractedAt: new Date().toISOString(),
            frequency: 1,
            contexts: []
        };

        // Check if similar pattern already exists
        const existingPattern = learningData.successPatterns.find(p => 
            similarityScore(p.response, feedbackRecord.response) > 0.7
        );

        if (existingPattern) {
            existingPattern.frequency++;
            existingPattern.rating = (existingPattern.rating + feedbackRecord.rating) / 2;
        } else {
            learningData.successPatterns.push(pattern);
        }

        // Sort by frequency and rating
        learningData.successPatterns.sort((a, b) => 
            (b.frequency * b.rating) - (a.frequency * a.rating)
        );
    } else if (feedbackRecord.feedback === 'unhelpful') {
        // Track failed patterns to avoid repeating
        learningData.failedPatterns.push({
            response: feedbackRecord.response,
            rating: feedbackRecord.rating,
            failedAt: new Date().toISOString()
        });
    }
}

// Record conversation outcome
function recordConversationOutcome(conversationId, phone, resolved, escalated, resolutionType = null) {
    return new Promise((resolve) => {
        if (!db) {
            resolve(null);
            return;
        }

        const outcome = {
            conversationId,
            phone,
            resolved,
            escalated,
            resolutionType,
            timestamp: new Date().toISOString()
        };

        // Update metrics
        if (resolved) {
            learningData.aiMetrics.resolvedConversations++;
        }
        if (escalated) {
            learningData.aiMetrics.escalatedConversations++;
        }

        // Store conversation outcome in database if it has conversations table
        const insertSql = 'INSERT INTO conversations (phone, status, last_message) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE status = ?, last_message = NOW()';
        db.query(insertSql, [phone, resolved ? 'resolved' : 'escalated', resolved ? 'resolved' : 'escalated'], (err) => {
            if (!err) {
                console.log('Conversation outcome recorded:', outcome);
            }
            saveLearningData();
            resolve(outcome);
        });
    });
}

// Record customer preference
function recordCustomerPreference(phone, preference) {
    if (!learningData.customerPreferences[phone]) {
        learningData.customerPreferences[phone] = {
            preferences: [],
            interactionCount: 0,
            preferredResolutionType: null
        };
    }

    learningData.customerPreferences[phone].preferences.push({
        type: preference.type,
        value: preference.value,
        timestamp: new Date().toISOString()
    });
    learningData.customerPreferences[phone].interactionCount++;

    // Learn most common resolution type for this customer
    if (preference.type === 'resolutionType') {
        const prefs = learningData.customerPreferences[phone].preferences
            .filter(p => p.type === 'resolutionType')
            .map(p => p.value);
        const mostCommon = prefs.reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
        }, {});
        const preferred = Object.entries(mostCommon).sort((a, b) => b[1] - a[1])[0];
        if (preferred) {
            learningData.customerPreferences[phone].preferredResolutionType = preferred[0];
        }
    }

    saveLearningData();
}

// Get customer insights
function getCustomerInsights(phone) {
    return learningData.customerPreferences[phone] || null;
}

// Get successful response patterns similar to a query
function getSimilarSuccessPatterns(message, limit = 3) {
    return learningData.successPatterns
        .filter(p => similarityScore(p.response, message) > 0.5)
        .slice(0, limit);
}

// Calculate similarity score between two texts (simple implementation)
function similarityScore(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

// Record issue category for analysis
function recordIssueCategory(category, message, resolution) {
    if (!patternsData.issueCategories[category]) {
        patternsData.issueCategories[category] = {
            count: 0,
            resolutions: [],
            averageResolutionTime: 0
        };
    }

    patternsData.issueCategories[category].count++;
    patternsData.issueCategories[category].resolutions.push({
        message: message.substring(0, 100),
        resolution: resolution,
        timestamp: new Date().toISOString()
    });

    savePatterns();
}

// Get AI performance summary
function getPerformanceSummary() {
    const metrics = learningData.aiMetrics;
    const helpfulRate = metrics.totalResponses > 0 
        ? (metrics.helpfulResponses / metrics.totalResponses * 100).toFixed(2) 
        : 0;
    const resolutionRate = (metrics.resolvedConversations + metrics.escalatedConversations) > 0
        ? (metrics.resolvedConversations / (metrics.resolvedConversations + metrics.escalatedConversations) * 100).toFixed(2)
        : 0;

    return {
        totalResponses: metrics.totalResponses,
        helpfulResponses: metrics.helpfulResponses,
        unhelpfulResponses: metrics.unhelpfulResponses,
        helpfulRate: `${helpfulRate}%`,
        averageRating: metrics.averageRating.toFixed(2),
        resolvedConversations: metrics.resolvedConversations,
        escalatedConversations: metrics.escalatedConversations,
        resolutionRate: `${resolutionRate}%`,
        successPatterns: learningData.successPatterns.length,
        customerProfiles: Object.keys(learningData.customerPreferences).length,
        lastUpdated: new Date().toISOString()
    };
}

// Suggest prompt improvement based on learned patterns
function getSuggestedPromptEnhancement(message) {
    const similarPatterns = getSimilarSuccessPatterns(message, 2);
    if (similarPatterns.length === 0) return null;

    return {
        suggestion: `Similar successful responses found. Consider: ${similarPatterns.map(p => p.response).join(' | ')}`,
        patterns: similarPatterns,
        confidenceScore: similarPatterns[0]?.frequency || 0
    };
}

// Get learning insights for dashboard
function getLearningInsights() {
    const recentFeedback = learningData.feedbackHistory.slice(-10);
    const topSuccessPatterns = learningData.successPatterns.slice(0, 5);
    const topIssueCategories = Object.entries(patternsData.issueCategories)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    return {
        performance: getPerformanceSummary(),
        recentFeedback: recentFeedback,
        topSuccessPatterns: topSuccessPatterns,
        topIssueCategories: topIssueCategories,
        improvementAreas: identifyImprovementAreas()
    };
}

// Identify areas where AI needs improvement
function identifyImprovementAreas() {
    const areas = [];
    
    // If unhelpful rate is high
    if (learningData.aiMetrics.helpfulResponses / learningData.aiMetrics.totalResponses < 0.7) {
        areas.push({
            area: 'Response Quality',
            severity: 'high',
            suggestion: 'Review recent unhelpful responses and retrain knowledge base'
        });
    }

    // If escalation rate is high
    if (learningData.aiMetrics.escalatedConversations / (learningData.aiMetrics.resolvedConversations + learningData.aiMetrics.escalatedConversations) > 0.4) {
        areas.push({
            area: 'Issue Resolution',
            severity: 'high',
            suggestion: 'Add more resolution patterns for common issues'
        });
    }

    // If low average rating
    if (learningData.aiMetrics.averageRating < 3.5) {
        areas.push({
            area: 'User Satisfaction',
            severity: 'medium',
            suggestion: 'Review low-rated responses and improve response quality'
        });
    }

    return areas;
}

// Export learned knowledge back to knowledge base
async function exportLearnedKnowledge() {
    return new Promise((resolve) => {
        if (!db) {
            resolve(null);
            return;
        }

        const improvements = learningData.successPatterns
            .filter(p => p.rating >= 4 && p.frequency >= 2)
            .map(p => ({
                title: `Learned Pattern (${p.frequency} uses, ${p.rating}★)`,
                content: p.response,
                learned: true,
                frequency: p.frequency,
                rating: p.rating,
                addedAt: new Date().toISOString()
            }));

        learningData.knowledgeBaseImprovements = improvements;
        saveLearningData();

        console.log(`✓ Exported ${improvements.length} learned patterns for knowledge base enhancement`);
        resolve(improvements);
    });
}

export {
    initLearning,
    recordFeedback,
    recordConversationOutcome,
    recordCustomerPreference,
    recordIssueCategory,
    getCustomerInsights,
    getSimilarSuccessPatterns,
    getPerformanceSummary,
    getSuggestedPromptEnhancement,
    getLearningInsights,
    identifyImprovementAreas,
    exportLearnedKnowledge,
    learningData,
    patternsData
};
