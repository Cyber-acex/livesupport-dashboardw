// Simple Instagram-like inbox demo
const sampleConversations = [
  { id: 'c1', name: 'alice', last: 'Hey, is my order ready?', unread: 2, avatar: '' , messages: [
    {from: 'alice', text: 'Hey, is my order ready?', time: '10:01'},
    {from: 'me', text: 'Working on it — will update soon.', time: '10:02'}
  ]},
  { id: 'c2', name: 'brand_official', last: 'Thanks for your message!', unread: 0, avatar: '' , messages: [
    {from: 'brand_official', text: 'Thanks for your message!', time: 'Yesterday'}
  ]},
  { id: 'c3', name: 'bob', last: 'Can I change the address?', unread: 1, avatar: '' , messages: [
    {from: 'bob', text: 'Can I change the address?', time: '08:22'}
  ]}
];

let activeConversationId = null;
let conversations = sampleConversations.slice();
// Socket.IO client (initialized on load)
let socket = null;

function renderConversations(list = conversations) {
  const container = document.getElementById('conversationsList');
  container.innerHTML = '';
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="no-convos" style="padding:20px;color:#666;text-align:center;">No conversations yet</div>';
    return;
  }
  list.forEach(conv => {
    const el = document.createElement('div');
    el.className = 'conversation-item';
    el.dataset.id = conv.id;
    if(String(activeConversationId) === String(conv.id)) el.classList.add('active');
    // avatar: image or initials
    const avatarHtml = conv.avatar ? `<div class="conv-avatar"><img src="${conv.avatar}" alt="${conv.name}"/></div>` : `<div class="conv-avatar"><div class="initials">${getInitials(conv.name)}</div></div>`;
    el.innerHTML = `
      ${avatarHtml}
      <div class="conv-meta">
        <div class="conv-name"><span class="name-text">${conv.name}</span><span class="conv-time">${conv.created_at? formatTime(conv.created_at): ''}</span></div>
        <div class="conv-last">${conv.last || ''}</div>
      </div>
      <div class="conv-right">
        ${conv.unread ? '<span class="conv-unread">' + conv.unread + '</span>' : ''}
      </div>
    `;
    el.addEventListener('click', () => selectConversation(conv.id));
    container.appendChild(el);
  });
}

function getInitials(name){
  if(!name) return 'U';
  const parts = name.split(/[\s_\-\.]+/).filter(Boolean);
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}

async function loadConversationsFromServer(){
  try{
    const res = await fetch('/api/instagram/conversations');
    if(!res.ok) throw new Error('no convs');
    const data = await res.json();
    if(!data || data.length===0) return;
    conversations = data.map(c => ({ id: c.id, name: c.ig_username || c.name || c.phone, last: c.last_message || '', unread: c.unread_count || 0, avatar: '', phone: c.phone }));
    renderConversations(conversations);
    // Auto-select the newest conversation if none selected
    if(conversations.length>0 && !activeConversationId){
      selectConversation(conversations[0].id);
    }
  }catch(e){
    console.log('Could not load conversations from server, using sample data');
    conversations = sampleConversations.slice();
    renderConversations(conversations);
  }
}

async function selectConversation(id) {
  activeConversationId = id;
  const conv = conversations.find(c=>c.id==id) || sampleConversations.find(c=>c.id==id);
  if(!conv) return;
  document.getElementById('chatHeader').textContent = conv.name;
  conv.unread = 0;
  renderConversations();
  // try loading messages from backend
  try{
    const res = await fetch('/api/messages/' + conv.id);
    if(res.ok){
      const msgs = await res.json();
      const formatted = msgs.map(m => ({ from: (m.sender === 'sent' || m.sender === 'me') ? 'me' : 'other', text: m.message, time: m.created_at, attachment: m.attachment || null }));
      // store messages in conv for optimistic updates
      conv.messages = formatted.map(f => ({ from: f.from, text: f.text, time: f.time, attachment: f.attachment }));
      renderMessages(conv.messages);
      return;
    }
  }catch(e){ /* fallback to local messages */ }
  renderMessages(conv.messages || []);
}

function handleIncomingSocketMessage(data){
  if(!data || !data.conversation_id) return;
  const convId = data.conversation_id;
  let conv = conversations.find(c => String(c.id) === String(convId));
  const text = data.message || data.msg || '[message]';
  if(!conv){
    // Try to fetch the conversation list from server to pick up the new conversation
    try{
      fetch('/api/instagram/conversations').then(r=>r.json()).then(rows => {
        if(!rows || rows.length===0) return;
        // map and replace conversations
        conversations = rows.map(c => ({ id: c.id, name: c.ig_username || c.name || c.phone, last: c.last_message || '', unread: c.unread_count || 0, avatar: '', phone: c.phone, created_at: c.created_at }));
        // find the conversation
        conv = conversations.find(c => String(c.id) === String(convId));
        if(!conv){
          // nothing more we can do
          renderConversations(conversations);
          return;
        }
        // mark last message and unread
        conv.last = text;
        conv.unread = (conv.unread || 0) + 1;
        // update UI
        renderConversations(conversations);
        // if the conversation is currently open, load its messages
        if(activeConversationId && String(activeConversationId) === String(convId)){
          fetch('/api/messages/' + convId).then(r=>r.json()).then(msgs => {
            const formatted = msgs.map(m => ({ from: (m.sender === 'sent' || m.sender === 'me') ? 'me' : 'other', text: m.message, time: m.created_at, attachment: m.attachment || null }));
            conv.messages = formatted;
            renderMessages(conv.messages);
          }).catch(()=>{});
        }
      }).catch(()=>{});
    }catch(e){
      // fallback: refresh conversations
      loadConversationsFromServer();
    }
    return;
  }
  conv.last = text;
  // if conversation is currently open, append message
  if(activeConversationId && String(activeConversationId) === String(convId)){
    conv.messages = conv.messages || [];
    const fromMe = data.sender === 'sent' || data.sender === 'me';
    conv.messages.push({ from: fromMe ? 'me' : 'other', text });
    renderMessages(conv.messages);
  } else {
    conv.unread = (conv.unread || 0) + 1;
  }
  renderConversations();
}

