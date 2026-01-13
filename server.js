const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 55e6
});

app.use(cors());
app.use(express.json({ limit: '55mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sidchat-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const supabaseUrl = process.env.SUPABASE_URL || 'https://znlklskqcuybcnrflieq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubGtsc2txY3V5YmNucmZsaWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNDA1MTgsImV4cCI6MjA4MzgxNjUxOH0.PgGy8LJqi0vsA6F9MQUxh5WQ8VJfFTT64BW2prpDXCY';
const supabase = createClient(supabaseUrl, supabaseKey);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '251332694475-49ldp4v3mjeqhjgaobsvg1ji50aitslq.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://sidcha.onrender.com/auth/google/callback';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const validTokens = new Set();
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const onlineUsers = new Map();
const userSockets = new Map();
const socketUsers = new Map();

const STAMPS = [
  { id: 'like', emoji: '\ud83d\udc4d' }, { id: 'love', emoji: '\u2764\ufe0f' },
  { id: 'laugh', emoji: '\ud83d\ude02' }, { id: 'wow', emoji: '\ud83d\ude2e' },
  { id: 'sad', emoji: '\ud83d\ude22' }, { id: 'angry', emoji: '\ud83d\ude20' },
  { id: 'fire', emoji: '\ud83d\udd25' }, { id: 'cool', emoji: '\ud83d\ude0e' },
  { id: 'party', emoji: '\ud83c\udf89' }, { id: 'think', emoji: '\ud83e\udd14' },
  { id: 'clap', emoji: '\ud83d\udc4f' }, { id: 'cry', emoji: '\ud83d\ude2d' },
  { id: 'sleep', emoji: '\ud83d\ude34' }, { id: 'star', emoji: '\u2b50' },
  { id: 'heart_eyes', emoji: '\ud83d\ude0d' }, { id: 'skull', emoji: '\ud83d\udc80' },
  { id: 'ghost', emoji: '\ud83d\udc7b' }, { id: 'poop', emoji: '\ud83d\udca9' },
  { id: 'ok', emoji: '\ud83d\udc4c' }, { id: 'wave', emoji: '\ud83d\udc4b' }
];

const screenRooms = { 1: new Set(), 2: new Set(), 3: new Set() };
const roomSharers = { 1: null, 2: null, 3: null };
const screenSharers = new Map();
const screenShareViewers = new Map();
const MAX_VIEWERS = 3;

function broadcastRoomCounts() {
  const counts = {};
  for (let roomId in screenRooms) {
    counts[roomId] = screenRooms[roomId].size;
  }
  io.emit('roomCounts', counts);
}

function broadcastOnlineUsers() {
  const users = Array.from(onlineUsers.values());
  io.emit('onlineUsers', users);
}

// ========== Google OAuth ==========
app.get('/auth/google', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `access_type=offline&` +
    `prompt=consent`;
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const googleUser = await userRes.json();

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleUser.id)
      .single();

    let user;
    if (existingUser) {
      const { data } = await supabase
        .from('users')
        .update({ last_seen: new Date().toISOString(), status: 'online' })
        .eq('google_id', googleUser.id)
        .select()
        .single();
      user = data;
    } else {
      const { data } = await supabase
        .from('users')
        .insert([{
          google_id: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          status: 'online'
        }])
        .select()
        .single();
      user = data;
    }

    req.session.user = user;
    res.redirect('/?login=success');
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect('/?error=oauth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  if (req.session.user) {
    supabase.from('users').update({ status: 'offline' }).eq('id', req.session.user.id);
  }
  req.session.destroy();
  res.redirect('/');
});

app.get('/auth/me', (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, user: null });
  }
});

// ========== API ==========
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/stamps', (req, res) => res.json({ success: true, stamps: STAMPS }));

