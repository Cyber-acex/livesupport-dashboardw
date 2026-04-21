// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTickets);
} else {
    initTickets();
}

function initTickets() {
    // Connect to Socket.IO
    const socket = io();

    const ticketList = document.getElementById("ticketList");
    const emptyState = document.getElementById("emptyState");
    const ticketNotificationBar = document.getElementById("ticketNotificationBar");
    const ticketNotificationText = document.getElementById("ticketNotificationText");

    if (!ticketList || !emptyState) {
        console.error("Required DOM elements not found. Check that ticketList and emptyState elements exist.");
        return;
    }

    // Store tickets in memory for easy updates
    let ticketsData = [];

    // Show notification
    function showTicketNotification(message) {
        if (!ticketNotificationBar || !ticketNotificationText) return;
        ticketNotificationText.textContent = message;
        ticketNotificationBar.style.display = "block";
        clearTimeout(showTicketNotification.timeout);
        showTicketNotification.timeout = setTimeout(() => {
            ticketNotificationBar.style.display = "none";
        }, 5000);
    }

    // Render a single ticket element
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

        // Escalate button
        div.querySelector(".escalateBtn").onclick = async () => {
            await fetch("/api/escalate-ticket", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket_id: ticket.id })
            });
        };

        // Print button
        div.querySelector(".printTicketBtn").onclick = () => {
            const printWindow = window.open('', '', 'height=600,width=800');
            printWindow.document.write('<pre>' + ticket.content + '</pre>');
            printWindow.document.close();
            printWindow.print();
        };

        // Delete button
        div.querySelector(".deleteTicketBtn").onclick = async () => {
            if (confirm("Are you sure you want to delete this ticket?")) {
                await fetch(`/api/tickets/${ticket.id}`, {
                    method: "DELETE"
                });
            }
        };

        return div;
    }

    // Update the ticket list UI
    function updateTicketListUI() {
        ticketList.innerHTML = "";

        if (ticketsData.length === 0) {
            emptyState.style.display = "block";
            return;
        }

        emptyState.style.display = "none";
        ticketsData.forEach(ticket => {
            ticketList.appendChild(renderTicketElement(ticket));
        });
    }

    // Load tickets from backend on initial load
    async function loadTickets() {
        try {
            const res = await fetch("/api/tickets");
            if (!res.ok) {
                console.error("Failed to fetch tickets:", res.status);
                return;
            }
            const data = await res.json();
            console.log("Fetched tickets from /api/tickets:", data);
            ticketsData = data;
            updateTicketListUI();
            console.log("Tickets loaded:", ticketsData.length);
        } catch (error) {
            console.error("Error loading tickets:", error);
        }
    }

    // Socket.IO event listeners
    socket.on("ticketCreated", (ticket) => {
        console.log("New ticket created in real-time:", ticket);
        ticketsData.unshift(ticket);
        updateTicketListUI();
        showTicketNotification(`Ticket #${ticket.id} created successfully!`);
    });

    socket.on("ticketDeleted", (data) => {
        console.log("Ticket deleted:", data);
        ticketsData = ticketsData.filter(t => t.id !== data.id);
        updateTicketListUI();
        showTicketNotification(`Ticket #${data.id} deleted.`);
    });

    socket.on("ticketEscalated", (data) => {
        console.log("Ticket escalated:", data);
        const ticket = ticketsData.find(t => t.id === data.ticket_id);
        if (ticket) {
            ticket.escalated = 1;
            const ticketElement = document.getElementById(`ticket-${ticket.id}`);
            if (ticketElement) {
                const escalatedLabel = ticketElement.querySelector(".escalated-label");
                if (escalatedLabel) {
                    escalatedLabel.style.display = "block";
                }
            }
            showTicketNotification(`Ticket #${data.ticket_id} escalated!`);
        }
    });

    // Load tickets on page load
    loadTickets();
}
// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTickets);
} else {
    initTickets();
}

