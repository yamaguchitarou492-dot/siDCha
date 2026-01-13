const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

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
  </style>
</head>
<body>
  <div id="header">
    <span># general</span>
    <span id="online-count">0人がオンライン</span>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="username-input" placeholder="名前" maxlength="20">
    <input type="text" id="message-input" placeholder="メッセージを送信" maxlength="500">
    <button id="send-btn">送信</button>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const usernameInput = document.getElementById('username-input');
    const sendBtn = document.getElementById('send-btn');
    const onlineCount = document.getElementById('online-count');

    usernameInput.value = localStorage.getItem('username') || '';

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function addMessage(data) {
      const div = document.createElement('div');
      div.className = 'message';
      const initial = data.username.charAt(0).toUpperCase();
      const badge = data.from_roblox ? '<span class="roblox-badge">ROBLOX</span>' : '';
      const avatarClass = data.from_roblox ? 'avatar roblox' : 'avatar';
      const time = new Date(data.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = 
        '<div class="' + avatarClass + '">' + escapeHtml(initial) + '</div>' +
        '<div class="content">' +
          '<div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + '</span></div>' +
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

// ROBLOX API: メッセージ送信
app.post('/api/send', async (req, res) => {
  try {
    const { username, message, userId } = req.body;
    
    if (!username || !message) {
      return res.status(400).json({ success: false, error: 'username and message required' });
    }
    
    const newMessage = {
      username: username.substring(0, 20),
      message: message.substring(0, 500),
      user_id: userId || null,
      from_roblox: true
    };
    
    const { data, error } = await supabase
      .from('messages')
      .insert([newMessage])
      .select()
      .single();
    
    if (error) throw error;
    
    // WebSocketでブロードキャスト
    io.emit('chat', data);
    
    res.json({ success: true, message: data });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
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
        from_roblox: false
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
