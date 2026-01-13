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
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Supabase設定
const supabaseUrl = process.env.SUPABASE_URL || 'https://znlklskqcuybcnrflieq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_2nZ-FzNcVGKcPqYDSMxSuQ_r4nYxF0L';
const supabase = createClient(supabaseUrl, supabaseKey);

// 管理者パスワード
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 有効なトークン
const validTokens = new Set();

// ヘルスチェック
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// メインページ（画像対応版）
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
    #online-count {
      color: #72767d;
      font-size: 14px;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
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
    .msg-image {
      max-width: 400px;
      max-height: 300px;
      border-radius: 8px;
      margin-top: 8px;
      cursor: pointer;
    }
    .msg-image:hover { opacity: 0.9; }
    .roblox-badge {
      background: #00a2ff;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 5px;
    }
    .admin-badge {
      background: #ed4245;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 5px;
    }
    #input-area {
      padding: 15px 20px;
      background: #40444b;
      margin: 0 20px 20px 20px;
      border-radius: 8px;
    }
    #image-preview {
      display: none;
      margin-bottom: 10px;
      position: relative;
    }
    #image-preview img {
      max-width: 200px;
      max-height: 150px;
      border-radius: 8px;
    }
    #image-preview .remove-btn {
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
    #input-row {
      display: flex;
      gap: 10px;
    }
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
    #image-btn {
      background: #5865f2;
      border: none;
      padding: 10px 15px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    #image-btn:hover { background: #4752c4; }
    #send-btn {
      background: #5865f2;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    #send-btn:hover { background: #4752c4; }
    #send-btn:disabled { background: #4752c4; opacity: 0.5; }
    #file-input { display: none; }
    
    /* 画像モーダル */
    #image-modal {
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
    #image-modal img {
      max-width: 90%;
      max-height: 90%;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div id="header">
    <span># general</span>
    <span id="online-count">0人がオンライン</span>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <div id="image-preview">
      <img id="preview-img" src="">
      <button class="remove-btn" onclick="removeImage()">×</button>
    </div>
    <div id="input-row">
      <input type="text" id="username-input" placeholder="名前" maxlength="20">
      <input type="text" id="message-input" placeholder="メッセージを送信 (Ctrl+Vで画像貼り付け)" maxlength="500">
      <input type="file" id="file-input" accept="image/*">
      <button id="image-btn">📷</button>
      <button id="send-btn">送信</button>
    </div>
  </div>

  <div id="image-modal">
    <img id="modal-img" src="">
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
    const imageBtn = document.getElementById('image-btn');
    const imagePreview = document.getElementById('image-preview');
    const previewImg = document.getElementById('preview-img');
    const imageModal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');

    let pendingImage = null;

    usernameInput.value = localStorage.getItem('username') || '';

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
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
      let imageHtml = '';
      if (data.image_url) {
        imageHtml = '<img class="msg-image" src="' + data.image_url + '" onclick="showImage(this.src)">';
      }
      div.innerHTML = 
        '<div class="' + avatarClass + '">' + escapeHtml(initial) + '</div>' +
        '<div class="content">' +
          '<div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + '</span></div>' +
          '<div class="text">' + escapeHtml(data.message) + '</div>' +
          imageHtml +
        '</div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function showImage(src) {
      modalImg.src = src;
      imageModal.style.display = 'flex';
    }

    imageModal.addEventListener('click', () => {
      imageModal.style.display = 'none';
    });

    function removeImage() {
      pendingImage = null;
      imagePreview.style.display = 'none';
      previewImg.src = '';
    }

    function handleImage(file) {
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingImage = e.target.result;
          previewImg.src = pendingImage;
          imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    }

    imageBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleImage(e.target.files[0]);
    });

    // Ctrl+V で画像ペースト
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData.items;
      for (let item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          handleImage(file);
          e.preventDefault();
          break;
        }
      }
    });

    function sendMessage() {
      const message = messageInput.value.trim();
      const username = usernameInput.value.trim() || 'Anonymous';
      if ((message || pendingImage) && !sendBtn.disabled) {
        sendBtn.disabled = true;
        localStorage.setItem('username', username);
        socket.emit('chat', { username, message, image: pendingImage });
        messageInput.value = '';
        removeImage();
        setTimeout(() => { sendBtn.disabled = false; }, 500);
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    socket.on('chat', addMessage);
    socket.on('history', (history) => {
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

// ROBLOX API: メッセージ取得
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const since = req.query.since;
    
    let query = supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (since) {
      query = query.gt('created_at', since);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ 
      success: true,
      messages: data.reverse()
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// Admin: ログイン
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    
    setTimeout(() => {
      validTokens.delete(token);
    }, 60 * 60 * 1000);
    
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Admin: トークン検証
app.get('/admin/verify', (req, res) => {
  const token = req.headers.authorization;
  if (token && validTokens.has(token)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// Admin: 認証ミドルウェア
function adminAuth(req, res, next) {
  const token = req.headers.authorization;
  if (token && validTokens.has(token)) {
    next();
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

// Admin: 統計
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });
    res.json({ success: true, messageCount: count });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Admin: アナウンス
app.post('/admin/announce', adminAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message required' });
    }
    
    const newMessage = {
      username: '📢 Announcement',
      message: message.substring(0, 500),
      from_roblox: false,
      is_announcement: true
    };
    
    const { data, error } = await supabase
      .from('messages')
      .insert([newMessage])
      .select()
      .single();
    
    if (error) throw error;
    
    io.emit('chat', data);
    res.json({ success: true, message: data });
  } catch (error) {
    console.error('Error sending announcement:', error);
    res.status(500).json({ success: false, error: 'Failed to send announcement' });
  }
});

// Admin: メッセージ削除
app.delete('/admin/delete/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    io.emit('deleted', parseInt(id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

// Admin: 全メッセージ削除
app.delete('/admin/clear', adminAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('messages')
      .delete()
      .neq('id', 0);
    
    if (error) throw error;
    
    io.emit('cleared');
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ success: false, error: 'Failed to clear messages' });
  }
});

// WebSocket接続
let onlineUsers = 0;

io.on('connection', async (socket) => {
  onlineUsers++;
  io.emit('online', onlineUsers);
  
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!error && data) {
      socket.emit('history', data.reverse());
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
  
  socket.on('chat', async (data) => {
    try {
      const newMessage = {
        username: (data.username || 'Anonymous').substring(0, 20),
        message: (data.message || '').substring(0, 500),
        image_url: data.image || null,
        from_roblox: false,
        is_announcement: false
      };
      
      const { data: saved, error } = await supabase
        .from('messages')
        .insert([newMessage])
        .select()
        .single();
      
      if (!error && saved) {
        io.emit('chat', saved);
      }
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
server.listen(PORT, () => {
  console.log(`siDChat server running on port ${PORT}`);
});
