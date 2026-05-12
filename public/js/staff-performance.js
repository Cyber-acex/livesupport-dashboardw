document.getElementById('refreshBtn').addEventListener('click', loadAndRender);
document.getElementById('timeRange').addEventListener('change', loadAndRender);

// initial
// staff-performance.js
// Requires Chart.js (included via CDN in the HTML)

let avgResponseChart = null;
let activityChart = null;
let currentData = [];
let filteredData = [];
const pageSize = 6;
let currentPage = 1;

async function fetchMetrics() {
    try {
        const days = document.getElementById('timeRange') ? document.getElementById('timeRange').value : '7';
        const res = await fetch('/api/staff-metrics?days=' + encodeURIComponent(days));
        if (!res.ok) throw new Error('Network error');
        return await res.json();
    } catch (err) {
        console.error('Failed to load staff metrics', err);
        return null;
    }
}

function formatSeconds(sec) {
    if (sec == null) return '-';
    if (sec < 60) return sec + 's';
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return mins + 'm ' + s + 's';
}

function renderSummary(data) {
    const summary = document.getElementById('summaryContent');
    if (!data || data.length === 0) {
        summary.innerHTML = '<em>No data</em>';
        return;
    }
    const avgResp = Math.round(data.reduce((a,b)=>a+b.avg_response_time,0)/data.length);
    const totalHandled = data.reduce((a,b)=>a+b.messages_handled,0);
    const avgSatisfaction = (data.reduce((a,b)=>a+b.satisfaction,0)/data.length).toFixed(2);

    summary.innerHTML = `
        <div class="kpi">
            <div class="kpi-item"><h4>Avg response</h4><p>${formatSeconds(avgResp)}</p></div>
            <div class="kpi-item"><h4>Total handled</h4><p>${totalHandled}</p></div>
            <div class="kpi-item"><h4>Avg satisfaction</h4><p>${avgSatisfaction} / 5</p></div>
        </div>
    `;
}