function initTickets() {
    // Connect to Socket.IO
    const socket = io();

    const ticketList = document.getElementById("ticketList");
    const emptyState = document.getElementById("emptyState");
    const ticketNotificationBar = document.getElementById("ticketNotificationBar");
    const ticketNotificationText = document.getElementById("ticketNotificationText");

    if (!ticketList || !emptyState) {
        console.error("Required DOM elements not found. Check that ticketList and emptyState elements exist.");
        return;
    }

    // Store tickets in memory for easy updates
    let ticketsData = [];

    // Show notification
    function showTicketNotification(message) {
        if (!ticketNotificationBar || !ticketNotificationText) return;
        ticketNotificationText.textContent = message;
        ticketNotificationBar.style.display = "block";
        clearTimeout(showTicketNotification.timeout);
        showTicketNotification.timeout = setTimeout(() => {
            ticketNotificationBar.style.display = "none";
        }, 5000);
    }

    // Render a single ticket element
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

    // Escalate button
    div.querySelector(".escalateBtn").onclick = async () => {
        await fetch("/api/escalate-ticket", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket_id: ticket.id })
        });
    };

    // Print button
    div.querySelector(".printTicketBtn").onclick = () => {
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write('<pre>' + ticket.content + '</pre>');
        printWindow.document.close();
        printWindow.print();
    };

    // Delete button
    div.querySelector(".deleteTicketBtn").onclick = async () => {
        if (confirm("Are you sure you want to delete this ticket?")) {
            await fetch(`/api/tickets/${ticket.id}`, {
                method: "DELETE"
            });
        }
    };

    return div;
    }

    // Update the ticket list UI
    function updateTicketListUI() {
    ticketList.innerHTML = "";

    if (ticketsData.length === 0) {
        emptyState.style.display = "block";
        return;
    }

    emptyState.style.display = "none";
    ticketsData.forEach(ticket => {
        ticketList.appendChild(renderTicketElement(ticket));
    });
}

// Load tickets from backend on initial load
async function loadTickets() {
    try {
        const res = await fetch("/api/tickets");
        const data = await res.json();
        ticketsData = data;
        updateTicketListUI();
    } catch (error) {
        console.error("Error loading tickets:", error);
    }
}

// Socket.IO event listeners
socket.on("ticketCreated", (ticket) => {
    console.log("New ticket created in real-time:", ticket);
    ticketsData.unshift(ticket); // Add to beginning of array
    updateTicketListUI();
    showTicketNotification(`Ticket #${ticket.id} created successfully!`);
});

socket.on("ticketDeleted", (data) => {
    console.log("Ticket deleted:", data);
    ticketsData = ticketsData.filter(t => t.id !== data.id);
    updateTicketListUI();
    showTicketNotification(`Ticket #${data.id} deleted.`);
});

socket.on("ticketEscalated", (data) => {
    console.log("Ticket escalated:", data);
    const ticket = ticketsData.find(t => t.id === data.ticket_id);
    if (ticket) {
        ticket.escalated = 1;
        const ticketElement = document.getElementById(`ticket-${ticket.id}`);
        if (ticketElement) {
            const escalatedLabel = ticketElement.querySelector(".escalated-label");
            if (escalatedLabel) {
                escalatedLabel.style.display = "block";
            }
        }
        showTicketNotification(`Ticket #${data.ticket_id} escalated!`);
    }
});

// Load tickets from backend on initial load
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
        console.log("Tickets loaded:", ticketsData.length);
    } catch (error) {
        console.error("Error loading tickets:", error);
    }
}

// Socket.IO event listeners - moved above
socket.on("ticketCreated", (ticket) => {
    console.log("New ticket created in real-time:", ticket);
    ticketsData.unshift(ticket);
    updateTicketListUI();
    showTicketNotification(`Ticket #${ticket.id} created successfully!`);
});

socket.on("ticketDeleted", (data) => {
    console.log("Ticket deleted:", data);
    ticketsData = ticketsData.filter(t => t.id !== data.id);
    updateTicketListUI();
    showTicketNotification(`Ticket #${data.id} deleted.`);
});

socket.on("ticketEscalated", (data) => {
    console.log("Ticket escalated:", data);
    const ticket = ticketsData.find(t => t.id === data.ticket_id);
    if (ticket) {
        ticket.escalated = 1;
        const ticketElement = document.getElementById(`ticket-${ticket.id}`);
        if (ticketElement) {
            const escalatedLabel = ticketElement.querySelector(".escalated-label");
            if (escalatedLabel) {
                escalatedLabel.style.display = "block";
            }
        }
        showTicketNotification(`Ticket #${data.ticket_id} escalated!`);
    }
});

loadTickets();