import {
  BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException,
} from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DATA_FILE = join(DATA_DIR, 'anon.json');
type User = { username: string; password: string };
type ChatMessage = { id: string; username: string; text: string; time: number };
type Channel = { id: string; name: string; messages: ChatMessage[] };
type Community = { id: string; name: string; channels: Channel[] };
type Store = { users: User[]; communities: Community[] };
const initial: Store = { users: [], communities: [{ id: 'lobby', name: 'The Commons', channels: [{ id: 'general', name: 'general', messages: [] }, { id: 'introductions', name: 'introductions', messages: [] }] }] };

function loadStore(): Store {
  try { return existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : initial; }
  catch { return initial; }
}
let store = loadStore();
function save() { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function safeCommunity(c: Community) { return { id: c.id, name: c.name, channels: c.channels.map(({ id, name }) => ({ id, name })) }; }
function tokenFor(username: string) { return jwt.sign({ username }, SECRET, { expiresIn: '30d' }); }

@Controller('api')
export class AppController {
  private userFromHeader(header?: string): string {
    try { if (!header?.startsWith('Bearer ')) throw Error(); return (jwt.verify(header.slice(7), SECRET) as any).username; }
    catch { throw new UnauthorizedException('Please sign in again.'); }
  }

  @Post('register') async register(@Body() body: any) {
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new BadRequestException('Username must be 3–20 letters, numbers, or underscores.');
    if (password.length < 8 || password.length > 72) throw new BadRequestException('Password must be 8–72 characters.');
    if (store.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new BadRequestException('That username is already taken.');
    store.users.push({ username, password: await bcrypt.hash(password, 12) }); save();
    return { token: tokenFor(username), username };
  }

  @Post('login') async login(@Body() body: any) {
    const username = String(body?.username || '').trim();
    const user = store.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !await bcrypt.compare(String(body?.password || ''), user.password)) throw new UnauthorizedException('Username or password is incorrect.');
    return { token: tokenFor(user.username), username: user.username };
  }

  @Get('me') me(@Headers('authorization') auth: string) {
    const username = this.userFromHeader(auth);
    return { username, communities: store.communities.map(safeCommunity) };
  }

  @Post('communities') createCommunity(@Headers('authorization') auth: string, @Body() body: any) {
    const username = this.userFromHeader(auth);
    const name = String(body?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new BadRequestException('Server name must be at least 2 characters.');
    const community = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, channels: [{ id: 'general', name: 'general', messages: [] }] };
    store.communities.push(community); save();
    return { community: safeCommunity(community), username };
  }

  @Post('messages') messages(@Headers('authorization') auth: string, @Body() body: any) {
    this.userFromHeader(auth);
    const channel = store.communities.find(s => s.id === body?.serverId)?.channels.find(c => c.id === body?.channelId);
    if (!channel) throw new BadRequestException('Channel not found.');
    return { messages: channel.messages.slice(-100) };
  }
}

@WebSocketGateway({ cors: { origin: true }, namespace: '/' })
export class ChatGateway {
  @WebSocketServer() server: Server;
  private userFor(client: Socket): string {
    try { return (jwt.verify(client.handshake.auth?.token, SECRET) as any).username; }
    catch { throw new Error('Unauthorized'); }
  }

  @SubscribeMessage('join-channel') join(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const channel = store.communities.find(s => s.id === data?.serverId)?.channels.find(c => c.id === data?.channelId);
      if (!channel) return { error: 'Channel not found.' };
      for (const room of client.rooms) if (room.startsWith('channel:')) client.leave(room);
      const room = `channel:${data.serverId}:${data.channelId}`;
      client.join(room);
      this.server.to(room).emit('presence', { username, status: 'online' });
      return { messages: channel.messages.slice(-100) };
    } catch { return { error: 'Unauthorized' }; }
  }

  @SubscribeMessage('chat-message') sendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const community = store.communities.find(s => s.id === data?.serverId);
      const channel = community?.channels.find(c => c.id === data?.channelId);
      const text = String(data?.text || '').trim();
      if (!channel || !text || text.length > 2000) return;
      const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() };
      channel.messages.push(message); if (channel.messages.length > 500) channel.messages.shift(); save();
      this.server.to(`channel:${data.serverId}:${data.channelId}`).emit('chat-message', message);
    } catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }

  @SubscribeMessage('voice-join') voiceJoin(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const room = `voice:${data?.serverId}:${data?.channelId}`;
      client.join(room);
      client.to(room).emit('voice-peer', { id: client.id, username });
      const peers = [...(this.server.sockets.adapter.rooms.get(room) || [])].filter(id => id !== client.id).map(id => ({ id, username: (this.server.sockets.sockets.get(id)?.data.username || 'member') }));
      client.data.username = username; client.data.voiceRoom = room;
      return { peers };
    } catch { return { error: 'Unauthorized' }; }
  }

  @SubscribeMessage('voice-leave') voiceLeave(@ConnectedSocket() client: Socket) {
    const room = client.data.voiceRoom;
    if (room) { client.to(room).emit('voice-peer-left', { id: client.id }); client.leave(room); client.data.voiceRoom = null; }
  }

  @SubscribeMessage('signal') signal(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { this.userFor(client); if (typeof data?.to === 'string') this.server.to(data.to).emit('signal', { from: client.id, signal: data.signal }); }
    catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }
}
