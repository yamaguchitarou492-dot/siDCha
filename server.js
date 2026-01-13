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
  { id: 'like', emoji: '👍' }, { id: 'love', emoji: '❤️' },
  { id: 'laugh', emoji: '😂' }, { id: 'wow', emoji: '😮' },
  { id: 'sad', emoji: '😢' }, { id: 'angry', emoji: '😠' },
  { id: 'fire', emoji: '🔥' }, { id: 'cool', emoji: '😎' },
  { id: 'party', emoji: '🎉' }, { id: 'think', emoji: '🤔' },
  { id: 'clap', emoji: '👏' }, { id: 'cry', emoji: '😭' },
  { id: 'sleep', emoji: '😴' }, { id: 'star', emoji: '⭐' },
  { id: 'heart_eyes', emoji: '😍' }, { id: 'skull', emoji: '💀' },
  { id: 'ghost', emoji: '👻' }, { id: 'poop', emoji: '💩' },
  { id: 'ok', emoji: '👌' }, { id: 'wave', emoji: '👋' }
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

// ========== メインページ（Liquid Glass テーマ） ==========
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>siDChat</title>
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
    <div id="server-header">🏖️ siDChat</div>
    <div id="channels-header">チャンネル<button id="add-channel-btn">+</button></div>
    <div id="channel-list"></div>
    <div id="voice-channels-header">🖥️ 画面共有</div>
    <div id="voice-channel-list">
      <div class="voice-channel-item" id="screen-room-1" onclick="joinScreenRoom(1)">
        <span>共有ルーム1</span>
        <span class="viewer-count" id="room1-count">0人</span>
      </div>
      <div class="voice-channel-item" id="screen-room-2" onclick="joinScreenRoom(2)">
        <span>共有ルーム2</span>
        <span class="viewer-count" id="room2-count">0人</span>
      </div>
      <div class="voice-channel-item" id="screen-room-3" onclick="joinScreenRoom(3)">
        <span>共有ルーム3</span>
        <span class="viewer-count" id="room3-count">0人</span>
      </div>
    </div>
    <div id="user-section" class="glass-light">
      <div id="guest-login">
        <button id="login-btn" class="glass-btn" onclick="googleLogin()">🔐 Googleでログイン</button>
      </div>
      <div id="logged-in-user" style="display:none;">
        <img id="user-avatar" src="" alt="">
        <div id="user-info">
          <div id="user-name"></div>
          <div id="user-status">🟢 オンライン</div>
        </div>
        <button id="logout-btn" class="glass-btn" onclick="logout()">↩️</button>
      </div>
    </div>
  </div>
  
  <div id="main" class="glass">
    <div id="header">
      <span id="channel-name">general</span>
      <div class="header-buttons">
        <button class="header-btn glass-btn" onclick="togglePins()">📌 ピン留め</button>
        <button class="header-btn glass-btn" onclick="toggleMembers()">👥 メンバー</button>
        <span id="online-count">0人がオンライン</span>
      </div>
    </div>
    <div id="screen-share-container" class="glass-light">
      <div id="screen-share-header">
        <span>🖥️ <span id="sharer-name">誰か</span>が画面を共有中</span>
        <button id="close-screen-share" class="glass-btn">✕ 閉じる</button>
      </div>
      <video id="screen-share-video" autoplay playsinline></video>
    </div>
    <div id="pins-panel" class="glass">
      <div id="pins-header">📌 ピン留め <button onclick="togglePins()" style="background:none;border:none;color:#7f8c8d;cursor:pointer;font-size:18px;">✕</button></div>
      <div id="pins-list"></div>
    </div>
    <div id="messages">
      <div id="loading"><div class="spinner"></div><div>ロードしています...</div></div>
    </div>
    <div id="input-area" class="glass-light">
      <div id="upload-status">📤 アップロード中...</div>
      <div id="media-preview">
        <img id="preview-img" src="" style="display:none;">
        <video id="preview-video" src="" style="display:none;" controls></video>
        <button class="remove-btn" onclick="removeMedia()">×</button>
      </div>
      <div id="mention-suggest" class="glass"></div>
      <div id="input-row">
        <input type="text" id="username-input" placeholder="名前" maxlength="20">
        <input type="text" id="message-input" placeholder="メッセージを送信 (@でメンション)" maxlength="500">
        <input type="file" id="file-input" accept="image/*,video/*">
        <button id="media-btn" class="input-btn glass-btn">📷</button>
        <div id="stamp-container">
          <button id="stamp-btn" class="input-btn glass-btn">😀</button>
          <div id="stamp-panel" class="glass"><div class="stamp-title">スタンプ</div><div class="stamp-grid" id="stamp-grid"></div></div>
        </div>
        <button id="send-btn" class="input-btn glass-btn primary">送信</button>
      </div>
    </div>
  </div>
  
  <div id="members-panel" class="glass">
    <div id="members-header">オンライン — <span id="members-count">0</span></div>
    <div id="members-list"></div>
  </div>

  <div id="media-modal">
    <img id="modal-img" src="" style="display:none;">
    <video id="modal-video" src="" style="display:none;" controls></video>
  </div>
  
  <div id="channel-modal">
    <div class="modal-content glass">
      <h3>✨ チャンネルを作成</h3>
      <input type="text" id="new-channel-name" placeholder="チャンネル名" maxlength="20">
      <div class="modal-buttons">
        <button class="cancel" onclick="closeChannelModal()">キャンセル</button>
        <button class="create" onclick="createChannel()">作成</button>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
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
      { emoji: '👍' }, { emoji: '❤️' }, { emoji: '😂' }, { emoji: '😮' },
      { emoji: '😢' }, { emoji: '😠' }, { emoji: '🔥' }, { emoji: '😎' },
      { emoji: '🎉' }, { emoji: '🤔' }, { emoji: '👏' }, { emoji: '😭' },
      { emoji: '😴' }, { emoji: '⭐' }, { emoji: '😍' }, { emoji: '💀' },
      { emoji: '👻' }, { emoji: '💩' }, { emoji: '👌' }, { emoji: '👋' }
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
          '<strong>' + escapeHtml(p.messages?.username || '不明') + '</strong><br>' +
          '<span>' + escapeHtml(p.messages?.message || '') + '</span>' +
          '</div>'
        ).join('');
      } else {
        list.innerHTML = '<div style="padding:15px;color:#7f8c8d;">ピン留めされたメッセージはありません</div>';
      }
    }
    
    async function pinMessage(messageId) {
      if (!currentUser) { alert('ピン留めするにはログインしてください'); return; }
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
      if (confirm('画面を共有しますか？\\n「キャンセル」を押すと視聴のみになります')) {
        try {
          localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          isSharing = true;
          socket.emit('startScreenShare', { roomId, username });
          localStream.getVideoTracks()[0].onended = () => stopScreenShare();
          updateRoomUI();
        } catch (err) { console.log('共有キャンセル'); }
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
    socket.on('screenShareFull', () => alert('画面共有は最大3人までです！'));
    socket.on('roomCounts', (counts) => {
      for (let roomId in counts) {
        const el = document.getElementById('room' + roomId + '-count');
        if (el) el.textContent = counts[roomId] + '人';
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
        '<div class="message-actions"><button class="glass-btn" onclick="pinMessage(' + data.id + ')">📌</button></div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      
      if (currentUser && msgText.includes('@' + currentUser.name)) {
        if (Notification.permission === 'granted') {
          new Notification('siDChat', { body: data.username + 'があなたをメンションしました' });
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
    socket.on('online', (count) => { onlineCount.textContent = count + '人がオンライン'; });
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
  const { data, error } = await supabase.from('messages').insert([{ username: '📢 Announcement', message, is_announcement: true, channel_id: channelId || 1 }]).select().single();
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
