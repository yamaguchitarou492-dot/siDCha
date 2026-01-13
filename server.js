const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 55e6 // 55MB
});

app.use(cors());
app.use(express.json({ limit: '55mb' }));

// Supabase設定
const supabaseUrl = process.env.SUPABASE_URL || 'https://znlklskqcuybcnrflieq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_2nZ-FzNcVGKcPqYDSMxSuQ_r4nYxF0L';
const supabase = createClient(supabaseUrl, supabaseKey);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const validTokens = new Set();
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/stamps', (req, res) => {
  res.json({ success: true, stamps: STAMPS });
});

// メディアアップロード関数
async function uploadMedia(base64Data, mediaType) {
  try {
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return null;
    
    const mimeType = matches[1];
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');
    
    if (buffer.length > MAX_FILE_SIZE) return null;
    
    const ext = mimeType.split('/')[1] || 'bin';
    const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    
    const { data, error } = await supabase.storage
      .from('media')
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: false
      });
    
    if (error) {
      console.error('Upload error:', error);
      return null;
    }
    
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

// メインページ
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>siDChat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #36393f;
      color: #dcddde;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #header {
      background: #202225;
      padding: 15px 20px;
      font-size: 18px;
      font-weight: bold;
      border-bottom: 1px solid #202225;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #online-count { color: #72767d; font-size: 14px; }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      position: relative;
    }
    
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #72767d;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #40444b;
      border-top: 4px solid #5865f2;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 15px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .message {
      margin-bottom: 15px;
      display: flex;
      gap: 10px;
    }
    .message.announcement {
      background: #5865f233;
      padding: 10px;
      border-radius: 8px;
      border-left: 4px solid #5865f2;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #5865f2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      flex-shrink: 0;
    }
    .avatar.roblox { background: #00a2ff; }
    .avatar.admin { background: #ed4245; }
    .content { flex: 1; }
    .username {
      font-weight: bold;
      color: #fff;
      margin-bottom: 3px;
    }
    .username .time {
      font-size: 12px;
      color: #72767d;
      font-weight: normal;
      margin-left: 8px;
    }
    .text { line-height: 1.4; word-wrap: break-word; }
    .stamp-msg { font-size: 48px; line-height: 1.2; }
    .msg-image, .msg-video {
      max-width: 400px;
      max-height: 300px;
      border-radius: 8px;
      margin-top: 8px;
      cursor: pointer;
    }
    .msg-image:hover, .msg-video:hover { opacity: 0.9; }
    .roblox-badge, .admin-badge {
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 5px;
    }
    .roblox-badge { background: #00a2ff; }
    .admin-badge { background: #ed4245; }
    
    #input-area {
      padding: 15px 20px;
      background: #40444b;
      margin: 0 20px 20px 20px;
      border-radius: 8px;
    }
    #media-preview {
      display: none;
      margin-bottom: 10px;
      position: relative;
    }
    #media-preview img, #media-preview video {
      max-width: 200px;
      max-height: 150px;
      border-radius: 8px;
    }
    #media-preview .remove-btn {
      position: absolute;
      top: -8px;
      right: -8px;
      background: #ed4245;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    .file-info { color: #72767d; font-size: 12px; margin-top: 5px; }
    .file-size-warning { color: #faa61a; font-size: 12px; margin-top: 5px; }
    #input-row { display: flex; gap: 10px; }
    #username-input {
      width: 120px;
      background: #202225;
      border: none;
      padding: 10px;
      border-radius: 5px;
      color: #dcddde;
      font-size: 14px;
    }
    #message-input {
      flex: 1;
      background: transparent;
      border: none;
      padding: 10px;
      color: #dcddde;
      font-size: 14px;
      outline: none;
    }
    .input-btn {
      background: #5865f2;
      border: none;
      padding: 10px 15px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    .input-btn:hover { background: #4752c4; }
    #send-btn:disabled { background: #4752c4; opacity: 0.5; }
    #file-input { display: none; }
    
    #stamp-panel {
      display: none;
      position: absolute;
      bottom: 100%;
      right: 0;
      background: #2f3136;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 10px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      width: 280px;
    }
    #stamp-panel.show { display: block; }
    .stamp-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 5px;
    }
    .stamp-item {
      font-size: 24px;
      padding: 8px;
      text-align: center;
      cursor: pointer;
      border-radius: 5px;
      transition: background 0.2s;
    }
    .stamp-item:hover { background: #40444b; }
    .stamp-title { color: #72767d; font-size: 12px; margin-bottom: 8px; font-weight: bold; }
    #stamp-container { position: relative; }
    
    #media-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      cursor: pointer;
    }
    #media-modal img, #media-modal video {
      max-width: 90%;
      max-height: 90%;
      border-radius: 8px;
    }
    
    /* アップロード中 */
    #upload-status {
      display: none;
      color: #5865f2;
      font-size: 12px;
      margin-bottom: 10px;
    }
    #upload-status.show { display: block; }
  </style>
