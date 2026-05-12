document.addEventListener('DOMContentLoaded', function(){
  let lastMenuData = null;
  let favorites = JSON.parse(localStorage.getItem('menuFavorites') || '[]');
  let searchTimeout;
  let showFavoritesOnly = false;

  const menuView = document.getElementById('menu-view');
  const tablesView = document.getElementById('tables-view');
  const tabMenu = document.getElementById('tab-menu');
  const tabTables = document.getElementById('tab-tables');
  const menuContent = document.getElementById('menuContent');
  const tablesContent = document.getElementById('tablesContent');
  const searchInput = document.getElementById('searchInput');
  const sortBy = document.getElementById('sortBy');
  const filterCategory = document.getElementById('filterCategory');
  const favoritesToggle = document.getElementById('favoritesToggle');
  const filterPanel = document.getElementById('filterPanel');

  // ===== Toast notifications =====
  function showToast(message, type='info'){
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:20px;right:20px;padding:14px 18px;background:${type==='success'?'#10b981':type==='error'?'#ef4444':'#3b82f6'};
      color:#fff;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-weight:600;animation:slideInLeft 0.3s ease;
      z-index:10000;max-width:300px;word-wrap:break-word;`;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(), 3000);
  }

  // ===== Tab switching with animation =====
  tabMenu.addEventListener('click', ()=>{
    tabMenu.classList.add('active');
    tabTables.classList.remove('active');
    menuView.style.display='block';
    tablesView.style.display='none';
  });
  tabTables.addEventListener('click', ()=>{
    tabTables.classList.add('active');
    tabMenu.classList.remove('active');
    menuView.style.display='none';
    tablesView.style.display='block';
  });

  // ===== Search with debouncing =====
  searchInput.addEventListener('input', ()=>{
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(()=>{
      filterAndRenderMenu();
      updateStats();
    }, 200);
  });

  // ===== Keyboard shortcuts =====
  document.addEventListener('keydown', (e)=>{
    if(e.ctrlKey && e.key === 'k'){
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if(e.key === 'Escape'){
      searchInput.value = '';
      filterAndRenderMenu();
    }
  });

  // ===== Favorites toggle =====
  favoritesToggle.addEventListener('click', ()=>{
    showFavoritesOnly = !showFavoritesOnly;
    favoritesToggle.style.background = showFavoritesOnly ? 'var(--accent)' : '#fff';
    favoritesToggle.style.color = showFavoritesOnly ? '#fff' : '#000';
    filterAndRenderMenu();
    updateStats();
  });

  // ===== Sort and filter =====
  sortBy.addEventListener('change', filterAndRenderMenu);
  filterCategory.addEventListener('change', filterAndRenderMenu);

  // ===== Modal helpers with animations =====
  const modalOverlay = document.getElementById('modalOverlay');
  const modalContent = document.getElementById('modalContent');
  function showModal(html) {
    modalContent.innerHTML = html;
    modalOverlay.style.display = 'flex';
    modalOverlay.style.animation = 'fadeIn 0.3s ease';
  }
  function closeModal() { 
    modalOverlay.style.animation = 'fadeIn 0.3s ease reverse';
    setTimeout(()=>{ modalOverlay.style.display = 'none'; modalContent.innerHTML = ''; }, 150);
  }
  modalOverlay && modalOverlay.addEventListener('click', (e)=>{ if (e.target === modalOverlay) closeModal(); });

  // ===== Quick view modal with enhanced UI =====
  function showQuickView(category, key, item) {
    const availClass = item.available > 10 ? 'high' : item.available > 5 ? 'medium' : 'low';
    const html = `
      <div style="max-height:80vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
          <h3 style="margin:0;flex:1">${item.name || key}</h3>
          <button onclick="document.querySelector('#modalOverlay').click()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
          <div style="border-radius:12px;height:200px;background:${item.image_url ? `url('${item.image_url}') center/cover` : '#e5e7eb'};display:flex;align-items:center;justify-content:center;font-size:64px"></div>
          <div>
            <div style="font-weight:800;font-size:1.4rem;color:var(--accent);margin-bottom:8px">$${(item.price||0).toFixed(2)}</div>
            <div style="font-size:0.9rem;color:var(--muted);margin-bottom:12px">📍 ${category}</div>
            <div style="padding:8px 10px;border-radius:8px;background:rgba(40,167,69,${item.available > 0 ? '0.15' : '0.15'});margin-bottom:12px">
              <div style="font-weight:600;color:${item.available > 0 ? 'var(--accent-2)' : '#dc2626'}">
                ${item.available > 0 ? '✓ In Stock' : '✗ Out of Stock'}
              </div>
              <div style="font-size:0.85rem;color:var(--muted)">Available: <strong>${item.available}</strong> units</div>
            </div>
            <div style="padding:8px 10px;border-radius:8px;background:#f3f4f6;margin-bottom:16px">
              <div style="font-size:0.85rem;color:#666">Stock Level</div>
              <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-top:6px;overflow:hidden">
                <div style="height:100%;background:${availClass === 'high' ? 'var(--accent-2)' : availClass === 'medium' ? '#f59e0b' : '#dc2626'};width:${Math.min(item.available / 20 * 100, 100)}%"></div>
              </div>
            </div>
            <button onclick="addToCart('${category}', '${key}', '${(item.name||key).replace(/'/g, "\\'")}', ${item.price})" style="width:100%;padding:10px;background:var(--accent-2);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">+ Add to Cart</button>
          </div>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:12px">
          <h4 style="margin:0 0 8px;font-size:0.95rem;font-weight:600">Details</h4>
          <div style="font-size:0.9rem;color:#666;line-height:1.6">Category: <strong>${category}</strong><br>Item Key: <strong>${key}</strong><br>Last Updated: <strong>${new Date().toLocaleDateString()}</strong></div>
        </div>
      </div>`;
    showModal(html);
  }

  // ===== Filter and render menu with sorting and search =====
  function filterAndRenderMenu() {
    if (!lastMenuData) return;
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    const sortType = sortBy.value;
    const categoryFilter = filterCategory.value;
    
    const container = document.createElement('div');
    let totalFound = 0;

    for (const [category, items] of Object.entries(lastMenuData)) {
      if (categoryFilter && categoryFilter !== category) continue;

      const filteredItems = Object.entries(items).filter(([key, item])=>{
        // Favorites filter
        if (showFavoritesOnly && !favorites.includes(`${category}:${key}`)) return false;
        // Search filter
        if (searchTerm && !item.name?.toLowerCase().includes(searchTerm) && !key.toLowerCase().includes(searchTerm)) return false;
        return true;
      });

      if (filteredItems.length === 0) continue;

      // Sort items
      filteredItems.sort(([k1, i1], [k2, i2])=>{
        if (sortType === 'name') return (i1.name||k1).localeCompare(i2.name||k2);
        if (sortType === 'price-low') return (i1.price||0) - (i2.price||0);
        if (sortType === 'price-high') return (i2.price||0) - (i1.price||0);
        if (sortType === 'availability') return (i2.available||0) - (i1.available||0);
        return 0;
      });

      totalFound += filteredItems.length;

      const catEl = document.createElement('div');
      catEl.className = 'menu-category';
      const h = document.createElement('h3');
      h.innerText = category.charAt(0).toUpperCase() + category.slice(1);
      catEl.appendChild(h);

      const grid = document.createElement('div');
      grid.className = 'menu-grid';

      for (const [key, item] of filteredItems) {
        const tileWrap = document.createElement('div');
        tileWrap.className = 'menu-tile';
        tileWrap.setAttribute('data-category', category);
        tileWrap.setAttribute('data-key', key);

        const bg = document.createElement('div');
        bg.className = 'bg';
        if (item.image_url) {
          bg.style.backgroundImage = `url('${item.image_url}')`;
          bg.style.backgroundSize = 'cover';
          bg.style.backgroundPosition = 'center';
        } else {
          let emoji = '🍽️';
          if (category.toLowerCase().includes('pizza') || key.toLowerCase().includes('pizza')) emoji = '🍕';
          else if (category.toLowerCase().includes('burger') || key.toLowerCase().includes('burger')) emoji = '🍔';
          else if (category.toLowerCase().includes('drink') || key.toLowerCase().includes('cola') || key.toLowerCase().includes('coffee')) emoji = '🥤';
          bg.innerText = emoji;
        }

        // Favorite button
        const isFav = favorites.includes(`${category}:${key}`);
        const favBtn = document.createElement('button');
        favBtn.className = `favorite-btn ${isFav ? 'favorited' : ''}`;
        favBtn.innerText = isFav ? '❤️' : '🤍';
        favBtn.addEventListener('click', (e)=>{
          e.stopPropagation();
          toggleFavorite(category, key, favBtn);
        });

        const meta = document.createElement('div');
        meta.className = 'meta';
        const name = document.createElement('div');
        name.className = 'name';
        name.innerText = item.name || key;

        const priceBlock = document.createElement('div');
        priceBlock.className = 'price-block';
        const price = document.createElement('div');
        price.className = 'price';
        price.innerText = `$${(item.price||0).toFixed(2)}`;
        
        const avail = document.createElement('div');
        avail.className = 'avail';
        const availCount = (typeof item.available === 'number') ? item.available : '—';
        const availClass = availCount > 10 ? 'high' : availCount > 5 ? 'medium' : 'low';
        avail.classList.add(availClass);
        avail.innerText = `${availCount} left`;
        
        priceBlock.appendChild(price);
        priceBlock.appendChild(avail);
        meta.appendChild(name);
        meta.appendChild(priceBlock);

        tileWrap.appendChild(bg);
        tileWrap.appendChild(favBtn);
        tileWrap.appendChild(meta);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'padding:0 14px 14px;display:flex;gap:8px';
        const btnAdd = document.createElement('button');
        btnAdd.className = 'tile-actions btn-add';
        btnAdd.innerText = '+ Add';
        btnAdd.style.cssText = 'flex:1;padding:9px 8px;border-radius:8px;border:none;background:var(--accent-2);color:#fff;font-weight:600;transition:all 0.3s;cursor:pointer';
        btnAdd.addEventListener('click', ()=>addToCart(category, key, item.name||key, item.price||0));
        btnAdd.addEventListener('mouseover', ()=>btnAdd.style.transform = 'scale(1.02)');
        btnAdd.addEventListener('mouseout', ()=>btnAdd.style.transform = 'scale(1)');

        const btnView = document.createElement('button');
        btnView.className = 'tile-actions btn-view';
        btnView.innerText = '👁️ View';
        btnView.style.cssText = 'flex:1;padding:9px 8px;border-radius:8px;border:none;background:#e5e7eb;color:#111;font-weight:600;transition:all 0.3s;cursor:pointer';
        btnView.addEventListener('click', ()=>showQuickView(category, key, item));
        btnView.addEventListener('mouseover', ()=>btnView.style.transform = 'scale(1.02)');
        btnView.addEventListener('mouseout', ()=>btnView.style.transform = 'scale(1)');

        actions.appendChild(btnAdd);
        actions.appendChild(btnView);
        tileWrap.appendChild(actions);

        grid.appendChild(tileWrap);
      }

      catEl.appendChild(grid);
      container.appendChild(catEl);
    }

    if (totalFound === 0) {
      const noRes = document.createElement('div');
      noRes.className = 'no-results';
      noRes.innerText = searchTerm ? `No items found for "${searchTerm}"` : 'No items available';
      container.appendChild(noRes);
    }

    menuContent.innerHTML = '';
    menuContent.appendChild(container);
    
    // Show/hide search stats
    if (searchTerm) {
      document.getElementById('statsSearch').style.display = 'block';
      document.getElementById('foundCount').innerText = totalFound;
    } else {
      document.getElementById('statsSearch').style.display = 'none';
    }
  }

  // ===== Toggle favorite =====
  function toggleFavorite(category, key, btn) {
    const fav = `${category}:${key}`;
    if (favorites.includes(fav)) {
      favorites = favorites.filter(f => f !== fav);
      btn.innerText = '🤍';
      btn.classList.remove('favorited');
      showToast('Removed from favorites', 'info');
    } else {
      favorites.push(fav);
      btn.innerText = '❤️';
      btn.classList.add('favorited');
      showToast('Added to favorites!', 'success');
    }
    localStorage.setItem('menuFavorites', JSON.stringify(favorites));
  }

  // ===== Add to cart function =====
  function addToCart(category, key, name, price) {
    let cart = JSON.parse(localStorage.getItem('menuCart') || '[]');
    cart.push({ category, key, name, price, timestamp: Date.now() });
    localStorage.setItem('menuCart', JSON.stringify(cart));
    showToast(`✓ ${name} added to cart!`, 'success');
    updateStats();
  }

  // ===== Update statistics =====
  function updateStats() {
    if (!lastMenuData) return;
    let total = 0, inStock = 0, totalPrice = 0;
    for (const items of Object.values(lastMenuData)) {
      for (const item of Object.values(items)) {
        total++;
        if ((item.available || 0) > 0) inStock++;
        totalPrice += item.price || 0;
      }
    }
    document.getElementById('statsItems').innerText = total;
    document.getElementById('statsInStock').innerText = inStock;
    document.getElementById('statsAvgPrice').innerText = `$${total > 0 ? (totalPrice / total).toFixed(2) : '0.00'}`;
  }

  // Update Menu button flow
  const updateBtn = document.getElementById('updateMenuBtn');
  updateBtn && updateBtn.addEventListener('click', async ()=>{
    try {
      const role = await getCurrentUserRole();
      const r = (role || '').toLowerCase();
      if (r === 'admin' || r === 'manager') {
        openMainUpdateMenu();
      } else {
        showModal(`<div style="padding:12px">This feature is only allowed for Admins and Managers</div><div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="closeRoleMsg">Close</button></div>`);
        const btn = document.getElementById('closeRoleMsg');
        if (btn) btn.addEventListener('click', closeModal);
      }
    } catch (e) {
      console.error('Failed to verify user role', e);
      alert('Unable to verify permissions. Please try again.');
    }
  });

  // ===== Fetch and initialize menu =====
  async function fetchMenu() {
    try {
      menuContent.innerHTML = '<div style="padding:20px;text-align:center">⏳ Loading menu…</div>';
      const res = await fetch('/api/menu');
      if (!res.ok) throw new Error('Failed to load menu');
      const menu = await res.json();
      lastMenuData = menu;
      
      // Populate category filter
      const cats = Object.keys(menu);
      filterCategory.innerHTML = '<option value="">All Categories</option>' + cats.map(c=>`<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
      
      filterAndRenderMenu();
      updateStats();
      showToast('Menu loaded successfully!', 'success');
    } catch (e) {
      menuContent.innerHTML = '<div class="no-results">Failed to load menu. Please refresh the page.</div>';
      console.error(e);
    }
  }

  // Make addToCart global for inline onclick
  window.addToCart = addToCart;
  window.showQuickView = showQuickView;

  // Tables
  async function fetchTables() {
    try {
      const res = await fetch('/api/tables');
      if (!res.ok) throw new Error('Failed to load tables');
      const tables = await res.json();
      renderTables(tables);
    } catch (e) {
      tablesContent.innerText = 'Failed to load tables.';
      console.error(e);
    }
  }

  function renderTables(tables) {
    if (!Array.isArray(tables)) {
      tablesContent.innerText = 'No tables available.';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'tables-grid';
    for (const t of tables) {
      const card = document.createElement('div');
      const statusClass = `status-${t.status || 'available'}`;
      card.className = `table-card ${statusClass}`;
      const name = document.createElement('div');
      name.innerText = t.name;
      const seats = document.createElement('div');
      seats.className = 'small';
      seats.innerText = `${t.seats} seats`;
      const status = document.createElement('div');
      status.style.marginTop = '8px';
      status.innerText = (t.status||'available').toUpperCase();
      card.appendChild(name);
      card.appendChild(seats);
      card.appendChild(status);
      grid.appendChild(card);
    }
    tablesContent.innerHTML = '';
    tablesContent.appendChild(grid);
  }

  // ---------- Update Menu UI flows ----------
  // Helper to fetch current user's role from server
  async function getCurrentUserRole() {
    try {
      const res = await fetch('/api/user');
      if (!res.ok) throw new Error('not_logged_in');
      const j = await res.json();
      return j && j.role ? String(j.role) : null;
    } catch (e) {
      console.error('getCurrentUserRole error', e);
      throw e;
    }
  }
  function openMainUpdateMenu() {
    const html = `
      <h3 style="margin:0 0 8px">Update Menu</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button id="optUpdatePizza" style="padding:8px;border-radius:6px;">Update Pizza</button>
        <button id="optUpdateBurger" style="padding:8px;border-radius:6px;">Update Burger</button>
        <button id="optAddNew" style="padding:8px;border-radius:6px;">Add New Food</button>
        <div style="display:flex;justify-content:flex-end;margin-top:6px"><button id="closeMainModal" style="padding:6px 10px">Close</button></div>
      </div>`;
    showModal(html);
    document.getElementById('optUpdatePizza').addEventListener('click', ()=>{ openVariantSelection('pizza'); });
    document.getElementById('optUpdateBurger').addEventListener('click', ()=>{ openVariantSelection('burger'); });
    document.getElementById('optAddNew').addEventListener('click', ()=>{ openAddNewModal(); });
    document.getElementById('closeMainModal').addEventListener('click', closeModal);
  }

  function openVariantSelection(category) {
    const menu = lastMenuData || {};
    const items = menu[category] || {};
    const options = Object.keys(items);
    let listHtml = `<h3 style="margin:0 0 8px">Select ${category}</h3><div style="display:flex;flex-direction:column;gap:8px">`;
    if (options.length === 0) listHtml += '<div>No items found for this category.</div>';
    for (const k of options) {
      listHtml += `<button class="variantOpt" data-key="${k}" style="padding:8px;border-radius:6px;text-align:left">${items[k].name || k} — $${(items[k].price||0).toFixed(2)} (Available: ${items[k].available||0})</button>`;
    }
    listHtml += `<div style="display:flex;justify-content:space-between;margin-top:8px"><button id="backToMain">Back</button><button id="closeVariant">Close</button></div></div>`;
    showModal(listHtml);
    Array.from(document.getElementsByClassName('variantOpt')).forEach(btn=>btn.addEventListener('click',(e)=>{
      const key = e.currentTarget.dataset.key;
      const item = items[key];
      openEditModal(category, key, item);
    }));
    document.getElementById('backToMain').addEventListener('click', openMainUpdateMenu);
    document.getElementById('closeVariant').addEventListener('click', closeModal);
  }

  function openEditModal(category, key, item) {
    const html = `
      <h3 style="margin:0 0 8px">Edit: ${item.name || key}</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <label>Display name<input id="fldName" style="width:100%;padding:8px" value="${(item.name||'').replace(/"/g,'&quot;')}"></label>
        <label>Price<input id="fldPrice" type="number" step="0.01" style="width:100%;padding:8px" value="${(item.price||0)}"></label>
        <label>Available<input id="fldAvailable" type="number" style="width:100%;padding:8px" value="${(item.available||0)}"></label>
        <label>Image URL<input id="fldImageUrl" style="width:100%;padding:8px" value="${(item.image_url||'').replace(/"/g,'&quot;')}"></label>
        <label>Or upload image<input id="fldImageFile" type="file" accept="image/*" style="width:100%;padding:6px 0"></label>
        <label style="display:flex;align-items:center;gap:8px"><input id="fldSum" type="checkbox"> Add to existing stock (sum)</label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
          <button id="cancelEdit">Cancel</button>
          <button id="saveEdit" style="background:#28a745;color:#fff;border:none;padding:8px 12px;border-radius:6px;">Save Changes</button>
        </div>
      </div>`;
    showModal(html);
    document.getElementById('cancelEdit').addEventListener('click', openVariantSelection.bind(null, category));
    document.getElementById('saveEdit').addEventListener('click', async ()=>{
      const name = document.getElementById('fldName').value.trim();
      const price = parseFloat(document.getElementById('fldPrice').value) || 0;
      const available = parseInt(document.getElementById('fldAvailable').value,10) || 0;
      const imageUrlField = document.getElementById('fldImageUrl').value.trim();
      const imageFileInput = document.getElementById('fldImageFile');
      const sumWithExisting = document.getElementById('fldSum').checked;
      let finalImageUrl = imageUrlField || null;
      // If a file is selected, upload it first
      if (imageFileInput && imageFileInput.files && imageFileInput.files.length > 0) {
        try {
          const fd = new FormData();
          fd.append('image', imageFileInput.files[0]);
          const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
          const ctype = (up.headers.get('content-type') || '');
          let upRes;
          if (ctype.includes('application/json')) {
            upRes = await up.json();
          } else {
            const text = await up.text();
            console.error('upload returned non-json response', up.status, text);
            throw new Error('upload_failed_nonjson: ' + (text && text.length ? text.slice(0,200) : 'no body'));
          }
          if (!up.ok) throw new Error(upRes && upRes.error ? upRes.error : 'upload_failed');
          finalImageUrl = upRes.url;
        } catch (ue) { console.error('image upload failed', ue); alert('Image upload failed: '+(ue.message||ue)); return; }
      }
      try {
        const payload = { category, key, name, price, available, sumWithExisting };
        if (finalImageUrl) payload.image_url = finalImageUrl;
        const res = await fetch('/api/menu/item', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : 'save_failed');
        closeModal();
        await fetchMenu();
        alert('Saved');
      } catch (e) { console.error(e); alert('Failed to save: '+(e.message||e)); }
    });
  }

  function openAddNewModal() {
    const html = `
      <h3 style="margin:0 0 8px">Add New Food</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <label>Category<input id="newCategory" style="width:100%;padding:8px" placeholder="e.g. pizza"></label>
        <label>Key (unique key)<input id="newKey" style="width:100%;padding:8px" placeholder="e.g. mango-pie (optional)"></label>
        <label>Name<input id="newName" style="width:100%;padding:8px" placeholder="Display name"></label>
        <label>Price<input id="newPrice" type="number" step="0.01" style="width:100%;padding:8px" value="0"></label>
        <label>Available<input id="newAvailable" type="number" style="width:100%;padding:8px" value="0"></label>
        <label>Image URL<input id="newImageUrl" style="width:100%;padding:8px" placeholder="https://... or /uploads/..." ></label>
        <label>Or upload image<input id="newImageFile" type="file" accept="image/*" style="width:100%;padding:6px 0"></label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
          <button id="cancelNew">Cancel</button>
          <button id="saveNew" style="background:#28a745;color:#fff;border:none;padding:8px 12px;border-radius:6px;">Add Food</button>
        </div>
      </div>`;
    showModal(html);
    document.getElementById('cancelNew').addEventListener('click', openMainUpdateMenu);
    document.getElementById('saveNew').addEventListener('click', async ()=>{
      const category = document.getElementById('newCategory').value.trim();
      let key = document.getElementById('newKey').value.trim();
      const name = document.getElementById('newName').value.trim();
      const price = parseFloat(document.getElementById('newPrice').value) || 0;
      const available = parseInt(document.getElementById('newAvailable').value,10) || 0;
      const newImageUrlField = document.getElementById('newImageUrl').value.trim();
      const newImageFileInput = document.getElementById('newImageFile');
      let finalImageUrl = newImageUrlField || null;
      if (newImageFileInput && newImageFileInput.files && newImageFileInput.files.length > 0) {
        try {
          const fd = new FormData();
          fd.append('image', newImageFileInput.files[0]);
          const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
          const ctype = (up.headers.get('content-type') || '');
          let upRes;
          if (ctype.includes('application/json')) {
            upRes = await up.json();
          } else {
            const text = await up.text();
            console.error('upload returned non-json response', up.status, text);
            throw new Error('upload_failed_nonjson: ' + (text && text.length ? text.slice(0,200) : 'no body'));
          }
          if (!up.ok) throw new Error(upRes && upRes.error ? upRes.error : 'upload_failed');
          finalImageUrl = upRes.url;
        } catch (ue) { console.error('image upload failed', ue); alert('Image upload failed: '+(ue.message||ue)); return; }
      }
      if (!category || !name) { alert('Category and name required'); return; }
      if (!key) key = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
      try {
        const payload = { category, key, name, price, available };
        if (finalImageUrl) payload.image_url = finalImageUrl;
        const res = await fetch('/api/menu/item', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : 'save_failed');
        closeModal();
        await fetchMenu();
        alert('Added');
      } catch (e) { console.error(e); alert('Failed to add: '+(e.message||e)); }
    });
  }

  // ===== Update Menu button handler (for admins/managers) =====
  const updateBtn = document.getElementById('updateMenuBtn');
  updateBtn && updateBtn.addEventListener('click', async ()=>{
    try {
      const role = await getCurrentUserRole();
      const r = (role || '').toLowerCase();
      if (r === 'admin' || r === 'manager') {
        openMainUpdateMenu();
      } else {
        showToast('Only Admins & Managers can update the menu', 'error');
      }
    } catch (e) {
      console.error('Failed to verify user role', e);
      showToast('Unable to verify permissions. Please try again.', 'error');
    }
  });

  // ===== Helper to fetch current user's role from server =====
  async function getCurrentUserRole() {
    try {
      const res = await fetch('/api/user');
      if (!res.ok) throw new Error('not_logged_in');
      const j = await res.json();
      return j && j.role ? String(j.role) : null;
    } catch (e) {
      console.error('getCurrentUserRole error', e);
      throw e;
    }
  }

  // ===== Advanced menu update UI flows =====
  function openMainUpdateMenu() {
    const html = `
      <div style="max-width:400px">
        <h3 style="margin:0 0 16px;display:flex;align-items:center;gap:8px">⚙️ Update Menu</h3>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="optUpdatePizza" style="padding:12px;border-radius:8px;border:none;background:var(--accent-2);color:#fff;font-weight:600;cursor:pointer;transition:all 0.3s">🍕 Update Pizza</button>
          <button id="optUpdateBurger" style="padding:12px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;transition:all 0.3s">🍔 Update Burger</button>
          <button id="optAddNew" style="padding:12px;border-radius:8px;border:none;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;transition:all 0.3s">➕ Add New Food</button>
          <div style="display:flex;justify-content:flex-end;margin-top:12px;gap:8px">
            <button id="closeMainModal" style="padding:8px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:600">Close</button>
          </div>
        </div>
      </div>`;
    showModal(html);
    document.getElementById('optUpdatePizza').addEventListener('click', ()=>{ openVariantSelection('pizza'); });
    document.getElementById('optUpdateBurger').addEventListener('click', ()=>{ openVariantSelection('burger'); });
    document.getElementById('optAddNew').addEventListener('click', ()=>{ openAddNewModal(); });
    document.getElementById('closeMainModal').addEventListener('click', closeModal);
  }

  function openVariantSelection(category) {
    const menu = lastMenuData || {};
    const items = menu[category] || {};
    const options = Object.keys(items);
    let listHtml = `
      <div style="max-width:400px">
        <h3 style="margin:0 0 16px">Select ${category.toUpperCase()}</h3>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto">
          ${options.length === 0 ? '<div style="color:var(--muted);padding:20px;text-align:center">No items found for this category.</div>' : ''}`;
    for (const k of options) {
      listHtml += `<button class="variantOpt" data-key="${k}" style="padding:10px;border-radius:8px;border:2px solid #e5e7eb;text-align:left;background:#fff;cursor:pointer;transition:all 0.3s;hover:border-color:var(--accent)">
        <div style="font-weight:600">${items[k].name || k}</div>
        <div style="font-size:0.85rem;color:var(--muted)">💰 $${(items[k].price||0).toFixed(2)} • 📦 ${items[k].available||0} in stock</div>
      </button>`;
    }
    listHtml += `
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:16px;gap:8px">
          <button id="backToMain" style="flex:1;padding:8px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:600">← Back</button>
          <button id="closeVariant" style="flex:1;padding:8px;border-radius:8px;border:none;background:#e5e7eb;cursor:pointer;font-weight:600">Close</button>
        </div>
      </div>`;
    showModal(listHtml);
    Array.from(document.getElementsByClassName('variantOpt')).forEach(btn=>btn.addEventListener('click',(e)=>{
      const key = e.currentTarget.dataset.key;
      const item = items[key];
      openEditModal(category, key, item);
    }));
    document.getElementById('backToMain').addEventListener('click', openMainUpdateMenu);
    document.getElementById('closeVariant').addEventListener('click', closeModal);
  }

  function openEditModal(category, key, item) {
    const html = `
      <div style="max-width:500px;max-height:80vh;overflow-y:auto">
        <h3 style="margin:0 0 16px;display:flex;align-items:center;gap:8px">✏️ Edit: ${item.name || key}</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Display Name</label>
            <input id="fldName" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="${(item.name||'').replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Price</label>
            <input id="fldPrice" type="number" step="0.01" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="${(item.price||0)}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Available</label>
            <input id="fldAvailable" type="number" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="${(item.available||0)}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Image URL</label>
            <input id="fldImageUrl" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="${(item.image_url||'').replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Or Upload Image</label>
            <input id="fldImageFile" type="file" accept="image/*" style="width:100%;padding:8px;border-radius:8px;border:2px solid #e5e7eb">
          </div>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;background:#f3f4f6;border-radius:8px;cursor:pointer">
            <input id="fldSum" type="checkbox"> <span style="font-weight:500">Add to existing stock (sum)</span>
          </label>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button id="cancelEdit" style="padding:10px 16px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:600">Cancel</button>
            <button id="saveEdit" style="padding:10px 16px;border-radius:8px;border:none;background:var(--accent-2);color:#fff;cursor:pointer;font-weight:600">✓ Save Changes</button>
          </div>
        </div>
      </div>`;
    showModal(html);
    document.getElementById('cancelEdit').addEventListener('click', openVariantSelection.bind(null, category));
    document.getElementById('saveEdit').addEventListener('click', async ()=>{
      const name = document.getElementById('fldName').value.trim();
      const price = parseFloat(document.getElementById('fldPrice').value) || 0;
      const available = parseInt(document.getElementById('fldAvailable').value,10) || 0;
      const imageUrlField = document.getElementById('fldImageUrl').value.trim();
      const imageFileInput = document.getElementById('fldImageFile');
      const sumWithExisting = document.getElementById('fldSum').checked;
      let finalImageUrl = imageUrlField || null;
      if (imageFileInput && imageFileInput.files && imageFileInput.files.length > 0) {
        try {
          const fd = new FormData();
          fd.append('image', imageFileInput.files[0]);
          const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
          const ctype = (up.headers.get('content-type') || '');
          let upRes;
          if (ctype.includes('application/json')) {
            upRes = await up.json();
          } else {
            const text = await up.text();
            console.error('upload returned non-json response', up.status, text);
            throw new Error('upload_failed_nonjson: ' + (text && text.length ? text.slice(0,200) : 'no body'));
          }
          if (!up.ok) throw new Error(upRes && upRes.error ? upRes.error : 'upload_failed');
          finalImageUrl = upRes.url;
        } catch (ue) { console.error('image upload failed', ue); showToast('Image upload failed: '+(ue.message||ue), 'error'); return; }
      }
      try {
        const payload = { category, key, name, price, available, sumWithExisting };
        if (finalImageUrl) payload.image_url = finalImageUrl;
        const res = await fetch('/api/menu/item', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : 'save_failed');
        closeModal();
        await fetchMenu();
        showToast('✓ Changes saved successfully!', 'success');
      } catch (e) { console.error(e); showToast('Failed to save: '+(e.message||e), 'error'); }
    });
  }

  function openAddNewModal() {
    const html = `
      <div style="max-width:500px;max-height:80vh;overflow-y:auto">
        <h3 style="margin:0 0 16px;display:flex;align-items:center;gap:8px">➕ Add New Food Item</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Category</label>
            <input id="newCategory" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" placeholder="e.g. pizza, drinks">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Unique Key (optional)</label>
            <input id="newKey" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" placeholder="e.g. mango-pie">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Display Name</label>
            <input id="newName" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" placeholder="Display name">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Price</label>
            <input id="newPrice" type="number" step="0.01" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="0">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Available</label>
            <input id="newAvailable" type="number" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" value="0">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Image URL</label>
            <input id="newImageUrl" style="width:100%;padding:10px;border-radius:8px;border:2px solid #e5e7eb;box-sizing:border-box" placeholder="https://... or /uploads/...">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:6px">Or Upload Image</label>
            <input id="newImageFile" type="file" accept="image/*" style="width:100%;padding:8px;border-radius:8px;border:2px solid #e5e7eb">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button id="cancelNew" style="padding:10px 16px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:600">Cancel</button>
            <button id="saveNew" style="padding:10px 16px;border-radius:8px;border:none;background:var(--accent-2);color:#fff;cursor:pointer;font-weight:600">✓ Add Food</button>
          </div>
        </div>
      </div>`;
    showModal(html);
    document.getElementById('cancelNew').addEventListener('click', openMainUpdateMenu);
    document.getElementById('saveNew').addEventListener('click', async ()=>{
      const category = document.getElementById('newCategory').value.trim();
      let key = document.getElementById('newKey').value.trim();
      const name = document.getElementById('newName').value.trim();
      const price = parseFloat(document.getElementById('newPrice').value) || 0;
      const available = parseInt(document.getElementById('newAvailable').value,10) || 0;
      const newImageUrlField = document.getElementById('newImageUrl').value.trim();
      const newImageFileInput = document.getElementById('newImageFile');
      let finalImageUrl = newImageUrlField || null;
      if (newImageFileInput && newImageFileInput.files && newImageFileInput.files.length > 0) {
        try {
          const fd = new FormData();
          fd.append('image', newImageFileInput.files[0]);
          const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
          const ctype = (up.headers.get('content-type') || '');
          let upRes;
          if (ctype.includes('application/json')) {
            upRes = await up.json();
          } else {
            const text = await up.text();
            console.error('upload returned non-json response', up.status, text);
            throw new Error('upload_failed_nonjson: ' + (text && text.length ? text.slice(0,200) : 'no body'));
          }
          if (!up.ok) throw new Error(upRes && upRes.error ? upRes.error : 'upload_failed');
          finalImageUrl = upRes.url;
        } catch (ue) { console.error('image upload failed', ue); showToast('Image upload failed: '+(ue.message||ue), 'error'); return; }
      }
      if (!category || !name) { showToast('Category and name are required', 'error'); return; }
      if (!key) key = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
      try {
        const payload = { category, key, name, price, available };
        if (finalImageUrl) payload.image_url = finalImageUrl;
        const res = await fetch('/api/menu/item', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : 'save_failed');
        closeModal();
        await fetchMenu();
        showToast(`✓ "${name}" added successfully!`, 'success');
      } catch (e) { console.error(e); showToast('Failed to add: '+(e.message||e), 'error'); }
    });
  }

  // Initial fetch
  fetchMenu();
  fetchTables();

  // Poll tables every 3 seconds for live updates
  setInterval(fetchTables, 3000);
});