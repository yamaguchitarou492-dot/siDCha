const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 55e6
});

app.use(cors());
app.use(express.json({ limit: '55mb' }));

const supabaseUrl = process.env.SUPABASE_URL || 'https://znlklskqcuybcnrflieq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_2nZ-FzNcVGKcPqYDSMxSuQ_r4nYxF0L';
const supabase = createClient(supabaseUrl, supabaseKey);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const validTokens = new Set();
const MAX_FILE_SIZE = 50 * 1024 * 1024;

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

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/stamps', (req, res) => res.json({ success: true, stamps: STAMPS }));

app.get('/api/channels', async (req, res) => {
  try {
    const { data, error } = await supabase.from('channels').select('*').order('id');
    if (error) throw error;
    res.json({ success: true, channels: data });
  } catch (err) {
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
    body { font-family: 'Segoe UI', sans-serif; background: #36393f; color: #dcddde; height: 100vh; display: flex; }
    
    #sidebar { width: 240px; background: #2f3136; display: flex; flex-direction: column; }
    #server-header { padding: 15px; background: #2f3136; border-bottom: 1px solid #202225; font-weight: bold; font-size: 16px; }
    #channels-header { padding: 10px 15px; color: #72767d; font-size: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    #add-channel-btn { background: none; border: none; color: #72767d; font-size: 18px; cursor: pointer; }
    #add-channel-btn:hover { color: #dcddde; }
    #channel-list { flex: 1; overflow-y: auto; }
    .channel-item { padding: 8px 15px; margin: 2px 8px; border-radius: 4px; cursor: pointer; color: #72767d; display: flex; align-items: center; gap: 8px; }
    .channel-item:hover { background: #393c43; color: #dcddde; }
    .channel-item.active { background: #393c43; color: #fff; }
    .channel-item::before { content: '#'; font-size: 18px; }
    
    /* 画面共有ボタン */
    #screen-share-section { padding: 10px 15px; border-top: 1px solid #202225; }
    #screen-share-btn { width: 100%; padding: 10px; background: #3ba55d; border: none; border-radius: 5px; color: white; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; }
    #screen-share-btn:hover { background: #2d8049; }
    #screen-share-btn.sharing { background: #ed4245; }
    #screen-share-btn.sharing:hover { background: #c73e41; }
    
    #main { flex: 1; display: flex; flex-direction: column; }
    #header { background: #36393f; padding: 15px 20px; font-size: 18px; font-weight: bold; border-bottom: 1px solid #202225; display: flex; justify-content: space-between; align-items: center; }
    #channel-name::before { content: '# '; color: #72767d; }
    #online-count { color: #72767d; font-size: 14px; }
    
    /* 画面共有表示エリア */
    #screen-share-container { display: none; background: #202225; padding: 10px; border-bottom: 1px solid #202225; }
    #screen-share-container.active { display: block; }
    #screen-share-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; color: #3ba55d; font-weight: bold; }
    #screen-share-video { width: 100%; max-height: 400px; background: #000; border-radius: 8px; }
    #close-screen-share { background: #ed4245; border: none; padding: 5px 10px; border-radius: 4px; color: white; cursor: pointer; font-size: 12px; }
    
    #messages { flex: 1; overflow-y: auto; padding: 20px; position: relative; }
    #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #72767d; }
    .spinner { width: 40px; height: 40px; border: 4px solid #40444b; border-top: 4px solid #5865f2; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .message { margin-bottom: 15px; display: flex; gap: 10px; }
    .message.announcement { background: #5865f233; padding: 10px; border-radius: 8px; border-left: 4px solid #5865f2; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0; }
    .avatar.roblox { background: #00a2ff; }
    .avatar.admin { background: #ed4245; }
    .content { flex: 1; }
    .username { font-weight: bold; color: #fff; margin-bottom: 3px; }
    .username .time { font-size: 12px; color: #72767d; font-weight: normal; margin-left: 8px; }
    .text { line-height: 1.4; word-wrap: break-word; }
    .stamp-msg { font-size: 48px; line-height: 1.2; }
    .msg-image, .msg-video { max-width: 400px; max-height: 300px; border-radius: 8px; margin-top: 8px; cursor: pointer; }
    .roblox-badge, .admin-badge { color: white; font-size: 10px; padding: 2px 6px; border-radius: 3px; margin-left: 5px; }
    .roblox-badge { background: #00a2ff; }
    .admin-badge { background: #ed4245; }
    
    #input-area { padding: 15px 20px; background: #40444b; margin: 0 20px 20px 20px; border-radius: 8px; }
    #media-preview { display: none; margin-bottom: 10px; position: relative; }
    #media-preview img, #media-preview video { max-width: 200px; max-height: 150px; border-radius: 8px; }
    #media-preview .remove-btn { position: absolute; top: -8px; right: -8px; background: #ed4245; border: none; border-radius: 50%; width: 24px; height: 24px; color: white; cursor: pointer; font-size: 14px; }
    .file-info { color: #72767d; font-size: 12px; margin-top: 5px; }
    #upload-status { display: none; color: #5865f2; font-size: 12px; margin-bottom: 10px; }
    #upload-status.show { display: block; }
    #input-row { display: flex; gap: 10px; }
    #username-input { width: 120px; background: #202225; border: none; padding: 10px; border-radius: 5px; color: #dcddde; font-size: 14px; }
    #message-input { flex: 1; background: transparent; border: none; padding: 10px; color: #dcddde; font-size: 14px; outline: none; }
    .input-btn { background: #5865f2; border: none; padding: 10px 15px; border-radius: 5px; color: white; cursor: pointer; font-size: 14px; }
    .input-btn:hover { background: #4752c4; }
    #send-btn:disabled { opacity: 0.5; }
    #file-input { display: none; }
    
    #stamp-panel { display: none; position: absolute; bottom: 100%; right: 0; background: #2f3136; border-radius: 8px; padding: 10px; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); width: 280px; }
    #stamp-panel.show { display: block; }
    .stamp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
    .stamp-item { font-size: 24px; padding: 8px; text-align: center; cursor: pointer; border-radius: 5px; }
    .stamp-item:hover { background: #40444b; }
    .stamp-title { color: #72767d; font-size: 12px; margin-bottom: 8px; font-weight: bold; }
    #stamp-container { position: relative; }
    
    #media-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; cursor: pointer; }
    #media-modal img, #media-modal video { max-width: 90%; max-height: 90%; border-radius: 8px; }
    
    #channel-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center; }
    #channel-modal.show { display: flex; }
    .modal-content { background: #36393f; padding: 20px; border-radius: 8px; width: 90%; max-width: 400px; }
    .modal-content h3 { color: #fff; margin-bottom: 15px; }
    .modal-content input { width: 100%; background: #202225; border: none; padding: 12px; border-radius: 5px; color: #dcddde; font-size: 14px; margin-bottom: 15px; }
    .modal-buttons { display: flex; gap: 10px; }
    .modal-buttons button { flex: 1; padding: 10px; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; }
    .modal-buttons .cancel { background: #4f545c; color: #fff; }
    .modal-buttons .create { background: #5865f2; color: #fff; }
  </style>
</head>
<body>
  <div id="sidebar">
    <div id="server-header">siDChat</div>
    <div id="channels-header">チャンネル<button id="add-channel-btn">+</button></div>
    <div id="channel-list"></div>
    <div id="screen-share-section">
      <button id="screen-share-btn">🖥️ 画面共有</button>
    </div>
  </div>
  
  <div id="main">
    <div id="header">
      <span id="channel-name">general</span>
      <span id="online-count">0人がオンライン</span>
    </div>
    <div id="screen-share-container">
      <div id="screen-share-header">
        <span>🖥️ <span id="sharer-name">誰か</span>が画面を共有中</span>
        <button id="close-screen-share">✕ 閉じる</button>
      </div>
      <video id="screen-share-video" autoplay playsinline></video>
    </div>
    <div id="messages">
      <div id="loading"><div class="spinner"></div><div>ロードしています...</div></div>
    </div>
    <div id="input-area">
      <div id="upload-status">📤 アップロード中...</div>
      <div id="media-preview">
        <img id="preview-img" src="" style="display:none;">
        <video id="preview-video" src="" style="display:none;" controls></video>
        <button class="remove-btn" onclick="removeMedia()">×</button>
        <div id="file-info" class="file-info"></div>
      </div>
      <div id="input-row">
        <input type="text" id="username-input" placeholder="名前" maxlength="20">
        <input type="text" id="message-input" placeholder="メッセージを送信" maxlength="500">
        <input type="file" id="file-input" accept="image/*,video/*">
        <button id="media-btn" class="input-btn">📷</button>
        <div id="stamp-container">
          <button id="stamp-btn" class="input-btn">😀</button>
          <div id="stamp-panel"><div class="stamp-title">スタンプ</div><div class="stamp-grid" id="stamp-grid"></div></div>
        </div>
        <button id="send-btn" class="input-btn">送信</button>
      </div>
    </div>
  </div>

  <div id="media-modal">
    <img id="modal-img" src="" style="display:none;">
    <video id="modal-video" src="" style="display:none;" controls></video>
  </div>
  
  <div id="channel-modal">
    <div class="modal-content">
      <h3>チャンネルを作成</h3>
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
    let isSharing = false;
    let localStream = null;
    let peerConnections = {};
    
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
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
    const screenShareBtn = document.getElementById('screen-share-btn');
    const screenShareContainer = document.getElementById('screen-share-container');
    const screenShareVideo = document.getElementById('screen-share-video');
    const sharerNameSpan = document.getElementById('sharer-name');

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

    usernameInput.value = localStorage.getItem('username') || '';

    // ========== 画面共有 ==========
    screenShareBtn.onclick = async () => {
      if (!isSharing) {
        try {
          localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          isSharing = true;
          screenShareBtn.textContent = '🛑 共有を停止';
          screenShareBtn.classList.add('sharing');
          
          const username = usernameInput.value.trim() || 'Anonymous';
          socket.emit('startScreenShare', { username });
          
          localStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
          };
        } catch (err) {
          console.error('画面共有エラー:', err);
        }
      } else {
        stopScreenShare();
      }
    };

    function stopScreenShare() {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }
      isSharing = false;
      screenShareBtn.textContent = '🖥️ 画面共有';
      screenShareBtn.classList.remove('sharing');
      socket.emit('stopScreenShare');
      
      for (let id in peerConnections) {
        peerConnections[id].close();
      }
      peerConnections = {};
    }

    document.getElementById('close-screen-share').onclick = () => {
      screenShareContainer.classList.remove('active');
      screenShareVideo.srcObject = null;
    };

    // WebRTC シグナリング
    socket.on('screenShareStarted', async ({ odeSenderId, username }) => {
      if (socketId === socket.id) return;
      sharerNameSpan.textContent = username;
      screenShareContainer.classList.add('active');
      
      const pc = new RTCPeerConnection(config);
      peerConnections[socketId] = pc;
      
      pc.ontrack = (event) => {
        screenShareVideo.srcObject = event.streams[0];
      };
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('iceCandidate', { candidate: event.candidate, targetId: socketId });
        }
      };
      
      socket.emit('requestScreenShare', { targetId: socketId });
    });

    socket.on('screenShareRequested', async ({ requesterId }) => {
      if (!localStream) return;
      
      const pc = new RTCPeerConnection(config);
      peerConnections[requesterId] = pc;
      
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('iceCandidate', { candidate: event.candidate, targetId: requesterId });
        }
      };
      
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
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('iceCandidate', async ({ candidate, senderId }) => {
      const pc = peerConnections[senderId];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('screenShareStopped', ({ socketId }) => {
      screenShareContainer.classList.remove('active');
      screenShareVideo.srcObject = null;
      if (peerConnections[socketId]) {
        peerConnections[socketId].close();
        delete peerConnections[socketId];
      }
    });

    socket.on('screenShareFull', () => {
      alert('画面共有は最大3人までです！');
    });

    // ========== チャンネル ==========
    async function loadChannels() {
      const res = await fetch('/api/channels');
      const data = await res.json();
      if (data.success) {
        channels = data.channels;
        renderChannels();
      }
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
    function closeChannelModal() {
      channelModal.classList.remove('show');
      document.getElementById('new-channel-name').value = '';
    }
    async function createChannel() {
      const name = document.getElementById('new-channel-name').value.trim();
      if (!name) return;
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if ((await res.json()).success) {
        closeChannelModal();
        loadChannels();
      }
    }
    channelModal.onclick = (e) => { if (e.target === channelModal) closeChannelModal(); };

    // ========== メッセージ ==========
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function isStampOnly(msg) {
      return STAMPS.some(s => s.emoji === msg.trim());
    }

    function addMessage(data) {
      if (loadingDiv.parentNode === messagesDiv) loadingDiv.style.display = 'none';
      const div = document.createElement('div');
      const isAnnounce = data.is_announcement;
      div.className = 'message' + (isAnnounce ? ' announcement' : '');
      div.dataset.id = data.id;
      const initial = data.username.charAt(0).toUpperCase();
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
      div.innerHTML = '<div class="' + avatarClass + '">' + escapeHtml(initial) + '</div><div class="content"><div class="username">' + escapeHtml(data.username) + badge + '<span class="time">' + time + '</span></div><div class="' + textClass + '">' + escapeHtml(msgText) + '</div>' + mediaHtml + '</div>';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function sendStamp(emoji) {
      const username = usernameInput.value.trim() || 'Anonymous';
      localStorage.setItem('username', username);
      socket.emit('chat', { username, message: emoji, channelId: currentChannel });
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
    document.addEventListener('click', () => stampPanel.classList.remove('show'));
    stampPanel.onclick = (e) => e.stopPropagation();

    function sendMessage() {
      const message = messageInput.value.trim();
      const username = usernameInput.value.trim() || 'Anonymous';
      if ((message || pendingMedia) && !sendBtn.disabled) {
        sendBtn.disabled = true;
        localStorage.setItem('username', username);
        if (pendingMedia) uploadStatus.classList.add('show');
        socket.emit('chat', { username, message, media: pendingMedia, mediaType: pendingMediaType, channelId: currentChannel });
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
    socket.on('deleted', (id) => { const msg = document.querySelector('[data-id="' + id + '"]'); if (msg) msg.remove(); });
    socket.on('cleared', () => { messagesDiv.innerHTML = ''; });
    socket.on('channelCreated', () => loadChannels());

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

let onlineUsers = 0;
const userChannels = new Map();
const screenSharers = new Map();
const screenShareViewers = new Map(); // 視聴者カウント
const MAX_VIEWERS = 3;

io.on('connection', async (socket) => {
  onlineUsers++;
  io.emit('online', onlineUsers);
  
  socket.on('joinChannel', async (channelId) => {
    const prevChannel = userChannels.get(socket.id);
    if (prevChannel) socket.leave('channel_' + prevChannel);
    socket.join('channel_' + channelId);
    userChannels.set(socket.id, channelId);
    
    const { data } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(50);
    if (data) socket.emit('history', data.reverse());
  });
  
  // 画面共有
  socket.on('startScreenShare', ({ username }) => {
    screenSharers.set(socket.id, username);
    socket.broadcast.emit('screenShareStarted', { socketId: socket.id, username });
  });
  
  socket.on('stopScreenShare', () => {
    screenSharers.delete(socket.id);
    screenShareViewers.delete(socket.id); // 視聴者カウントリセット
    socket.broadcast.emit('screenShareStopped', { socketId: socket.id });
  });
  
  socket.on('requestScreenShare', ({ targetId }) => {
    // 視聴者数チェック
    const currentViewers = screenShareViewers.get(targetId) || 0;
    if (currentViewers >= MAX_VIEWERS) {
      socket.emit('screenShareFull');
      return;
    }
    screenShareViewers.set(targetId, currentViewers + 1);
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
      from_roblox: false,
      is_announcement: false
    };
    const { data: saved, error } = await supabase.from('messages').insert([newMessage]).select().single();
    if (!error && saved) io.to('channel_' + saved.channel_id).emit('chat', saved);
  });
  
  socket.on('disconnect', () => {
    onlineUsers--;
    userChannels.delete(socket.id);
    if (screenSharers.has(socket.id)) {
      screenSharers.delete(socket.id);
      socket.broadcast.emit('screenShareStopped', { socketId: socket.id });
    }
    io.emit('online', onlineUsers);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`siDChat running on ${PORT}`));