</head>
<body>
  <div id="header">
    <span># general</span>
    <span id="online-count">0人がオンライン</span>
  </div>
  <div id="messages">
    <div id="loading">
      <div class="spinner"></div>
      <div>ロードしています...</div>
    </div>
  </div>
  <div id="input-area">
    <div id="upload-status">📤 アップロード中...</div>
    <div id="media-preview">
      <img id="preview-img" src="" style="display:none;">
      <video id="preview-video" src="" style="display:none;" controls></video>
      <button class="remove-btn" onclick="removeMedia()">×</button>
      <div id="file-info" class="file-info"></div>
      <div id="size-warning" class="file-size-warning"></div>
    </div>
    <div id="input-row">
      <input type="text" id="username-input" placeholder="名前" maxlength="20">
      <input type="text" id="message-input" placeholder="メッセージを送信" maxlength="500">
      <input type="file" id="file-input" accept="image/*,video/*">
      <button id="media-btn" class="input-btn">📷</button>
      <div id="stamp-container">
        <button id="stamp-btn" class="input-btn">😀</button>
        <div id="stamp-panel">
          <div class="stamp-title">スタンプ</div>
          <div class="stamp-grid" id="stamp-grid"></div>
        </div>
      </div>
      <button id="send-btn" class="input-btn">送信</button>
    </div>
  </div>

  <div id="media-modal">
    <img id="modal-img" src="" style="display:none;">
    <video id="modal-video" src="" style="display:none;" controls></video>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const usernameInput = document.getElementById('username-input');
    const sendBtn = document.getElementById('send-btn');
    const onlineCount = document.getElementById('online-count');
    const fileInput = document.getElementById('file-input');
    const mediaBtn = document.getElementById('media-btn');
    const mediaPreview = document.getElementById('media-preview');
    const previewImg = document.getElementById('preview-img');
    const previewVideo = document.getElementById('preview-video');
    const fileInfo = document.getElementById('file-info');
    const sizeWarning = document.getElementById('size-warning');
    const mediaModal = document.getElementById('media-modal');
    const modalImg = document.getElementById('modal-img');
    const modalVideo = document.getElementById('modal-video');
    const stampBtn = document.getElementById('stamp-btn');
    const stampPanel = document.getElementById('stamp-panel');
    const stampGrid = document.getElementById('stamp-grid');
    const loadingDiv = document.getElementById('loading');
    const uploadStatus = document.getElementById('upload-status');

    let pendingMedia = null;
    let pendingMediaType = null;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB

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

    STAMPS.forEach(stamp => {
      const div = document.createElement('div');
      div.className = 'stamp-item';
      div.textContent = stamp.emoji;
      div.onclick = () => sendStamp(stamp.emoji);
      stampGrid.appendChild(div);
    });

    stampBtn.onclick = (e) => {
      e.stopPropagation();
      stampPanel.classList.toggle('show');
    };
    document.addEventListener('click', () => stampPanel.classList.remove('show'));
    stampPanel.onclick = (e) => e.stopPropagation();

    usernameInput.value = localStorage.getItem('username') || '';

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function isStampOnly(msg) {
      const stampEmojis = STAMPS.map(s => s.emoji);
      return stampEmojis.includes(msg.trim());
    }

    function addMessage(data) {
      const div = document.createElement('div');
      const isAnnounce = data.is_announcement;
      div.className = 'message' + (isAnnounce ? ' announcement' : '');
      div.dataset.id = data.id;
      const initial = data.username.charAt(0).toUpperCase();
      let badge = '';
      let avatarClass = 'avatar';
      if (isAnnounce) {
        badge = '<span class="admin-badge">ADMIN</span>';
        avatarClass = 'avatar admin';
      } else if (data.from_roblox) {
        badge = '<span class="roblox-badge">ROBLOX</span>';
        avatarClass = 'avatar roblox';
      }
      const time = new Date(data.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      
      let mediaHtml = '';
      if (data.media_url) {
        if (data.media_type === 'video') {
          mediaHtml = '<video class="msg-video" src="' + data.media_url + '" onclick="showMedia(this.src, \\'video\\')" controls></video>';
        } else {
          mediaHtml = '<img class="msg-image" src="' + data.media_url + '" onclick="showMedia(this.src, \\'image\\')">';
        }
      }
      
      const msgText = data.message || '';
      const textClass = isStampOnly(msgText) ? 'text stamp-msg' : 'text';
      
      div.innerHTML = 
        '<div class="' + avatarClass + '">' + escapeHtml(initial) + '</div>' +
        '<div class="content">' +
          '<div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + '</span></div>' +
          '<div class="' + textClass + '">' + escapeHtml(msgText) + '</div>' +
          mediaHtml +
        '</div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function sendStamp(emoji) {
      const username = usernameInput.value.trim() || 'Anonymous';
      localStorage.setItem('username', username);
      socket.emit('chat', { username, message: emoji });
      stampPanel.classList.remove('show');
    }

    function showMedia(src, type) {
      if (type === 'video') {
        modalImg.style.display = 'none';
        modalVideo.style.display = 'block';
        modalVideo.src = src;
      } else {
        modalVideo.style.display = 'none';
        modalImg.style.display = 'block';
        modalImg.src = src;
      }
      mediaModal.style.display = 'flex';
    }

    mediaModal.addEventListener('click', () => {
      mediaModal.style.display = 'none';
      modalVideo.pause();
    });

    function removeMedia() {
      pendingMedia = null;
      pendingMediaType = null;
      mediaPreview.style.display = 'none';
      previewImg.style.display = 'none';
      previewVideo.style.display = 'none';
      previewImg.src = '';
      previewVideo.src = '';
      fileInfo.textContent = '';
      sizeWarning.textContent = '';
    }

    function handleMedia(file) {
      if (!file) return;
      
      if (file.size > MAX_SIZE) {
        sizeWarning.textContent = '⚠️ ファイルサイズが大きすぎます（50MB以下）';
        return;
      }
      
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        pendingMedia = e.target.result;
        pendingMediaType = isVideo ? 'video' : 'image';
        if (isVideo) {
          previewImg.style.display = 'none';
          previewVideo.style.display = 'block';
          previewVideo.src = pendingMedia;
        } else {
          previewVideo.style.display = 'none';
          previewImg.style.display = 'block';
          previewImg.src = pendingMedia;
        }
        mediaPreview.style.display = 'block';
        fileInfo.textContent = file.name + ' (' + formatFileSize(file.size) + ')';
        sizeWarning.textContent = '';
      };
      reader.readAsDataURL(file);
    }

    mediaBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleMedia(e.target.files[0]);
    });

    document.addEventListener('paste', (e) => {
      const items = e.clipboardData.items;
      for (let item of items) {
        if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
          handleMedia(item.getAsFile());
          e.preventDefault();
          break;
        }
      }
    });

    function sendMessage() {
      const message = messageInput.value.trim();
      const username = usernameInput.value.trim() || 'Anonymous';
      if ((message || pendingMedia) && !sendBtn.disabled) {
        sendBtn.disabled = true;
        localStorage.setItem('username', username);
        
        if (pendingMedia) {
          uploadStatus.classList.add('show');
        }
        
        socket.emit('chat', { username, message, media: pendingMedia, mediaType: pendingMediaType });
        messageInput.value = '';
        removeMedia();
        
        setTimeout(() => {
          sendBtn.disabled = false;
          uploadStatus.classList.remove('show');
        }, 1000);
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    socket.on('chat', (data) => {
      uploadStatus.classList.remove('show');
      addMessage(data);
    });
    socket.on('history', (history) => {
      loadingDiv.style.display = 'none';
      messagesDiv.innerHTML = '';
      history.forEach(addMessage);
    });
    socket.on('online', (count) => {
      onlineCount.textContent = count + '人がオンライン';
    });
    socket.on('deleted', (id) => {
      const msg = document.querySelector('[data-id="' + id + '"]');
      if (msg) msg.remove();
    });
    socket.on('cleared', () => {
      messagesDiv.innerHTML = '';
    });
  </script>
</body>
</html>
  `);
});

// ROBLOX API
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const since = req.query.since;
    let query = supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(limit);
    if (since) query = query.gt('created_at', since);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, messages: data.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    setTimeout(() => validTokens.delete(token), 60 * 60 * 1000);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

app.get('/admin/verify', (req, res) => {
  const token = req.headers.authorization;
  if (token && validTokens.has(token)) res.json({ success: true });
  else res.status(401).json({ success: false });
});

function adminAuth(req, res, next) {
  const token = req.headers.authorization;
  if (token && validTokens.has(token)) next();
  else res.status(401).json({ success: false, error: 'Unauthorized' });
}

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true });
    res.json({ success: true, messageCount: count });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

app.post('/admin/announce', adminAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });
    const newMessage = { username: '📢 Announcement', message: message.substring(0, 500), from_roblox: false, is_announcement: true };
    const { data, error } = await supabase.from('messages').insert([newMessage]).select().single();
    if (error) throw error;
    io.emit('chat', data);
    res.json({ success: true, message: data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send announcement' });
  }
});

app.delete('/admin/delete/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) throw error;
    io.emit('deleted', parseInt(id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

app.delete('/admin/clear', adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('messages').delete().neq('id', 0);
    if (error) throw error;
    io.emit('cleared');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to clear messages' });
  }
});

let onlineUsers = 0;

io.on('connection', async (socket) => {
  onlineUsers++;
  io.emit('online', onlineUsers);
  
  try {
    const { data, error } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(50);
    if (!error && data) socket.emit('history', data.reverse());
  } catch (err) {
    console.error('Error loading history:', err);
  }
  
  socket.on('chat', async (data) => {
    try {
      let mediaUrl = null;
      
      // メディアがあればStorageにアップロード
      if (data.media) {
        mediaUrl = await uploadMedia(data.media, data.mediaType);
      }
      
      const newMessage = {
        username: (data.username || 'Anonymous').substring(0, 20),
        message: (data.message || '').substring(0, 500),
        media_url: mediaUrl,
        media_type: data.mediaType || null,
        from_roblox: false,
        is_announcement: false
      };
      
      const { data: saved, error } = await supabase.from('messages').insert([newMessage]).select().single();
      if (!error && saved) io.emit('chat', saved);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });
  
  socket.on('disconnect', () => {
    onlineUsers--;
    io.emit('online', onlineUsers);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`siDChat server running on port ${PORT}`));
