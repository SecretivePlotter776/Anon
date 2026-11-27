# Anon

A real-time server chat and direct messaging app with one-to-one, audio-only peer-to-peer calls. Create an account with only a username and password—no email address or phone number.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run start:dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account, choose a user under **Available** to start a direct message, then use **Call** for an audio-only WebRTC call. The browser asks for microphone permission. Voice works best on HTTPS (or localhost); some NATs and firewalls may require a TURN relay.

## Features

- Username/password registration and sign-in; passwords are bcrypt-hashed
- Server text channels and real-time chat
- Private one-to-one message threads, persisted with recent messages
- Direct one-to-one voice calls using WebRTC; no video
- NestJS API and Socket.IO signaling
- Local JSON persistence in `data/anon.json`

## Before public deployment

This is a starter implementation, not a hardened public service. Set a long random `JWT_SECRET`, serve over HTTPS, restrict CORS to your trusted origin, and add rate limits, moderation, backups, and durable database storage. Accounts have no email/phone recovery. WebRTC uses a public STUN server; TURN may be needed on restrictive networks. Local JSON persistence is intended for a single application instance.
