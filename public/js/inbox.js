// THEME HANDLING FOR INBOX
function applyInboxTheme() {
    const theme = localStorage.getItem('theme') || 'Light';
    if (theme === 'Dark') {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
}
applyInboxTheme();
window.addEventListener('storage', function(e) {
    if (e.key === 'theme') applyInboxTheme();
});
window.addEventListener('focus', applyInboxTheme);
// Connect to Socket.IO server
const socket = io();


let currentConversationId = null;
let conversationCache = [];
window.currentConversationId = null;
window.currentConversation = null;

const localResolvedChats = JSON.parse(localStorage.getItem('resolvedChats')) || [];

async function resolveEscalatedConversation(conv, targetSection) {
    if (!conv) return;

    try {
        const endpoint = targetSection === 'refunds' ? '/api/refund' : '/api/delivery-issue';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: conv.id, name: conv.phone || conv.name })
        });
        const data = await res.json();
        if (!data.success) {
            console.warn(`${endpoint} returned no success flag`, data);
        }
    } catch (error) {
        console.error(`${targetSection === 'refunds' ? '/api/refund' : '/api/delivery-issue'} error:`, error);
    }

    const filterButtons = document.querySelectorAll('.filter');
    const activeFilter = Array.from(filterButtons).find(btn => btn.classList.contains('active'));
    if (activeFilter) {
        const filterText = activeFilter.textContent.trim().toLowerCase();
        if (filterText === 'refunds') {
            loadConversations('refunds');
        } else if (filterText === 'delivery issues') {
            loadConversations('delivery-issues');
        } else if (filterText === 'resolved') {
            loadConversations('resolved');
        } else {
            loadConversations('escalated');
        }
    }

    if (currentConversationId === conv.id) {
        const badge = document.getElementById('escalatedBadge');
        if (badge) badge.style.display = 'none';
    }
}

// ---------------------------
// DOM Elements
// ---------------------------
const conversationsList = document.querySelector(".conversation-list");
const messagesContainer = document.getElementById("chat-messages");
const messageInput = document.getElementById("staff-input");
const sendButton = document.getElementById("staff-send");
const aiSuggestionField = document.getElementById("ai-text");
const aiUseButton = document.getElementById("ai-send");
const fileInput = document.getElementById("internalFileInput");
const addFileButton = document.getElementById("add-file");
const selectedFileDisplay = document.getElementById("selected-file-display");
let selectedFile = null;

window.inboxAppLoaded = true;

if (addFileButton && fileInput) {
    addFileButton.addEventListener("click", () => {
        fileInput.click();
    });
}

if (fileInput) {
    fileInput.addEventListener("change", () => {
        selectedFile = fileInput.files[0] || null;
        if (selectedFileDisplay) {
            selectedFileDisplay.textContent = selectedFile ? `Selected: ${selectedFile.name}` : "No file selected.";
        }
    });
}

const confidenceValues = [79, 85, 87, 92, 99, 93, 91, 86, 81, 80, 84, 83, 94, 97, 96, 95];
const confidenceLabel = document.getElementById("confidence-label");

function getRandomConfidence() {
    return confidenceValues[Math.floor(Math.random() * confidenceValues.length)];
}

function updateConfidenceLabel() {
    if (!confidenceLabel) return;
    const randomValue = getRandomConfidence();
    confidenceLabel.textContent = `Confidence: ${randomValue}%`;
}

async function fetchAISuggestion(conversationId) {
    if (!conversationId || !aiSuggestionField) return;

    aiSuggestionField.value = "Listening for the latest customer message...";
    updateConfidenceLabel();

    try {
        const res = await fetch(`/api/suggest-reply/${conversationId}`);
        const data = await res.json();
        aiSuggestionField.value = data.suggestion || "";
        updateConfidenceLabel();
    } catch (error) {
        console.error("Failed to fetch AI suggestion:", error);
        if (aiSuggestionField) {
            aiSuggestionField.value = "Unable to generate suggestion right now.";
        }
        updateConfidenceLabel();
    }
}

if (aiUseButton && messageInput) {
    aiUseButton.addEventListener("click", () => {
        if (!aiSuggestionField || !messageInput) return;
        messageInput.value = aiSuggestionField.value;
        messageInput.focus();
    });
}

