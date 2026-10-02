# デプロイ構成 (VPS + Cloudflare Tunnel + GitHub Actions)

```
GitHub (main)
   │  merge = push  ─────────────►  GitHub Actions (CI: PR時 / Deploy: main時)
   │                                        │
   │                                        ▼  self-hosted runner (VPS 常駐, アウトバウンド取得)
   │                                ~/apps/english-for-kids
   │                                git reset --hard → npm ci → npm run build
   │                                systemctl --user restart english-for-kids
   ▼
Cloudflare Tunnel  ──  yy.english.kids.com  ──►  http://127.0.0.1:3000  (Next.js)
```

## 構成要素
- **アプリ**: Next.js (`.next`) を `next start` で常駐。`127.0.0.1:3000` のみ listen (外部非公開)。
- **プロセス管理**: systemd **user** unit `english-for-kids.service` (linger 有効なので再起動後も自動起動)。
- **公開**: `cloudflared` のトンネルで `yy.english.kids.com` → `http://127.0.0.1:3000`。
- **デプロイ**: main マージ時に **セルフホストランナー** が実行 (受信ポート不要・トンネル無関係)。

## 初回セットアップ手順 (runbook)

### 1. systemd user unit の配置
```bash
cp deploy/english-for-kids.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now english-for-kids.service
loginctl show-user "$USER" | grep Linger      # Linger=yes を確認
journalctl --user -u english-for-kids -f      # ログ
```

### 2. cloudflared (既存トンネルを再利用)
ダッシュボード管理トンネルのトークンを使う場合:
```bash
# トークンは secrets 管理 (リポジトリには置かない)。例:
cloudflared tunnel --no-autoupdate run --token <TOKEN>
# systemd 化は cloudflared service install <TOKEN> が便利
```
トンネルの **Public Hostname** に以下を設定:
- Hostname: `yy.english.kids.com`
- Service: `http://127.0.0.1:3000`

### 3. セルフホストランナーの登録 (user サービスとして)
```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# 公式の tar.gz を展開後:
./config.sh --url https://github.com/yusuke-y-0306/english-for-kids \
            --token <REGISTRATION_TOKEN> \
            --labels english-for-kids --name vps-english-for-kids --unattended
# user サービス化 (XDG を介して systemctl --user を叩けるようにするため)
```
> ランナーを **user サービス**として動かすと、ワークフロー内の `systemctl --user` が
> そのまま通る。システムサービスとして入れる場合は `XDG_RUNTIME_DIR` の面倒を見る必要がある。

## セキュリティ
- リポジトリは public。**deploy ワークフローは `push`(main) のみをトリガ**にし、
  `pull_request` では起動しない。fork PR のコードをランナーで実行しないこと。
- トークン / credentials は **GitHub Secrets か VPS 上のファイル**に置き、リポジトリに含めない。