app.get('/api/channels', async (req, res) => {
  try {
    console.log('Fetching channels...');
    console.log('Supabase URL:', supabaseUrl);
    const { data, error } = await supabase.from('channels').select('*').order('id');
    if (error) {
      console.error('Supabase channels error:', error);
      throw error;
    }
    console.log('Channels fetched:', data?.length);
    res.json({ success: true, channels: data });
  } catch (err) {
    console.error('Channels catch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

app.post('/api/channels', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.length < 1 || name.length > 20) {
      return res.status(400).json({ success: false, error: 'Invalid channel name' });
    }
    const cleanName = name.trim().replace(/\s+/g, '-');
    const { data, error } = await supabase.from('channels').insert([{ name: cleanName }]).select().single();
    if (error) throw error;
    io.emit('channelCreated', data);
    res.json({ success: true, channel: data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create channel' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    console.log('Fetching users...');
    const { data, error } = await supabase.from('users').select('id, name, picture, status').order('name');
    if (error) {
      console.error('Supabase users error:', error);
      throw error;
    }
    console.log('Users fetched:', data?.length);
    res.json({ success: true, users: data });
  } catch (err) {
    console.error('Users catch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

app.get('/api/pins/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { data, error } = await supabase
      .from('pins')
      .select('*, messages(*)')
      .eq('messages.channel_id', channelId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, pins: data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch pins' });
  }
});

app.post('/api/pins', async (req, res) => {
  try {
    const { message_id, pinned_by } = req.body;
    const { data, error } = await supabase
      .from('pins')
      .insert([{ message_id, pinned_by }])
      .select()
      .single();
    if (error) throw error;
    io.emit('messagePinned', data);
    res.json({ success: true, pin: data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to pin message' });
  }
});

app.delete('/api/pins/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { error } = await supabase.from('pins').delete().eq('message_id', messageId);
    if (error) throw error;
    io.emit('messageUnpinned', parseInt(messageId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to unpin message' });
  }
});

async function uploadMedia(base64Data, mediaType) {
  try {
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return null;
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length > MAX_FILE_SIZE) return null;
    const ext = mimeType.split('/')[1] || 'bin';
    const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const { error } = await supabase.storage.from('media').upload(fileName, buffer, { contentType: mimeType });
    if (error) return null;
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) { return null; }
}

function parseMentions(message) {
  const mentionRegex = /@(\S+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(message)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

// ========== \u30e1\u30a4\u30f3\u30da\u30fc\u30b8\uff08Liquid Glass \u30c6\u30fc\u30de\uff09 ==========
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>siDChat</title>
  <link rel="icon" type="image/png" href="data:image/png;base64,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">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: 'Noto Sans JP', sans-serif; 
      background: url('https://min-chi.material.jp/mc/materials/background-c/summer_beach/summer_beach_1.jpg') no-repeat center center fixed;
      background-size: cover;
      color: #333; 
      height: 100vh; 
      display: flex; 
      padding: 20px;
      gap: 20px;
    }
    
    /* ===== Liquid Glass Effect ===== */
    .glass {
      background: rgba(255, 255, 255, 0.65);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.8);
      border-radius: 24px;
      box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.1),
        inset 0 1px 1px rgba(255, 255, 255, 0.9),
        inset 0 -1px 1px rgba(0, 0, 0, 0.05);
    }
    
    .glass-light {
      background: rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 16px;
    }
    
    .glass-btn {
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.8);
      border-radius: 12px;
      transition: all 0.3s ease;
      cursor: pointer;
    }
    
    .glass-btn:hover {
      background: rgba(255, 255, 255, 0.9);
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    
    /* ===== Sidebar ===== */
    #sidebar { 
      width: 260px; 
      display: flex; 
      flex-direction: column; 
      padding: 20px;
      gap: 15px;
    }
    
    #server-header { 
      padding: 15px; 
      font-weight: 700; 
      font-size: 20px; 
      text-align: center;
      color: #2c3e50;
      background: linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0.4));
      border-radius: 16px;
    }
    
    #user-section { 
      padding: 15px; 
      display: flex; 
      align-items: center; 
      gap: 12px; 
    }
    
    #user-avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.8); }
    #user-info { flex: 1; }
    #user-name { font-size: 14px; font-weight: 600; color: #2c3e50; }
    #user-status { font-size: 11px; color: #27ae60; }
    
    #login-btn { 
      width: 100%;
      padding: 12px 20px; 
      color: #2c3e50;
      font-size: 14px;
      font-weight: 600;
    }
    
    #logout-btn { 
      padding: 8px 12px; 
      background: rgba(231, 76, 60, 0.2);
      color: #c0392b;
      font-size: 12px;
    }
    
    #channels-header { 
      padding: 10px 15px; 
      color: #7f8c8d; 
      font-size: 12px; 
      font-weight: 600; 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    #add-channel-btn { 
      background: none; 
      border: none; 
      color: #7f8c8d; 
      font-size: 20px; 
      cursor: pointer;
      transition: all 0.3s;
    }
    #add-channel-btn:hover { color: #3498db; transform: scale(1.2); }
    
    #channel-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    
    .channel-item { 
      padding: 12px 15px; 
      border-radius: 12px; 
      cursor: pointer; 
      color: #5d6d7e; 
      display: flex; 
      align-items: center; 
      gap: 10px;
      transition: all 0.3s ease;
      font-weight: 500;
    }
    .channel-item:hover { 
      background: rgba(255, 255, 255, 0.6); 
      color: #2c3e50;
      transform: translateX(5px);
    }
    .channel-item.active { 
      background: rgba(52, 152, 219, 0.2); 
      color: #2980b9;
      font-weight: 600;
    }
    .channel-item::before { content: '#'; font-size: 18px; opacity: 0.6; }
    
    #voice-channels-header { 
      padding: 10px 15px; 
      color: #7f8c8d; 
      font-size: 12px; 
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 10px;
    }
    
    .voice-channel-item { 
      padding: 12px 15px; 
      border-radius: 12px; 
      cursor: pointer; 
      color: #5d6d7e; 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      transition: all 0.3s ease;
    }
    .voice-channel-item:hover { background: rgba(255, 255, 255, 0.6); }
    .voice-channel-item.active { background: rgba(46, 204, 113, 0.2); color: #27ae60; }
    .voice-channel-item.sharing { background: rgba(231, 76, 60, 0.2); color: #c0392b; }
    .viewer-count { 
      font-size: 11px; 
      background: rgba(0,0,0,0.1); 
      padding: 3px 8px; 
      border-radius: 10px;
    }
    
    /* ===== Main Area ===== */
    #main { 
      flex: 1; 
      display: flex; 
      flex-direction: column; 
      padding: 20px;
      gap: 15px;
    }
    
    #header { 
      padding: 15px 20px; 
      font-size: 18px; 
      font-weight: 600; 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      color: #2c3e50;
    }
    
    #channel-name::before { content: '# '; opacity: 0.5; }
    
    .header-buttons { display: flex; gap: 10px; align-items: center; }
    
    .header-btn { 
      padding: 8px 16px; 
      color: #5d6d7e;
      font-size: 13px;
      font-weight: 500;
    }
    
    #online-count { 
      color: #27ae60; 
      font-size: 13px;
      font-weight: 500;
      padding: 6px 12px;
      background: rgba(46, 204, 113, 0.15);
      border-radius: 20px;
    }
    
    #screen-share-container { 
      display: none; 
      padding: 15px;
    }
    #screen-share-container.active { display: block; }
    #screen-share-header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 10px; 
      color: #27ae60; 
      font-weight: 600;
    }
    #screen-share-video { 
      width: 100%; 
      max-height: 400px; 
      background: #000; 
      border-radius: 16px;
    }
    #close-screen-share { 
      padding: 6px 12px;
      background: rgba(231, 76, 60, 0.2);
      color: #c0392b;
      font-size: 12px;
    }
    
    /* ===== Messages ===== */
    #messages { 
      flex: 1; 
      overflow-y: auto; 
      padding: 20px; 
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    #loading { 
      position: absolute; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%); 
      text-align: center; 
      color: #7f8c8d;
    }
    
    .spinner { 
      width: 40px; 
      height: 40px; 
      border: 4px solid rgba(52, 152, 219, 0.2); 
      border-top: 4px solid #3498db; 
      border-radius: 50%; 
      animation: spin 1s linear infinite; 
      margin: 0 auto 15px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .message { 
      display: flex; 
      gap: 12px; 
      position: relative;
      padding: 12px 15px;
      border-radius: 16px;
      transition: all 0.3s ease;
    }
    .message:hover { 
      background: rgba(255, 255, 255, 0.5);
    }
    .message:hover .message-actions { display: flex; }
    
    .message.announcement { 
      background: linear-gradient(135deg, rgba(52, 152, 219, 0.2), rgba(155, 89, 182, 0.2));
      border-left: 4px solid #3498db;
    }
    
    .message-actions { 
      display: none; 
      position: absolute; 
      top: -5px; 
      right: 10px;
      gap: 4px;
    }
    .message-actions button { 
      padding: 6px 10px;
      font-size: 12px;
    }
    
    .avatar { 
      width: 44px; 
      height: 44px; 
      border-radius: 50%; 
      background: linear-gradient(135deg, #3498db, #9b59b6); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-weight: bold; 
      flex-shrink: 0; 
      overflow: hidden;
      color: white;
      font-size: 16px;
      border: 2px solid rgba(255,255,255,0.8);
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .avatar.roblox { background: linear-gradient(135deg, #00a2ff, #0066cc); }
    .avatar.admin { background: linear-gradient(135deg, #e74c3c, #c0392b); }
    
    .content { flex: 1; }
    .username { 
      font-weight: 600; 
      color: #2c3e50; 
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .username .time { 
      font-size: 11px; 
      color: #95a5a6; 
      font-weight: 400;
    }
    .text { 
      line-height: 1.6; 
      word-wrap: break-word;
      color: #34495e;
    }
    
    .mention { 
      background: rgba(52, 152, 219, 0.2); 
      color: #2980b9; 
      padding: 1px 4px; 
      border-radius: 4px; 
      cursor: pointer;
      font-weight: 500;
    }
    .mention:hover { background: rgba(52, 152, 219, 0.4); }
    
    .stamp-msg { font-size: 48px; line-height: 1.2; }
    
    .msg-image, .msg-video { 
      max-width: 400px; 
      max-height: 300px; 
      border-radius: 12px; 
      margin-top: 8px; 
      cursor: pointer;
      border: 2px solid rgba(255,255,255,0.8);
    }
    
    .roblox-badge, .admin-badge { 
      color: white; 
      font-size: 10px; 
      padding: 2px 8px; 
      border-radius: 10px;
      font-weight: 600;
    }
    .roblox-badge { background: linear-gradient(135deg, #00a2ff, #0066cc); }
    .admin-badge { background: linear-gradient(135deg, #e74c3c, #c0392b); }
    
    /* ===== Input Area ===== */
    #input-area { 
      padding: 15px 20px;
    }
    
    #media-preview { 
      display: none; 
      margin-bottom: 10px; 
      position: relative;
    }
    #media-preview img, #media-preview video { 
      max-width: 200px; 
      max-height: 150px; 
      border-radius: 12px;
    }
    #media-preview .remove-btn { 
      position: absolute; 
      top: -8px; 
      right: -8px; 
      background: #e74c3c; 
      border: none; 
      border-radius: 50%; 
      width: 24px; 
      height: 24px; 
      color: white; 
      cursor: pointer;
      font-size: 14px;
    }
    
    #upload-status { 
      display: none; 
      color: #3498db; 
      font-size: 12px; 
      margin-bottom: 10px;
    }
    #upload-status.show { display: block; }
    
    #input-row { display: flex; gap: 10px; align-items: center; }
    
    #username-input { 
      width: 120px; 
      background: rgba(255, 255, 255, 0.7); 
      border: 1px solid rgba(255,255,255,0.8);
      padding: 12px 15px; 
      border-radius: 12px; 
      color: #2c3e50; 
      font-size: 14px;
      outline: none;
      transition: all 0.3s;
    }
    #username-input:focus {
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.2);
    }
    
    #message-input { 
      flex: 1; 
      background: rgba(255, 255, 255, 0.5); 
      border: none; 
      padding: 12px 15px; 
      border-radius: 12px;
      color: #2c3e50; 
      font-size: 14px; 
      outline: none;
    }
    #message-input::placeholder { color: #95a5a6; }
    
    .input-btn { 
      padding: 12px 18px;
      color: #2c3e50;
      font-size: 14px;
      font-weight: 500;
    }
    .input-btn.primary {
      background: linear-gradient(135deg, rgba(52, 152, 219, 0.8), rgba(155, 89, 182, 0.8));
      color: white;
    }
    
    #send-btn:disabled { opacity: 0.5; }
    #file-input { display: none; }
    
    /* ===== Mention Suggest ===== */
    #mention-suggest { 
      display: none; 
      position: absolute; 
      bottom: 100%; 
      left: 0;
      padding: 8px 0; 
      margin-bottom: 8px;
      max-height: 200px; 
      overflow-y: auto; 
      min-width: 220px;
    }
    #mention-suggest.show { display: block; }
    
    .mention-item { 
      padding: 10px 15px; 
      cursor: pointer; 
      display: flex; 
      align-items: center; 
      gap: 10px;
      transition: all 0.2s;
    }
    .mention-item:hover { background: rgba(52, 152, 219, 0.1); }
    .mention-item img { width: 28px; height: 28px; border-radius: 50%; }
    .mention-item .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .mention-item .status-dot.online { background: #27ae60; }
    .mention-item .status-dot.offline { background: #95a5a6; }
    
    /* ===== Stamp Panel ===== */
    #stamp-panel { 
      display: none; 
      position: absolute; 
      bottom: 100%; 
      right: 0;
      padding: 15px; 
      margin-bottom: 10px;
      width: 300px;
    }
    #stamp-panel.show { display: block; }
    .stamp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
    .stamp-item { 
      font-size: 24px; 
      padding: 10px; 
      text-align: center; 
      cursor: pointer; 
      border-radius: 10px;
      transition: all 0.2s;
    }
    .stamp-item:hover { 
      background: rgba(52, 152, 219, 0.2);
      transform: scale(1.2);
    }
    .stamp-title { 
      color: #7f8c8d; 
      font-size: 12px; 
      margin-bottom: 10px; 
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    #stamp-container { position: relative; }
    
    /* ===== Modal ===== */
    #media-modal { 
      display: none; 
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      background: rgba(0, 0, 0, 0.85); 
      backdrop-filter: blur(10px);
      z-index: 1000; 
      justify-content: center; 
      align-items: center; 
      cursor: pointer;
    }
    #media-modal img, #media-modal video { 
      max-width: 90%; 
      max-height: 90%; 
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    
    #channel-modal { 
      display: none; 
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
      z-index: 1000; 
      justify-content: center; 
      align-items: center;
    }
    #channel-modal.show { display: flex; }
    
    .modal-content { 
      padding: 30px; 
      width: 90%; 
      max-width: 400px;
    }
    .modal-content h3 { 
      color: #2c3e50; 
      margin-bottom: 20px;
      font-size: 20px;
    }
    .modal-content input { 
      width: 100%; 
      background: rgba(255, 255, 255, 0.8); 
      border: 1px solid rgba(255,255,255,0.9);
      padding: 15px; 
      border-radius: 12px; 
      color: #2c3e50; 
      font-size: 14px; 
      margin-bottom: 20px;
      outline: none;
    }
    .modal-buttons { display: flex; gap: 10px; }
    .modal-buttons button { 
      flex: 1; 
      padding: 12px; 
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
    }
    .modal-buttons .cancel { 
      background: rgba(149, 165, 166, 0.3);
      border: none;
      color: #5d6d7e;
      cursor: pointer;
    }
    .modal-buttons .create { 
      background: linear-gradient(135deg, #3498db, #9b59b6);
      border: none;
      color: white;
      cursor: pointer;
    }
    
    /* ===== Pins Panel ===== */
    #pins-panel { 
      display: none; 
      position: fixed; 
      top: 80px; 
      right: 40px;
      width: 350px; 
      max-height: 500px; 
      overflow-y: auto;
      z-index: 100;
    }
    #pins-panel.show { display: block; }
    #pins-header { 
      padding: 15px 20px; 
      font-weight: 600;
      display: flex; 
      justify-content: space-between;
      color: #2c3e50;
      border-bottom: 1px solid rgba(0,0,0,0.1);
    }
    .pinned-message { 
      padding: 12px 20px; 
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }
    .pinned-message:hover { background: rgba(255, 255, 255, 0.5); }
    
    /* ===== Members Panel ===== */
    #members-panel { 
      width: 240px;
      padding: 20px;
      display: none;
    }
    #members-panel.show { display: block; }
    #members-header { 
      color: #7f8c8d; 
      font-size: 12px; 
      font-weight: 600; 
      margin-bottom: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .member-item { 
      display: flex; 
      align-items: center; 
      gap: 12px; 
      padding: 8px 0;
    }
    .member-item img { 
      width: 36px; 
      height: 36px; 
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.8);
    }
    .member-avatar-wrapper { position: relative; }
    .member-item .status-indicator { 
      width: 12px; 
      height: 12px; 
      border-radius: 50%; 
      position: absolute; 
      bottom: 0; 
      right: 0; 
      border: 2px solid rgba(255,255,255,0.9);
    }
    .member-item .status-indicator.online { background: #27ae60; }
    .member-item .status-indicator.offline { background: #95a5a6; }
    
    /* ===== Scrollbar ===== */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { 
      background: rgba(0, 0, 0, 0.2); 
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.3); }
  </style>
</head>
<body>
  <div id="sidebar" class="glass">
    <div id="server-header"><img src="data:image/png;base64,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" alt="SdiChat" style="height: 32px;"></div>
    <div id="channels-header">\u30c1\u30e3\u30f3\u30cd\u30eb<button id="add-channel-btn">+</button></div>
    <div id="channel-list"></div>
    <div id="voice-channels-header">\ud83d\udda5\ufe0f \u753b\u9762\u5171\u6709</div>
    <div id="voice-channel-list">
      <div class="voice-channel-item" id="screen-room-1" onclick="joinScreenRoom(1)">
        <span>\u5171\u6709\u30eb\u30fc\u30e01</span>
        <span class="viewer-count" id="room1-count">0\u4eba</span>
      </div>
      <div class="voice-channel-item" id="screen-room-2" onclick="joinScreenRoom(2)">
        <span>\u5171\u6709\u30eb\u30fc\u30e02</span>
        <span class="viewer-count" id="room2-count">0\u4eba</span>
      </div>
      <div class="voice-channel-item" id="screen-room-3" onclick="joinScreenRoom(3)">
        <span>\u5171\u6709\u30eb\u30fc\u30e03</span>
        <span class="viewer-count" id="room3-count">0\u4eba</span>
      </div>
    </div>
    <div id="user-section" class="glass-light">
      <div id="guest-login">
        <button id="login-btn" class="glass-btn" onclick="googleLogin()">\ud83d\udd10 Google\u3067\u30ed\u30b0\u30a4\u30f3</button>
      </div>
      <div id="logged-in-user" style="display:none;">
        <img id="user-avatar" src="" alt="">
        <div id="user-info">
          <div id="user-name"></div>
          <div id="user-status">\ud83d\udfe2 \u30aa\u30f3\u30e9\u30a4\u30f3</div>
        </div>
        <button id="logout-btn" class="glass-btn" onclick="logout()">\u21a9\ufe0f</button>
      </div>
    </div>
  </div>
  
  <div id="main" class="glass">
    <div id="header">
      <span id="channel-name">general</span>
      <div class="header-buttons">
        <button class="header-btn glass-btn" onclick="togglePins()">\ud83d\udccc \u30d4\u30f3\u7559\u3081</button>
        <button class="header-btn glass-btn" onclick="toggleMembers()">\ud83d\udc65 \u30e1\u30f3\u30d0\u30fc</button>
        <span id="online-count">0\u4eba\u304c\u30aa\u30f3\u30e9\u30a4\u30f3</span>
      </div>
    </div>
    <div id="screen-share-container" class="glass-light">
      <div id="screen-share-header">
        <span>\ud83d\udda5\ufe0f <span id="sharer-name">\u8ab0\u304b</span>\u304c\u753b\u9762\u3092\u5171\u6709\u4e2d</span>
        <button id="close-screen-share" class="glass-btn">\u2715 \u9589\u3058\u308b</button>
      </div>
      <video id="screen-share-video" autoplay playsinline></video>
    </div>
    <div id="pins-panel" class="glass">
      <div id="pins-header">\ud83d\udccc \u30d4\u30f3\u7559\u3081 <button onclick="togglePins()" style="background:none;border:none;color:#7f8c8d;cursor:pointer;font-size:18px;">\u2715</button></div>
      <div id="pins-list"></div>
    </div>
    <div id="messages">
      <div id="loading"><div class="spinner"></div><div>\u30ed\u30fc\u30c9\u3057\u3066\u3044\u307e\u3059...</div></div>
    </div>
    <div id="input-area" class="glass-light">
      <div id="upload-status">\ud83d\udce4 \u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u4e2d...</div>
      <div id="media-preview">
        <img id="preview-img" src="" style="display:none;">
        <video id="preview-video" src="" style="display:none;" controls></video>
        <button class="remove-btn" onclick="removeMedia()">\u00d7</button>
      </div>
      <div id="mention-suggest" class="glass"></div>
      <div id="input-row">
        <input type="text" id="username-input" placeholder="\u540d\u524d" maxlength="20">
        <input type="text" id="message-input" placeholder="\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1 (@\u3067\u30e1\u30f3\u30b7\u30e7\u30f3)" maxlength="500">
        <input type="file" id="file-input" accept="image/*,video/*">
        <button id="media-btn" class="input-btn glass-btn">\ud83d\udcf7</button>
        <div id="stamp-container">
          <button id="stamp-btn" class="input-btn glass-btn">\ud83d\ude00</button>
          <div id="stamp-panel" class="glass"><div class="stamp-title">\u30b9\u30bf\u30f3\u30d7</div><div class="stamp-grid" id="stamp-grid"></div></div>
        </div>
        <button id="send-btn" class="input-btn glass-btn primary">\u9001\u4fe1</button>
      </div>
    </div>
  </div>
  
  <div id="members-panel" class="glass">
    <div id="members-header">\u30aa\u30f3\u30e9\u30a4\u30f3 \u2014 <span id="members-count">0</span></div>
    <div id="members-list"></div>
  </div>

  <div id="media-modal">
    <img id="modal-img" src="" style="display:none;">
    <video id="modal-video" src="" style="display:none;" controls></video>
  </div>
  
  <div id="channel-modal">
    <div class="modal-content glass">
      <h3>\u2728 \u30c1\u30e3\u30f3\u30cd\u30eb\u3092\u4f5c\u6210</h3>
      <input type="text" id="new-channel-name" placeholder="\u30c1\u30e3\u30f3\u30cd\u30eb\u540d" maxlength="20">
      <div class="modal-buttons">
        <button class="cancel" onclick="closeChannelModal()">\u30ad\u30e3\u30f3\u30bb\u30eb</button>
        <button class="create" onclick="createChannel()">\u4f5c\u6210</button>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    // ===== コンソール警告（Base64画像版） =====
    const warningImg = 'data:image/png;base64,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';
    console.log('%c ', 'background: url(' + warningImg + ') no-repeat center; background-size: contain; padding: 100px 150px;');
    console.log('%c↑ 上の警告を必ず読んでください ↑', 'color: red; font-size: 16px; font-weight: bold;');
    console.log('%cこのコンソールは開発者向けです。', 'font-size: 12px; color: gray;');

    const socket = io();
    let currentChannel = 1;
    let channels = [];
    let currentUser = null;
    let allUsers = [];
    let isSharing = false;
    let localStream = null;
    let peerConnections = {};
    let currentScreenRoom = null;
    
    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
    
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const usernameInput = document.getElementById('username-input');
    const sendBtn = document.getElementById('send-btn');
    const channelList = document.getElementById('channel-list');
    const channelName = document.getElementById('channel-name');
    const onlineCount = document.getElementById('online-count');
    const loadingDiv = document.getElementById('loading');
    const uploadStatus = document.getElementById('upload-status');
    const stampPanel = document.getElementById('stamp-panel');
    const stampGrid = document.getElementById('stamp-grid');
    const mediaModal = document.getElementById('media-modal');
    const channelModal = document.getElementById('channel-modal');
    const screenShareContainer = document.getElementById('screen-share-container');
    const screenShareVideo = document.getElementById('screen-share-video');
    const sharerNameSpan = document.getElementById('sharer-name');
    const mentionSuggest = document.getElementById('mention-suggest');
    const pinsPanel = document.getElementById('pins-panel');
    const membersPanel = document.getElementById('members-panel');

    let pendingMedia = null;
    let pendingMediaType = null;
    const MAX_SIZE = 50 * 1024 * 1024;

    const STAMPS = [
      { emoji: '\ud83d\udc4d' }, { emoji: '\u2764\ufe0f' }, { emoji: '\ud83d\ude02' }, { emoji: '\ud83d\ude2e' },
      { emoji: '\ud83d\ude22' }, { emoji: '\ud83d\ude20' }, { emoji: '\ud83d\udd25' }, { emoji: '\ud83d\ude0e' },
      { emoji: '\ud83c\udf89' }, { emoji: '\ud83e\udd14' }, { emoji: '\ud83d\udc4f' }, { emoji: '\ud83d\ude2d' },
      { emoji: '\ud83d\ude34' }, { emoji: '\u2b50' }, { emoji: '\ud83d\ude0d' }, { emoji: '\ud83d\udc80' },
      { emoji: '\ud83d\udc7b' }, { emoji: '\ud83d\udca9' }, { emoji: '\ud83d\udc4c' }, { emoji: '\ud83d\udc4b' }
    ];

    STAMPS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'stamp-item';
      div.textContent = s.emoji;
      div.onclick = () => sendStamp(s.emoji);
      stampGrid.appendChild(div);
    });

    async function checkAuth() {
      const res = await fetch('/auth/me');
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        showLoggedInUser();
        usernameInput.value = currentUser.name;
        usernameInput.disabled = true;
        socket.emit('userOnline', { userId: currentUser.id, name: currentUser.name, picture: currentUser.picture });
      } else {
        usernameInput.value = localStorage.getItem('username') || '';
      }
    }
    
    function showLoggedInUser() {
      document.getElementById('guest-login').style.display = 'none';
      document.getElementById('logged-in-user').style.display = 'flex';
      document.getElementById('user-avatar').src = currentUser.picture || '';
      document.getElementById('user-name').textContent = currentUser.name;
    }
    
    function googleLogin() { window.location.href = '/auth/google'; }
    function logout() { window.location.href = '/auth/logout'; }
    
    checkAuth();

    async function loadUsers() {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success) allUsers = data.users;
    }
    loadUsers();

    messageInput.addEventListener('input', (e) => {
      const val = e.target.value;
      const lastAt = val.lastIndexOf('@');
      if (lastAt !== -1 && lastAt === val.length - 1 || (lastAt !== -1 && !val.substring(lastAt).includes(' '))) {
        const query = val.substring(lastAt + 1).toLowerCase();
        const filtered = allUsers.filter(u => u.name.toLowerCase().includes(query));
        if (filtered.length > 0) {
          mentionSuggest.innerHTML = filtered.map(u => 
            '<div class="mention-item" onclick="insertMention(\\'' + u.name + '\\')">' +
            '<img src="' + (u.picture || '') + '" onerror="this.style.display=\\'none\\'">' +
            '<span class="status-dot ' + (u.status || 'offline') + '"></span>' +
            '<span>' + escapeHtml(u.name) + '</span></div>'
          ).join('');
          mentionSuggest.classList.add('show');
        } else {
          mentionSuggest.classList.remove('show');
        }
      } else {
        mentionSuggest.classList.remove('show');
      }
    });
    
    function insertMention(name) {
      const val = messageInput.value;
      const lastAt = val.lastIndexOf('@');
      messageInput.value = val.substring(0, lastAt) + '@' + name + ' ';
      mentionSuggest.classList.remove('show');
      messageInput.focus();
    }

    function togglePins() {
      pinsPanel.classList.toggle('show');
      if (pinsPanel.classList.contains('show')) loadPins();
    }
    
    async function loadPins() {
      const res = await fetch('/api/pins/' + currentChannel);
      const data = await res.json();
      const list = document.getElementById('pins-list');
      if (data.success && data.pins.length > 0) {
        list.innerHTML = data.pins.map(p => 
          '<div class="pinned-message">' +
          '<strong>' + escapeHtml(p.messages?.username || '\u4e0d\u660e') + '</strong><br>' +
          '<span>' + escapeHtml(p.messages?.message || '') + '</span>' +
          '</div>'
        ).join('');
      } else {
        list.innerHTML = '<div style="padding:15px;color:#7f8c8d;">\u30d4\u30f3\u7559\u3081\u3055\u308c\u305f\u30e1\u30c3\u30bb\u30fc\u30b8\u306f\u3042\u308a\u307e\u305b\u3093</div>';
      }
    }
    
    async function pinMessage(messageId) {
      if (!currentUser) { alert('\u30d4\u30f3\u7559\u3081\u3059\u308b\u306b\u306f\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044'); return; }
      await fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, pinned_by: currentUser.id })
      });
    }
    
    async function unpinMessage(messageId) {
      await fetch('/api/pins/' + messageId, { method: 'DELETE' });
    }

    function toggleMembers() {
      membersPanel.classList.toggle('show');
    }
    
    function updateMembersList(users) {
      const list = document.getElementById('members-list');
      document.getElementById('members-count').textContent = users.length;
      list.innerHTML = users.map(u => 
        '<div class="member-item">' +
        '<div class="member-avatar-wrapper">' +
        '<img src="' + (u.picture || '') + '" onerror="this.src=\\'\\';">' +
        '<div class="status-indicator online"></div>' +
        '</div>' +
        '<span>' + escapeHtml(u.name) + '</span></div>'
      ).join('');
    }

    async function joinScreenRoom(roomId) {
      const username = usernameInput.value.trim() || currentUser?.name || 'Anonymous';
      if (currentScreenRoom === roomId) { leaveScreenRoom(); return; }
      if (currentScreenRoom) leaveScreenRoom();
      currentScreenRoom = roomId;
      updateRoomUI();
      socket.emit('joinScreenRoom', { roomId, username });
      if (confirm('\u753b\u9762\u3092\u5171\u6709\u3057\u307e\u3059\u304b\uff1f\\
\u300c\u30ad\u30e3\u30f3\u30bb\u30eb\u300d\u3092\u62bc\u3059\u3068\u8996\u8074\u306e\u307f\u306b\u306a\u308a\u307e\u3059')) {
        try {
          localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          isSharing = true;
          socket.emit('startScreenShare', { roomId, username });
          localStream.getVideoTracks()[0].onended = () => stopScreenShare();
          updateRoomUI();
        } catch (err) { console.log('\u5171\u6709\u30ad\u30e3\u30f3\u30bb\u30eb'); }
      }
    }
    
    function leaveScreenRoom() {
      if (isSharing) stopScreenShare();
      socket.emit('leaveScreenRoom', { roomId: currentScreenRoom });
      currentScreenRoom = null;
      screenShareContainer.classList.remove('active');
      screenShareVideo.srcObject = null;
      updateRoomUI();
    }
    
    function stopScreenShare() {
      if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
      isSharing = false;
      socket.emit('stopScreenShare', { roomId: currentScreenRoom });
      updateRoomUI();
      for (let id in peerConnections) { peerConnections[id].close(); }
      peerConnections = {};
    }
    
    function updateRoomUI() {
      document.querySelectorAll('.voice-channel-item').forEach(el => el.classList.remove('active', 'sharing'));
      if (currentScreenRoom) {
        const roomEl = document.getElementById('screen-room-' + currentScreenRoom);
        if (roomEl) roomEl.classList.add(isSharing ? 'sharing' : 'active');
      }
    }
    
    document.getElementById('close-screen-share').onclick = () => {
      screenShareContainer.classList.remove('active');
      screenShareVideo.srcObject = null;
    };

    socket.on('screenShareStarted', async ({ socketId, username }) => {
      if (socketId === socket.id) return;
      sharerNameSpan.textContent = username;
      screenShareContainer.classList.add('active');
      const pc = new RTCPeerConnection(config);
      peerConnections[socketId] = pc;
      pc.ontrack = (event) => { screenShareVideo.srcObject = event.streams[0]; };
      pc.onicecandidate = (event) => { if (event.candidate) socket.emit('iceCandidate', { candidate: event.candidate, targetId: socketId }); };
      socket.emit('requestScreenShare', { targetId: socketId });
    });
    socket.on('screenShareRequested', async ({ requesterId }) => {
      if (!localStream) return;
      const pc = new RTCPeerConnection(config);
      peerConnections[requesterId] = pc;
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      pc.onicecandidate = (event) => { if (event.candidate) socket.emit('iceCandidate', { candidate: event.candidate, targetId: requesterId }); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { offer, targetId: requesterId });
    });
    socket.on('offer', async ({ offer, senderId }) => {
      const pc = peerConnections[senderId];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, targetId: senderId });
    });
    socket.on('answer', async ({ answer, senderId }) => {
      const pc = peerConnections[senderId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on('iceCandidate', async ({ candidate, senderId }) => {
      const pc = peerConnections[senderId];
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });
    socket.on('screenShareStopped', ({ socketId }) => {
      screenShareContainer.classList.remove('active');
      screenShareVideo.srcObject = null;
      if (peerConnections[socketId]) { peerConnections[socketId].close(); delete peerConnections[socketId]; }
    });
    socket.on('screenShareFull', () => alert('\u753b\u9762\u5171\u6709\u306f\u6700\u59273\u4eba\u307e\u3067\u3067\u3059\uff01'));
    socket.on('roomCounts', (counts) => {
      for (let roomId in counts) {
        const el = document.getElementById('room' + roomId + '-count');
        if (el) el.textContent = counts[roomId] + '\u4eba';
      }
    });

    async function loadChannels() {
      const res = await fetch('/api/channels');
      const data = await res.json();
      if (data.success) { channels = data.channels; renderChannels(); }
    }
    function renderChannels() {
      channelList.innerHTML = '';
      channels.forEach(ch => {
        const div = document.createElement('div');
        div.className = 'channel-item' + (ch.id === currentChannel ? ' active' : '');
        div.textContent = ch.name;
        div.onclick = () => switchChannel(ch.id, ch.name);
        channelList.appendChild(div);
      });
    }
    function switchChannel(id, name) {
      currentChannel = id;
      channelName.textContent = name;
      renderChannels();
      loadingDiv.style.display = 'block';
      messagesDiv.innerHTML = '';
      messagesDiv.appendChild(loadingDiv);
      socket.emit('joinChannel', id);
    }
    document.getElementById('add-channel-btn').onclick = () => channelModal.classList.add('show');
    function closeChannelModal() { channelModal.classList.remove('show'); document.getElementById('new-channel-name').value = ''; }
    async function createChannel() {
      const name = document.getElementById('new-channel-name').value.trim();
      if (!name) return;
      const res = await fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if ((await res.json()).success) { closeChannelModal(); loadChannels(); }
    }
    channelModal.onclick = (e) => { if (e.target === channelModal) closeChannelModal(); };

    function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
    function isStampOnly(msg) { return STAMPS.some(s => s.emoji === msg.trim()); }
    
    function formatMessage(text) {
      return escapeHtml(text).replace(/@(\S+)/g, '<span class="mention">@$1</span>');
    }

    function addMessage(data) {
      if (loadingDiv.parentNode === messagesDiv) loadingDiv.style.display = 'none';
      const div = document.createElement('div');
      const isAnnounce = data.is_announcement;
      div.className = 'message' + (isAnnounce ? ' announcement' : '');
      div.dataset.id = data.id;
      let avatarContent = '';
      if (data.user_picture) {
        avatarContent = '<img src="' + data.user_picture + '">';
      } else {
        avatarContent = escapeHtml(data.username.charAt(0).toUpperCase());
      }
      let badge = '', avatarClass = 'avatar';
      if (isAnnounce) { badge = '<span class="admin-badge">ADMIN</span>'; avatarClass = 'avatar admin'; }
      else if (data.from_roblox) { badge = '<span class="roblox-badge">ROBLOX</span>'; avatarClass = 'avatar roblox'; }
      const time = new Date(data.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      let mediaHtml = '';
      if (data.media_url) {
        if (data.media_type === 'video') mediaHtml = '<video class="msg-video" src="' + data.media_url + '" onclick="showMedia(this.src,\\'video\\')" controls></video>';
        else mediaHtml = '<img class="msg-image" src="' + data.media_url + '" onclick="showMedia(this.src,\\'image\\')">';
      }
      const msgText = data.message || '';
      const textClass = isStampOnly(msgText) ? 'text stamp-msg' : 'text';
      const formattedText = isStampOnly(msgText) ? escapeHtml(msgText) : formatMessage(msgText);
      
      div.innerHTML = '<div class="' + avatarClass + '">' + avatarContent + '</div><div class="content"><div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + '</span></div><div class="' + textClass + '">' + formattedText + '</div>' + mediaHtml + '</div>' +
        '<div class="message-actions"><button class="glass-btn" onclick="pinMessage(' + data.id + ')">\ud83d\udccc</button></div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      
      if (currentUser && msgText.includes('@' + currentUser.name)) {
        if (Notification.permission === 'granted') {
          new Notification('siDChat', { body: data.username + '\u304c\u3042\u306a\u305f\u3092\u30e1\u30f3\u30b7\u30e7\u30f3\u3057\u307e\u3057\u305f' });
        }
      }
    }

    function sendStamp(emoji) {
      const username = currentUser?.name || usernameInput.value.trim() || 'Anonymous';
      localStorage.setItem('username', username);
      socket.emit('chat', { username, message: emoji, channelId: currentChannel, userId: currentUser?.id, userPicture: currentUser?.picture });
      stampPanel.classList.remove('show');
    }

    function showMedia(src, type) {
      const modalImg = document.getElementById('modal-img');
      const modalVideo = document.getElementById('modal-video');
      if (type === 'video') { modalImg.style.display = 'none'; modalVideo.style.display = 'block'; modalVideo.src = src; }
      else { modalVideo.style.display = 'none'; modalImg.style.display = 'block'; modalImg.src = src; }
      mediaModal.style.display = 'flex';
    }
    mediaModal.onclick = () => { mediaModal.style.display = 'none'; document.getElementById('modal-video').pause(); };

    function removeMedia() {
      pendingMedia = null; pendingMediaType = null;
      document.getElementById('media-preview').style.display = 'none';
      document.getElementById('preview-img').style.display = 'none';
      document.getElementById('preview-video').style.display = 'none';
    }

    function handleMedia(file) {
      if (!file || file.size > MAX_SIZE) return;
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        pendingMedia = e.target.result;
        pendingMediaType = isVideo ? 'video' : 'image';
        const preview = document.getElementById('media-preview');
        const previewImg = document.getElementById('preview-img');
        const previewVideo = document.getElementById('preview-video');
        if (isVideo) { previewImg.style.display = 'none'; previewVideo.style.display = 'block'; previewVideo.src = pendingMedia; }
        else { previewVideo.style.display = 'none'; previewImg.style.display = 'block'; previewImg.src = pendingMedia; }
        preview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }

    document.getElementById('media-btn').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = (e) => { if (e.target.files[0]) handleMedia(e.target.files[0]); };
    document.addEventListener('paste', (e) => {
      for (let item of e.clipboardData.items) {
        if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
          handleMedia(item.getAsFile());
          e.preventDefault();
          break;
        }
      }
    });

    document.getElementById('stamp-btn').onclick = (e) => { e.stopPropagation(); stampPanel.classList.toggle('show'); };
    document.addEventListener('click', () => { stampPanel.classList.remove('show'); mentionSuggest.classList.remove('show'); });
    stampPanel.onclick = (e) => e.stopPropagation();

    function sendMessage() {
      const message = messageInput.value.trim();
      const username = currentUser?.name || usernameInput.value.trim() || 'Anonymous';
      if ((message || pendingMedia) && !sendBtn.disabled) {
        sendBtn.disabled = true;
        localStorage.setItem('username', username);
        if (pendingMedia) uploadStatus.classList.add('show');
        socket.emit('chat', { 
          username, 
          message, 
          media: pendingMedia, 
          mediaType: pendingMediaType, 
          channelId: currentChannel,
          userId: currentUser?.id,
          userPicture: currentUser?.picture
        });
        messageInput.value = '';
        removeMedia();
        setTimeout(() => { sendBtn.disabled = false; uploadStatus.classList.remove('show'); }, 1000);
      }
    }

    sendBtn.onclick = sendMessage;
    messageInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

    socket.on('chat', (data) => { if (data.channel_id === currentChannel) { uploadStatus.classList.remove('show'); addMessage(data); } });
    socket.on('history', (history) => { loadingDiv.style.display = 'none'; messagesDiv.innerHTML = ''; history.forEach(addMessage); });
    socket.on('online', (count) => { onlineCount.textContent = count + '\u4eba\u304c\u30aa\u30f3\u30e9\u30a4\u30f3'; });
    socket.on('onlineUsers', (users) => { updateMembersList(users); });
    socket.on('deleted', (id) => { const msg = document.querySelector('[data-id="' + id + '"]'); if (msg) msg.remove(); });
    socket.on('cleared', () => { messagesDiv.innerHTML = ''; });
    socket.on('channelCreated', () => loadChannels());
    socket.on('messagePinned', () => { if (pinsPanel.classList.contains('show')) loadPins(); });
    socket.on('messageUnpinned', () => { if (pinsPanel.classList.contains('show')) loadPins(); });

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    loadChannels();
    socket.emit('joinChannel', currentChannel);
  </script>
</body>
</html>
  `);
});

// API
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const channelId = parseInt(req.query.channel) || 1;
    const { data, error } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json({ success: true, messages: data.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    setTimeout(() => validTokens.delete(token), 3600000);
    res.json({ success: true, token });
  } else res.status(401).json({ success: false });
});

app.get('/admin/verify', (req, res) => {
  if (validTokens.has(req.headers.authorization)) res.json({ success: true });
  else res.status(401).json({ success: false });
});

function adminAuth(req, res, next) {
  if (validTokens.has(req.headers.authorization)) next();
  else res.status(401).json({ success: false, error: 'Unauthorized' });
}

app.get('/admin/stats', adminAuth, async (req, res) => {
  const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true });
  res.json({ success: true, messageCount: count });
});

app.post('/admin/announce', adminAuth, async (req, res) => {
  const { message, channelId } = req.body;
  if (!message) return res.status(400).json({ success: false });
  const { data, error } = await supabase.from('messages').insert([{ username: '\ud83d\udce2 Announcement', message, is_announcement: true, channel_id: channelId || 1 }]).select().single();
  if (!error) io.emit('chat', data);
  res.json({ success: true });
});

app.delete('/admin/delete/:id', adminAuth, async (req, res) => {
  await supabase.from('messages').delete().eq('id', req.params.id);
  io.emit('deleted', parseInt(req.params.id));
  res.json({ success: true });
});

app.delete('/admin/clear', adminAuth, async (req, res) => {
  await supabase.from('messages').delete().neq('id', 0);
  io.emit('cleared');
  res.json({ success: true });
});

const userChannels = new Map();

io.on('connection', async (socket) => {
  io.emit('online', io.engine.clientsCount);
  broadcastRoomCounts();
  broadcastOnlineUsers();
  
  socket.on('userOnline', ({ userId, name, picture }) => {
    onlineUsers.set(socket.id, { userId: userId, name, picture });
    socketUsers.set(socket.id, userId);
    userSockets.set(userId, socket.id);
    broadcastOnlineUsers();
    supabase.from('users').update({ status: 'online', last_seen: new Date().toISOString() }).eq('id', userId);
  });
  
  socket.on('joinChannel', async (channelId) => {
    const prevChannel = userChannels.get(socket.id);
    if (prevChannel) socket.leave('channel_' + prevChannel);
    socket.join('channel_' + channelId);
    userChannels.set(socket.id, channelId);
    const { data } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(50);
    if (data) socket.emit('history', data.reverse());
  });
  
  socket.on('joinScreenRoom', ({ roomId, username }) => {
    if (screenRooms[roomId].size >= 4) { socket.emit('screenShareFull'); return; }
    screenRooms[roomId].add(socket.id);
    socket.join('screen_room_' + roomId);
    broadcastRoomCounts();
    if (roomSharers[roomId]) socket.emit('screenShareStarted', { socketId: roomSharers[roomId].id, username: roomSharers[roomId].name });
  });
  
  socket.on('leaveScreenRoom', ({ roomId }) => {
    if (roomId && screenRooms[roomId]) {
      screenRooms[roomId].delete(socket.id);
      socket.leave('screen_room_' + roomId);
      if (roomSharers[roomId] && roomSharers[roomId].id === socket.id) {
        roomSharers[roomId] = null;
        io.to('screen_room_' + roomId).emit('screenShareStopped', { socketId: socket.id });
      }
      broadcastRoomCounts();
    }
  });
  
  socket.on('startScreenShare', ({ roomId, username }) => {
    if (roomSharers[roomId]) { socket.emit('screenShareFull'); return; }
    roomSharers[roomId] = { id: socket.id, name: username };
    screenSharers.set(socket.id, { roomId, username });
    socket.to('screen_room_' + roomId).emit('screenShareStarted', { socketId: socket.id, username });
  });
  
  socket.on('stopScreenShare', ({ roomId }) => {
    if (roomId && roomSharers[roomId] && roomSharers[roomId].id === socket.id) {
      roomSharers[roomId] = null;
      screenSharers.delete(socket.id);
      io.to('screen_room_' + roomId).emit('screenShareStopped', { socketId: socket.id });
    }
  });
  
  socket.on('requestScreenShare', ({ targetId }) => {
    io.to(targetId).emit('screenShareRequested', { requesterId: socket.id });
  });
  
  socket.on('offer', ({ offer, targetId }) => {
    io.to(targetId).emit('offer', { offer, senderId: socket.id });
  });
  
  socket.on('answer', ({ answer, targetId }) => {
    io.to(targetId).emit('answer', { answer, senderId: socket.id });
  });
  
  socket.on('iceCandidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('iceCandidate', { candidate, senderId: socket.id });
  });
  
  socket.on('chat', async (data) => {
    let mediaUrl = null;
    if (data.media) mediaUrl = await uploadMedia(data.media, data.mediaType);
    const newMessage = {
      username: (data.username || 'Anonymous').substring(0, 20),
      message: (data.message || '').substring(0, 500),
      media_url: mediaUrl,
      media_type: data.mediaType || null,
      channel_id: data.channelId || 1,
      user_id: data.userId || null,
      from_roblox: false,
      is_announcement: false
    };
    const { data: saved, error } = await supabase.from('messages').insert([newMessage]).select().single();
    if (!error && saved) {
      saved.user_picture = data.userPicture;
      io.to('channel_' + saved.channel_id).emit('chat', saved);
    }
  });
  
  socket.on('disconnect', () => {
    const userId = socketUsers.get(socket.id);
    if (userId) {
      onlineUsers.delete(socket.id);
      socketUsers.delete(socket.id);
      userSockets.delete(userId);
      supabase.from('users').update({ status: 'offline' }).eq('id', userId);
      broadcastOnlineUsers();
    }
    userChannels.delete(socket.id);
    for (let roomId in screenRooms) {
      if (screenRooms[roomId].has(socket.id)) {
        screenRooms[roomId].delete(socket.id);
        if (roomSharers[roomId] && roomSharers[roomId].id === socket.id) {
          roomSharers[roomId] = null;
          io.to('screen_room_' + roomId).emit('screenShareStopped', { socketId: socket.id });
        }
      }
    }
    screenSharers.delete(socket.id);
    broadcastRoomCounts();
    io.emit('online', io.engine.clientsCount);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`siDChat running on ${PORT}`));