function renderMessages(messages) {
  const area = document.getElementById('messages');
  area.innerHTML = '';
  if(!messages || messages.length === 0){
    area.innerHTML = '<div class="no-messages" style="padding:20px;color:#666;text-align:center;">No messages yet</div>';
    return;
  }
  messages.forEach(m => {
    const wrap = document.createElement('div');
    wrap.className = 'message-row ' + (m.from === 'me' ? 'row-out' : 'row-in');
    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (m.from === 'me' ? 'outgoing' : 'incoming');
    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    textEl.textContent = m.text || '';
    bubble.appendChild(textEl);
    if(m.attachment){
      const a = document.createElement('div');
      a.className = 'attachment';
      if(m.attachment.type && m.attachment.type.startsWith('image')){
        const img = document.createElement('img');
        img.src = m.attachment.url;
        a.appendChild(img);
      } else {
        a.textContent = m.attachment.name || 'Attachment';
      }
      bubble.appendChild(a);
    }
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = m.time ? formatTime(m.time) : '';
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    area.appendChild(wrap);
  });
  area.scrollTop = area.scrollHeight;
}

function formatTime(ts){
  try{
    const d = new Date(ts);
    if(isNaN(d.getTime())) return '';
    const hh = d.getHours().toString().padStart(2,'0');
    const mm = d.getMinutes().toString().padStart(2,'0');
    return `${hh}:${mm}`;
  }catch(e){ return ''; }
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if((!text && !pendingAttachment) || !activeConversationId) return;
  const conv = conversations.find(c=>c.id==activeConversationId) || sampleConversations.find(c=>c.id==activeConversationId);
  const lastLabel = text || (pendingAttachment ? '[Attachment]' : '');
  pendingAttachment = null;
  conv.last = lastLabel;
  renderConversations();
  input.value = '';
  input.placeholder = 'Message...';
  const attachEl = document.getElementById('attachInput'); if(attachEl) attachEl.value = '';
  showTypingIndicator(true);

  (async ()=>{
    try{
      const payload = { recipient: conv.phone || conv.id, message: text };
      if(window.pendingAttachment) payload.attachment = window.pendingAttachment;
      const resp = await fetch('/api/instagram/send', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      showTypingIndicator(false);
      // optimistic UI update
      conv.messages = conv.messages || [];
      conv.messages.push({from: 'me', text});
      renderMessages(conv.messages);
      renderConversations();
    }catch(err){
      showTypingIndicator(false);
      console.error('Send failed', err);
    }
  })();
}

function handleComposerKey(e) {
  if(e.key === 'Enter') sendMessage();
}

function filterConversations() {
  const q = document.getElementById('igSearch').value.toLowerCase();
  const filtered = conversations.filter(c => (c.name||'').toLowerCase().includes(q) || (c.last||'').toLowerCase().includes(q));
  renderConversations(filtered);
}

// initial render
window.addEventListener('load', () => {
  loadConversationsFromServer().then(()=>{
    if(!conversations || conversations.length===0) renderConversations();
  });
  // wire attach button and file input
  window.pendingAttachment = null;
  window.handleFileAttach = function(e){
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    // create a local preview URL
    const url = URL.createObjectURL(f);
    pendingAttachment = { name: f.name, type: f.type, url };
    document.getElementById('messageInput').placeholder = 'Sending attachment: '+f.name;
  };
  window.showTypingIndicator = function(show){
    const area = document.getElementById('messages');
    if(show){
      const t = document.createElement('div');
      t.id = 'typingIndicator';
      t.className = 'typing-indicator';
      t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      area.appendChild(t);
      area.scrollTop = area.scrollHeight;
    } else {
      const ex = document.getElementById('typingIndicator');
      if(ex) ex.remove();
    }
  };

  // Initialize Socket.IO and listen for new messages
  try{
    if(typeof io !== 'undefined'){
      socket = io();
      socket.on('connect', () => console.log('Socket.IO connected'));
      socket.on('newMessage', (d) => {
        try{ handleIncomingSocketMessage(d); }catch(e){ console.error('Error handling socket message', e); }
      });
    } else {
      console.log('Socket.IO client not loaded');
    }
  }catch(e){ console.warn('Socket init failed', e); }
});
