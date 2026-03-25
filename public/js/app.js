const socket = io("http://localhost:3000");
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

    addMessage(messageText, "customer"); // reuse styling for now
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

    addMessage(data.message, "customer");

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
    const res = await fetch("http://localhost:3000/conversations");
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

