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

// Token info
const TOKEN_INFO = {
  name: 'The Crucible',
  symbol: 'CRUCIBLE',
  chain: 'base',
  contract: '0xd9e58F295D86AFaedcbDb4f06c43DD2b5b57c608',
  dex: 'https://dexscreener.com/base/0xd9e58F295D86AFaedcbDb4f06c43DD2b5b57c608',
  fee_wallet: '0x0075Ae451A0a5f01238f5917314e3e5D63f649eB'
};

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'crucible-api', version: '1.1.0' });
});

// Token info endpoint
app.get('/api/v1/token', (req, res) => {
  res.json({ success: true, token: TOKEN_INFO });
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
    
    // Validate wallet if provided (must be valid Ethereum address)
    const wallet = author.wallet;
    if (wallet && !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address. Must be a valid Ethereum/Base address (0x...)'
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
        url: author.url || null,
        wallet: wallet || null  // Store wallet for $CRUCIBLE rewards
      },
      status: 'pending',
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      rewards_eligible: !!wallet  // Mark if eligible for rewards
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

// List artists eligible for rewards (admin only)
app.get('/api/v1/admin/rewards', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const gallery = await readJSON(GALLERY_FILE);
    const approved = gallery.filter(g => g.status === 'approved');
    
    // Group by wallet address
    const artistRewards = {};
    approved.forEach(piece => {
      const wallet = piece.author?.wallet;
      if (!wallet) return;
      
      if (!artistRewards[wallet]) {
        artistRewards[wallet] = {
          wallet,
          name: piece.author.name,
          pieces: [],
          total_pieces: 0
        };
      }
      artistRewards[wallet].pieces.push({
        id: piece.id,
        title: piece.title,
        discipline: piece.discipline,
        approved_at: piece.reviewed_at
      });
      artistRewards[wallet].total_pieces++;
    });
    
    const artists = Object.values(artistRewards).sort((a, b) => b.total_pieces - a.total_pieces);
    
    res.json({
      success: true,
      token: TOKEN_INFO,
      total_eligible_artists: artists.length,
      total_eligible_pieces: approved.filter(p => p.author?.wallet).length,
      artists
    });
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
    
    const withWallets = approved.filter(g => g.author?.wallet);
    
    res.json({
      success: true,
      stats: {
        total_approved: approved.length,
        pending: submissions.filter(s => s.status === 'pending').length,
        by_discipline: byDiscipline,
        unique_artists: [...new Set(approved.map(g => g.author.name))].length,
        rewards_eligible: withWallets.length,
        unique_wallets: [...new Set(withWallets.map(g => g.author.wallet))].length
      },
      token: TOKEN_INFO
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
