// Tracking System with Leaflet Map and Simulation
// ================================================

// Map and markers storage
let map;
const deliveryMarkers = new Map();
const deliveryPolylines = new Map();
const deliverySimulations = new Map();
const activeDeliveries = new Map();

// Ikeja, Lagos coordinates as default center
const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792 };

// Initialize the map
function initMap() {
  map = L.map('map').setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  console.log('✓ Map initialized with Leaflet.js');
}

// Load active deliveries from the server
async function loadActiveDeliveries() {
  try {
    const response = await fetch('/api/deliveries/active');
    const deliveries = await response.json();

    if (Array.isArray(deliveries)) {
      deliveries.forEach(delivery => {
        addDeliveryToMap(delivery);
        activeDeliveries.set(delivery.id, delivery);
      });
      updateDeliveriesList();
      console.log(`✓ Loaded ${deliveries.length} active deliveries`);
    }
  } catch (error) {
    console.warn('Could not load deliveries from server:', error.message);
  }
}

// Add a delivery to the map
function addDeliveryToMap(delivery) {
  const { id, rider_name, vehicle, current_lat, current_lng, customer_lat, customer_lng, delivery_status, order_id } = delivery;

  // Skip if no coordinates
  if (!current_lat || !current_lng) return;

  // Create or update rider marker
  const riderIcon = L.divIcon({
    html: `<div style="background: #007bff; color: white; padding: 6px 10px; border-radius: 4px; font-weight: 600; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">${vehicle ? vehicle[0].toUpperCase() : 'R'}</div>`,
    className: 'rider-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  let marker = deliveryMarkers.get(id);
  if (marker) {
    marker.setLatLng([current_lat, current_lng]);
  } else {
    marker = L.marker([current_lat, current_lng], { icon: riderIcon }).addTo(map);
    marker.bindPopup(`
      <div style="font-size: 12px;">
        <strong>${rider_name || 'Rider'}</strong><br>
        Vehicle: ${vehicle || 'Unknown'}<br>
        Order: ${order_id}<br>
        Status: <strong>${delivery_status || 'pending'}</strong>
      </div>
    `);
    deliveryMarkers.set(id, marker);
  }

  // Create customer marker
  if (customer_lat && customer_lng) {
    const customerIcon = L.divIcon({
      html: `<div style="background: #28a745; color: white; padding: 6px 10px; border-radius: 4px; font-weight: 600; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">📍</div>`,
      className: 'customer-icon',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const customerId = `${id}-customer`;
    let customerMarker = deliveryMarkers.get(customerId);
    if (!customerMarker) {
      customerMarker = L.marker([customer_lat, customer_lng], { icon: customerIcon }).addTo(map);
      customerMarker.bindPopup(`<div style="font-size: 12px;"><strong>Customer Location</strong></div>`);
      deliveryMarkers.set(customerId, customerMarker);
    }
  }

  // Draw path from rider to customer
  if (customer_lat && customer_lng) {
    const polylineId = `${id}-path`;
    let polyline = deliveryPolylines.get(polylineId);
    const pathColor = delivery_status === 'delivered' ? '#28a745' : '#007bff';
    
    if (polyline) {
      polyline.setLatLngs([[current_lat, current_lng], [customer_lat, customer_lng]]);
      polyline.setStyle({ color: pathColor });
    } else {
      polyline = L.polyline([[current_lat, current_lng], [customer_lat, customer_lng]], {
        color: pathColor,
        weight: 2,
        opacity: 0.7,
        dashArray: delivery_status === 'delivered' ? '' : '5, 5',
      }).addTo(map);
      deliveryPolylines.set(polylineId, polyline);
    }
  }
}

// Update the deliveries list panel
function updateDeliveriesList() {
  const list = document.getElementById('deliveriesList');
  const deliveries = Array.from(activeDeliveries.values());

  if (deliveries.length === 0) {
    list.innerHTML = '<div class="no-deliveries">No active deliveries</div>';
    return;
  }

  list.innerHTML = deliveries
    .map(d => `
      <div class="delivery-item ${d.isActive ? 'active' : ''}" onclick="focusDelivery(${d.id})">
        <div class="delivery-header">
          <span>${d.order_id || `Order #${d.id}`}</span>
          <span class="delivery-status ${d.delivery_status}">${d.delivery_status || 'pending'}</span>
        </div>
        <div class="delivery-info">
          <div><label>Rider:</label> ${d.rider_name || 'Pending'}</div>
          <div><label>Vehicle:</label> ${d.vehicle || 'Unknown'}</div>
          <div><label>Distance:</label> ${d.distance ? d.distance.toFixed(2) + ' km' : 'N/A'}</div>
          <div><label>ETA:</label> ${d.eta || 'Calculating...'}</div>
        </div>
      </div>
    `)
    .join('');
}

// Focus on a delivery on the map
function focusDelivery(deliveryId) {
  const delivery = activeDeliveries.get(deliveryId);
  if (!delivery) return;

  const marker = deliveryMarkers.get(deliveryId);
  if (marker) {
    map.setView(marker.getLatLng(), 15);
    marker.openPopup();
  }

  // Update UI
  document.querySelectorAll('.delivery-item').forEach(item => item.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

// Center map on first active delivery
function centerMapOnDelivery() {
  const firstDelivery = Array.from(activeDeliveries.values())[0];
  if (firstDelivery && firstDelivery.current_lat && firstDelivery.current_lng) {
    map.setView([firstDelivery.current_lat, firstDelivery.current_lng], 14);
  } else {
    map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);
  }
}

// Zoom to fit all deliveries
function zoomToFitDeliveries() {
  if (deliveryMarkers.size === 0) return;

  const bounds = L.latLngBounds([]);
  for (let [key, marker] of deliveryMarkers) {
    if (!key.includes('customer')) bounds.extend(marker.getLatLng());
  }

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

// Clear all markers
function clearAllMarkers() {
  if (confirm('Clear all markers from the map?')) {
    deliveryMarkers.forEach(marker => map.removeLayer(marker));
    deliveryPolylines.forEach(polyline => map.removeLayer(polyline));
    deliveryMarkers.clear();
    deliveryPolylines.clear();
    activeDeliveries.clear();
    updateDeliveriesList();
    console.log('✓ All markers cleared');
  }
}

// Generate a test delivery for simulation
function generateTestDelivery() {
  const testDeliveryId = Math.floor(Math.random() * 10000);
  const startLat = DEFAULT_CENTER.lat + (Math.random() - 0.5) * 0.05;
  const startLng = DEFAULT_CENTER.lng + (Math.random() - 0.5) * 0.05;
  const endLat = DEFAULT_CENTER.lat + (Math.random() - 0.5) * 0.05;
  const endLng = DEFAULT_CENTER.lng + (Math.random() - 0.5) * 0.05;

  const testDelivery = {
    id: testDeliveryId,
    order_id: `TEST-${Date.now()}`,
    rider_name: `Rider ${Math.floor(Math.random() * 100)}`,
    vehicle: ['Motorcycle', 'Car', 'Bicycle'][Math.floor(Math.random() * 3)],
    current_lat: startLat,
    current_lng: startLng,
    customer_lat: endLat,
    customer_lng: endLng,
    delivery_status: 'in-transit',
    distance: calculateDistance(startLat, startLng, endLat, endLng),
    eta: '8 mins',
  };

  activeDeliveries.set(testDeliveryId, testDelivery);
  addDeliveryToMap(testDelivery);
  updateDeliveriesList();

  console.log(`✓ Test delivery created: ${testDelivery.order_id}`);
}

// Start simulation for a delivery
function startSimulation() {
  const deliveries = Array.from(activeDeliveries.values());
  if (deliveries.length === 0) {
    alert('Please add or load deliveries first');
    return;
  }

  // Start simulation for first unstarted delivery
  for (let delivery of deliveries) {
    if (!deliverySimulations.has(delivery.id)) {
      simulateDeliveryMovement(delivery.id);
      alert(`Simulating delivery: ${delivery.order_id}`);
      return;
    }
  }

  alert('All deliveries are already simulating!');
}

// Stop all simulations
function stopAllSimulations() {
  deliverySimulations.forEach((intervalId, deliveryId) => {
    clearInterval(intervalId);
  });
  deliverySimulations.clear();
  console.log('✓ All simulations stopped');
}

// Simulate delivery movement
function simulateDeliveryMovement(deliveryId) {
  if (deliverySimulations.has(deliveryId)) return;

  const delivery = activeDeliveries.get(deliveryId);
  if (!delivery) return;

  let progress = 0;
  const startLat = delivery.current_lat;
  const startLng = delivery.current_lng;
  const endLat = delivery.customer_lat;
  const endLng = delivery.customer_lng;

  const intervalId = setInterval(() => {
    progress += 0.01; // 1% per update

    if (progress >= 1) {
      progress = 1;
      delivery.delivery_status = 'delivered';
      delivery.current_lat = endLat;
      delivery.current_lng = endLng;
      clearInterval(intervalId);
      deliverySimulations.delete(deliveryId);
      console.log(`✓ Delivery ${delivery.order_id} completed`);
    } else {
      delivery.delivery_status = progress < 0.5 ? 'picked-up' : 'in-transit';
    }

    // Interpolate position
    delivery.current_lat = startLat + (endLat - startLat) * progress;
    delivery.current_lng = startLng + (endLng - startLng) * progress;

    // Update distance and ETA
    const remainingDist = calculateDistance(
      delivery.current_lat,
      delivery.current_lng,
      endLat,
      endLng
    );
    delivery.distance = remainingDist;
    delivery.eta = Math.ceil(remainingDist * 80) + ' mins'; // ~80 km/h

    // Update map
    addDeliveryToMap(delivery);
    updateDeliveriesList();
  }, 1000);

  deliverySimulations.set(deliveryId, intervalId);
  console.log(`▶️ Started simulation for delivery ${delivery.order_id}`);
}

// Calculate distance between two coordinates (km)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Initialize on page load
window.addEventListener('load', () => {
  initMap();
  loadActiveDeliveries();
  console.log('🚀 Tracking system loaded');
});

// Refresh deliveries every 5 seconds when page is visible
setInterval(() => {
  if (!document.hidden) {
    // Only refresh if user is actively looking at the page
  }
}, 5000);

// Search for order by Order ID
async function searchOrderById() {
  const orderId = document.getElementById('orderSearchInput').value.trim();
  
  if (!orderId) {
    alert('Please enter an Order ID');
    return;
  }

  try {
    const response = await fetch(`/api/tracking/${orderId}`);
    if (!response.ok) {
      alert('Order not found');
      document.getElementById('searchResult').classList.remove('visible');
      return;
    }

    const orderData = await response.json();
    
    if (!orderData.delivery) {
      alert('This order does not have delivery information yet');
      document.getElementById('searchResult').classList.remove('visible');
      return;
    }

    const delivery = orderData.delivery;
    
    // Add delivery to map if it has coordinates
    if (delivery.current_lat && delivery.current_lng) {
      const deliveryToAdd = {
        id: orderData.id,
        order_id: orderData.order_id,
        rider_name: delivery.rider_name || 'Not Assigned',
        vehicle: delivery.vehicle || 'Unknown',
        current_lat: parseFloat(delivery.current_lat),
        current_lng: parseFloat(delivery.current_lng),
        customer_lat: parseFloat(delivery.customer_lat),
        customer_lng: parseFloat(delivery.customer_lng),
        delivery_status: delivery.status || 'pending',
        distance: calculateDistance(
          parseFloat(delivery.current_lat),
          parseFloat(delivery.current_lng),
          parseFloat(delivery.customer_lat),
          parseFloat(delivery.customer_lng)
        ),
        eta: '-- mins'
      };

      // Add to active deliveries (overwrite if exists)
      activeDeliveries.set(deliveryToAdd.id, deliveryToAdd);
      
      // Update map
      addDeliveryToMap(deliveryToAdd);
      updateDeliveriesList();
      
      // Center map on this delivery
      map.setView([deliveryToAdd.current_lat, deliveryToAdd.current_lng], 15);
      
      // Show search result
      const resultDiv = document.getElementById('searchResult');
      const resultInfo = document.getElementById('searchResultInfo');
      resultInfo.innerHTML = `
        <div><label>Order ID:</label> ${orderData.order_id}</div>
        <div><label>Customer:</label> ${orderData.customer_name}</div>
        <div><label>Rider:</label> ${delivery.rider_name || 'Not Assigned'}</div>
        <div><label>Vehicle:</label> ${delivery.vehicle || 'Unknown'}</div>
        <div><label>Status:</label> <strong>${(delivery.status || 'pending').toUpperCase()}</strong></div>
        <div><label>Current Location:</label> ${delivery.current_lat.toFixed(4)}, ${delivery.current_lng.toFixed(4)}</div>
        <div><label>Distance to Destination:</label> ${deliveryToAdd.distance.toFixed(2)} km</div>
      `;
      resultDiv.classList.add('visible');
      
      console.log(`✓ Found order ${orderData.order_id} - showing on map`);
    } else {
      alert('No location data available for this order yet');
      document.getElementById('searchResult').classList.remove('visible');
    }
  } catch (error) {
    console.error('Error searching order:', error);
    alert('Error searching order: ' + error.message);
  }
}

// Handle Enter key on search input
function handleSearchKeypress(event) {
  if (event.key === 'Enter') {
    searchOrderById();
  }
}
