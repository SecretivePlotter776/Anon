(() => {
  const peopleList = document.querySelector('#peopleList');
  if (!peopleList) return;

  const sectionLabel = peopleList.previousElementSibling;
  if (sectionLabel?.classList.contains('section-label')) {
    sectionLabel.firstChild.textContent = 'ALL USERS ';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = '↻';
    refresh.title = 'Refresh user list';
    refresh.setAttribute('aria-label', 'Refresh user list');
    Object.assign(refresh.style, { float: 'right', background: 'none', border: '0', color: 'var(--accent)', fontSize: '16px', padding: '0 8px' });
    refresh.addEventListener('click', () => refreshUsers());
    sectionLabel.appendChild(refresh);
  }

  const previousRender = window.renderPeople;
  if (typeof previousRender === 'function') {
    window.renderPeople = function () {
      previousRender();
      addCurrentUser();
    };
  }

  function addCurrentUser() {
    if (!peopleList || !window.username) return;
    peopleList.querySelector('.current-user')?.remove();
    const row = document.createElement('div');
    row.className = 'person current-user';
    row.setAttribute('aria-label', `${window.username} (you)`);
    row.style.cursor = 'default';
    row.innerHTML = `<span class="mini">${escapeHtml(window.username[0].toUpperCase())}</span>${escapeHtml(window.username)} <span style="color:var(--muted);font-size:10px">(you)</span>`;
    peopleList.prepend(row);
  }

  async function refreshUsers() {
    if (!window.token || typeof window.api !== 'function') return;
    try {
      const result = await window.api('/users');
      window.users = Array.isArray(result.users) ? result.users : [];
      if (typeof window.renderPeople === 'function') window.renderPeople();
    } catch (error) {
      if (error?.message) console.warn('Could not refresh the user list:', error.message);
    }
  }

  window.refreshUsers = refreshUsers;
  refreshUsers();
  window.setInterval(refreshUsers, 15000);
  window.addEventListener('focus', refreshUsers);
})();
