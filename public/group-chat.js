(() => {
  const baseIo = window.io;
  if (typeof baseIo !== 'function') return;
  let groups = [], activeGroup = null, activeSocket = null;
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('anon-token') || ''}`, 'Content-Type': 'application/json' });
  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, { ...options, headers: { ...auth(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Could not complete the request.');
    return data;
  }
  function toast(message) {
    const element = document.querySelector('#toast');
    if (element) { element.textContent = message; element.style.display = 'block'; setTimeout(() => { element.style.display = 'none'; }, 3200); }
  }
  function currentUsername() { return localStorage.getItem('anon-user') || 'you'; }
  function addMessage(message) {
    const body = document.querySelector('#chatBody');
    if (!body || !message?.text) return;
    const row = document.createElement('div'); row.className = 'message';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = (message.username || '?')[0].toUpperCase();
    const content = document.createElement('div'), meta = document.createElement('div'); meta.className = 'msg-meta'; meta.textContent = message.username || 'Unknown';
    const time = document.createElement('time'); time.textContent = new Date(message.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); meta.appendChild(time);
    const text = document.createElement('div'); text.className = 'msg-text'; text.textContent = message.text;
    content.append(meta, text); row.append(avatar, content); body.appendChild(row); body.scrollTop = body.scrollHeight;
  }
  function openGroup(group) {
    activeGroup = group;
    document.querySelector('#appView')?.classList.remove('mobile-panel');
    document.querySelector('#chatTitle').textContent = group.name;
    document.querySelector('#chatSubtitle').textContent = `Group chat · ${group.members.length} members`;
    document.querySelector('#messageInput').disabled = false;
    document.querySelector('#messageInput').placeholder = `Message ${group.name}`;
    document.querySelector('#headActions').innerHTML = '';
    const body = document.querySelector('#chatBody');
    body.innerHTML = `<div class="welcome"><div class="orb">✦</div><h2>${esc(group.name)}</h2><p>${group.members.length} members: ${group.members.map(esc).join(', ')}</p></div>`;
    if (activeSocket?.connected) activeSocket.emit('join-group', { groupId: group.id }, result => {
      if (result?.error) { toast(result.error); return; }
      if (activeGroup?.id === group.id) { body.innerHTML = `<div class="welcome"><div class="orb">✦</div><h2>${esc(group.name)}</h2><p>${group.members.length} members: ${group.members.map(esc).join(', ')}</p></div>`; (result.messages || []).forEach(addMessage); }
    });
    document.querySelectorAll('.group-chat-item').forEach(button => button.classList.toggle('active', button.dataset.groupId === group.id));
  }
  async function refreshGroups() {
    if (!localStorage.getItem('anon-token')) return;
    try {
      const result = await api('/groups'); groups = result.groups || [];
      const list = document.querySelector('#groupChatList'); if (!list) return;
      list.innerHTML = '';
      if (!groups.length) { const empty = document.createElement('div'); empty.textContent = 'No group chats yet.'; empty.style.cssText = 'padding:8px 14px;color:var(--muted);font-size:12px'; list.appendChild(empty); }
      groups.forEach(group => {
        const button = document.createElement('button'); button.className = 'person group-chat-item'; button.dataset.groupId = group.id;
        button.innerHTML = `<span class="mini">✦</span>${esc(group.name)} <span style="color:var(--muted);font-size:10px">${group.members.length}</span>`;
        button.onclick = () => openGroup(group); list.appendChild(button);
      });
      if (activeGroup) { const updated = groups.find(group => group.id === activeGroup.id); if (updated) activeGroup = updated; }
    } catch (error) { console.warn('Could not load group chats:', error.message); }
  }
  function createGroupSection() {
    const dmList = document.querySelector('#dmList'); if (!dmList || document.querySelector('#groupChatSection')) return;
    const section = document.createElement('div'); section.id = 'groupChatSection'; section.innerHTML = `<div class="section-label" style="display:flex;justify-content:space-between;align-items:center">GROUP CHATS <button id="createGroupChat" title="Create group chat" aria-label="Create group chat" style="background:none;border:0;color:var(--accent);font-size:18px;padding:0 8px">＋</button></div><div id="groupChatList"></div>`;
    dmList.after(section);
    document.querySelector('#createGroupChat').onclick = async () => {
      const name = window.prompt('Name your group chat:'); if (!name?.trim()) return;
      const names = window.prompt('Enter other registered usernames, separated by commas:'); if (!names?.trim()) { toast('Add at least one other user.'); return; }
      try {
        const result = await api('/groups', { method: 'POST', body: JSON.stringify({ name: name.trim(), members: names.split(',').map(value => value.trim()).filter(Boolean) }) });
        await refreshGroups(); const created = groups.find(group => group.id === result.group.id) || result.group; openGroup(created);
      } catch (error) { toast(error.message); }
    };
  }
  // Wrap the existing Socket.IO factory so group events share the authenticated connection.
  const wrappedIo = function (...args) {
    const socket = baseIo.apply(this, args); activeSocket = socket;
    socket.on('connect', () => { if (activeGroup) socket.emit('join-group', { groupId: activeGroup.id }, result => { if (!result?.error && activeGroup) { const body = document.querySelector('#chatBody'); if (body && document.querySelector('#chatTitle')?.textContent === activeGroup.name) { body.innerHTML = `<div class="welcome"><div class="orb">✦</div><h2>${esc(activeGroup.name)}</h2><p>${activeGroup.members.length} members: ${activeGroup.members.map(esc).join(', ')}</p></div>`; (result.messages || []).forEach(addMessage); } } }); });
    socket.on('group-message', data => { if (activeGroup?.id === data?.groupId) addMessage(data.message); refreshGroups(); });
    return socket;
  };
  Object.assign(wrappedIo, baseIo); window.io = wrappedIo;
  document.addEventListener('DOMContentLoaded', () => { createGroupSection(); refreshGroups(); setInterval(refreshGroups, 20000); });
  // Intercept the existing composer only while a group chat is selected.
  document.querySelector('#messageForm')?.addEventListener('submit', event => {
    if (!activeGroup) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const input = document.querySelector('#messageInput'), text = input.value.trim();
    if (!text || !activeSocket?.connected) { if (text) toast('Connecting… try again in a moment.'); return; }
    activeSocket.emit('group-message', { groupId: activeGroup.id, text }); input.value = '';
  }, true);
})();