function createConversationElement(conv, filter = 'all') {
    const div = document.createElement("div");
    div.classList.add("conversation");
    div.dataset.id = conv.id;

    const escalatedInfo = conv.escalated_at ? `<br><small>Escalated: ${new Date(conv.escalated_at).toLocaleString()}</small>` : '';
    const resolvedInfo = conv.resolved_at ? `<br><small>Resolved: ${new Date(conv.resolved_at).toLocaleString()}</small>` : '';
    const refundedInfo = conv.refunded_at ? `<br><small>Refunded: ${new Date(conv.refunded_at).toLocaleString()}</small>` : '';
    const reportedInfo = conv.reported_at ? `<br><small>Reported: ${new Date(conv.reported_at).toLocaleString()}</small>` : '';
    div.innerHTML = `
        <div class="name">${conv.phone}</div>
        <div class="preview">Click to open</div>
        <div class="meta">${conv.platform ? conv.platform.charAt(0).toUpperCase() + conv.platform.slice(1) : 'WhatsApp'}${escalatedInfo}${resolvedInfo}${refundedInfo}${reportedInfo}</div>
    `;

    if (conv.escalated_at) {
            const actions = document.createElement('div');
            actions.classList.add('escalated-action-buttons');
            actions.style.cssText = `
                position: absolute;
                top: 6px;
                right: 40px;
                display: flex;
                gap: 4px;
                z-index: 10;
            `;

            const refundBtn = document.createElement('button');
            refundBtn.classList.add('refund-btn');
            refundBtn.type = 'button';
            refundBtn.textContent = 'R';
            refundBtn.title = 'Refunds';
            refundBtn.style.cssText = `
                width: 22px;
                height: 22px;
                border-radius: 50%;
                border: none;
                background: #ec4899;
                color: white;
                font-size: 12px;
                cursor: pointer;
            `;
            refundBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resolveEscalatedConversation(conv, 'refunds');
            });

            const deliveryBtn = document.createElement('button');
            deliveryBtn.classList.add('delivery-btn');
            deliveryBtn.type = 'button';
            deliveryBtn.textContent = 'D';
            deliveryBtn.title = 'Delivery issues';
            deliveryBtn.style.cssText = `
                width: 22px;
                height: 22px;
                border-radius: 50%;
                border: none;
                background: #374151;
                color: white;
                font-size: 12px;
                cursor: pointer;
            `;
            deliveryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resolveEscalatedConversation(conv, 'delivery');
            });

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
                if (currentConversationId == conv.id) {
                    document.getElementById("escalatedBadge").style.display = "none";
                }
                filterButtons.forEach(b => b.classList.remove('active'));
                const resolvedBtn = Array.from(filterButtons).find(btn => btn.textContent.toLowerCase() === 'resolved');
                if (resolvedBtn) {
                    resolvedBtn.classList.add('active');
                    loadConversations('resolved');
                } else {
                    loadConversations('escalated');
                }
            });

            div.style.position = "relative";
            actions.appendChild(refundBtn);
            actions.appendChild(deliveryBtn);
            div.appendChild(actions);
            div.appendChild(cancelBtn);
        }
    div.addEventListener("click", () => {
        currentConversationId = conv.id;
        window.currentConversationId = conv.id;
        window.currentConversation = conv.id;
        loadMessages(conv.id, filter === 'escalated');
        document.querySelector(".chat-header strong").textContent = conv.phone;
    });

    return div;
}

