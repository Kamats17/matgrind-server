# MatGrind Server — Deployment Guide

## Railway Deployment (Recommended)

### 1. Create a Railway Project
- Go to [railway.app](https://railway.app) and sign in
- Create a new project
- Select "Deploy from GitHub repo" or "Deploy from local directory"

### 2. Set the Root Directory
If deploying from the full MatGrind repo, set the root directory to `server-online/`.

### 3. Set Environment Variables
In the Railway dashboard, add:

| Variable | Value |
|----------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON string of your Firebase Admin SDK service account key |
| `PORT` | Railway sets this automatically — do NOT override |

To get the Firebase service account key:
1. Go to Firebase Console > Project Settings > Service accounts
2. Click "Generate new private key"
3. Copy the entire JSON content
4. Paste as the value for `FIREBASE_SERVICE_ACCOUNT` in Railway

### 4. Deploy
Railway will auto-detect the Dockerfile and build. The server exposes:
- `GET /health` — Health check endpoint
- WebSocket at `/` — Game connections

### 5. Get the Server URL
After deployment, Railway provides a public URL like:
```
matgrind-server-production.up.railway.app
```

### 6. Update Client Config
Set the client environment variable:
```
VITE_ONLINE_SERVER_URL=wss://matgrind-server-production.up.railway.app
```

For local development:
```
VITE_ONLINE_SERVER_URL=ws://localhost:3033
```

Add this to a `.env` file in the MatGrind root directory.

### 7. Verify
```bash
curl https://matgrind-server-production.up.railway.app/health
```
Should return: `{"status":"ok","rooms":0,"uptime":...}`

---

## Multi-Region Notes

For v1, a single Railway region is sufficient. If latency becomes an issue:

### Option A: Railway Multi-Region (Future)
Railway supports deploying to multiple regions. Deploy the same service to US-East and EU-West. Use a DNS-based load balancer or Cloudflare Workers to route users to the nearest region.

### Option B: Fly.io (Alternative)
Fly.io natively supports multi-region with `fly.toml`:
```toml
[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 3033
  protocol = "tcp"
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

[env]
  PORT = "3033"
```
Deploy with: `fly deploy --region iad,lhr` (US-East + London)

### Region Routing
With multi-region, the client needs to connect to the nearest server. Options:
1. **DNS GeoDNS**: Route `ws.matgrind.com` to different IPs per region
2. **Cloudflare Worker**: Inspect request origin and redirect to nearest WS endpoint
3. **Client-side ping**: Client pings all regions on connect, picks fastest

For now, single-region deployment is recommended until player count justifies multi-region.

---

## Local Development

```bash
cd server-online
npm install
node index.mjs
```

Server starts on port 3033. Set `FIREBASE_SERVICE_ACCOUNT` env var or the server will skip token verification (dev mode).
