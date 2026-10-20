# デプロイ構成 (VPS + Cloudflare Tunnel + GitHub Actions)

```
GitHub (main)
   │  merge = push
   ▼
GitHub Actions (CI: PR時 / Deploy: main時)
   │  CI      : ubuntu-latest (ホステッド) で lint / typecheck / build
   │  Deploy  : ubuntu-latest (ホステッド) から VPS へ SSH
   │              └─► 160.251.252.114  (~/apps/english-for-kids)
   │                    git reset --hard origin/main → npm ci → npm run build
   │                    systemctl --user restart english-for-kids → healthcheck
   ▼
Cloudflare Tunnel ── yy.english.kids.com ──► http://127.0.0.1:3000 (Next.js)
```

## 構成要素
- **アプリ**: Next.js (`.next`) を `next start` で常駐。`127.0.0.1:3000` のみ listen (外部非公開)。
- **プロセス管理**: systemd **user** unit `english-for-kids.service` (linger 有効なので再起動後も自動起動)。
- **公開**: `cloudflared` のトンネルで `yy.english.kids.com` → `http://127.0.0.1:3000`。
- **デプロイ**: main マージ時に **GitHub ホステッドランナー** が VPS へ **SSH** して実行。

## なぜセルフホストランナーを使わないか
この VPS は OpenClaw Gateway が稼働するホストで、credentials / トークン / memory を保持している。
セルフホストランナーを置くと、リポジトリのワークフロー (= 任意コード) が **Gateway と同じユーザ権限**
で VPS 上を実行できてしまう。そのため、常駐ランナーは置かず「GitHub → VPS」方向の SSH のみで
デプロイする。VPS 側に GitHub の資格情報は不要 (リポジトリは public のため `git fetch` は匿名で可)。

## 初回セットアップ (runbook)

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
cloudflared tunnel --no-autoupdate run --token ***
# systemd 化は cloudflared service install <TOKEN> が便利
```
トンネルの **Public Hostname** に以下を設定:
- Hostname: `yy.english.kids.com`
- Service: `http://127.0.0.1:3000`

### 3. デプロイ用 SSH 鍵
VPS 上で鍵ペアを作成し、**公開鍵を `~/.ssh/authorized_keys` に登録**、**秘密鍵を GitHub リポジトリの
Secrets に登録**する。
```bash
ssh-keygen -t ed25519 -f ~/.ssh/gh_deploy_ed25519 -C "gh-actions-deploy" -N ""
# 公開鍵 (restrict 付き) を登録
PUB="$(cat ~/.ssh/gh_deploy_ed25519.pub)"
echo "restrict ${PUB}" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 4. GitHub Secrets
リポジトリの Settings → Secrets and variables → Actions に以下を登録:
- `VPS_HOST` : `160.251.252.114`
- `VPS_PORT` : `22`
- `VPS_USER` : `yusuke`
- `VPS_SSH_KEY` : `~/.ssh/gh_deploy_ed25519` の**秘密鍵**の中身 (Secrets に登録後、VPS 上の
  ローカルコピーは削除してよい)

## セキュリティ
- リポジトリは public。**deploy ワークフローは `push`(main) のみをトリガ**にし、
  `pull_request` では起動しない。fork PR のコードを実行しないこと。
- トークン / credentials は **GitHub Secrets か VPS 上のファイル**に置き、リポジトリに含めない。
- デプロイ鍵は `restrict` 付き。より厳しくするなら `command="~/bin/efk-deploy.sh"` の
  強制コマンド化 (秘密鍵が漏れてもデプロイ script しか実行できない) を検討。
