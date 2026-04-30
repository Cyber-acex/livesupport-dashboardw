async function fetchUsers() {
  const res = await fetch('/api/admin/users');
  if (res.status === 401) return location.href = '/login.html';
  if (res.status === 403) return document.body.innerHTML = '<h2>Access denied</h2>';
  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    document.getElementById('usersList').textContent = 'Failed to parse server response';
    return;
  }
  if (!Array.isArray(payload)) {
    // server returned error object
    const msg = payload && (payload.message || payload.error || JSON.stringify(payload)) || 'Unknown error';
    const el = document.getElementById('usersList');
    if (el) el.innerHTML = `<div style="color:#b91c1c">Failed to load users: ${escapeHtml(String(msg))}</div>`;
    return;
  }
  renderUsers(payload);
}

function renderUsers(users) {
  const container = document.getElementById('usersList');
  if (!container) return;
  container.innerHTML = '';
  const table = document.createElement('table');
  table.style.width = '100%';
  table.innerHTML = '<tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Disabled</th><th>Actions</th></tr>';
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.id}</td><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td><select data-id="${u.id}" class="roleSel"><option value="agent">agent</option><option value="admin">admin</option></select></td><td>${u.active ? '<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:#10b981;border-radius:50%;display:inline-block;"></span><small style="color:#065f46">Active</small></span>' : '<small style="color:#6b7280">Offline</small>'}</td><td><input type="checkbox" data-id="${u.id}" class="disabledChk" ${u.disabled ? 'checked' : ''} /></td><td></td>`;
    const actionsTd = tr.querySelector('td:last-child');

    const saveBtn = document.createElement('button'); saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
      const role = tr.querySelector('.roleSel').value;
      const disabled = tr.querySelector('.disabledChk').checked ? 1 : 0;
      await fetch('/api/admin/users/' + u.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role, disabled }) });
      fetchUsers();
    };

    const resetBtn = document.createElement('button'); resetBtn.textContent = 'Reset PW';
    resetBtn.onclick = async () => {
      const r = await fetch('/api/admin/users/' + u.id + '/reset-password', { method: 'POST' });
      const data = await r.json();
      if (data && data.password) alert('New password: ' + data.password);
    };

    const logoutBtn = document.createElement('button'); logoutBtn.textContent = 'Force Logout';
    logoutBtn.onclick = async () => {
      await fetch('/api/admin/users/' + u.id + '/force-logout', { method: 'POST' });
      alert('Force logout requested');
    };

    const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      if (!confirm('Delete user ' + u.name + '?')) return;
      await fetch('/api/admin/users/' + u.id, { method: 'DELETE' });
      fetchUsers();
    };

    actionsTd.appendChild(saveBtn);
    actionsTd.appendChild(resetBtn);
    actionsTd.appendChild(logoutBtn);
    actionsTd.appendChild(delBtn);

    table.appendChild(tr);
  });
  container.appendChild(table);

  // set roles selects after table inserted
  container.querySelectorAll('.roleSel').forEach(sel => {
    const id = sel.dataset.id;
    const user = users.find(u=>String(u.id)===String(id));
    if (user) sel.value = user.role || 'agent';
  });
}

function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Attach handlers after DOM is ready to ensure elements exist
window.addEventListener('DOMContentLoaded', () => {
  // Create button
  const _createBtn = document.getElementById('createBtn');
  if (_createBtn) {
    _createBtn.addEventListener('click', async () => {
      const name = document.getElementById('newName').value;
      const email = document.getElementById('newEmail').value;
      const password = document.getElementById('newPass').value;
      const role = document.getElementById('newRole').value;
      if (!email || !password) {
        const msgEl = document.getElementById('createMsg');
        if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#b91c1c'; msgEl.textContent = 'Email and password required'; setTimeout(()=>{ msgEl.style.display='none'; }, 4000); }
        return;
      }
      try {
        const res = await fetch('/api/admin/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, email, password, role }) });
        if (!res.ok) {
          const err = await res.json().catch(()=>({}));
          const msgEl = document.getElementById('createMsg');
          const msgText = err.message || err.details || err.error || res.statusText || res.status;
          if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#b91c1c'; msgEl.textContent = 'Failed: ' + msgText; setTimeout(()=>{ msgEl.style.display='none'; }, 6000); }
          return;
        }
        const data = await res.json().catch(()=>null);
        const nameEl = document.getElementById('newName'); const emailEl = document.getElementById('newEmail'); const passEl = document.getElementById('newPass');
        if (nameEl) nameEl.value = '';
        if (emailEl) emailEl.value = '';
        if (passEl) passEl.value = '';
        fetchUsers();
        const msgEl = document.getElementById('createMsg');
        if (msgEl) {
          msgEl.style.display = 'block';
          msgEl.style.color = '#065f46';
          msgEl.textContent = 'User created' + (data && data.id ? ' (id: ' + data.id + ')' : '');
          setTimeout(()=>{ msgEl.style.display='none'; }, 4000);
        }
      } catch (e) {
        console.error('Create user error', e);
        const msgEl = document.getElementById('createMsg');
        if (msgEl) { msgEl.style.display='block'; msgEl.style.color = '#b91c1c'; msgEl.textContent = 'Failed to create user'; setTimeout(()=>{ msgEl.style.display='none'; }, 4000); }
      }
    });
  }

  // initial load
  try { fetchUsers(); } catch (e) { console.warn('fetchUsers failed at DOMContentLoaded', e); }

  // Setup Socket.IO to refresh list when users change or presence updates
  try {
    if (typeof io !== 'undefined') {
      const socket = io();
      socket.on('admin:users:changed', (info) => {
        console.log('admin:users:changed', info || '');
        try { fetchUsers(); } catch (e) {}
      });
      socket.on('presenceUpdate', (list) => {
        // presence changed — refresh so active flags update
        try { fetchUsers(); } catch (e) {}
      });
    }
  } catch (e) { console.warn('Socket.IO not available for admin users:', e); }
});
