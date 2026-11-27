import {
  BadRequestException, Body, Controller, Get, Headers, Param, Post, UnauthorizedException,
} from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody } from '@nestjs/websockets';
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
type DirectMessage = { id: string; participants: string[]; messages: ChatMessage[] };
type Store = { users: User[]; communities: Community[]; directMessages: DirectMessage[] };
const initial: Store = { users: [], communities: [{ id: 'lobby', name: 'The Commons', channels: [{ id: 'general', name: 'general', messages: [] }, { id: 'introductions', name: 'introductions', messages: [] }] }], directMessages: [] };

function loadStore(): Store {
  try {
    if (!existsSync(DATA_FILE)) return initial;
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return { ...initial, ...parsed, directMessages: parsed.directMessages || [] };
  } catch { return initial; }
}
let store = loadStore();
function save() { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function safeCommunity(c: Community) { return { id: c.id, name: c.name, channels: c.channels.map(({ id, name }) => ({ id, name })) }; }
function tokenFor(username: string) { return jwt.sign({ username }, SECRET, { expiresIn: '30d' }); }
function dmFor(a: string, b: string) { return store.directMessages.find(d => d.participants.some(x => x.toLowerCase() === a.toLowerCase()) && d.participants.some(x => x.toLowerCase() === b.toLowerCase())); }

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

  @Get('users') users(@Headers('authorization') auth: string) {
    const username = this.userFromHeader(auth);
    return { users: store.users.filter(u => u.username.toLowerCase() !== username.toLowerCase()).map(u => u.username) };
  }

  @Get('dms') listDms(@Headers('authorization') auth: string) {
    const username = this.userFromHeader(auth);
    return { dms: store.directMessages.filter(d => d.participants.some(p => p.toLowerCase() === username.toLowerCase())).map(d => ({ id: d.id, username: d.participants.find(p => p.toLowerCase() !== username.toLowerCase()), lastMessage: d.messages[d.messages.length - 1] || null })) };
  }

  @Post('dms') openDm(@Headers('authorization') auth: string, @Body() body: any) {
    const username = this.userFromHeader(auth);
    const targetName = String(body?.username || '').trim();
    const target = store.users.find(u => u.username.toLowerCase() === targetName.toLowerCase());
    if (!target || target.username.toLowerCase() === username.toLowerCase()) throw new BadRequestException('Choose another valid account.');
    let dm = dmFor(username, target.username);
    if (!dm) { dm = { id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, participants: [username, target.username], messages: [] }; store.directMessages.push(dm); save(); }
    return { dm: { id: dm.id, username: target.username, messages: dm.messages.slice(-100) } };
  }

  @Post('dms/messages') dmMessages(@Headers('authorization') auth: string, @Body() body: any) {
    const username = this.userFromHeader(auth);
    const dm = store.directMessages.find(d => d.id === body?.dmId && d.participants.some(p => p.toLowerCase() === username.toLowerCase()));
    if (!dm) throw new BadRequestException('Conversation not found.');
    return { messages: dm.messages.slice(-100) };
  }

  @Post('communities') createCommunity(@Headers('authorization') auth: string, @Body() body: any) {
    this.userFromHeader(auth);
    const name = String(body?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new BadRequestException('Server name must be at least 2 characters.');
    const community = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, channels: [{ id: 'general', name: 'general', messages: [] }] };
    store.communities.push(community); save();
    return { community: safeCommunity(community) };
  }

  @Post('messages') messages(@Headers('authorization') auth: string, @Body() body: any) {
    this.userFromHeader(auth);
    const channel = store.communities.find(s => s.id === body?.serverId)?.channels.find(c => c.id === body?.channelId);
    if (!channel) throw new BadRequestException('Channel not found.');
    return { messages: channel.messages.slice(-100) };
  }
}

