document.addEventListener('DOMContentLoaded', ()=>{
  // animate counters
  const counters = document.querySelectorAll('.value[data-target]');
  counters.forEach(el=>{
    const target = parseFloat(el.getAttribute('data-target'));
    const isFloat = String(target).includes('.')
    const steps = 36;
    let cur = 0;
    const increment = target/steps;
    const iv = setInterval(()=>{
      cur += increment;
      if(cur >= target - 0.0001){
        el.textContent = isFloat ? target.toFixed(1) : Math.round(target);
        clearInterval(iv);
      } else {
        el.textContent = isFloat ? cur.toFixed(1) : Math.round(cur);
      }
    }, 18);
  });

  // inbox button
  const openBtn = document.getElementById('openInbox');
  if(openBtn){
    openBtn.addEventListener('click', ()=>{
      window.location.href = 'inbox.html';
    });
  }
  // topnav Inbox link
  const openNavLink = document.getElementById('openInboxNav');
  if(openNavLink){
    openNavLink.addEventListener('click', (e)=>{
      e.preventDefault();
      window.location.href = 'inbox.html';
    });
  }

  // live clock
  const clock = document.getElementById('clock');
  function updateClock(){
    if(!clock) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    clock.textContent = `${hh}:${mm}`;
  }
  updateClock();
  setInterval(updateClock, 1000);

  function getSharedNotifications(limit = 5) {
    try {
      return JSON.parse(localStorage.getItem('liveSupportNotifications') || '[]').slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  function saveSharedNotification(message, source = 'System', type = 'general') {
    try {
      const key = 'liveSupportNotifications';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({ message, source, type, time: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
    } catch (e) {
      console.error('Shared notification save failed', e);
    }
  }

  const notifBtn = document.getElementById('notifBtn');
  if(notifBtn){
    const popup = document.createElement('div');
    popup.className = 'notif-popup';
    const notifications = getSharedNotifications(5);
    let notifContent = '<strong>Notifications</strong><ul><li>No recent notifications</li></ul>';
    if (notifications.length) {
      notifContent = '<strong>Notifications</strong><ul>' + notifications.map(n => {
        const time = n.time ? new Date(n.time).toLocaleString() : '';
        const label = n.source ? `<strong>${escapeHtml(n.source)}:</strong> ` : '';
        const timeMarkup = time ? `<br><small>${escapeHtml(time)}</small>` : '';
        return `<li>${label}${escapeHtml(n.message)}${timeMarkup}</li>`;
      }).join('') + '</ul>';
    }
    popup.innerHTML = notifContent;
    document.body.appendChild(popup);
    notifBtn.addEventListener('click', (e)=>{
      const notifications = getSharedNotifications(5);
      let content = '<strong>Notifications</strong><ul><li>No recent notifications</li></ul>';
      if (notifications.length) {
        content = '<strong>Notifications</strong><ul>' + notifications.map(n => {
          const time = n.time ? new Date(n.time).toLocaleString() : '';
          const label = n.source ? `<strong>${escapeHtml(n.source)}:</strong> ` : '';
          const timeMarkup = time ? `<br><small>${escapeHtml(time)}</small>` : '';
          return `<li>${label}${escapeHtml(n.message)}${timeMarkup}</li>`;
        }).join('') + '</ul>';
      }
      popup.innerHTML = content;
      popup.style.right = '24px';
      popup.style.top = (notifBtn.getBoundingClientRect().bottom + 8) + 'px';
      popup.classList.toggle('show');
    });
    document.addEventListener('click', (ev)=>{
      if(!notifBtn.contains(ev.target) && !popup.contains(ev.target)) popup.classList.remove('show');
    });
  }

  // search filter for tickets & activity
  const search = document.getElementById('searchInput');
  if(search){
    search.addEventListener('input', ()=>{
      const q = search.value.toLowerCase();
      // filter activity
      document.querySelectorAll('#activityList li').forEach(li=>{
        li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      // filter tickets
      document.querySelectorAll('#ticketsTable tbody tr').forEach(tr=>{
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  // simple theme toggle (light/dark)
  const themeToggle = document.getElementById('themeToggle');
  if(themeToggle){
    themeToggle.addEventListener('click', ()=>{
      document.documentElement.classList.toggle('light');
      const isLight = document.documentElement.classList.contains('light');
      themeToggle.textContent = isLight ? 'Dark' : 'Light';
    });
  }

  // load recent tickets from tickets table (show last 4 created)
  async function loadRecentTickets(){
    try{
      const res = await fetch('/api/recent-tickets-tickets');
      if(!res.ok) throw new Error('Network');
      const data = await res.json();
      const tbody = document.querySelector('#ticketsTable tbody');
      if(!tbody) return;
      tbody.innerHTML = '';
      data.forEach(t => {
        const tr = document.createElement('tr');
        const snippet = t.snippet ? String(t.snippet).slice(0,80) : '';
        tr.innerHTML = `<td>#${t.id}</td><td>${escapeHtml(t.subject||'(No subject)')}<div class="muted">${escapeHtml(snippet)}</div></td><td>${escapeHtml(t.assignee||'')}</td><td>${escapeHtml(t.status||'Open')}</td><td><a class="btn" href="tickets.html">View</a></td>`;
        tbody.appendChild(tr);
      });
    }catch(err){
      console.error('Failed loading recent tickets', err);
    }
  }
  loadRecentTickets();

  // live-update recent tickets via Socket.IO
  function initDashboardSocket() {
    try{
      const socket = io();
      socket.on && socket.on('ticketCreated', (t) => {
        loadRecentTickets();
        try { saveSharedNotification(`Ticket #${t.id} created successfully!`, 'Ticket', 'ticket'); } catch (e) {}
      });
      socket.on && socket.on('ticketDeleted', (d) => {
        loadRecentTickets();
        try { saveSharedNotification(`Ticket #${d.id} deleted.`, 'Ticket', 'ticket'); } catch (e) {}
      });
      socket.on && socket.on('ticketResolved', (d) => {
        loadRecentTickets();
        const msg = d.resolved_by ? `Ticket #${d.ticket_id} resolved by ${d.resolved_by}` : `Ticket #${d.ticket_id} marked resolved`;
        try { saveSharedNotification(msg, 'Ticket', 'ticket'); } catch (e) {}
      });
      socket.on && socket.on('ticketEscalated', (d) => {
        loadRecentTickets();
        try { saveSharedNotification(`Ticket #${d.ticket_id} escalated!`, 'Ticket', 'ticket'); } catch (e) {}
      });

      socket.on && socket.on('newMessage', (m) => {
        try{
          const sender = (m && m.sender) ? String(m.sender).toLowerCase() : '';
          if(sender === 'sent') return;
          loadRecentMessages();
          if (m && m.message) saveSharedNotification(m.message, 'Inbox', 'message');
        }catch(e){}
      });
    }catch(e){
      // Socket.IO not available or connection failed; ignore silently
    }
  }

  if(typeof io === 'undefined'){
    const iv = setInterval(()=>{ if(typeof io !== 'undefined'){ clearInterval(iv); initDashboardSocket(); } }, 200);
    document.addEventListener('DOMContentLoaded', ()=>{ if(typeof io !== 'undefined') initDashboardSocket(); });
  } else {
    initDashboardSocket();
  }

  // load recent customer messages (last 5)
  async function loadRecentMessages(){
    try{
      const res = await fetch('/api/recent-messages?limit=5');
      if(!res.ok) throw new Error('Network');
      const data = await res.json();
      const ul = document.getElementById('recentMessagesList');
      if(!ul) return;
      ul.innerHTML = '';
      if(!data || data.length === 0){
        ul.innerHTML = '<li class="muted">No recent messages</li>';
        return;
      }
      data.forEach(m => {
        const li = document.createElement('li');
        const name = m.customer_name || m.phone || 'Customer';
        const snippet = m.message ? String(m.message).slice(0,120) : '';
        const time = m.created_at ? new Date(m.created_at).toLocaleString() : '';
        li.innerHTML = `
          <div class="avatar">${escapeHtml((name||'C').charAt(0).toUpperCase())}</div>
          <div class="message-content">
            <strong>${escapeHtml(name)}</strong>
            <div class="message-snippet muted">${escapeHtml(snippet)}</div>
          </div>
          <div class="message-time">${escapeHtml(time)}</div>
        `;
        li.style.cursor = 'pointer';
        li.setAttribute('role','button');
        li.addEventListener('click', ()=>{
          if(m.conversation_id) window.location.href = `inbox.html?conversation_id=${m.conversation_id}`;
        });
        ul.appendChild(li);
      });
    }catch(err){
      console.error('Failed loading recent messages', err);
    }
  }
  loadRecentMessages();

  // simple helper to avoid HTML injection when inserting text
  function escapeHtml(str){
    return String(str).replace(/[&<>"'`]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;","`":"&#96;"})[s]);
  }

  // Profile dropdown: load staff name from settings (fallback to /api/user)
  async function initProfile(){
    const profileNameEl = document.getElementById('profileName');
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const logoutBtn = document.getElementById('logoutBtn');
    const avatarSm = document.querySelector('.avatar-sm');
    const avatarImg = document.querySelector('.avatar-sm-img');
    if(!profileBtn || !profileDropdown) return;
    try{
      let displayName = null;
      const sres = await fetch('/api/settings');
      if(sres.ok){
        const settings = await sres.json();
        if(settings && settings.displayName) displayName = settings.displayName;
        // try common image fields
        var profileImage = settings && (settings.image_url || settings.avatar_url || settings.avatar || settings.profile_image || settings.avatarUrl || settings.imageUrl) ? (settings.image_url || settings.avatar_url || settings.avatar || settings.profile_image || settings.avatarUrl || settings.imageUrl) : null;
      }
      if(!displayName){
        const ures = await fetch('/api/user');
        if(ures.ok){
          const user = await ures.json();
          displayName = user && (user.name || user.displayName) ? (user.name || user.displayName) : null;
          // try user avatar fields as fallback
          if(!profileImage) profileImage = user && (user.avatar || user.image || user.avatar_url || user.image_url) ? (user.avatar || user.image || user.avatar_url || user.image_url) : null;
        }
      }
      displayName = displayName || 'Staff';
      if(profileNameEl) profileNameEl.textContent = displayName;
      if(avatarSm) avatarSm.textContent = (displayName || 'S').charAt(0).toUpperCase();
      // default: show initials
      if(avatarSm) avatarSm.style.display = '';
      if(avatarImg) avatarImg.style.display = 'none';

      if(profileImage && avatarImg){
        try{
          let src = String(profileImage || '').trim();
          if(src && src.charAt(0) === '/') src = (window.location.origin || '') + src;
          // set image and show it; on error revert to initials
          avatarImg.src = src;
          avatarImg.style.display = 'inline-block';
          avatarImg.onload = function(){ if(avatarSm) avatarSm.style.display = 'none'; };
          avatarImg.onerror = function(){ avatarImg.style.display = 'none'; if(avatarSm) avatarSm.style.display = ''; };
        }catch(e){
          console.error('profile image set error', e);
        }
      }
    }catch(e){
      console.error('Failed to load profile name', e);
    }

    profileBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const isOpen = profileDropdown.classList.toggle('show');
      profileBtn.setAttribute('aria-expanded', String(!!isOpen));
    });
    document.addEventListener('click', (ev)=>{
      if(!profileBtn.contains(ev.target) && !profileDropdown.contains(ev.target)){
        profileDropdown.classList.remove('show');
        profileBtn.setAttribute('aria-expanded','false');
      }
    });

    // Status Toggle Functionality
    const statusBtns = profileDropdown.querySelectorAll('.status-btn');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusDot = statusIndicator?.querySelector('.status-dot');
    const statusText = statusIndicator?.querySelector('.status-text');

    function updateStatusDisplay(status) {
      // Update indicator
      if (statusIndicator && statusDot && statusText) {
        statusDot.className = `status-dot ${status}`;
        statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      }

      // Update mini status indicator on profile button
      const profileStatusMini = document.getElementById('profileStatusMini');
      const statusDotMini = profileStatusMini?.querySelector('.status-dot-mini');
      if (statusDotMini) {
        statusDotMini.className = `status-dot-mini ${status}`;
      }

      // Update active button
      statusBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === status);
      });

      // Store status
      localStorage.setItem('userStatus', status);
    }

    // Initialize status from localStorage or default to online
    const initialStatus = localStorage.getItem('userStatus') || 'online';
    updateStatusDisplay(initialStatus);

    // Add click handlers for status buttons
    statusBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const newStatus = btn.dataset.status;
        updateStatusDisplay(newStatus);
      });
    });

    // Session Info Functionality
    function updateSessionInfo() {
      const loginTimeEl = document.getElementById('loginTime');
      const sessionDurationEl = document.getElementById('sessionDuration');
      const lastActivityEl = document.getElementById('lastActivity');

      if (!loginTimeEl || !sessionDurationEl || !lastActivityEl) return;

      // Get or set login time
      let loginTime = localStorage.getItem('loginTime');
      if (!loginTime) {
        loginTime = new Date().toISOString();
        localStorage.setItem('loginTime', loginTime);
      }

      const loginDate = new Date(loginTime);
      const now = new Date();

      // Format login time
      const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
      loginTimeEl.textContent = loginDate.toLocaleTimeString([], timeOptions);

      // Calculate session duration
      const durationMs = now - loginDate;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      sessionDurationEl.textContent = `${hours}h ${minutes}m`;

      // Update last activity (simulate with current time for now)
      const lastActivity = localStorage.getItem('lastActivity') || loginTime;
      const lastActivityDate = new Date(lastActivity);
      const timeSince = now - lastActivityDate;
      const minutesSince = Math.floor(timeSince / (1000 * 60));

      if (minutesSince < 1) {
        lastActivityEl.textContent = 'Just now';
      } else if (minutesSince < 60) {
        lastActivityEl.textContent = `${minutesSince}m ago`;
      } else {
        const hoursSince = Math.floor(minutesSince / 60);
        lastActivityEl.textContent = `${hoursSince}h ago`;
      }
    }

    // Update session info immediately and set interval
    updateSessionInfo();
    setInterval(updateSessionInfo, 60000); // Update every minute

    // Update last activity on user interactions
    function updateLastActivity() {
      localStorage.setItem('lastActivity', new Date().toISOString());
    }

    // Track user activity
    ['click', 'keydown', 'scroll', 'mousemove'].forEach(event => {
      document.addEventListener(event, updateLastActivity, { passive: true });
    });

    if(logoutBtn){
      logoutBtn.addEventListener('click', (ev)=>{
        ev.preventDefault();
        const ok = confirm('Are you sure you want to log out?');
        if(ok){
          window.location.href = '/logout';
        }
      });
    }
  }
  initProfile();

  // --- Messages chart: AI vs Staff over last 7 days ---
  function initMessagesChart(){
    const canvas = document.getElementById('messagesChart');
    if(!canvas) return;

    const defaultLabels = ['1d','2d','3d','4d','5d','6d','7d'];
    const ctx = canvas.getContext('2d');
    // create subtle vertical gradients for area fills
    const gradAI = ctx.createLinearGradient(0, 0, 0, 320);
    gradAI.addColorStop(0, 'rgba(22,163,74,0.28)');
    gradAI.addColorStop(1, 'rgba(22,163,74,0.04)');
    const gradStaff = ctx.createLinearGradient(0, 0, 0, 320);
    gradStaff.addColorStop(0, 'rgba(37,99,235,0.26)');
    gradStaff.addColorStop(1, 'rgba(37,99,235,0.04)');

    const cfg = {
      type: 'line',
      data: {
        labels: defaultLabels.slice(),
        datasets: [
          {
            label: 'AI',
            data: [0,0,0,0,0,0,0],
            borderColor: '#16a34a',
            backgroundColor: gradAI,
            fill: true,
            cubicInterpolationMode: 'monotone',
            tension: 0.4,
            pointRadius:4,
            pointBackgroundColor: '#16a34a',
            pointBorderColor: '#07201a',
            pointHoverRadius:8,
            pointHoverBorderWidth:2,
            borderWidth:2
          },
          {
            label: 'Staff',
            data: [0,0,0,0,0,0,0],
            borderColor: '#2563eb',
            backgroundColor: gradStaff,
            fill: true,
            cubicInterpolationMode: 'monotone',
            tension: 0.4,
            pointRadius:4,
            pointBackgroundColor: '#2563eb',
            pointBorderColor: '#07203a',
            pointHoverRadius:8,
            pointHoverBorderWidth:2,
            borderWidth:2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: true },
        hover: { mode: 'nearest', intersect: true },
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,0.9)' } },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: true,
            backgroundColor: 'rgba(6,8,12,0.95)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            padding: 8,
            displayColors: true,
            caretSize: 0,
            cornerRadius: 6,
            bodyFont: { weight: '600' }
          }
        ,
          // zoom plugin config (pan/zoom)
          zoom: {
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x'
            },
            pan: { enabled: true, mode: 'x' }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Days', color: 'rgba(255,255,255,0.9)', font: { weight: '600' } },
            ticks: { color: 'rgba(255,255,255,0.8)' }
          },
          y: {
            title: { display: true, text: 'Number of messages', color: 'rgba(255,255,255,0.9)', font: { weight: '600' } },
            min: 0,
            max: 20,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: 'rgba(255,255,255,0.7)'
            },
            // Force ticks to the exact set we want (0,5,10,15,20)
            afterBuildTicks: function(scale) {
              const vals = [0,5,10,15,20];
              scale.ticks = vals.map(v => ({ value: v, label: String(v) }));
            }
          }
        }
      }
    };

    // Register zoom plugin if available
    try{ if(window.Chart && window.chartjsPluginZoom) Chart.register(window.chartjsPluginZoom); }catch(e){}
    const chart = new Chart(ctx, cfg);

    // Fetch last7 data from server and populate chart; fallback to simulated values
    async function loadLast7FromServer(){
      try{
        const res = await fetch('/api/messages-last7');
        if(!res.ok) {
          console.warn('/api/messages-last7 responded with', res.status);
          return; // don't overwrite chart with random data
        }
        const js = await res.json();
        console.debug('messages-last7 payload', js);
        if(js && Array.isArray(js.labels) && Array.isArray(js.ai) && Array.isArray(js.staff)){
          chart.data.labels = js.labels;
          chart.data.datasets[0].data = js.ai.map(n=>Number(n||0));
          chart.data.datasets[1].data = js.staff.map(n=>Number(n||0));
          chart.update();
          return;
        }
        console.warn('/api/messages-last7 returned unexpected shape, ignoring');
        return;
      }catch(e){
        console.error('Failed to fetch /api/messages-last7', e);
        return;
      }
    }
    loadLast7FromServer();
    // refresh every 5 minutes
    setInterval(loadLast7FromServer, 5 * 60 * 1000);

    // Listen for real-time updates via Socket.IO and refresh chart
    try{
      const socket = io();
      if(socket && socket.on) socket.on('newMessage', () => { loadLast7FromServer(); });
    }catch(e){ /* socket.io not available */ }
    
    // Hover tooltips handle showing per-point details; click popup removed in favor of hover.

    // Controls: toggles, reset zoom, export CSV
    const toggleAI = document.getElementById('toggleAI');
    const toggleStaff = document.getElementById('toggleStaff');
    const resetZoomBtn = document.getElementById('resetZoom');
    const exportCsvBtn = document.getElementById('exportCsv');
    function setDatasetVisibility(){
      if(toggleAI) chart.getDatasetMeta(0).hidden = !toggleAI.checked;
      if(toggleStaff) chart.getDatasetMeta(1).hidden = !toggleStaff.checked;
      chart.update();
    }
    if(toggleAI) toggleAI.addEventListener('change', setDatasetVisibility);
    if(toggleStaff) toggleStaff.addEventListener('change', setDatasetVisibility);
    if(resetZoomBtn) resetZoomBtn.addEventListener('click', ()=>{ try{ if(chart.resetZoom) chart.resetZoom(); else chart.zoomScale('x', {min: undefined, max: undefined}); }catch(e){} });
    if(exportCsvBtn) exportCsvBtn.addEventListener('click', ()=>{
      const labels = chart.data.labels || [];
      const a = chart.data.datasets[0].data || [];
      const b = chart.data.datasets[1].data || [];
      let csv = 'day,AI,Staff\n';
      for(let i=0;i<labels.length;i++) csv += `${labels[i]},${a[i]||0},${b[i]||0}\n`;
      const blob = new Blob([csv], {type:'text/csv'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'messages-last7.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    });

    // Enhanced tooltip: include delta from previous day
    chart.options.plugins.tooltip.callbacks = chart.options.plugins.tooltip.callbacks || {};
    chart.options.plugins.tooltip.callbacks.label = function(context){
      const idx = context.dataIndex;
      const dsLabel = context.dataset.label || '';
      const val = Number(context.parsed.y || 0);
      let delta = '';
      if(typeof idx === 'number' && idx > 0){
        const prev = Number(context.dataset.data[idx-1] || 0);
        const diff = val - prev;
        const pct = prev === 0 ? (diff>0?'+100%':'0%') : Math.round((diff/prev)*100) + '%';
        delta = ` (${diff>=0?'+':''}${diff} / ${pct})`;
      }
      return `${dsLabel}: ${val}${delta}`;
    };
  }
  initMessagesChart();
});
