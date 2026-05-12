
// Orders management
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
let ordersPerPage = 10;
const selectedOrders = new Set();
let currentSort = 'date_desc';
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
      // normalize amount and date fields for safety
      allOrders = allOrders.map(o => ({
        ...o,
        amount: Number(o.amount || o.total || 0),
        date: o.date || (o.created_at || o.createdAt) || new Date().toISOString()
      }));
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
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ordersPerPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIndex = (currentPage - 1) * ordersPerPage;
  const endIndex = startIndex + ordersPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);
  // Build table rows
  tbody.innerHTML = paginatedOrders.map(order => {
    const checked = selectedOrders.has(order.id) ? 'checked' : '';
    const statusLabel = (order.status || '').toString();
    const statusText = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);
    const displayDate = (new Date(order.date)).toLocaleString();
    return `
    <tr data-order-id="${order.id}">
      <td><input type="checkbox" class="row-select" ${checked} onchange="toggleSelectRow(event, '${order.id}')"></td>
      <td>
        <div class="order-id-cell">
          <span class="order-id" onclick="viewOrderDetails('${order.id}')">${order.id}</span>
          <button class="copy-order-btn" onclick="copyOrderId(event, '${order.id}')" aria-label="Copy order ID">📋</button>
        </div>
      </td>
      <td>${order.customerName || ''}</td>
      <td>${order.product || ''}</td>
      <td>$${Number(order.amount || 0).toLocaleString('en-US')}</td>
      <td>
        <span class="status-badge status-${statusLabel}">
          ${statusText}
        </span>
      </td>
      <td>${displayDate}</td>
      <td>
        <div class="order-actions">
          <button class="action-btn view-btn" onclick="viewOrderDetails('${order.id}')">View</button>
          <button class="action-btn edit-btn" onclick="editOrder('${order.id}')">Completed</button>
          <button class="action-btn cancel-btn" onclick="cancelOrder('${order.id}')">Cancel</button>
        </div>
      </td>
    </tr>
    `;
  }).join('');
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
    const matchesSearch = (order.id || '').toString().toLowerCase().includes(searchText) || 
                         (order.customerName || '').toString().toLowerCase().includes(searchText);
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
  // apply sorting after filtering
  sortArray(filteredOrders, currentSort);
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
  openOrderModal(orderId);
}

// Open view/edit modal
function openOrderModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return showNotification('Order not found');
  document.getElementById('view_order_id').value = order.id;
  document.getElementById('view_customerName').value = order.customerName || '';
  document.getElementById('view_product').value = order.product || '';
  document.getElementById('view_amount').value = Number(order.amount || 0).toFixed(2);
  document.getElementById('view_status').value = order.status || 'pending';
  document.getElementById('view_date').value = new Date(order.date).toLocaleString();
  document.getElementById('orderViewModal').style.display = 'flex';
}

function closeOrderViewModal() {
  document.getElementById('orderViewModal').style.display = 'none';
  document.getElementById('orderViewForm').reset();
}

async function saveOrderChanges(event) {
  event.preventDefault();
  const id = document.getElementById('view_order_id').value;
  const customerName = document.getElementById('view_customerName').value;
  const product = document.getElementById('view_product').value;
  const amount = parseFloat(document.getElementById('view_amount').value) || 0;
  const status = document.getElementById('view_status').value;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ customerName, product, amount, status })
    });
    if (res.ok) {
      // update local copy
      const order = allOrders.find(o => o.id === id);
      if (order) {
        order.customerName = customerName;
        order.product = product;
        order.amount = amount;
        order.status = status;
      }
      showNotification('Order updated');
      closeOrderViewModal();
      displayOrders();
    } else {
      const err = await res.json().catch(()=>({}));
      alert('Failed to save: ' + (err.error || res.statusText));
    }
  } catch (e) {
    console.error('Save order error', e);
    alert('Error saving order');
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
// Toggle select all
function toggleSelectAll(checkbox) {
  const rows = document.querySelectorAll('.row-select');
  rows.forEach(r => {
    r.checked = checkbox.checked;
    const id = r.closest('tr')?.getAttribute('data-order-id');
    if (checkbox.checked && id) selectedOrders.add(id);
    if (!checkbox.checked && id) selectedOrders.delete(id);
  });
}
function toggleSelectRow(event, orderId) {
  event.stopPropagation();
  if (event.target.checked) selectedOrders.add(orderId);
  else selectedOrders.delete(orderId);
  // sync header checkbox
  const allRow = document.querySelectorAll('.row-select');
  const checked = document.querySelectorAll('.row-select:checked');
  document.getElementById('selectAllCheckbox').checked = allRow.length === checked.length;
}

function applyBulkAction() {
  const action = document.getElementById('bulkActionSelect').value;
  if (!action) return showNotification('Select a bulk action first');
  if (selectedOrders.size === 0) return showNotification('No orders selected');
  const ids = Array.from(selectedOrders);
  if (action === 'mark_completed') {
    ids.forEach(id => {
      const o = allOrders.find(x => x.id === id);
      if (o) o.status = 'completed';
    });
    // send batch update to server if available
    fetch('/api/orders/bulk', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids, status:'completed'})}).catch(()=>{});
    showNotification(`Marked ${ids.length} orders completed`);
  } else if (action === 'cancel') {
    if (!confirm(`Cancel ${ids.length} orders?`)) return;
    ids.forEach(id => {
      const o = allOrders.find(x => x.id === id);
      if (o) o.status = 'cancelled';
    });
    fetch('/api/orders/bulk', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids, status:'cancelled'})}).catch(()=>{});
    showNotification(`Cancelled ${ids.length} orders`);
  }
  // clear selection after action
  selectedOrders.clear();
  document.getElementById('selectAllCheckbox').checked = false;
  displayOrders();
}

function exportCSV() {
  if (filteredOrders.length === 0) return showNotification('No orders to export');
  const rows = filteredOrders.map(o => ({
    id: o.id,
    customerName: o.customerName,
    product: o.product,
    amount: o.amount,
    status: o.status,
    date: o.date
  }));
  const csv = [Object.keys(rows[0]).join(',')].concat(rows.map(r => Object.values(r).map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','))).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-export-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setPerPage(val) {
  ordersPerPage = Number(val) || 10;
  currentPage = 1;
  displayOrders();
}

function sortOrders(val) {
  currentSort = val;
  sortArray(filteredOrders, val);
  displayOrders();
}

function sortArray(arr, val) {
  if (!arr || !arr.sort) return;
  if (val === 'date_desc') arr.sort((a,b)=> new Date(b.date) - new Date(a.date));
  else if (val === 'date_asc') arr.sort((a,b)=> new Date(a.date) - new Date(b.date));
  else if (val === 'amount_desc') arr.sort((a,b)=> Number(b.amount) - Number(a.amount));
  else if (val === 'amount_asc') arr.sort((a,b)=> Number(a.amount) - Number(b.amount));
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
