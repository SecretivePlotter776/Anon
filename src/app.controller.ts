import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DATA_FILE = join(DATA_DIR, 'anon.json');
type User = { username: string; password: string };
type Message = { id: string; username: string; text: string; time: number };
type Channel = { id: string; name: string; messages: Message[] };
type Community = { id: string; name: string; channels: Channel[] };
type DirectMessage = { id: string; participants: string[]; messages: Message[] };
type Store = { users: User[]; communities: Community[]; directMessages: DirectMessage[] };
const initial: Store = { users: [], communities: [{ id: 'lobby', name: 'The Commons', channels: [{ id: 'general', name: 'general', messages: [] }, { id: 'introductions', name: 'introductions', messages: [] }] }], directMessages: [] };
function loadStore(): Store {
  try { if (!existsSync(DATA_FILE)) return initial; const data = JSON.parse(readFileSync(DATA_FILE, 'utf8')); return { ...initial, ...data, directMessages: data.directMessages || [] }; }
  catch { return initial; }
}
let store = loadStore();
function save() { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function tokenFor(username: string) { return jwt.sign({ username }, SECRET, { expiresIn: '30d' }); }
function findDm(a: string, b: string) { return store.directMessages.find(d => d.participants.some(x => x.toLowerCase() === a.toLowerCase()) && d.participants.some(x => x.toLowerCase() === b.toLowerCase())); }

@Controller('api')
export class AppController {
  private user(header?: string): string {
    try { if (!header?.startsWith('Bearer ')) throw Error(); return (jwt.verify(header.slice(7), SECRET) as any).username; }
    catch { throw new UnauthorizedException('Please sign in again.'); }
  }
  @Post('register') async register(@Body() body: any) {
    const username = String(body?.username || '').trim(), password = String(body?.password || '');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new BadRequestException('Username must be 3–20 letters, numbers, or underscores.');
    if (password.length < 8 || password.length > 72) throw new BadRequestException('Password must be 8–72 characters.');
    if (store.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new BadRequestException('That username is already taken.');
    store.users.push({ username, password: await bcrypt.hash(password, 12) }); save(); return { token: tokenFor(username), username };
  }
  @Post('login') async login(@Body() body: any) {
    const username = String(body?.username || '').trim(), account = store.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!account || !await bcrypt.compare(String(body?.password || ''), account.password)) throw new UnauthorizedException('Username or password is incorrect.');
    return { token: tokenFor(account.username), username: account.username };
  }
  @Get('me') me(@Headers('authorization') auth: string) {
    const username = this.user(auth);
    return { username, communities: store.communities.map(s => ({ id: s.id, name: s.name, channels: s.channels.map(c => ({ id: c.id, name: c.name })) })) };
  }
  @Get('users') users(@Headers('authorization') auth: string) { const me = this.user(auth); return { users: store.users.filter(u => u.username.toLowerCase() !== me.toLowerCase()).map(u => u.username) }; }
  @Get('dms') dms(@Headers('authorization') auth: string) {
    const me = this.user(auth);
    return { dms: store.directMessages.filter(d => d.participants.some(p => p.toLowerCase() === me.toLowerCase())).map(d => ({ id: d.id, username: d.participants.find(p => p.toLowerCase() !== me.toLowerCase()), lastMessage: d.messages[d.messages.length - 1] || null })) };
  }
  @Post('dms') openDm(@Headers('authorization') auth: string, @Body() body: any) {
    const me = this.user(auth), target = store.users.find(u => u.username.toLowerCase() === String(body?.username || '').trim().toLowerCase());
    if (!target || target.username.toLowerCase() === me.toLowerCase()) throw new BadRequestException('Choose another valid account.');
    let dm = findDm(me, target.username);
    if (!dm) { dm = { id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, participants: [me, target.username], messages: [] }; store.directMessages.push(dm); save(); }
    return { dm: { id: dm.id, username: target.username, messages: dm.messages.slice(-100) } };
  }
  @Post('dms/messages') dmMessages(@Headers('authorization') auth: string, @Body() body: any) {
    const me = this.user(auth), dm = store.directMessages.find(d => d.id === body?.dmId && d.participants.some(p => p.toLowerCase() === me.toLowerCase()));
    if (!dm) throw new BadRequestException('Conversation not found.'); return { messages: dm.messages.slice(-100) };
  }
  @Post('communities') createCommunity(@Headers('authorization') auth: string, @Body() body: any) {
    this.user(auth); const name = String(body?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new BadRequestException('Server name must be at least 2 characters.');
    const community = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, channels: [{ id: 'general', name: 'general', messages: [] }] };
    store.communities.push(community); save(); return { community: { id: community.id, name, channels: [{ id: 'general', name: 'general' }] } };
  }
  @Post('messages') messages(@Headers('authorization') auth: string, @Body() body: any) {
    this.user(auth); const channel = store.communities.find(s => s.id === body?.serverId)?.channels.find(c => c.id === body?.channelId);
    if (!channel) throw new BadRequestException('Channel not found.'); return { messages: channel.messages.slice(-100) };
  }
}

type Call = { id: string; caller: string; callee: string; callerSocket: string; calleeSocket?: string; accepted: boolean };
@WebSocketGateway({ cors: { origin: true }, namespace: '/' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private calls = new Map<string, Call>();
  private userFor(client: Socket): string { try { return (jwt.verify(client.handshake.auth?.token, SECRET) as any).username; } catch { throw Error('Unauthorized'); } }
  private userRoom(username: string) { return `user:${username.toLowerCase()}`; }
  handleConnection(client: Socket) { try { const username = this.userFor(client); client.data.username = username; client.join(this.userRoom(username)); } catch { client.disconnect(true); } }
  handleDisconnect(client: Socket) {
    for (const [id, call] of this.calls) if (call.callerSocket === client.id || call.calleeSocket === client.id) {
      const peer = call.callerSocket === client.id ? call.calleeSocket : call.callerSocket;
      if (peer) this.server.to(peer).emit('call-ended', { callId: id, reason: 'Connection lost' }); this.calls.delete(id);
    }
  }
  @SubscribeMessage('join-channel') joinChannel(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { this.userFor(client); const channel = store.communities.find(s => s.id === data?.serverId)?.channels.find(c => c.id === data?.channelId); if (!channel) return { error: 'Channel not found.' }; for (const r of client.rooms) if (r.startsWith('channel:')) client.leave(r); client.join(`channel:${data.serverId}:${data.channelId}`); return { messages: channel.messages.slice(-100) }; }
    catch { return { error: 'Unauthorized' }; }
  }
  @SubscribeMessage('chat-message') sendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { const username = this.userFor(client), channel = store.communities.find(s => s.id === data?.serverId)?.channels.find(c => c.id === data?.channelId), text = String(data?.text || '').trim(); if (!channel || !text || text.length > 2000) return; const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() }; channel.messages.push(message); if (channel.messages.length > 500) channel.messages.shift(); save(); this.server.to(`channel:${data.serverId}:${data.channelId}`).emit('chat-message', message); }
    catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }
  @SubscribeMessage('join-dm') joinDm(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { const username = this.userFor(client), dm = store.directMessages.find(d => d.id === data?.dmId && d.participants.some(p => p.toLowerCase() === username.toLowerCase())); if (!dm) return { error: 'Conversation not found.' }; for (const r of client.rooms) if (r.startsWith('dm:')) client.leave(r); client.join(`dm:${dm.id}`); return { messages: dm.messages.slice(-100) }; }
    catch { return { error: 'Unauthorized' }; }
  }
  @SubscribeMessage('dm-message') sendDm(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { const username = this.userFor(client), dm = store.directMessages.find(d => d.id === data?.dmId && d.participants.some(p => p.toLowerCase() === username.toLowerCase())), text = String(data?.text || '').trim(); if (!dm || !text || text.length > 2000) return; const message = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() }; dm.messages.push(message); if (dm.messages.length > 500) dm.messages.shift(); save(); this.server.to(`dm:${dm.id}`).emit('dm-message', { dmId: dm.id, message }); for (const p of dm.participants) if (p.toLowerCase() !== username.toLowerCase()) this.server.to(this.userRoom(p)).emit('dm-notification', { dmId: dm.id, username }); }
    catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }
  @SubscribeMessage('call-start') startCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try { const caller = this.userFor(client), target = store.users.find(u => u.username.toLowerCase() === String(data?.username || '').toLowerCase()); if (!target || target.username.toLowerCase() === caller.toLowerCase()) return { error: 'That user is not available.' }; if ([...this.calls.values()].some(c => c.caller.toLowerCase() === target.username.toLowerCase() || c.callee.toLowerCase() === target.username.toLowerCase())) return { error: 'That person is already on a call.' }; const call: Call = { id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, caller, callee: target.username, callerSocket: client.id, accepted: false }; this.calls.set(call.id, call); this.server.to(this.userRoom(target.username)).emit('incoming-call', { callId: call.id, from: caller }); return { callId: call.id }; }
    catch { return { error: 'Please sign in again.' }; }
  }
  @SubscribeMessage('call-accept') acceptCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) { const c = this.calls.get(data?.callId); if (!c || c.accepted || c.callee.toLowerCase() !== String(client.data.username || '').toLowerCase()) return { error: 'Call is no longer available.' }; c.accepted = true; c.calleeSocket = client.id; this.server.to(c.callerSocket).emit('call-accepted', { callId: c.id, peerSocket: client.id, peer: c.callee }); return { ok: true, peerSocket: c.callerSocket }; }
  @SubscribeMessage('call-decline') declineCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) { const c = this.calls.get(data?.callId); if (!c || c.callee.toLowerCase() !== String(client.data.username || '').toLowerCase()) return; this.server.to(c.callerSocket).emit('call-declined', { callId: c.id }); this.calls.delete(c.id); }
  @SubscribeMessage('call-signal') signalCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) { const c = this.calls.get(data?.callId); if (!c?.accepted || (client.id !== c.callerSocket && client.id !== c.calleeSocket)) return; const peer = client.id === c.callerSocket ? c.calleeSocket : c.callerSocket; if (peer) this.server.to(peer).emit('call-signal', { callId: c.id, signal: data.signal }); }
  @SubscribeMessage('call-end') endCall(@ConnectedSocket() client: Socket, @MessageBody() data: any) { const c = this.calls.get(data?.callId); if (!c || (client.id !== c.callerSocket && client.id !== c.calleeSocket)) return; const peer = client.id === c.callerSocket ? c.calleeSocket : c.callerSocket; if (peer) this.server.to(peer).emit('call-ended', { callId: c.id, reason: 'Call ended' }); this.calls.delete(c.id); }
}
