import fs from 'fs';
import path from 'path';
import { db } from '../db/database.js';

// Export ai_feedback rows to JSONL for training/analysis
(async function exportFeedback() {
  try {
    const out = fs.createWriteStream(path.join(__dirname, '..', 'exports', `ai_feedback_export_${Date.now()}.jsonl`), { flags: 'wx' });
    db.query('SELECT id, conversation_id, message_id, user_id, rating, feedback_text, correction, created_at FROM ai_feedback ORDER BY created_at ASC', (err, rows) => {
      if (err) {
        console.error('DB error fetching ai_feedback:', err);
        process.exit(1);
      }
      if (!rows || rows.length === 0) {
        console.log('No feedback rows found');
        process.exit(0);
      }

      rows.forEach(r => {
        const outObj = {
          id: r.id,
          conversation_id: r.conversation_id,
          message_id: r.message_id,
          user_id: r.user_id,
          rating: r.rating,
          feedback_text: r.feedback_text,
          correction: r.correction,
          created_at: r.created_at
        };
        out.write(JSON.stringify(outObj) + '\n');
      });

      out.end(() => {
        console.log('Export complete:', out.path);
        process.exit(0);
      });
    });
  } catch (e) {
    console.error('Export failed:', e);
    process.exit(1);
  }
})();
