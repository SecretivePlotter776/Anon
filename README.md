# Anon

A real-time server chat and direct messaging app with one-to-one, audio-only peer-to-peer calls. Create an account with only a username and password—no email address or phone number.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run start:dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account. On desktop, direct messages and people are in the sidebar. On mobile, use the **Chats**, **People**, and **Servers** tabs at the bottom. Open a direct message to send messages or tap **Call** for an audio-only WebRTC call. The browser asks for microphone permission.

To show an operating-system/browser notification for incoming calls while Anon is open, tap **Enable call alerts** and allow notifications. The in-app incoming call prompt remains available if browser notifications are unavailable or denied. Notifications while the site is fully closed or suspended require Web Push support and are not provided by this basic in-app notification feature.

Voice works best over HTTPS; some networks require a TURN relay.

## Features

- Username/password registration and sign-in; passwords are bcrypt-hashed
- Server channels and real-time chat
- Private one-to-one direct messages
- One-to-one, audio-only WebRTC voice calls
- Mobile bottom navigation for chats, people, and servers, with a back-to-chat control
- Optional browser notifications for incoming calls while the app is open
- NestJS API, Socket.IO signaling, and local JSON persistence in `data/anon.json`

## Before public deployment

This is a starter implementation, not a hardened public service. Set a long random `JWT_SECRET`, serve over HTTPS, restrict CORS to your trusted origin, and add rate limits, moderation, backups, and durable database storage. Accounts have no email/phone recovery. WebRTC uses a public STUN server; TURN may be needed on restrictive networks. Local JSON persistence is intended for a single application instance.
