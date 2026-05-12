// Shared user loader: fetch current user and expose helpers
(function(){
  const storageKey = 'livesupport_user';

  async function fetchUser(){
    try{
      const res = await fetch('/api/user', { credentials: 'same-origin' });
      if (res.status === 401) {
        // not logged in — clear stored user and redirect to login when appropriate
        localStorage.removeItem(storageKey);
        window.currentUser = null;
        return null;
      }
      const data = await res.json();
      if (data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
        window.currentUser = data;
        applyToDom(data);
      }
      initProfileWidget();
      return data;
    }catch(e){
      // fallback to stored value
      try{ window.currentUser = JSON.parse(localStorage.getItem(storageKey)); applyToDom(window.currentUser); }catch(e){}
      initProfileWidget();
      return null;
    }
  }

  function applyToDom(user){
    if (!user) return;
    // elements by id
    const els = document.querySelectorAll('#staffName, .staffName, .staffname, #profileName');
    els.forEach(el => {
      try {
        // prefer displayName, then name, then role
        el.textContent = user.displayName || user.name || user.role || user.username || 'Staff';
      } catch(e) {}
    });
    // update any status displays
    const onlineEl = document.getElementById('agentsOnline');
    if (onlineEl && user.role) {
      onlineEl.style.display = 'inline-block';
      onlineEl.textContent = (user.role === 'admin' ? 'Admin' : user.role) + ' (online)';
    }
    try {
      // expose role on body for CSS/behavior and disable interactive controls for viewers
      if (document && document.body) {
        document.body.setAttribute('data-role', user.role || '');
        if ((user.role || '').toString().toLowerCase() === 'viewer') {
          document.body.classList.add('viewer-mode');
          // disable form submissions and interactive controls
          document.addEventListener('submit', function(e){ e.preventDefault(); e.stopImmediatePropagation(); }, true);
          document.addEventListener('click', function(e){
            const t = e.target && e.target.closest ? e.target.closest('button, input[type="button"], input[type="submit"], [data-action], a') : null;
            if (t) {
              e.preventDefault();
              e.stopImmediatePropagation();
            }
          }, true);
          // disable inputs/controls for viewer
          try {
            document.querySelectorAll('button, input, textarea, select').forEach(el => el.setAttribute('disabled', 'disabled'));
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function initProfileWidget(){
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const logoutBtn = document.getElementById('logoutBtn');
    const statusBtns = Array.from(document.querySelectorAll('.status-btn'));
    const statusIndicator = document.getElementById('statusIndicator');
    const statusDot = statusIndicator?.querySelector('.status-dot');
    const statusText = statusIndicator?.querySelector('.status-text');
    const profileStatusMini = document.getElementById('profileStatusMini');
    const profileNameEl = document.getElementById('profileName');
    const avatarSm = document.querySelector('.avatar-sm');
    const avatarImg = document.querySelector('.avatar-sm-img');

    async function loadProfileData(){
      let displayName = null;
      let profileImage = null;
      try{
        const sres = await fetch('/api/settings');
        if(sres.ok){
          const settings = await sres.json();
          if(settings){
            if(settings.displayName) displayName = settings.displayName;
            profileImage = settings.image_url || settings.avatar_url || settings.avatar || settings.profile_image || settings.avatarUrl || settings.imageUrl || profileImage;
          }
        }
      }catch(e){}

      let user = window.currentUser || null;
      if((!displayName || !profileImage) && !user){
        try{
          const ures = await fetch('/api/user', { credentials: 'same-origin' });
          if(ures.ok) user = await ures.json();
        }catch(e){}
      }

      if(user){
        if(!displayName) displayName = user.name || user.displayName || user.role || user.username;
        if(!profileImage) profileImage = user.avatar || user.image || user.avatar_url || user.image_url || user.profile_image || user.imageUrl;
      }

      displayName = displayName || 'Staff';
      if(profileNameEl) profileNameEl.textContent = displayName;
      if(avatarSm) avatarSm.textContent = (displayName || 'S').charAt(0).toUpperCase();
      if(avatarSm) avatarSm.style.display = '';
      if(avatarImg) avatarImg.style.display = 'none';

      if(profileImage && avatarImg){
        try{
          let src = String(profileImage || '').trim();
          if(src && src.charAt(0) === '/') src = (window.location.origin || '') + src;
          avatarImg.src = src;
          avatarImg.style.display = 'inline-block';
          avatarImg.onload = function(){ if(avatarSm) avatarSm.style.display = 'none'; };
          avatarImg.onerror = function(){ avatarImg.style.display = 'none'; if(avatarSm) avatarSm.style.display = ''; };
        }catch(e){}
      }
    }

    function updateStatusDisplay(status){
      if (statusDot) statusDot.className = `status-dot ${status}`;
      if (statusText) statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      const statusDotMini = profileStatusMini?.querySelector('.status-dot-mini');
      if (statusDotMini) statusDotMini.className = `status-dot-mini ${status}`;
      statusBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.status === status));
      localStorage.setItem('userStatus', status);
    }

    function formatTime(date){
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function updateSessionInfo(){
      const loginTimeEl = document.getElementById('loginTime');
      const sessionDurationEl = document.getElementById('sessionDuration');
      const lastActivityEl = document.getElementById('lastActivity');
      if (!loginTimeEl || !sessionDurationEl || !lastActivityEl) return;

      let loginTime = localStorage.getItem('loginTime');
      if (!loginTime) {
        loginTime = new Date().toISOString();
        localStorage.setItem('loginTime', loginTime);
      }

      const loginDate = new Date(loginTime);
      const now = new Date();
      loginTimeEl.textContent = formatTime(loginDate);

      const durationMs = now - loginDate;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      sessionDurationEl.textContent = `${hours}h ${minutes}m`;

      const lastActivity = localStorage.getItem('lastActivity') || loginTime;
      const lastActivityDate = new Date(lastActivity);
      const minutesSince = Math.floor((now - lastActivityDate) / (1000 * 60));
      lastActivityEl.textContent = minutesSince < 1 ? 'Just now' : minutesSince < 60 ? `${minutesSince}m ago` : `${Math.floor(minutesSince / 60)}h ago`;
    }

    if (statusBtns.length) {
      const initialStatus = localStorage.getItem('userStatus') || 'online';
      updateStatusDisplay(initialStatus);
      statusBtns.forEach(btn => btn.addEventListener('click', () => updateStatusDisplay(btn.dataset.status)));
    }

    if (profileBtn && profileDropdown) {
      profileBtn.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = profileDropdown.classList.toggle('show');
        profileBtn.setAttribute('aria-expanded', String(!!isOpen));
        profileDropdown.setAttribute('aria-hidden', String(!isOpen));
      });
      document.addEventListener('click', event => {
        if (!profileBtn.contains(event.target) && !profileDropdown.contains(event.target)) {
          profileDropdown.classList.remove('show');
          profileBtn.setAttribute('aria-expanded', 'false');
          profileDropdown.setAttribute('aria-hidden', 'true');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', event => {
        event.preventDefault();
        const ok = confirm('Are you sure you want to log out?');
        if (ok) window.location.href = '/logout';
      });
    }

    if (statusBtns.length || profileBtn || profileDropdown) {
      updateSessionInfo();
      setInterval(updateSessionInfo, 60000);
      ['click', 'keydown', 'scroll', 'mousemove'].forEach(eventName => {
        document.addEventListener(eventName, () => {
          localStorage.setItem('lastActivity', new Date().toISOString());
        }, { passive: true });
      });
    }

    loadProfileData().catch(() => {});
  }

  // public helpers
  window.getCurrentUser = async function(){
    if (window.currentUser) return window.currentUser;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try{ window.currentUser = JSON.parse(stored); applyToDom(window.currentUser); }catch(e){}
    }
    // attempt network fetch in background
    fetchUser();
    return window.currentUser || null;
  };

  // run immediately to populate UI early
  if (document.readyState === 'loading') {
    // run as soon as possible
    document.addEventListener('DOMContentLoaded', fetchUser);
  } else {
    fetchUser();
  }

  // listen for updates in other tabs
  window.addEventListener('storage', (e)=>{
    if (e.key === storageKey) {
      try{ window.currentUser = JSON.parse(e.newValue); applyToDom(window.currentUser); }catch(e){}
    }
  });

})();