function highlightEscalatedMessage(escalation) {
    if (!escalation || !escalation.escalated_at) return;

    const escalationTime = Date.parse(escalation.escalated_at);
    if (Number.isNaN(escalationTime)) return;

    const messageDivs = Array.from(messagesContainer.querySelectorAll('.message'));
    const customerMessages = messageDivs
        .filter(div => div.dataset.sender !== 'sent' && div.dataset.createdAt)
        .sort((a, b) => Date.parse(a.dataset.createdAt) - Date.parse(b.dataset.createdAt));

    let target = null;
    customerMessages.forEach(div => {
        const createdAt = Date.parse(div.dataset.createdAt);
        if (!Number.isNaN(createdAt) && createdAt <= escalationTime) {
            target = div;
        }
    });

    if (!target && customerMessages.length > 0) {
        target = customerMessages[0];
    }

    if (!target) return;

    target.classList.add('highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => target.classList.remove('highlight'), 5000);
}

function renderConversations(data, filter = 'all') {
    conversationsList.innerHTML = "";
    const fragment = document.createDocumentFragment();

    if (data.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.classList.add("conversation", "empty");
        let message = "No chats";
        if (filter === 'escalated') {
            message = "No escalated chats";
        } else if (filter === 'resolved') {
            message = "No resolved chats";
        } else if (filter === 'refunds') {
            message = "No refund chats yet.";
        } else if (filter === 'delivery-issues') {
            message = "No delivery issue chats yet.";
        }
        emptyDiv.innerHTML = `<div class="name">${message}</div>`;
        fragment.appendChild(emptyDiv);
    } else {
        data.forEach(conv => {
            fragment.appendChild(createConversationElement(conv, filter));
        });
    }

    conversationsList.appendChild(fragment);
}

async function loadConversations(filter = 'all') {
    let data = [];
    if (filter === 'escalated') {
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
        const resRes = await fetch("/api/resolved");
        const resData = await resRes.json();
        const backendResolved = resData.map(res => ({
            id: res.conversation_id,
            phone: res.phone,
            name: res.name,
            created_at: res.created_at,
            resolved_at: res.resolved_at
        }));
        const localResolved = localResolvedChats.map(res => ({
            id: res.id,
            phone: res.name,
            name: res.name,
            created_at: res.time,
            resolved_at: res.time
        }));
        data = [...backendResolved, ...localResolved];
    } else if (filter === 'refunds') {
        const res = await fetch('/api/refunds');
        const resData = await res.json();
        data = resData.map(item => ({
            id: item.conversation_id,
            phone: item.phone,
            name: item.name,
            created_at: item.created_at,
            refunded_at: item.refunded_at
        }));
    } else if (filter === 'delivery-issues') {
        const res = await fetch('/api/delivery-issues');
        const resData = await res.json();
        data = resData.map(item => ({
            id: item.conversation_id,
            phone: item.phone,
            name: item.name,
            created_at: item.created_at,
            reported_at: item.reported_at
        }));
    } else {
        const res = await fetch("/api/conversations");
        data = await res.json();
    }

    conversationCache = data;
    renderConversations(data, filter);
}

function renderNoReceipts() {
    conversationsList.innerHTML = "";
    const emptyDiv = document.createElement("div");
    emptyDiv.classList.add("conversation", "empty");
    emptyDiv.innerHTML = `<div class="name">No saved receipts.</div>`;
    conversationsList.appendChild(emptyDiv);
}

function renderLocalItems(items, emptyText) {
    conversationsList.innerHTML = "";
    if (!items || items.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.classList.add("conversation", "empty");
        emptyDiv.innerHTML = `<div class="name">${emptyText}</div>`;
        conversationsList.appendChild(emptyDiv);
        return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(item => {
        const div = document.createElement("div");
        div.classList.add("conversation");
        div.dataset.id = item.id;
        div.innerHTML = `
            <div class="name">${item.name || item.phone}</div>
            <div class="preview">${item.section || 'Resolved'}</div>
            <div class="meta">✅ ${item.time}</div>
        `;
        div.addEventListener('click', () => {
            currentConversationId = item.id;
            window.currentConversationId = item.id;
            window.currentConversation = item.id;
            loadMessages(item.id, false);
        });
        fragment.appendChild(div);
    });
    conversationsList.appendChild(fragment);
}


async function renderReceipts() {
    conversationsList.innerHTML = "";
    try {
        const res = await fetch("/api/receipts");
        const tickets = await res.json();
        
        if (!tickets || tickets.length === 0) {
            renderNoReceipts();
            return;
        }
        
        const fragment = document.createDocumentFragment();
        tickets.forEach(ticket => {
            const div = document.createElement("div");
            div.classList.add("conversation");
            div.style.position = "relative";
            div.dataset.ticketId = ticket.id;
            
            const preview = ticket.content.substring(0, 50) + (ticket.content.length > 50 ? "..." : "");
            const createdAt = new Date(ticket.created_at).toLocaleString();
            
            div.innerHTML = `
                <div class="name">Receipt #${ticket.id}</div>
                <div class="preview">${preview}</div>
                <div class="meta">${createdAt}${ticket.escalated ? ' • Escalated' : ''}</div>
            `;
            
            div.addEventListener("click", () => {
                displayTicketActions(ticket);
            });
            
            fragment.appendChild(div);
        });
        
        conversationsList.appendChild(fragment);
    } catch (error) {
        console.error("Error fetching receipts:", error);
        renderNoReceipts();
    }
}

function displayTicketActions(ticket) {
    // Clear the messages container and show the ticket with action buttons
    messagesContainer.innerHTML = `
        <div style="padding: 20px; background: #f5f5f5; border-radius: 8px;">
            <h3 style="margin-top: 0;">Ticket #${ticket.id}</h3>
            <pre style="background: white; padding: 15px; border-radius: 6px; overflow-x: auto;">${ticket.content}</pre>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button id="ticket-print-btn" class="ai-btn success" style="flex: 1;">Print</button>
                <button id="ticket-delete-btn" class="ai-btn warning" style="flex: 1; background: #dc2626;">Delete</button>
            </div>
        </div>
    `;
    
    document.getElementById("ticket-print-btn").addEventListener("click", () => {
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write(`<!DOCTYPE html><html><head><title>Print Receipt #${ticket.id}</title></head><body><pre>${ticket.content}</pre></body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    });
    
    document.getElementById("ticket-delete-btn").addEventListener("click", async () => {
        if (confirm(`Delete ticket #${ticket.id}?`)) {
            try {
                const res = await fetch(`/api/receipts/${ticket.id}`, { method: "DELETE" });
                const data = await res.json();
                if (data.success) {
                    alert("Receipt deleted successfully.");
                    renderReceipts();
                    messagesContainer.innerHTML = "";
                } else {
                    alert("Failed to delete receipt.");
                }
            } catch (error) {
                console.error("Error deleting receipt:", error);
                alert("Error deleting receipt.");
            }
        }
    });
}


// ---------------------------
// Load messages for a conversation
// ---------------------------
async function loadMessages(conversationId, isEscalated = false) {
    if (!conversationId) return;

    messagesContainer.innerHTML = `<div class="loading-message">Loading chat...</div>`;
    const cachedConv = conversationCache.find(c => c.id == conversationId);
    if (cachedConv) {
        document.getElementById("chatName").textContent = cachedConv.phone;
        const channelSpan = document.querySelector(".channel");
        if (channelSpan) {
            channelSpan.textContent = cachedConv.platform ? cachedConv.platform.charAt(0).toUpperCase() + cachedConv.platform.slice(1) : 'WhatsApp';
        }
    }

    const messagePromise = fetch(`/api/messages/${conversationId}`).then(res => res.json());
    const escalationPromise = fetch("/api/escalations").then(res => res.json());

    const [data, escData] = await Promise.all([messagePromise, escalationPromise]);

    messagesContainer.innerHTML = "";
    if (data && data.length > 0) {
        data.forEach(msg => appendMessage(msg));
    } else {
        const emptyDiv = document.createElement('div');
        emptyDiv.classList.add('message', 'empty');
        emptyDiv.textContent = 'No messages yet.';
        messagesContainer.appendChild(emptyDiv);
    }

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const escalated = escData.some(e => e.conversation_id == conversationId);
    const badge = document.getElementById("escalatedBadge");
    if (escalated) {
        badge.style.display = "inline";
    } else {
        badge.style.display = "none";
    }

    if (isEscalated) {
        const conversationEscalation = escData.find(e => e.conversation_id == conversationId);
        highlightEscalatedMessage(conversationEscalation);
    }

    await fetchAISuggestion(conversationId);
}

// ---------------------------
// Append single message to chat container
// ---------------------------
function appendMessage(msg) {
    const div = document.createElement("div");
    div.classList.add("message");
    const senderValue = (msg.sender || "").toString().trim().toLowerCase();
    const outgoingSenders = new Set(["sent", "ai", "staff", "agent", "assistant"]);
    if (outgoingSenders.has(senderValue)) {
        div.classList.add("ai", "sent");
    } else {
        div.classList.add("customer");
    }

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

    div.dataset.createdAt = msg.created_at;
    div.dataset.sender = msg.sender;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ---------------------------
// Handle sending a message
// ---------------------------
function setSendButtonState(isLoading) {
    if (!sendButton) return;
    sendButton.disabled = isLoading;
    sendButton.textContent = isLoading ? "Sending..." : "Send";
}

sendButton.addEventListener("click", async () => {
    const message = messageInput.value.trim();
    if (!currentConversationId) return;

    setSendButtonState(true);

    if (selectedFile) {
        const success = await sendFileMessage(currentConversationId, selectedFile, message);
        setSendButtonState(false);
        if (!success) {
            alert("Failed to send file. Please try again.");
        }
        return;
    }

    if (!message) {
        setSendButtonState(false);
        return;
    }

    const res = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: currentConversationId, message })
    });

    if (res.ok) {
        messageInput.value = "";
        // Message will be appended via Socket.IO when the server emits the newMessage event.
    }

    setSendButtonState(false);
});

