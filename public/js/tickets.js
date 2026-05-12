// Tickets UI initialization
function initTickets() {
    const socket = io();

    const ticketList = document.getElementById("ticketList");
    const emptyState = document.getElementById("emptyState");
    const ticketNotificationBar = document.getElementById("ticketNotificationBar");
    const ticketNotificationText = document.getElementById("ticketNotificationText");

    if (!ticketList || !emptyState) {
        console.error("Required DOM elements not found. Check that ticketList and emptyState elements exist.");
        return;
    }

    let ticketsData = [];

    function saveNotification(message, source = 'Ticket', type = 'ticket') {
        try {
            const key = 'liveSupportNotifications';
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            list.unshift({ message, source, type, time: new Date().toISOString() });
            localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
        } catch (e) {
            console.error('Save notification failed', e);
        }
    }

    function showTicketNotification(message) {
        if (!ticketNotificationBar || !ticketNotificationText) return;
        ticketNotificationText.textContent = message;
        ticketNotificationBar.style.display = "block";
        clearTimeout(showTicketNotification.timeout);
        showTicketNotification.timeout = setTimeout(() => {
            ticketNotificationBar.style.display = "none";
        }, 5000);
        saveNotification(message, 'Ticket', 'ticket');
    }

    function renderTicketElement(ticket) {
        const div = document.createElement("div");
        div.classList.add("ticketItem");
        div.id = `ticket-${ticket.id}`;

        const statusText = ticket.status ? ticket.status : 'Open';
        const assigneeText = ticket.assignee ? `Assigned to: ${ticket.assignee}` : 'Unassigned';
        div.innerHTML = `
            <div class="ticket-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display:flex;align-items:center;gap:10px">
                  <h4 style="margin:0">Ticket #${ticket.id} (${new Date(ticket.created_at).toLocaleString()})</h4>
                  <span class="status-badge" title="${statusText}" style="margin-left:8px;font-size:12px;padding:6px 8px;border-radius:999px;background:#eef2ff;color:#0f172a">${statusText}</span>
                  <span class="assignee-badge" title="${assigneeText}" style="font-size:12px;padding:6px 8px;border-radius:999px;background:#dbeafe;color:#1e40af">${assigneeText}</span>
                </div>
                <div>
                    <button class="escalateBtn" style="background: red; color: white; border: none; padding: 5px 10px; margin-right: 5px;">Escalate</button>
                    <button class="printTicketBtn" style="background: blue; color: white; border: none; padding: 5px 10px;">Print</button>
                    <button class="deleteTicketBtn" style="background: darkred; color: white; border: none; padding: 5px 10px; margin-left: 5px;">Delete</button>
                </div>
            </div>
            <div class="escalated-label" style="display: ${ticket.escalated ? 'block' : 'none'}; color: red; font-weight: bold; text-align: center; margin-bottom: 10px; font-size: 18px;">ESCALATED</div>
            <pre>${ticket.content}</pre>
        `;

        div.querySelector(".escalateBtn").onclick = async () => {
            await fetch("/api/escalate-ticket", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket_id: ticket.id })
            });
        };

        div.querySelector(".printTicketBtn").onclick = () => {
            const printWindow = window.open('', '', 'height=600,width=800');
            printWindow.document.write('<pre>' + ticket.content + '</pre>');
            printWindow.document.close();
            printWindow.print();
        };

        div.querySelector(".deleteTicketBtn").onclick = async () => {
            if (confirm("Are you sure you want to delete this ticket?")) {
                await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
            }
        };

        return div;
    }

    function updateTicketListUI() {
        ticketList.innerHTML = "";
        if (ticketsData.length === 0) {
            emptyState.style.display = "block";
            return;
        }
        emptyState.style.display = "none";
        ticketsData.forEach(ticket => ticketList.appendChild(renderTicketElement(ticket)));
    }

    async function loadTickets() {
        try {
            const res = await fetch("/api/tickets");
            if (!res.ok) {
                console.error("Failed to fetch tickets:", res.status);
                return;
            }
            const data = await res.json();
            ticketsData = data;
            updateTicketListUI();
        } catch (error) {
            console.error("Error loading tickets:", error);
        }
    }

    socket.on("ticketCreated", (ticket) => {
        ticketsData.unshift(ticket);
        updateTicketListUI();
        showTicketNotification(`Ticket #${ticket.id} created successfully!`);
    });

    socket.on("ticketDeleted", (data) => {
        ticketsData = ticketsData.filter(t => t.id !== data.id);
        updateTicketListUI();
        showTicketNotification(`Ticket #${data.id} deleted.`);
    });

    socket.on("ticketEscalated", (data) => {
        const ticket = ticketsData.find(t => t.id === data.ticket_id);
        if (ticket) {
            ticket.escalated = 1;
            const ticketElement = document.getElementById(`ticket-${ticket.id}`);
            if (ticketElement) {
                const escalatedLabel = ticketElement.querySelector(".escalated-label");
                if (escalatedLabel) escalatedLabel.style.display = "block";
            }
            showTicketNotification(`Ticket #${data.ticket_id} escalated!`);
        }
    });

    socket.on("ticketResolved", (data) => {
        const ticket = ticketsData.find(t => t.id === data.ticket_id);
        if (ticket) {
            ticket.status = 'Resolved';
            const ticketElement = document.getElementById(`ticket-${ticket.id}`);
            if (ticketElement) {
                const statusEl = ticketElement.querySelector('.status-badge');
                if (statusEl) { statusEl.textContent = 'Resolved'; statusEl.setAttribute('title','Resolved'); statusEl.style.background = '#bbf7d0'; statusEl.style.color = '#065f46'; }
            }
            if (data && data.resolved_by) showTicketNotification(`Ticket #${data.ticket_id} resolved by ${data.resolved_by}`);
            else showTicketNotification(`Ticket #${data.ticket_id} marked resolved`);
        }
    });

    loadTickets();
}

// Wait for DOM ready then init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTickets);
} else {
    initTickets();
}