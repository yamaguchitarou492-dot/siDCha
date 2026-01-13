# siDChat

Discord風チャットサーバー（ROBLOX連携 + 履歴永続化対応）

## 機能

- リアルタイムWebチャット
- ROBLOX HttpService対応API
- オンラインユーザー数表示
- **Supabaseで履歴永続化**（サーバー再起動しても消えない！）

## ROBLOX API

### メッセージ送信
```
POST /api/send
Content-Type: application/json
Body: { "username": "Player1", "message": "こんにちは", "userId": 12345 }
```

### メッセージ取得
```
GET /api/messages?limit=50
```

## ROBLOXスクリプト例

```lua
local HttpService = game:GetService("HttpService")
local URL = "https://あなたのアプリ.onrender.com"

-- メッセージ送信
local function sendMessage(player, message)
    local success, response = pcall(function()
        return HttpService:RequestAsync({
            Url = URL .. "/api/send",
            Method = "POST",
            Headers = {["Content-Type"] = "application/json"},
            Body = HttpService:JSONEncode({
                username = player.Name,
                message = message,
                userId = player.UserId
            })
        })
    end)
    
    if success then
        print("Message sent!")
    else
        warn("Failed to send message")
    end
end

-- メッセージ取得
local function getMessages()
    local success, response = pcall(function()
        return HttpService:GetAsync(URL .. "/api/messages?limit=20")
    end)
    
    if success then
        local data = HttpService:JSONDecode(response)
        return data.messages
    end
    return {}
end
```

## 環境変数（Renderで設定）

- `SUPABASE_URL` - SupabaseのプロジェクトURL
- `SUPABASE_KEY` - Supabaseの公開キー
