const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: 'https://citymall-meme-assignment-f2xl7hq3a.vercel.app',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors({ origin: 'https://citymall-meme-assignment-f2xl7hq3a.vercel.app' }));
app.use(express.json());

// Mock users for hackathon
const users = { 'neonhacker': { id: 1, credits: 1000 }, 'cybershadow': { id: 2, credits: 1000 } };

// In-memory cache for leaderboard
let leaderboardCache = [];

async function generateAICaptionAndVibe(title, tags, image_url) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Generate a funny caption and a cyberpunk vibe description for a meme with title "${title}", tags [${tags.join(', ')}], and image URL ${image_url}. Return as JSON: { "caption": string, "vibe": string }`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    // Clean up response (Gemini sometimes wraps JSON in ```json)
    const cleanedText = text.replace(/```json\n|\n```/g, '').trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error('Gemini API error:', err.message);
    return { caption: 'YOLO to the moon!', vibe: 'Neon Chaos Mode' }; // Fallback
  }
}


app.get('/', (req, res) => res.send('Cybermeme Market: Neon chaos awaits!'));


app.get('/memes', async (req, res) => {
  console.log('Hit /memes endpoint');
  const { data, error } = await supabase.from('memes').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Supabase error:', error.message);
    return res.status(500).send('Server glitch: ' + error.message);
  }
  res.json(data);
});

app.post('/memes', async (req, res) => {
  console.log('Hit POST /memes:', req.body);
  const { title, image_url, tags, owner } = req.body;
  if (!users[owner]) {
    console.log('Invalid user:', owner);
    return res.status(401).send('User not found');
  }

  const { caption, vibe } = await generateAICaptionAndVibe(title, tags, image_url || 'https://picsum.photos/200');
  const { data, error } = await supabase.from('memes').insert({
    title,
    image_url: image_url || 'https://picsum.photos/200',
    tags,
    owner_id: users[owner].id,
    caption,
    vibe
  }).select();
  if (error) {
    console.error('Supabase error:', error.message);
    return res.status(500).send('Server glitch: ' + error.message);
  }
  console.log('Emitting new_meme:', data[0]);
  io.emit('new_meme', data[0]);
  res.json(data[0]);
});

// Place bid
app.post('/bids', async (req, res) => {
  console.log('Hit POST /bids:', req.body);
  const { meme_id, user, credits } = req.body;
  if (!users[user]) return res.status(401).send('User not found');
  if (!credits || credits < 0) return res.status(400).send('Invalid bid');
  const { data, error } = await supabase.from('bids').insert({
    meme_id,
    user_id: users[user].id,
    credits
  }).select();
  if (error) {
    console.error('Supabase error:', error.message);
    return res.status(500).send('Server glitch: ' + error.message);
  }
  io.emit('new_bid', { meme_id, credits, user });
  res.json(data[0]);
});

// Vote on meme
app.post('/memes/:id/vote', async (req, res) => {
  console.log('Hit POST /memes/:id/vote:', req.params, req.body);
  const { id } = req.params;
  const { type, user } = req.body;
  if (!users[user]) return res.status(401).send('User not found');
  if (!['up', 'down'].includes(type)) return res.status(400).send('Invalid vote type');
  const increment = type === 'up' ? 1 : -1;
  // Fetch current upvotes
  const { data: meme, error: fetchError } = await supabase
    .from('memes')
    .select('upvotes')
    .eq('id', id)
    .single();
  if (fetchError || !meme) {
    console.error('Supabase fetch error:', fetchError?.message || 'Meme not found');
    return res.status(404).send('Meme not found');
  }
  
  const newUpvotes = meme.upvotes + increment;
  const { data, error } = await supabase
    .from('memes')
    .update({ upvotes: newUpvotes })
    .eq('id', id)
    .select();
  if (error) {
    console.error('Supabase update error:', error.message);
    return res.status(500).send('Server glitch: ' + error.message);
  }
  io.emit('vote_update', { meme_id: parseInt(id), upvotes: data[0].upvotes });
  // Update leaderboard cache
  const { data: leaderboard } = await supabase
    .from('memes')
    .select('id, title, upvotes')
    .order('upvotes', { ascending: false })
    .limit(10);
  leaderboardCache = leaderboard;
  io.emit('leaderboard_update', leaderboard);
  res.json(data[0]);
});

app.get('/leaderboard', async (req, res) => {
  console.log('Hit /leaderboard endpoint');
  res.json(leaderboardCache);
});

io.on('connection', (socket) => {
  console.log('User jacked into the neon jungle');
  socket.on('disconnect', () => console.log('User bailed'));
});

const PORT = 5000;
server.listen(PORT, () => console.log(`Server jacked in at port ${PORT}`));