function createOrUpdateAvgChart(data) {
    const canvas = document.getElementById('avgResponseChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = data.map(s => s.name);
    const values = data.map(s => s.avg_response_time);
    if (avgResponseChart) {
        avgResponseChart.data.labels = labels;
        avgResponseChart.data.datasets[0].data = values;
        avgResponseChart.update();
        return;
    }
    avgResponseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Avg response (s)',
                data: values,
                backgroundColor: labels.map((_,i)=>`rgba(${30+i*10%200},${120+i*20%200},${150+i*15%200},0.8)`)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function createOrUpdateActivityChart(staff) {
    const canvas = document.getElementById('activityChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const values = staff.last_week || [];
    if (activityChart) {
        activityChart.data.labels = labels.slice(0, values.length);
        activityChart.data.datasets[0].data = values;
        activityChart.options.plugins.title.text = staff.name + ' — Messages per day';
        activityChart.update();
        return;
    }
    activityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.slice(0, values.length),
            datasets: [{
                label: 'Messages',
                data: values,
                borderColor: 'rgba(59,130,246,0.9)',
                backgroundColor: 'rgba(59,130,246,0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: true, text: staff.name + ' — Messages per day' } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderStaffTable(pageData) {
    const container = document.getElementById('staffList');
    if (!container) return;
    if (!pageData) return container.innerHTML = '<em>Failed to load</em>';
    if (pageData.length === 0) return container.innerHTML = '<em>No staff data</em>';

    const table = document.createElement('table');
    table.className = 'metrics-table';
    table.innerHTML = `
        <thead><tr><th>Staff</th><th>Avg Response</th><th>Avg Resolution</th><th>Handled</th><th>Satisfaction</th></tr></thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    pageData.forEach((s, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${s.name}</strong><div style="font-size:12px;color:var(--muted)">${s.role||''}</div></td>
            <td>${formatSeconds(s.avg_response_time)}</td>
            <td>${formatSeconds(s.avg_resolution_time)}</td>
            <td>${s.messages_handled}</td>
            <td>${s.satisfaction} / 5</td>
        `;
        tr.addEventListener('click', () => {
            table.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
            tr.classList.add('active');
            createOrUpdateActivityChart(s);
        });
        tr.addEventListener('dblclick', () => showStaffModal(s));
        tbody.appendChild(tr);
    });
    container.innerHTML = '';
    container.appendChild(table);
}

function applyFiltersAndRender() {
    const search = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim().toLowerCase() : '';
    const sortVal = document.getElementById('sortBy') ? document.getElementById('sortBy').value : 'name';

    filteredData = currentData.filter(s => !search || s.name.toLowerCase().includes(search));

    const desc = sortVal.startsWith('-');
    const key = desc ? sortVal.slice(1) : sortVal;
    filteredData.sort((a,b)=>{
        if (key === 'name') return a.name.localeCompare(b.name);
        const av = a[key] || 0; const bv = b[key] || 0; return desc ? bv-av : av-bv;
    });

    // pagination
    const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage-1)*pageSize;
    const pageData = filteredData.slice(start, start+pageSize);

    renderStaffTable(pageData);
    renderPagination(totalPages);
    if (filteredData.length) createOrUpdateAvgChart(filteredData);
    if (pageData[0]) createOrUpdateActivityChart(pageData[0]);
}

function renderPagination(totalPages) {
    const el = document.getElementById('pagination');
    if (!el) return;
    el.innerHTML = '';
    const prev = document.createElement('button'); prev.textContent = '<'; prev.disabled = currentPage<=1;
    prev.addEventListener('click', ()=>{ if (currentPage>1) { currentPage--; applyFiltersAndRender(); } });
    el.appendChild(prev);
    for (let i=1;i<=totalPages;i++){
        const btn = document.createElement('button'); btn.textContent = i; if (i===currentPage) btn.classList.add('active');
        btn.addEventListener('click', ()=>{ currentPage=i; applyFiltersAndRender(); });
        el.appendChild(btn);
    }
    const next = document.createElement('button'); next.textContent = '>'; next.disabled = currentPage>=totalPages;
    next.addEventListener('click', ()=>{ if (currentPage<totalPages) { currentPage++; applyFiltersAndRender(); } });
    el.appendChild(next);
}

function exportCsv() {
    const rows = [ ['Name','AvgResponse(s)','AvgResolution(s)','Handled','Satisfaction'] ];
    currentData.forEach(s=> rows.push([s.name,s.avg_response_time,s.avg_resolution_time,s.messages_handled,s.satisfaction]));
    const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'staff-performance.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function showStaffModal(s) {
    const modal = document.getElementById('staffModal');
    if (!modal) return;
    document.getElementById('modalName').textContent = s.name;
    const body = document.getElementById('modalBody');
    body.innerHTML = `
        <p><strong>Role:</strong> ${s.role||'—'}</p>
        <p><strong>Avg response:</strong> ${formatSeconds(s.avg_response_time)}</p>
        <p><strong>Avg resolution:</strong> ${formatSeconds(s.avg_resolution_time)}</p>
        <p><strong>Handled:</strong> ${s.messages_handled}</p>
        <p><strong>Satisfaction:</strong> ${s.satisfaction} / 5</p>
        <h4>Improvement suggestions</h4>
        <ul>
            ${generateSuggestions(s).map(t=>`<li>${t}</li>`).join('')}
        </ul>
    `;
    modal.setAttribute('aria-hidden','false');
}

function hideStaffModal() {
    const modal = document.getElementById('staffModal'); if (!modal) return; modal.setAttribute('aria-hidden','true');
}

function generateSuggestions(s) {
    const list = [];
    if (s.avg_response_time > 300) list.push('Consider improving first response time (aim < 2m).');
    if (s.avg_resolution_time > 1800) list.push('Investigate long resolution cases and share best practices.');
    if (s.satisfaction < 4) list.push('Provide coaching on customer empathy and follow-ups.');
    if (s.messages_handled < 20) list.push('Encourage more proactive engagement during shifts.');
    if (list.length===0) list.push('Performance looks good — keep it up!');
    return list;
}

async function loadAndRender() {
    const data = await fetchMetrics();
    if (!data) return;
    // remove entries with role 'viewer' or 'staff' (case-insensitive)
    currentData = data.filter(s=>{
        const r = (s.role||'').toString().toLowerCase();
        return r !== 'viewer' && r !== 'staff';
    });
    renderSummary(currentData);
    currentPage = 1;
    applyFiltersAndRender();
}

// event wiring
document.getElementById('refreshBtn').addEventListener('click', loadAndRender);
document.getElementById('timeRange').addEventListener('change', loadAndRender);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('sortBy').addEventListener('change', ()=>{ currentPage=1; applyFiltersAndRender(); });

let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ currentPage=1; applyFiltersAndRender(); }, 250); });

document.getElementById('modalClose').addEventListener('click', hideStaffModal);
document.getElementById('staffModal').addEventListener('click', (e)=>{ if (e.target.id === 'staffModal') hideStaffModal(); });

// initial
fetch('/api/user').then(r=>r.json()).then(u=>{document.getElementById('staffName').textContent = u.name || u.role || 'Me';}).catch(()=>{});
loadAndRender();