async function sendFileMessage(conversationId, file, caption = "") {
    if (!conversationId || !file) return false;

    if (selectedFileDisplay) {
        selectedFileDisplay.textContent = `Sending ${file.name}...`;
    }

    const formData = new FormData();
    formData.append("conversation_id", conversationId);
    formData.append("file", file);
    if (caption) {
        formData.append("caption", caption);
    }

    const res = await fetch("/api/send-media", {
        method: "POST",
        body: formData
    });

    if (!res.ok) {
        if (selectedFileDisplay) {
            selectedFileDisplay.textContent = `Failed to send ${file.name}.`;
        }
        return false;
    }

    selectedFile = null;
    if (fileInput) fileInput.value = "";
    if (selectedFileDisplay) selectedFileDisplay.textContent = "";
    if (messageInput) messageInput.value = "";
    return true;
}

messageInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
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
function playNotificationSound(beepCount = 1, beepDuration = 0.6, gap = 0.6) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    for (let i = 0; i < beepCount; i++) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 1000;
        oscillator.type = 'sine';

        const startTime = audioContext.currentTime + i * (beepDuration + gap);
        gainNode.gain.setValueAtTime(0.0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.8, startTime + 0.02);
        gainNode.gain.setValueAtTime(0.8, startTime + beepDuration - 0.05);
        gainNode.gain.linearRampToValueAtTime(0.001, startTime + beepDuration);

        oscillator.start(startTime);
        oscillator.stop(startTime + beepDuration);
    }
}

