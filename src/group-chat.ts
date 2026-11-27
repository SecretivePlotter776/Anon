import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const GROUPS_FILE = join(DATA_DIR, 'groups.json');
type GroupMessage = { id: string; username: string; text: string; time: number };
type Group = { id: string; name: string; members: string[]; messages: GroupMessage[] };
type GroupStore = { groups: Group[] };
function loadGroups(): GroupStore {
  try { if (existsSync(GROUPS_FILE)) { const data = JSON.parse(readFileSync(GROUPS_FILE, 'utf8')); return { groups: Array.isArray(data.groups) ? data.groups : [] }; } }
  catch { /* Recover with an empty store if the data file is malformed. */ }
  return { groups: [] };
}
const state = loadGroups();
function saveGroups() { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(GROUPS_FILE, JSON.stringify(state, null, 2)); }
function usernameFromToken(header?: string): string {
  try { if (!header?.startsWith('Bearer ')) throw Error(); return (jwt.verify(header.slice(7), SECRET) as any).username; }
  catch { throw new UnauthorizedException('Please sign in again.'); }
}
function isMember(group: Group, username: string) { return group.members.some(member => member.toLowerCase() === username.toLowerCase()); }

@Controller('api/groups')
export class GroupChatController {
  @Get() list(@Headers('authorization') auth: string) {
    const username = usernameFromToken(auth);
    return { groups: state.groups.filter(group => isMember(group, username)).map(group => ({ id: group.id, name: group.name, members: group.members, lastMessage: group.messages[group.messages.length - 1] || null })) };
  }
  @Post() create(@Headers('authorization') auth: string, @Body() body: any) {
    const username = usernameFromToken(auth);
    const name = String(body?.name || '').trim().slice(0, 40);
    if (name.length < 2) throw new BadRequestException('Group name must be at least 2 characters.');
    const requested = Array.isArray(body?.members) ? body.members : [];
    if (requested.length > 49) throw new BadRequestException('A group can have at most 50 members.');
    const allUsers = new Map<string, string>();
    try {
      const usersFile = join(DATA_DIR, 'anon.json');
      if (existsSync(usersFile)) {
        const usersData = JSON.parse(readFileSync(usersFile, 'utf8'));
        for (const user of (Array.isArray(usersData.users) ? usersData.users : [])) if (user?.username) allUsers.set(user.username.toLowerCase(), user.username);
      }
    } catch { /* Invalid/missing account storage simply makes requested users unavailable. */ }
    const members = new Set<string>([username]);
    for (const value of requested) {
      const key = String(value || '').trim().toLowerCase();
      const found = allUsers.get(key);
      if (!found) throw new BadRequestException(`User "${String(value).slice(0, 30)}" was not found.`);
      members.add(found);
    }
    if (members.size < 2) throw new BadRequestException('Add at least one other registered user.');
    const group: Group = { id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, members: [...members], messages: [] };
    state.groups.push(group); saveGroups();
    return { group: { id: group.id, name: group.name, members: group.members, lastMessage: null } };
  }
}

@WebSocketGateway({ cors: { origin: true }, namespace: '/' })
export class GroupChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private userFor(client: Socket): string { try { return (jwt.verify(client.handshake.auth?.token, SECRET) as any).username; } catch { throw Error('Unauthorized'); } }
  private room(id: string) { return `group:${id}`; }
  handleConnection(client: Socket) {
    try {
      const username = this.userFor(client);
      for (const group of state.groups) if (isMember(group, username)) client.join(this.room(group.id));
    } catch { /* The main chat gateway handles disconnecting unauthenticated sockets. */ }
  }
  @SubscribeMessage('join-group') joinGroup(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client), group = state.groups.find(item => item.id === data?.groupId && isMember(item, username));
      if (!group) return { error: 'Group not found.' };
      client.join(this.room(group.id));
      return { messages: group.messages.slice(-100), group: { id: group.id, name: group.name, members: group.members } };
    } catch { return { error: 'Unauthorized' }; }
  }
  @SubscribeMessage('group-message') sendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const username = this.userFor(client), group = state.groups.find(item => item.id === data?.groupId && isMember(item, username));
      const text = String(data?.text || '').trim();
      if (!group || !text || text.length > 2000) return;
      const message: GroupMessage = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, text, time: Date.now() };
      group.messages.push(message);
      if (group.messages.length > 500) group.messages.shift();
      saveGroups();
      this.server.to(this.room(group.id)).emit('group-message', { groupId: group.id, message });
    } catch { client.emit('app-error', 'Your session expired. Please sign in again.'); }
  }
}
