// Connect to Socket.IO server
const socket = io();


let currentConversationId = null;

// ---------------------------
// DOM Elements
// ---------------------------
const conversationsList = document.querySelector(".conversation-list");
const messagesContainer = document.getElementById("chat-messages");
const messageInput = document.getElementById("staff-input");
const sendButton = document.getElementById("staff-send");

// ---------------------------
// Load all conversations with filter
// ---------------------------
async function loadConversations(filter = 'all') {
    let data = [];
    if (filter === 'escalated') {
        // Load escalated conversations with joined data
        const escRes = await fetch("/api/escalations");
        const escData = await escRes.json();
        data = escData.map(esc => ({
            id: esc.conversation_id,
            phone: esc.phone,
            name: esc.name,
            created_at: esc.created_at,
            escalated_at: esc.escalated_at
        }));
    } else if (filter === 'resolved') {
        // Load resolved conversations with joined data
        const resRes = await fetch("/api/resolved");
        const resData = await resRes.json();
        data = resData.map(res => ({
            id: res.conversation_id,
            phone: res.phone,
            name: res.name,
            created_at: res.created_at,
            resolved_at: res.resolved_at
        }));
    } else {
        // Load all conversations
        const res = await fetch("/api/conversations");
        data = await res.json();
    }

    conversationsList.innerHTML = "";
    data.forEach(conv => {
        const div = document.createElement("div");
        div.classList.add("conversation");
        const escalatedInfo = conv.escalated_at ? `<br><small>Escalated: ${new Date(conv.escalated_at).toLocaleString()}</small>` : '';
        const resolvedInfo = conv.resolved_at ? `<br><small>Resolved: ${new Date(conv.resolved_at).toLocaleString()}</small>` : '';
        div.innerHTML = `
            <div class="name">${conv.phone}</div>
            <div class="preview">Click to open</div>
            <div class="meta">WhatsApp${escalatedInfo}${resolvedInfo}</div>
        `;
        if (conv.escalated_at) {
            // Add cancel button
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "✕";
            cancelBtn.classList.add("cancel-btn");
            cancelBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                background: #dc2626;
                color: white;
                border: none;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                cursor: pointer;
                font-size: 12px;
            `;
            cancelBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                await fetch("/api/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ conversation_id: conv.id })
                });
                // If this is the currently open chat, hide the escalated badge
                if (currentConversationId == conv.id) {
                    document.getElementById("escalatedBadge").style.display = "none";
                }
                // Switch to resolved filter
                filterButtons.forEach(b => b.classList.remove('active'));
                const resolvedBtn = Array.from(filterButtons).find(btn => btn.textContent.toLowerCase() === 'resolved');
                if (resolvedBtn) {
                    resolvedBtn.classList.add('active');
                    loadConversations('resolved');
                } else {
                    loadConversations('escalated'); // Fallback
                }
            });
            div.style.position = "relative";
            div.appendChild(cancelBtn);
        }
        div.dataset.id = conv.id;
        div.addEventListener("click", () => {
            currentConversationId = conv.id;
            loadMessages(conv.id, !!conv.escalated_at);
            // Update header
            document.querySelector(".chat-header strong").textContent = conv.phone;
        });
        conversationsList.appendChild(div);
    });

    // If no conversations, show empty message
    if (data.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.classList.add("conversation", "empty");
        let message = "No chats";
        if (filter === 'escalated') {
            message = "No escalated chats";
        } else if (filter === 'resolved') {
            message = "No resolved chats";
        }
        emptyDiv.innerHTML = `<div class="name">${message}</div>`;
        conversationsList.appendChild(emptyDiv);
    }
}

// ---------------------------
// Load messages for a conversation
// ---------------------------
async function loadMessages(conversationId, isEscalated = false) {
    if (!conversationId) return;
    const res = await fetch(`/api/messages/${conversationId}`);
    const data = await res.json();

    messagesContainer.innerHTML = "";
    data.forEach(msg => {
        appendMessage(msg);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Check if escalated
    const escRes = await fetch("/api/escalations");
    const escData = await escRes.json();
    const escalated = escData.some(e => e.conversation_id == conversationId);
    const badge = document.getElementById("escalatedBadge");
    if (escalated) {
        badge.style.display = "inline";
    } else {
        badge.style.display = "none";
    }

    // If escalated, highlight the refund message for 3 seconds
    if (isEscalated) {
        setTimeout(() => {
            const messageDivs = messagesContainer.querySelectorAll('.message');
            messageDivs.forEach(div => {
                if (div.textContent.toLowerCase().includes('refund')) {
                    div.classList.add('highlight');
                    setTimeout(() => {
                        div.classList.remove('highlight');
                    }, 3000);
                }
            });
        }, 500); // Small delay to ensure DOM is updated
    }
}

// ---------------------------
// Append single message to chat container
// ---------------------------
function appendMessage(msg) {
    const div = document.createElement("div");
    div.classList.add("message");
    div.classList.add(msg.sender === "agent" ? "ai" : "customer");

    // Message text
    const messageText = document.createElement("div");
    messageText.textContent = msg.message;
    div.appendChild(messageText);

    // Timestamp
    if (msg.created_at) {
        const timestamp = document.createElement("div");
        timestamp.classList.add("timestamp");
        const date = new Date(msg.created_at);
        timestamp.textContent = date.toLocaleString(); // Format as local time
        div.appendChild(timestamp);
    }

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ---------------------------
// Handle sending a message
// ---------------------------
sendButton.addEventListener("click", async () => {
    const message = messageInput.value.trim();
    if (!message || !currentConversationId) return;

    const res = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: currentConversationId, message })
    });

    if (res.ok) {
        messageInput.value = "";
        // Message will be appended via Socket.IO
    }
});

// ---------------------------
// Notification functions
// ---------------------------

function showNotification(message) {
    const bar = document.getElementById("notificationBar");
    const text = document.getElementById("notificationText");
    if (!bar || !text) return;
    text.textContent = message;
    bar.style.display = "block";
    setTimeout(() => {
        bar.style.display = "none";
    }, 5000);
}

function hideNotification() {
    const bar = document.getElementById("notificationBar");
    if (bar) bar.style.display = "none";
}

// ---------------------------
// Event listener for close button
// ---------------------------
document.getElementById("closeNotification").addEventListener("click", hideNotification);

// ---------------------------
// Function to play notification sound
// ---------------------------
function playNotificationSound() {
    // Create a simple beep using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Frequency in Hz
    oscillator.type = 'sine'; // Waveform type

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Volume
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5); // Fade out

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5); // Duration 0.5 seconds
}

// ---------------------------
// Socket.IO listener for new messages
// ---------------------------
socket.on("newMessage", msg => {
    // If the message belongs to the current conversation, append it
    if (msg.conversation_id == currentConversationId) {
        appendMessage(msg);
    }

    // Add in-page and desktop notifications only when message alerts are enabled
    if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('LiveSupport - New Message', {
            body: `New message: ${msg.message}`,
            icon: '/favicon.ico'
        });
    }

    if (msg.conversation_id != currentConversationId) {
        playNotificationSound();
        showNotification("New message received from a customer!");
        const convDiv = conversationsList.querySelector(`[data-id='${msg.conversation_id}']`);
        if (convDiv) {
            convDiv.classList.add("new-message");
        }
        loadConversations();
    }
});

// ---------------------------
// Initial load
// ---------------------------
loadConversations();

// ---------------------------
// Filter buttons
// ---------------------------
const filterButtons = document.querySelectorAll('.filter');
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filterText = btn.textContent.toLowerCase();
        if (filterText === 'escalated') {
            loadConversations('escalated');
        } else if (filterText === 'resolved') {
            loadConversations('resolved');
        } else {
            loadConversations('all');
        }
    });
});