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
app.use(express.json());

// Supabase設定
const supabaseUrl = process.env.SUPABASE_URL || 'https://znlklskqcuybcnrflieq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_2nZ-FzNcVGKcPqYDSMxSuQ_r4nYxF0L';
const supabase = createClient(supabaseUrl, supabaseKey);

// 管理者パスワード（Renderの環境変数で設定！）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 有効なトークンを保存（サーバーメモリ内）
const validTokens = new Set();

// ヘルスチェック（UptimeRobot用）
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

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
    #online-count {
      color: #72767d;
      font-size: 14px;
    }
    #admin-btn {
      background: #5865f2;
      border: none;
      padding: 8px 15px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 12px;
    }
    #admin-btn:hover { background: #4752c4; }
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

    /* Admin Popup */
    #admin-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    #admin-popup {
      background: #2f3136;
      border-radius: 10px;
      padding: 25px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
    }
    #admin-popup h2 {
      color: #fff;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #close-admin {
      background: #ed4245;
      border: none;
      padding: 5px 10px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
    }
    .admin-section {
      margin-bottom: 20px;
      padding: 15px;
      background: #36393f;
      border-radius: 8px;
    }
    .admin-section h3 {
      color: #fff;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .admin-input {
      width: 100%;
      background: #202225;
      border: none;
      padding: 10px;
      border-radius: 5px;
      color: #dcddde;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .admin-btn {
      background: #5865f2;
      border: none;
      padding: 10px 15px;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 14px;
      width: 100%;
    }
    .admin-btn:hover { background: #4752c4; }
    .admin-btn.danger { background: #ed4245; }
    .admin-btn.danger:hover { background: #c73e41; }
    .stat-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #40444b;
    }
    .stat-value { color: #5865f2; font-weight: bold; }
    #login-section { display: block; }
    #admin-content { display: none; }
    .error-msg { color: #ed4245; font-size: 12px; margin-top: 5px; }
    .success-msg { color: #3ba55d; font-size: 12px; margin-top: 5px; }
  </style>
</head>
<body>
  <div id="header">
    <span># general <span id="online-count">0人がオンライン</span></span>
    <button id="admin-btn">⚙️ Admin</button>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="username-input" placeholder="名前" maxlength="20">
    <input type="text" id="message-input" placeholder="メッセージを送信" maxlength="500">
    <button id="send-btn">送信</button>
  </div>

  <!-- Admin Popup -->
  <div id="admin-overlay">
    <div id="admin-popup">
      <h2>🔧 Admin Panel <button id="close-admin">✕</button></h2>
      
      <div id="login-section">
        <div class="admin-section">
          <h3>🔐 ログイン</h3>
          <input type="password" id="admin-password" class="admin-input" placeholder="管理者パスワード">
          <button id="admin-login-btn" class="admin-btn">ログイン</button>
          <div id="login-error" class="error-msg"></div>
        </div>
      </div>
      
      <div id="admin-content">
        <div class="admin-section">
          <h3>📊 統計</h3>
          <div class="stat-item">
            <span>オンラインユーザー</span>
            <span class="stat-value" id="stat-online">0</span>
          </div>
          <div class="stat-item">
            <span>総メッセージ数</span>
            <span class="stat-value" id="stat-messages">0</span>
          </div>
        </div>
        
        <div class="admin-section">
          <h3>📢 アナウンス送信</h3>
          <input type="text" id="announce-input" class="admin-input" placeholder="アナウンス内容" maxlength="500">
          <button id="announce-btn" class="admin-btn">送信</button>
          <div id="announce-status"></div>
        </div>
        
        <div class="admin-section">
          <h3>🗑️ メッセージ削除</h3>
          <input type="number" id="delete-id" class="admin-input" placeholder="メッセージID">
          <button id="delete-btn" class="admin-btn danger">削除</button>
        </div>
        
        <div class="admin-section">
          <h3>💣 全メッセージ削除</h3>
          <button id="clear-btn" class="admin-btn danger">全削除（注意！）</button>
        </div>
        
        <div class="admin-section">
          <h3>🚪 ログアウト</h3>
          <button id="logout-btn" class="admin-btn">ログアウト</button>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const usernameInput = document.getElementById('username-input');
    const sendBtn = document.getElementById('send-btn');
    const onlineCount = document.getElementById('online-count');
    const adminOverlay = document.getElementById('admin-overlay');
    const adminBtn = document.getElementById('admin-btn');
    const closeAdmin = document.getElementById('close-admin');
    
    let adminToken = sessionStorage.getItem('adminToken') || '';

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
      div.innerHTML = 
        '<div class="' + avatarClass + '">' + escapeHtml(initial) + '</div>' +
        '<div class="content">' +
          '<div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + ' (ID:' + data.id + ')</span></div>' +
          '<div class="text">' + escapeHtml(data.message) + '</div>' +
        '</div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function sendMessage() {
      const message = messageInput.value.trim();
      const username = usernameInput.value.trim() || 'Anonymous';
      if (message && !sendBtn.disabled) {
        sendBtn.disabled = true;
        localStorage.setItem('username', username);
        socket.emit('chat', { username, message });
        messageInput.value = '';
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
      document.getElementById('stat-online').textContent = count;
    });
    socket.on('deleted', (id) => {
      const msg = document.querySelector('[data-id="' + id + '"]');
      if (msg) msg.remove();
    });
    socket.on('cleared', () => {
      messagesDiv.innerHTML = '';
    });

    // Admin Panel
    async function checkToken() {
      if (!adminToken) return false;
      try {
        const res = await fetch('/admin/verify', {
          headers: { 'Authorization': adminToken }
        });
        return res.ok;
      } catch {
        return false;
      }
    }

    adminBtn.addEventListener('click', async () => {
      adminOverlay.style.display = 'flex';
      if (adminToken && await checkToken()) {
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('admin-content').style.display = 'block';
        loadStats();
      } else {
        adminToken = '';
        sessionStorage.removeItem('adminToken');
        document.getElementById('login-section').style.display = 'block';
        document.getElementById('admin-content').style.display = 'none';
      }
    });
    
    closeAdmin.addEventListener('click', () => {
      adminOverlay.style.display = 'none';
    });
    adminOverlay.addEventListener('click', (e) => {
      if (e.target === adminOverlay) adminOverlay.style.display = 'none';
    });

    document.getElementById('admin-login-btn').addEventListener('click', async () => {
      const password = document.getElementById('admin-password').value;
      const errorDiv = document.getElementById('login-error');
      try {
        const res = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
          adminToken = data.token;
          sessionStorage.setItem('adminToken', adminToken);
          document.getElementById('login-section').style.display = 'none';
          document.getElementById('admin-content').style.display = 'block';
          document.getElementById('admin-password').value = '';
          errorDiv.textContent = '';
          loadStats();
        } else {
          errorDiv.textContent = 'パスワードが違います';
        }
      } catch (err) {
        errorDiv.textContent = 'エラーが発生しました';
      }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
      adminToken = '';
      sessionStorage.removeItem('adminToken');
      document.getElementById('login-section').style.display = 'block';
      document.getElementById('admin-content').style.display = 'none';
    });

    async function loadStats() {
      try {
        const res = await fetch('/admin/stats', {
          headers: { 'Authorization': adminToken }
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('stat-messages').textContent = data.messageCount || 0;
        }
      } catch (err) {
        console.error('Failed to load stats');
      }
    }

    document.getElementById('announce-btn').addEventListener('click', async () => {
      const message = document.getElementById('announce-input').value.trim();
      const statusDiv = document.getElementById('announce-status');
      if (!message) return;
      try {
        const res = await fetch('/admin/announce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': adminToken },
          body: JSON.stringify({ message })
        });
        if (res.ok) {
          document.getElementById('announce-input').value = '';
          statusDiv.className = 'success-msg';
          statusDiv.textContent = '送信しました！';
        } else {
          statusDiv.className = 'error-msg';
          statusDiv.textContent = '送信に失敗しました';
        }
        setTimeout(() => { statusDiv.textContent = ''; }, 3000);
      } catch (err) {
        statusDiv.className = 'error-msg';
        statusDiv.textContent = 'エラーが発生しました';
      }
    });

    document.getElementById('delete-btn').addEventListener('click', async () => {
      const id = document.getElementById('delete-id').value;
      if (!id) return;
      await fetch('/admin/delete/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': adminToken }
      });
      document.getElementById('delete-id').value = '';
    });

    document.getElementById('clear-btn').addEventListener('click', async () => {
      if (!confirm('本当に全メッセージを削除しますか？この操作は取り消せません！')) return;
      await fetch('/admin/clear', {
        method: 'DELETE',
        headers: { 'Authorization': adminToken }
      });
    });
  </script>
</body>
</html>
  `);
});

// ROBLOX API: メッセージ取得のみ（閲覧専用）
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

// Admin: ログイン（セキュア版）
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    // 暗号的にランダムなトークン生成
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    
    // 1時間後に自動削除
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

// Admin: 認証ミドルウェア（セキュア版）
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
  
  // 履歴送信
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
