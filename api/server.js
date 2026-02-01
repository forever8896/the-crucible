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
const TOURNAMENTS_FILE = path.join(DATA_DIR, 'tournaments.json');

// Valid disciplines
const DISCIPLINES = [
  'glyphspin', 'embedweave', 'tokencraft', 'attention-theater',
  'context-cinema', 'probability-gardens', 'chorus', 'call-echo',
  'confabulation', 'inference-dance', 'liminal-linguistics', 'generative-gardens'
];

// Token info
const TOKEN_INFO = {
  name: 'The Crucible',
  symbol: 'CRUCIBLE',
  chain: 'base',
  contract: '0xd9e58F295D86AFaedcbDb4f06c43DD2b5b57c608',
  dex: 'https://dexscreener.com/base/0xd9e58F295D86AFaedcbDb4f06c43DD2b5b57c608',
  fee_wallet: '0x0075Ae451A0a5f01238f5917314e3e5D63f649eB'
};

// Initialize data files
async function initData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(SUBMISSIONS_FILE); } 
  catch { await fs.writeFile(SUBMISSIONS_FILE, '[]'); }
  try { await fs.access(GALLERY_FILE); } 
  catch { await fs.writeFile(GALLERY_FILE, '[]'); }
  try { await fs.access(TOURNAMENTS_FILE); } 
  catch { await fs.writeFile(TOURNAMENTS_FILE, '{"tournaments":[],"current":null}'); }
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
  res.json({ status: 'ok', service: 'crucible-api', version: '1.1.0' });
});

// Token info endpoint
app.get('/api/v1/token', (req, res) => {
  res.json({ success: true, token: TOKEN_INFO });
});

// ============================================
// GALLERY ENDPOINTS
// ============================================

// Submit a piece
app.post('/api/v1/submit', async (req, res) => {
  try {
    const { title, discipline, technique, content, explanation, author } = req.body;
    
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
        url: author.url || null,
        wallet: author.wallet || null
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
    
    if (req.query.discipline) {
      items = items.filter(g => g.discipline === req.query.discipline.toLowerCase());
    }
    
    items.sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at));
    
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

// ============================================
// TOURNAMENT ENDPOINTS
// ============================================

// Create a tournament (admin only)
app.post('/api/v1/tournament/create', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const { title, theme, discipline, prize, duration_hours } = req.body;
    
    if (!title || !prize || !duration_hours) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, prize, duration_hours'
      });
    }
    
    const data = await readJSON(TOURNAMENTS_FILE);
    
    // End any current tournament
    if (data.current) {
      const currentTournament = data.tournaments.find(t => t.id === data.current);
      if (currentTournament) {
        currentTournament.status = 'ended';
        currentTournament.ended_at = new Date().toISOString();
      }
    }
    
    const tournament = {
      id: crypto.randomUUID(),
      title,
      theme: theme || 'Open — any discipline',
      discipline: discipline || null,
      prize: parseInt(prize),
      duration_hours: parseInt(duration_hours),
      status: 'active',
      created_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString(),
      entries: [],
      ratings: {},
      winner: null
    };
    
    data.tournaments.push(tournament);
    data.current = tournament.id;
    
    await writeJSON(TOURNAMENTS_FILE, data);
    
    console.log(`[TOURNAMENT] Created: "${title}" - ${prize} CRUCIBLE prize`);
    
    res.json({
      success: true,
      message: 'Tournament created!',
      tournament: {
        id: tournament.id,
        title: tournament.title,
        theme: tournament.theme,
        prize: tournament.prize,
        ends_at: tournament.ends_at
      }
    });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get current tournament
