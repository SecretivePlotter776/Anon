# Anon

A real-time server chat and peer-to-peer voice calling app. Create an account with only a username and password—no email address or phone number.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run start:dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account, pick a server, and start chatting. Use **Join** under Voice Channels to start an audio-only WebRTC call. The browser will ask for microphone permission. Voice works best on HTTPS (or localhost); some NATs and firewalls may require a TURN relay for reliable calls.

## What is included

- NestJS API and Socket.IO real-time chat/signaling server
- Username/password registration and sign-in; passwords are bcrypt-hashed
- Local JSON persistence for users, servers, and recent channel messages (`data/anon.json`)
- Server creation, text channels, and real-time messages
- Peer-to-peer audio using WebRTC; no video feature

## Before public deployment

This is a starter implementation, not a hardened public service. Set a long random `JWT_SECRET`, serve over HTTPS, configure CORS to your trusted origin, and add rate limits, moderation, backups, and durable database storage. Accounts have no email/phone recovery; users who lose their password cannot recover it. WebRTC uses a public STUN server; TURN may be needed for calls across restrictive networks. Run one application instance with local JSON storage, since it is not a multi-instance database.
