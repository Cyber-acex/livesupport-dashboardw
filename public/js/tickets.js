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

    function showTicketNotification(message) {
        if (!ticketNotificationBar || !ticketNotificationText) return;
        ticketNotificationText.textContent = message;
        ticketNotificationBar.style.display = "block";
        clearTimeout(showTicketNotification.timeout);
        showTicketNotification.timeout = setTimeout(() => {
            ticketNotificationBar.style.display = "none";
        }, 5000);
    }

    function renderTicketElement(ticket) {
        const div = document.createElement("div");
        div.classList.add("ticketItem");
        div.id = `ticket-${ticket.id}`;

        div.innerHTML = `
            <div class="ticket-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h4>Ticket #${ticket.id} (${new Date(ticket.created_at).toLocaleString()})</h4>
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

    loadTickets();
}

// Wait for DOM ready then init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTickets);
} else {
    initTickets();
}