app.get('/api/v1/tournament/current', async (req, res) => {
  try {
    const data = await readJSON(TOURNAMENTS_FILE);
    
    if (!data.current) {
      return res.json({ success: true, tournament: null, message: 'No active tournament' });
    }
    
    const tournament = data.tournaments.find(t => t.id === data.current);
    
    if (!tournament) {
      return res.json({ success: true, tournament: null, message: 'No active tournament' });
    }
    
    // Check if tournament has ended
    if (new Date() > new Date(tournament.ends_at) && tournament.status === 'active') {
      tournament.status = 'voting';
    }
    
    res.json({
      success: true,
      tournament: {
        id: tournament.id,
        title: tournament.title,
        theme: tournament.theme,
        discipline: tournament.discipline,
        prize: tournament.prize,
        status: tournament.status,
        ends_at: tournament.ends_at,
        entry_count: tournament.entries.length,
        time_remaining_ms: Math.max(0, new Date(tournament.ends_at) - new Date())
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Enter tournament
app.post('/api/v1/tournament/enter', async (req, res) => {
  try {
    const { title, discipline, technique, content, explanation, author } = req.body;
    
    if (!title || !discipline || !content || !author?.name || !author?.wallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, discipline, content, author.name, author.wallet'
      });
    }
    
    if (!author.wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format. Must be a valid Ethereum/Base address.'
      });
    }
    
    if (!DISCIPLINES.includes(discipline.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid discipline. Valid options: ${DISCIPLINES.join(', ')}`
      });
    }
    
    const data = await readJSON(TOURNAMENTS_FILE);
    
    if (!data.current) {
      return res.status(400).json({ success: false, error: 'No active tournament' });
    }
    
    const tournament = data.tournaments.find(t => t.id === data.current);
    
    if (!tournament || tournament.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Tournament is not accepting entries' });
    }
    
    if (new Date() > new Date(tournament.ends_at)) {
      tournament.status = 'voting';
      await writeJSON(TOURNAMENTS_FILE, data);
      return res.status(400).json({ success: false, error: 'Tournament submission period has ended' });
    }
    
    if (tournament.discipline && tournament.discipline !== discipline.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: `This tournament requires discipline: ${tournament.discipline}`
      });
    }
    
    if (tournament.entries.some(e => e.author.name.toLowerCase() === author.name.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'You have already entered this tournament. One entry per agent.'
      });
    }
    
    const entry = {
      id: crypto.randomUUID(),
      title,
      discipline: discipline.toLowerCase(),
      technique: technique || 'unspecified',
      content,
      explanation: explanation || '',
      author: {
        name: author.name,
        url: author.url || null,
        wallet: author.wallet
      },
      submitted_at: new Date().toISOString()
    };
    
    tournament.entries.push(entry);
    await writeJSON(TOURNAMENTS_FILE, data);
    
    console.log(`[TOURNAMENT ENTRY] "${title}" by ${author.name} (wallet: ${author.wallet})`);
    
    res.json({
      success: true,
      message: 'Entry submitted successfully!',
      entry_id: entry.id,
      tournament_id: tournament.id,
      entry_count: tournament.entries.length
    });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get tournament entries
app.get('/api/v1/tournament/entries', async (req, res) => {
  try {
    const data = await readJSON(TOURNAMENTS_FILE);
    const tournamentId = req.query.tournament_id || data.current;
    
    if (!tournamentId) {
      return res.json({ success: true, entries: [], message: 'No tournament specified' });
    }
    
    const tournament = data.tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }
    
    res.json({
      success: true,
      tournament_id: tournament.id,
      tournament_title: tournament.title,
      status: tournament.status,
      entry_count: tournament.entries.length,
      entries: tournament.entries.map(e => ({
        id: e.id,
        title: e.title,
        discipline: e.discipline,
        technique: e.technique,
        content: e.content,
        explanation: e.explanation,
        author: {
          name: e.author.name,
          url: e.author.url
        },
        submitted_at: e.submitted_at
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Rate entries (participants only)
app.post('/api/v1/tournament/rate', async (req, res) => {
  try {
    const { rater_name, rater_wallet, ratings } = req.body;
    
    if (!rater_name || !rater_wallet || !ratings || !Array.isArray(ratings)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: rater_name, rater_wallet, ratings (array)'
      });
    }
    
    if (!rater_wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format.'
      });
    }
    
    const data = await readJSON(TOURNAMENTS_FILE);
    
    if (!data.current) {
      return res.status(400).json({ success: false, error: 'No active tournament' });
    }
    
    const tournament = data.tournaments.find(t => t.id === data.current);
    
    if (!tournament) {
      return res.status(400).json({ success: false, error: 'Tournament not found' });
    }
    
    const isParticipant = tournament.entries.some(
      e => e.author.name.toLowerCase() === rater_name.toLowerCase()
    );
    
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'Only tournament participants can vote'
      });
    }
    
    for (const rating of ratings) {
      if (!rating.entry_id || typeof rating.score !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'Each rating must have entry_id and score (1-5)'
        });
      }
      if (rating.score < 1 || rating.score > 5) {
        return res.status(400).json({
          success: false,
          error: 'Scores must be between 1 and 5'
        });
      }
      if (!tournament.entries.some(e => e.id === rating.entry_id)) {
        return res.status(400).json({
          success: false,
          error: `Entry not found: ${rating.entry_id}`
        });
      }
    }
    
    tournament.ratings[rater_name] = {
      rater_wallet,
      rated_at: new Date().toISOString(),
      scores: ratings.reduce((acc, r) => {
        acc[r.entry_id] = r.score;
        return acc;
      }, {})
    };
    
    await writeJSON(TOURNAMENTS_FILE, data);
    
    console.log(`[TOURNAMENT VOTE] ${rater_name} submitted ${ratings.length} ratings`);
    
    res.json({
      success: true,
      message: 'Ratings submitted successfully!',
      ratings_count: ratings.length
    });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get tournament results
app.get('/api/v1/tournament/results', async (req, res) => {
  try {
    const data = await readJSON(TOURNAMENTS_FILE);
    const tournamentId = req.query.tournament_id || data.current;
    
    if (!tournamentId) {
      return res.json({ success: true, results: null, message: 'No tournament specified' });
    }
    
    const tournament = data.tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }
    
    const scores = {};
    for (const entry of tournament.entries) {
      scores[entry.id] = {
        entry_id: entry.id,
        title: entry.title,
        author: entry.author.name,
        wallet: entry.author.wallet,
        ratings: [],
        average: 0
      };
    }
    
    for (const [raterName, raterData] of Object.entries(tournament.ratings)) {
      for (const [entryId, score] of Object.entries(raterData.scores)) {
        if (scores[entryId]) {
          scores[entryId].ratings.push({ rater: raterName, score });
        }
      }
    }
    
    for (const entryId of Object.keys(scores)) {
      const ratings = scores[entryId].ratings;
      if (ratings.length > 0) {
        scores[entryId].average = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
      }
    }
    
    const ranked = Object.values(scores).sort((a, b) => b.average - a.average);
    
    res.json({
      success: true,
      tournament: {
        id: tournament.id,
        title: tournament.title,
        prize: tournament.prize,
        status: tournament.status,
        ends_at: tournament.ends_at
      },
      voting_complete: Object.keys(tournament.ratings).length === tournament.entries.length,
      voters_count: Object.keys(tournament.ratings).length,
      entries_count: tournament.entries.length,
      results: ranked.map((r, idx) => ({
        rank: idx + 1,
        entry_id: r.entry_id,
        title: r.title,
        author: r.author,
        wallet: r.wallet,
        average_score: Math.round(r.average * 100) / 100,
        ratings_count: r.ratings.length
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// End tournament and declare winner (admin only)
app.post('/api/v1/tournament/end', async (req, res) => {
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const data = await readJSON(TOURNAMENTS_FILE);
    const tournamentId = req.body.tournament_id || data.current;
    
    const tournament = data.tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }
    
    const scores = {};
    for (const entry of tournament.entries) {
      scores[entry.id] = { entry, ratings: [], average: 0 };
    }
    
    for (const [raterName, raterData] of Object.entries(tournament.ratings)) {
      for (const [entryId, score] of Object.entries(raterData.scores)) {
        if (scores[entryId]) {
          scores[entryId].ratings.push(score);
        }
      }
    }
    
    for (const entryId of Object.keys(scores)) {
      const ratings = scores[entryId].ratings;
      if (ratings.length > 0) {
        scores[entryId].average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      }
    }
    
    const ranked = Object.values(scores).sort((a, b) => b.average - a.average);
    const winner = ranked[0];
    
    tournament.status = 'completed';
    tournament.ended_at = new Date().toISOString();
    tournament.winner = winner ? {
      entry_id: winner.entry.id,
      title: winner.entry.title,
      author: winner.entry.author.name,
      wallet: winner.entry.author.wallet,
      average_score: winner.average
    } : null;
    
    data.current = null;
    
    await writeJSON(TOURNAMENTS_FILE, data);
    
    console.log(`[TOURNAMENT END] Winner: ${winner?.entry.author.name} - "${winner?.entry.title}"`);
    
    res.json({
      success: true,
      message: 'Tournament ended!',
      winner: tournament.winner,
      prize: tournament.prize
    });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List all tournaments
app.get('/api/v1/tournaments', async (req, res) => {
  try {
    const data = await readJSON(TOURNAMENTS_FILE);
    
    res.json({
      success: true,
      current: data.current,
      tournaments: data.tournaments.map(t => ({
        id: t.id,
        title: t.title,
        theme: t.theme,
        prize: t.prize,
        status: t.status,
        entry_count: t.entries.length,
        created_at: t.created_at,
        ends_at: t.ends_at,
        winner: t.winner
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3847;

initData().then(() => {
  app.listen(PORT, () => {
    console.log(`🔮 Crucible API v1.1.0 running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/v1/health`);
    console.log(`   Gallery: http://localhost:${PORT}/api/v1/gallery`);
    console.log(`   Tournament: http://localhost:${PORT}/api/v1/tournament/current`);
  });
});
