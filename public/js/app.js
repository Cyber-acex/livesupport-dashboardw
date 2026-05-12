if (window.inboxAppLoaded) {
    console.log('Dashboard fallback app.js skipped because inbox.js is active');
} else {
    // Utility function to escape HTML
    function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function saveSharedNotification(message, source = 'Staff', type = 'staff') {
        try {
            const key = 'liveSupportNotifications';
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            list.unshift({ message, source, type, time: new Date().toISOString() });
            localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
        } catch (e) {
            console.error('Shared notification save failed', e);
        }
    }

    const socket = io();
    // Register this client as an agent for presence/broadcasts
    socket.on('connect', () => {
        fetch('/api/user').then(r=>r.json()).then(u=>{
            if(u && (u.id || u.name)) socket.emit('agent:register', { userId: u.id, name: u.name || u.role || 'Agent', role: u.role || 'agent' });
        }).catch(()=>{});
    });
    const aiSendBtn = document.getElementById("ai-send");
    const aiText = document.getElementById("ai-text");
    const chatMessages = document.getElementById("chat-messages");

const staffSendBtn = document.getElementById("staff-send");
const staffInput = document.getElementById("staff-input");

const escalateBtn = document.querySelector(".ai-btn.warning");
const chatHeader = document.querySelector(".chat-header");

const conversations = document.querySelectorAll(".conversation");

// Utility: Get Current Time
function getTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Add Message Function
function addMessage(text, type) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", type);

    const content = document.createElement("div");
    content.textContent = text;

    const time = document.createElement("div");
    time.style.fontSize = "11px";
    time.style.marginTop = "4px";
    time.style.opacity = "0.6";
    time.textContent = getTime();

    messageDiv.appendChild(content);
    messageDiv.appendChild(time);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// AI Send
aiSendBtn.addEventListener("click", function () {
    const messageText = aiText.value.trim();
    if (!messageText) return;

    addMessage(messageText, "ai");
    aiText.value = "";
});

// Staff Send
staffSendBtn.addEventListener("click", function () {
    const messageText = staffInput.value.trim();
    if (!messageText) return;

    addMessage(messageText, "ai"); // staff messages are blue
    staffInput.value = "";
});

// Escalate Logic
escalateBtn.addEventListener("click", function () {

    if (!document.querySelector(".escalated-badge")) {
        const badge = document.createElement("span");
        badge.textContent = "ESCALATED";
        badge.classList.add("escalated-badge");
        badge.style.background = "#dc2626";
        badge.style.color = "white";
        badge.style.padding = "4px 8px";
        badge.style.marginLeft = "10px";
        badge.style.borderRadius = "6px";
        badge.style.fontSize = "12px";

        chatHeader.appendChild(badge);
    }

});

// Conversation Switching
conversations.forEach(convo => {
    convo.addEventListener("click", function () {

        conversations.forEach(c => c.classList.remove("active"));
        this.classList.add("active");

        const name = this.querySelector(".name").textContent;
        chatHeader.querySelector("strong").textContent = name;

        // Clear messages
        chatMessages.innerHTML = "";

        // Load mock message
        addMessage("Hello, how can we help you?", "ai");
    });
});

document.getElementById("add-note").addEventListener("click", function () {
    addMessage("Internal note: Customer has history of late refund claims.", "note");
});

socket.on("newMessage", function (data) {

    const messageType = data.sender === "sent" ? "ai" : "customer";
    addMessage(data.message, messageType);

    // Show browser notification if msgAlert is enabled and message is from customer
    if (messageType === "customer" && localStorage.getItem('msgAlert') === 'true') {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification('New Message', {
                body: data.message,
                icon: '/favicon.ico' // or some icon
            });
            notification.onclick = function() {
                window.focus();
                notification.close();
            };
        }
    }

});

// Show staff notifications broadcast from other agents
socket.on('staffNotification', (data) => {
    try{
        const message = data && data.message ? data.message : '';
        const from = data && data.from ? data.from : 'Staff';
        // Store the last notification in localStorage
        const lastNotification = { message, from, time: data.time || new Date().toISOString() };
        localStorage.setItem('lastStaffNotification', JSON.stringify(lastNotification));
        saveSharedNotification(message, from, 'staff');
        // create a fixed notification element
        const id = 'globalStaffNotificationBar';
        let el = document.getElementById(id);
        if(!el){
            el = document.createElement('div');
            el.id = id;
            el.style.position = 'fixed';
            el.style.top = '12px';
            el.style.left = '50%';
            el.style.transform = 'translateX(-50%)';
            el.style.zIndex = '99999';
            el.style.maxWidth = '900px';
            el.style.width = 'calc(100% - 40px)';
            el.style.padding = '12px 16px';
            el.style.borderRadius = '8px';
            el.style.boxShadow = '0 6px 18px rgba(2,6,23,0.08)';
            el.style.fontSize = '14px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'space-between';
            el.style.gap = '12px';
            document.body.appendChild(el);
        }
        el.style.background = '#0ea5a4';
        el.style.color = 'white';
        el.innerHTML = `<div style="flex:1">${escapeHtml ? escapeHtml(from) : from}: ${escapeHtml ? escapeHtml(message) : message}</div><button id="globalNotifyClose" style="background:transparent;border:none;color:white;font-size:18px;cursor:pointer">&times;</button>`;
        const closeBtn = document.getElementById('globalNotifyClose');
        if(closeBtn) closeBtn.onclick = () => { el.style.display = 'none'; };
        el.style.display = 'flex';
        setTimeout(()=>{ try{ el.style.display='none'; }catch(e){} }, 6000);
    }catch(e){ console.error('staffNotification handler error', e); }
});

app.post("/tickets", (req, res) => {
    const { user_id, source, message, priority } = req.body;
    const sql = "INSERT INTO tickets (user_id, source, message, priority) VALUES (?, ?, ?, ?)";
    db.query(sql, [user_id, source, message, priority], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true, ticket_id: result.insertId });
    });
});

// show messages in sidebar
async function loadConversations() {
    const res = await fetch("/conversations");
    const conversations = await res.json();

    const sidebar = document.querySelector(".chat-list");
    sidebar.innerHTML = "";

    conversations.forEach(conv => {
        const div = document.createElement("div");
        div.classList.add("chat-item");
        div.innerText = `${conv.customer_name} (${conv.channel})`;

        div.onclick = () => loadMessages(conv.id);

        sidebar.appendChild(div);
    });
}

let activeConversationId = null;

//invalid login page
function showError(message) {
  const box = document.getElementById("errorBox");
  box.innerText = message;
  box.classList.remove("hidden");

  setTimeout(() => {
    box.classList.add("show");
  }, 10);

  // Auto hide after 3 seconds
  setTimeout(() => {
    box.classList.remove("show");
  }, 3000);
}

//AUTO REPLIES//
const autoReplies = {
  hello: "Hello! How can we assist you today?",
  refund: "We have received your refund request. Our team will review it shortly.",
  payment: "For payment issues, please provide your transaction ID.",
  complaint: "We're sorry for the inconvenience. Your complaint has been logged.",
  thanks: "You're welcome! Let us know if you need further assistance."
};
}

