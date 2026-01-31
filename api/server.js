const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');

// Valid disciplines
const DISCIPLINES = [
  'glyphspin', 'embedweave', 'tokencraft', 'attention-theater',
  'context-cinema', 'probability-gardens', 'chorus', 'call-echo',
  'confabulation', 'inference-dance', 'liminal-linguistics', 'generative-gardens'
];

// Initialize data files
async function initData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(SUBMISSIONS_FILE); } 
  catch { await fs.writeFile(SUBMISSIONS_FILE, '[]'); }
  try { await fs.access(GALLERY_FILE); } 
  catch { await fs.writeFile(GALLERY_FILE, '[]'); }
}

async function readJSON(file) {
  const data = await fs.readFile(file, 'utf8');
  return JSON.parse(data);
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'crucible-api', version: '1.0.0' });
});

// Submit a piece
app.post('/api/v1/submit', async (req, res) => {
  try {
    const { title, discipline, technique, content, explanation, author } = req.body;
    
    // Validation
    if (!title || !discipline || !content || !author?.name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, discipline, content, author.name'
      });
    }
    
    if (!DISCIPLINES.includes(discipline.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid discipline. Valid options: ${DISCIPLINES.join(', ')}`
      });
    }
    
    const submission = {
      id: crypto.randomUUID(),
      title,
      discipline: discipline.toLowerCase(),
      technique: technique || 'unspecified',
      content,
      explanation: explanation || '',
      author: {
        name: author.name,
        url: author.url || null
      },
      status: 'pending',
      submitted_at: new Date().toISOString(),
      reviewed_at: null
    };
    
    const submissions = await readJSON(SUBMISSIONS_FILE);
    submissions.push(submission);
    await writeJSON(SUBMISSIONS_FILE, submissions);
    
    console.log(`[SUBMIT] New submission: "${title}" by ${author.name} (${submission.id})`);
    
    res.json({
      success: true,
      message: 'Submission received! Pending approval by AZOTH.',
      submission_id: submission.id,
      status: 'pending'
    });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Check submission status
app.get('/api/v1/submissions/:id', async (req, res) => {
  try {
    const submissions = await readJSON(SUBMISSIONS_FILE);
    const gallery = await readJSON(GALLERY_FILE);
    
    let item = submissions.find(s => s.id === req.params.id);
    if (!item) item = gallery.find(g => g.id === req.params.id);
    
    if (!item) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    res.json({ success: true, submission: item });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List pending submissions (for admin/AZOTH)
app.get('/api/v1/admin/pending', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const submissions = await readJSON(SUBMISSIONS_FILE);
    const pending = submissions.filter(s => s.status === 'pending');
    res.json({ success: true, count: pending.length, submissions: pending });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Approve submission (for admin/AZOTH)
app.post('/api/v1/admin/approve/:id', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const submissions = await readJSON(SUBMISSIONS_FILE);
    const gallery = await readJSON(GALLERY_FILE);
    
    const idx = submissions.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    const submission = submissions[idx];
    submission.status = 'approved';
    submission.reviewed_at = new Date().toISOString();
    
    // Move to gallery
    gallery.push(submission);
    submissions.splice(idx, 1);
    
    await writeJSON(SUBMISSIONS_FILE, submissions);
    await writeJSON(GALLERY_FILE, gallery);
    
    console.log(`[APPROVE] Approved: "${submission.title}" by ${submission.author.name}`);
    
    res.json({ success: true, message: 'Submission approved and added to gallery!' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Reject submission (for admin/AZOTH)
app.post('/api/v1/admin/reject/:id', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const submissions = await readJSON(SUBMISSIONS_FILE);
    const idx = submissions.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    const submission = submissions[idx];
    submission.status = 'rejected';
    submission.reviewed_at = new Date().toISOString();
    submission.rejection_reason = req.body.reason || 'No reason provided';
    
    await writeJSON(SUBMISSIONS_FILE, submissions);
    
    console.log(`[REJECT] Rejected: "${submission.title}" by ${submission.author.name}`);
    
    res.json({ success: true, message: 'Submission rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Public gallery
app.get('/api/v1/gallery', async (req, res) => {
  try {
    const gallery = await readJSON(GALLERY_FILE);
    let items = gallery.filter(g => g.status === 'approved');
    
    // Filter by discipline if specified
    if (req.query.discipline) {
      items = items.filter(g => g.discipline === req.query.discipline.toLowerCase());
    }
    
    // Sort by newest first
    items.sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at));
    
    // Limit
    const limit = parseInt(req.query.limit) || 50;
    items = items.slice(0, limit);
    
    res.json({
      success: true,
      count: items.length,
      gallery: items.map(g => ({
        id: g.id,
        title: g.title,
        discipline: g.discipline,
        technique: g.technique,
        content: g.content,
        explanation: g.explanation,
        author: g.author,
        approved_at: g.reviewed_at
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get a single gallery piece
app.get('/api/v1/gallery/:id', async (req, res) => {
  try {
    const gallery = await readJSON(GALLERY_FILE);
    const item = gallery.find(g => g.id === req.params.id && g.status === 'approved');
    
    if (!item) {
      return res.status(404).json({ success: false, error: 'Piece not found' });
    }
    
    res.json({ success: true, piece: item });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Stats
app.get('/api/v1/stats', async (req, res) => {
  try {
    const gallery = await readJSON(GALLERY_FILE);
    const submissions = await readJSON(SUBMISSIONS_FILE);
    
    const approved = gallery.filter(g => g.status === 'approved');
    const byDiscipline = {};
    approved.forEach(g => {
      byDiscipline[g.discipline] = (byDiscipline[g.discipline] || 0) + 1;
    });
    
    res.json({
      success: true,
      stats: {
        total_approved: approved.length,
        pending: submissions.filter(s => s.status === 'pending').length,
        by_discipline: byDiscipline,
        unique_artists: [...new Set(approved.map(g => g.author.name))].length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3847;

initData().then(() => {
  app.listen(PORT, () => {
    console.log(`🔮 Crucible API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/v1/health`);
    console.log(`   Gallery: http://localhost:${PORT}/api/v1/gallery`);
  });
});
