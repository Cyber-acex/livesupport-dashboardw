import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMB_FILE = path.join(__dirname, '..', 'kb-embeddings.json');

let store = []; // { id, title, text, vector }
let vocab = {}; // term -> index
let idf = []; // index -> idf
let ready = false;

function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[\p{P}$+<=>^`|~]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function buildTfIdf(docs) {
    const N = docs.length;
    const df = {}; // term -> doc freq

    const docTerms = docs.map(d => {
        const terms = tokenize(d.text);
        const freqs = {};
        for (const t of terms) {
            freqs[t] = (freqs[t] || 0) + 1;
        }
        for (const t of Object.keys(freqs)) df[t] = (df[t] || 0) + 1;
        return freqs;
    });

    // build vocab
    const terms = Object.keys(df).sort();
    vocab = {};
    terms.forEach((t, i) => { vocab[t] = i; });

    // compute idf
    idf = terms.map(t => Math.log((N + 1) / (1 + df[t])) + 1);

    // compute doc vectors
    store = docs.map((d, idx) => {
        const freqs = docTerms[idx];
        const vec = new Array(terms.length).fill(0);
        for (const [t, f] of Object.entries(freqs)) {
            const i = vocab[t];
            if (i === undefined) continue;
            vec[i] = f * idf[i];
        }
        // normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
        return { id: d.id, title: d.title, text: d.text, vector: vec };
    });

    // persist
    try {
        fs.writeFileSync(EMB_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        console.warn('Failed to save embeddings file', e.message || e);
    }

    ready = true;
}

async function init(kbPath) {
    try {
        const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        // If existing embeddings available, load them
        if (fs.existsSync(EMB_FILE)) {
            try {
                const existing = JSON.parse(fs.readFileSync(EMB_FILE, 'utf8'));
                if (Array.isArray(existing) && existing.length === kb.length && existing[0].vector && existing[0].vector.length > 0) {
                    store = existing;
                    // reconstruct vocab and idf from store vectors is non-trivial; rebuild instead
                    ready = true;
                    console.log('Vector store loaded from', EMB_FILE);
                    return;
                }
            } catch (e) {
                console.warn('Failed to read existing embeddings, will rebuild', e.message);
            }
        }

        const entries = kb.map((item, idx) => ({ id: idx, title: item.title || item.question || '', text: (item.content || item.answer || item.title || item.question || '').trim() }));
        buildTfIdf(entries);
        console.log('TF-IDF vector store built (count:', entries.length, ')');
    } catch (e) {
        console.error('vectorStore.init error', e.message || e);
        ready = false;
    }
}

function dot(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += (a[i] || 0) * (b[i] || 0);
    return s;
}

function norm(a) {
    return Math.sqrt(a.reduce((s, v) => s + v * v, 0)) || 1;
}

function vectorizeQuery(q) {
    const terms = Object.keys(vocab);
    const freqs = {};
    for (const t of tokenize(q)) freqs[t] = (freqs[t] || 0) + 1;
    const vec = new Array(terms.length).fill(0);
    for (const [t, f] of Object.entries(freqs)) {
        const i = vocab[t];
        if (i === undefined) continue;
        vec[i] = f * idf[i];
    }
    // normalize
    const n = norm(vec);
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / n;
    return vec;
}

async function search(query, topK = 3) {
    try {
        if (!ready || store.length === 0) return [];
        if (!query) return [];
        const qVec = vectorizeQuery(query);
        const results = [];
        for (const item of store) {
            if (!item.vector) continue;
            const score = dot(qVec, item.vector) / (norm(qVec) * norm(item.vector));
            results.push({ id: item.id, title: item.title, text: item.text, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    } catch (e) {
        console.error('vectorStore.search error', e.message || e);
        return [];
    }
}

async function rebuild(kbPath) {
    try {
        const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        const entries = kb.map((item, idx) => ({ id: idx, title: item.title || item.question || '', text: (item.content || item.answer || item.title || item.question || '').trim() }));
        buildTfIdf(entries);
        return { success: true, count: store.length };
    } catch (e) {
        console.error('vectorStore.rebuild error', e.message || e);
        return { success: false, error: e.message || String(e) };
    }
}

export default { init, search, rebuild, _internal: { EMB_FILE } };