type ActiveCall = { id: string; caller: string; callee: string; callerSocket: string; calleeSocket?: string; accepted: boolean };
@WebSocketGateway({ cors: { origin: true }, namespace: '/' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private calls = new Map<string, ActiveCall>();
  private userFor(client: Socket): string {
    try { return (jwt.verify(client.handshake.auth?.token, SECRET) as any).username; }
    catch { throw new Error('Unauthorized'); }
  }
  handleConnection(client: Socket) {
    try { const username = this.userFor(client); client.data.username = username; client.join(this.userRoom(username)); }
    catch { client.disconnect(true); }
  }
  handleDisconnect(client: Socket) {
    for (const [id, call] of this.calls) {
      if (call.callerSocket === client.id || call.calleeSocket === client.id) {
        const peer = call.callerSocket === client.id ? call.calleeSocket : call.callerSocket;
        if (peer) this.server.to(peer).emit('call-ended', { callId: id, reason: 'Connection lost' });
        this.calls.delete(id);
      }
    }
  }
  private userRoom(username: string) { return `user:${username.toLowerCase()}`; }

  @SubscribeMessage('join-channel') join(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      this.userFor(client);
      const channel = store.communities.find(s => s.id === data?.serverId)?.channels.find(c => c.id === data?.channelId);
      if (!channel) return { error: 'Channel not found.' };
      for (const room of client.rooms) if (room.startsWith('channel:')) client.leave(room);
      const room = `channel:${data.serverId}:${data.channelId}`;
      client.join(room);
      return { messages: channel.messages.slice(-100) };
    } catch { return { error: 'Unauthorized' }; }
  }

  @SubscribeMessage('chat-message') sendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const channel = store.communities.find(s => s.id === data?.serverId)?.channels.find(c => c.id === data?.channelId);
      const text = String(data?.text || '').trim();
      if (!channel || !text || text.length > 2000) return;
      const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() };
      channel.messages.push(message); if (channel.messages.length > 500) channel.messages.shift(); save();
      this.server.to(`channel:${data.serverId}:${data.channelId}`).emit('chat-message', message);
    } catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }

  @SubscribeMessage('join-dm') joinDm(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const dm = store.directMessages.find(d => d.id === data?.dmId && d.participants.some(p => p.toLowerCase() === username.toLowerCase()));
      if (!dm) return { error: 'Conversation not found.' };
      for (const room of client.rooms) if (room.startsWith('dm:')) client.leave(room);
      client.join(`dm:${dm.id}`);
      return { messages: dm.messages.slice(-100) };
    } catch { return { error: 'Unauthorized' }; }
  }

  @SubscribeMessage('dm-message') sendDm(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client);
      const dm = store.directMessages.find(d => d.id === data?.dmId && d.participants.some(p => p.toLowerCase() === username.toLowerCase()));
      const text = String(data?.text || '').trim();
      if (!dm || !text || text.length > 2000) return;
      const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() };
      dm.messages.push(message); if (dm.messages.length > 500) dm.messages.shift(); save();
      this.server.to(`dm:${dm.id}`).emit('dm-message', { dmId: dm.id, message });
      for (const participant of dm.participants) if (participant.toLowerCase() !== username.toLowerCase()) this.server.to(this.userRoom(participant)).emit('dm-notification', { dmId: dm.id, username });
    } catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }

  @SubscribeMessage('call-start') startCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const caller = this.userFor(client);
      const target = store.users.find(u => u.username.toLowerCase() === String(data?.username || '').toLowerCase());
      if (!target || target.username.toLowerCase() === caller.toLowerCase()) return { error: 'That user is not available.' };
      const active = [...this.calls.values()].some(c => c.caller.toLowerCase() === target.username.toLowerCase() || c.callee.toLowerCase() === target.username.toLowerCase());
      if (active) return { error: 'That person is already on a call.' };
      const call: ActiveCall = { id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, caller, callee: target.username, callerSocket: client.id, accepted: false };
      this.calls.set(call.id, call);
      this.server.to(this.userRoom(target.username)).emit('incoming-call', { callId: call.id, from: caller, callerSocket: client.id });
      return { callId: call.id };
    } catch { return { error: 'Please sign in again.' }; }
  }

  @SubscribeMessage('call-accept') acceptCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const call = this.calls.get(data?.callId);
    if (!call || call.accepted || call.callee.toLowerCase() !== String(client.data.username || '').toLowerCase()) return { error: 'Call is no longer available.' };
    call.accepted = true; call.calleeSocket = client.id;
    this.server.to(call.callerSocket).emit('call-accepted', { callId: call.id, peerSocket: client.id, peer: call.callee });
    return { ok: true, peerSocket: call.callerSocket };
  }

  @SubscribeMessage('call-decline') declineCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const call = this.calls.get(data?.callId);
    if (!call || call.callee.toLowerCase() !== String(client.data.username || '').toLowerCase()) return;
    this.server.to(call.callerSocket).emit('call-declined', { callId: call.id, reason: 'Call declined' }); this.calls.delete(call.id);
  }

  @SubscribeMessage('call-signal') signalCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const call = this.calls.get(data?.callId);
    if (!call?.accepted || (client.id !== call.callerSocket && client.id !== call.calleeSocket)) return;
    const peer = client.id === call.callerSocket ? call.calleeSocket : call.callerSocket;
    if (peer) this.server.to(peer).emit('call-signal', { callId: call.id, from: client.id, signal: data.signal });
  }

  @SubscribeMessage('call-end') endCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const call = this.calls.get(data?.callId);
    if (!call || (client.id !== call.callerSocket && client.id !== call.calleeSocket)) return;
    const peer = client.id === call.callerSocket ? call.calleeSocket : call.callerSocket;
    if (peer) this.server.to(peer).emit('call-ended', { callId: call.id, reason: 'Call ended' });
    this.calls.delete(call.id);
  }
}
