
// Orders management
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const ordersPerPage = 10;
// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadStaffName();
  loadOrders();
  setupThemeToggle();
  setupRealtimeUpdates();
});
let socket = null;
function setupRealtimeUpdates() {
  try {
    socket = io();
  } catch (e) {
    console.warn('Socket.io not available:', e);
    return;
  }
  socket.on('connect', () => {
    console.log('Connected to socket server');
  });
  socket.on('order-created', (payload) => {
    console.log('order-created', payload);
    const order = {
      id: payload.id,
      customerName: payload.customerName || 'Customer',
      product: payload.product || '',
      amount: Number(payload.amount || 0),
      status: payload.status || 'pending',
      date: payload.date || new Date().toLocaleDateString()
    };
    // Insert at top
    allOrders.unshift(order);
    filteredOrders = [...allOrders];
    currentPage = 1;
    displayOrders();
    showNotification(`New order ${order.id} received`);
  });
  socket.on('order-updated', (data) => {
    console.log('order-updated', data);
    const oid = data.orderId || data.order_id || data.id;
    const newStatus = data.status;
    let changed = false;
    for (const o of allOrders) {
      if (o.id === oid) {
        o.status = newStatus;
        changed = true;
      }
    }
    if (changed) displayOrders();
  });
  socket.on('delivery-update', (data) => {
    try {
      const orderId = data.order_id || data.orderId || (data.order && data.order.order_id) || null;
      const delivery = data.delivery || data;
      if (!orderId) return;
      let changed = false;
      for (const o of allOrders) {
        if (o.id === orderId) {
          if (delivery && delivery.status) o.status = delivery.status;
          changed = true;
        }
      }
      if (changed) displayOrders();
    } catch (e) {
      console.error('Error handling delivery-update', e);
    }
  });
}
// Load staff name from API
function loadStaffName() {
  fetch("/api/user")
    .then(response => response.json())
    .then(data => {
      document.getElementById('staffName').textContent = data.role;
    })
    .catch(error => {
      console.log("User fetch error:", error);
      document.getElementById('staffName').textContent = 'User';
    });
}
// Load orders from server
async function loadOrders() {
  try {
    const response = await fetch('/api/orders');
    if (response.ok) {
      allOrders = await response.json();
      filteredOrders = [...allOrders];
      displayOrders();
    } else {
      showEmptyState();
    }
  } catch (error) {
    console.error('Error loading orders:', error);
    showEmptyState();
  }
}
// Generate sample orders for demo
function generateSampleOrders() {
  return [
    {
      id: 'ORD-001',
      customerName: 'John Doe',
      product: 'Premium Package',
      amount: 5000,
      status: 'completed',
      date: new Date(2026, 3, 20).toLocaleDateString()
    },
    {
      id: 'ORD-002',
      customerName: 'Jane Smith',
      product: 'Basic Package',
      amount: 2500,
      status: 'processing',
      date: new Date(2026, 3, 22).toLocaleDateString()
    },
    {
      id: 'ORD-003',
      customerName: 'Mike Johnson',
      product: 'Enterprise Package',
      amount: 10000,
      status: 'pending',
      date: new Date(2026, 3, 23).toLocaleDateString()
    },
    {
      id: 'ORD-004',
      customerName: 'Sarah Williams',
      product: 'Standard Package',
      amount: 3500,
      status: 'completed',
      date: new Date(2026, 3, 21).toLocaleDateString()
    },
    {
      id: 'ORD-005',
      customerName: 'Robert Brown',
      product: 'Premium Package',
      amount: 5000,
      status: 'cancelled',
      date: new Date(2026, 3, 19).toLocaleDateString()
    }
  ];
}
// Display orders in table
function displayOrders() {
  const tbody = document.getElementById('ordersTableBody');
  const emptyState = document.getElementById('emptyState');
  if (filteredOrders.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    document.getElementById('pagination').innerHTML = '';
    return;
  }
  emptyState.style.display = 'none';
  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const endIndex = startIndex + ordersPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);
  // Build table rows
  tbody.innerHTML = paginatedOrders.map(order => `
    <tr>
      <td>
        <div class="order-id-cell">
          <span class="order-id" onclick="viewOrderDetails('${order.id}')">${order.id}</span>
          <button class="copy-order-btn" onclick="copyOrderId(event, '${order.id}')" aria-label="Copy order ID">📋</button>
        </div>
      </td>
      <td>${order.customerName}</td>
      <td>${order.product}</td>
      <td>$${order.amount.toLocaleString('en-US')}</td>
      <td>
        <span class="status-badge status-${order.status}">
          ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}
        </span>
      </td>
      <td>${order.date}</td>
      <td>
        <div class="order-actions">
          <button class="action-btn view-btn" onclick="viewOrderDetails('${order.id}')">View</button>
          <button class="action-btn edit-btn" onclick="editOrder('${order.id}')">Completed</button>
          <button class="action-btn cancel-btn" onclick="cancelOrder('${order.id}')">Cancel</button>
        </div>
      </td>
    </tr>
  `).join('');
  // Build pagination
  const paginationDiv = document.getElementById('pagination');
  paginationDiv.innerHTML = '';
  if (totalPages > 1) {
    // Previous button
    if (currentPage > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '← Previous';
      prevBtn.onclick = () => goToPage(currentPage - 1);
      paginationDiv.appendChild(prevBtn);
    }
    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.textContent = i;
      if (i === currentPage) {
        pageBtn.classList.add('active');
      }
      pageBtn.onclick = () => goToPage(i);
      paginationDiv.appendChild(pageBtn);
    }
    // Next button
    if (currentPage < totalPages) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next →';
      nextBtn.onclick = () => goToPage(currentPage + 1);
      paginationDiv.appendChild(nextBtn);
    }
  }
}
// Go to page
function goToPage(page) {
  currentPage = page;
  displayOrders();
  window.scrollTo(0, 0);
}
// Apply filters
function applyFilters() {
  const searchText = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const dateFilter = document.getElementById('dateFilter').value;
  filteredOrders = allOrders.filter(order => {
    // Search filter
    const matchesSearch = order.id.toLowerCase().includes(searchText) || 
                         order.customerName.toLowerCase().includes(searchText);
    // Status filter
    const matchesStatus = !statusFilter || order.status === statusFilter;
    // Date filter
    let matchesDate = true;
    if (dateFilter) {
      const orderDate = new Date(order.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dateFilter === 'today') {
        matchesDate = orderDate.toDateString() === today.toDateString();
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        matchesDate = orderDate >= weekAgo && orderDate <= today;
      } else if (dateFilter === 'month') {
        matchesDate = orderDate.getMonth() === today.getMonth() &&
                     orderDate.getFullYear() === today.getFullYear();
      }
    }
    return matchesSearch && matchesStatus && matchesDate;
  });
  currentPage = 1;
  displayOrders();
}
// Clear filters
function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('statusFilter').value = '';
  document.getElementById('dateFilter').value = '';
  filteredOrders = [...allOrders];
  currentPage = 1;
  displayOrders();
}
// Open new order modal
function openNewOrderModal() {
  document.getElementById('orderModal').style.display = 'flex';
}
// Close order modal
function closeOrderModal() {
  document.getElementById('orderModal').style.display = 'none';
  document.getElementById('orderForm').reset();
}
// Handle create order
async function handleCreateOrder(event) {
  event.preventDefault();
  const customerName = document.getElementById('customerName').value;
  const product = document.getElementById('product').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const status = document.getElementById('orderStatus').value;
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerName,
        product,
        amount,
        status
      })
    });
    if (response.ok) {
      const data = await response.json();
      showNotification('Order created successfully!');
      closeOrderModal();
      loadOrders(); // Reload orders from database
    } else {
      const error = await response.json();
      alert('Failed to create order: ' + (error.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error creating order:', error);
    alert('Error creating order: ' + error.message);
  }
}
// View order details
function viewOrderDetails(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (order) {
    alert(`Order Details:\n\nID: ${order.id}\nCustomer: ${order.customerName}\nProduct: ${order.product}\nAmount: $${order.amount.toLocaleString('en-US')}\nStatus: ${order.status}\nDate: ${order.date}`);
  }
}
function copyOrderId(event, orderId) {
  event.stopPropagation();
  navigator.clipboard.writeText(orderId)
    .then(() => {
      showNotification(`Copied ${orderId} to clipboard.`);
    })
    .catch(error => {
      console.error('Copy failed:', error);
      alert('Unable to copy order ID.');
    });
}
// Mark order completed
function editOrder(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || order.status === 'completed') {
    return;
  }
  fetch(`/api/orders/${orderId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'completed' })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      order.status = 'completed';
      displayOrders();
      showNotification(`Order ${orderId} marked completed.`);
    } else {
      alert('Failed to update order');
    }
  })
  .catch(error => {
    console.error('Error updating order:', error);
    alert('Error updating order');
  });
}
// Cancel order
function cancelOrder(orderId) {
  if (confirm('Are you sure you want to cancel this order?')) {
    const order = allOrders.find(o => o.id === orderId);
    if (order) {
      // Update status on server
      fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'cancelled' })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          order.status = 'cancelled';
          displayOrders();
          showNotification(`Order ${orderId} cancelled!`);
        } else {
          alert('Failed to cancel order');
        }
      })
      .catch(error => {
        console.error('Error cancelling order:', error);
        alert('Error cancelling order');
      });
    }
  }
}
// Show empty state
function showEmptyState() {
  document.getElementById('ordersTableBody').innerHTML = '';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('pagination').innerHTML = '';
}
// Show notification
function showNotification(message) {
  const notificationBar = document.getElementById('notificationBar');
  const notificationText = document.getElementById('notificationText');
  notificationText.textContent = message;
  notificationBar.style.display = 'block';
  setTimeout(() => {
    notificationBar.style.display = 'none';
  }, 3000);
}
// Theme toggle
function setupThemeToggle() {
  const theme = localStorage.getItem('theme') || 'Light';
  if (theme === 'Dark') {
    document.documentElement.classList.add('dark-theme');
  }
}
// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('orderModal');
  if (e.target === modal) {
    closeOrderModal();
  }
});
// Search on Enter key
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        applyFilters();
      }
    });
  }
});