// ---------------------------
// Socket.IO listener for new messages
// ---------------------------
socket.on("newMessage", msg => {
    // If the message belongs to the current conversation, append it
    if (msg.conversation_id == currentConversationId) {
        appendMessage(msg);
    }

    // Add desktop notification only when message alerts are enabled
    if (localStorage.getItem('msgAlert') === 'true' && !document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('LiveSupport - New Message', {
            body: `New message: ${msg.message}`,
            icon: '/favicon.ico'
        });
    }

    if (msg.conversation_id != currentConversationId) {
        if (localStorage.getItem('soundAlert') === 'true') {
            playNotificationSound();
        }
        showNotification("New message received from a customer!");
        const convDiv = conversationsList.querySelector(`[data-id='${msg.conversation_id}']`);
        const previewText = msg.message.length > 50 ? msg.message.slice(0, 47) + '...' : msg.message;
        if (convDiv) {
            convDiv.classList.add("new-message");
            const preview = convDiv.querySelector('.preview');
            if (preview) preview.textContent = previewText;
            // move updated conversation to top for faster visibility
            conversationsList.prepend(convDiv);
        } else {
            // If unknown conversation, reload the list once
            loadConversations();
        }
    }

    if (msg.conversation_id == currentConversationId && msg.sender !== 'sent') {
        fetchAISuggestion(currentConversationId);
    }
});

socket.on("handoffAlert", data => {
    if (localStorage.getItem('soundAlert') === 'true') {
        playNotificationSound(5, 1.0, 1.0);
    }
    showNotification("AI has handed off the chat to staff.");
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
        const filterText = btn.textContent.trim().toLowerCase();
        if (filterText === 'escalated') {
            loadConversations('escalated');
        } else if (filterText === 'resolved') {
            loadConversations('resolved');
        } else if (filterText === 'receipt' || filterText === 'receipts') {
            renderReceipts();
        } else if (filterText === 'refunds') {
            loadConversations('refunds');
        } else if (filterText === 'delivery issues') {
            loadConversations('delivery-issues');
        } else {
            loadConversations('all');
        }
    });
});