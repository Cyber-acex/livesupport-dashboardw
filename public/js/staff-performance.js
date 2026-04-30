// staff-performance.js
// Requires Chart.js (included via CDN in the HTML)

let avgResponseChart = null;
let activityChart = null;

async function fetchMetrics() {
    try {
        const res = await fetch('/api/staff-metrics');
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
        <p><strong>Average response time:</strong> ${formatSeconds(avgResp)}</p>
        <p><strong>Total messages handled:</strong> ${totalHandled}</p>
        <p><strong>Average satisfaction:</strong> ${avgSatisfaction} / 5</p>
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
                backgroundColor: 'rgba(16,185,129,0.7)'
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

function renderStaffList(data) {
    const container = document.getElementById('staffList');
    if (!data) return container.innerHTML = '<em>Failed to load</em>';
    if (data.length === 0) return container.innerHTML = '<em>No staff data</em>';

    const table = document.createElement('table');
    table.className = 'metrics-table';
    table.innerHTML = `
        <thead><tr><th>Staff</th><th>Avg Response</th><th>Avg Resolution</th><th>Handled</th><th>Satisfaction</th></tr></thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    data.forEach((s, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name}</td>
            <td>${formatSeconds(s.avg_response_time)}</td>
            <td>${formatSeconds(s.avg_resolution_time)}</td>
            <td>${s.messages_handled}</td>
            <td>${s.satisfaction} / 5</td>
        `;
        tr.addEventListener('click', () => {
            // set active style
            table.querySelectorAll('tr').forEach(r => r.classList.remove('active')); 
            tr.classList.add('active');
            createOrUpdateActivityChart(s);
        });
        if (idx === 0) tr.classList.add('active');
        tbody.appendChild(tr);
    });
    container.innerHTML = '';
    container.appendChild(table);

    // initialize activity chart with first staff
    createOrUpdateActivityChart(data[0]);
}

async function loadAndRender() {
    const data = await fetchMetrics();
    renderSummary(data);
    renderStaffList(data);
    if (data) createOrUpdateAvgChart(data);
}

document.getElementById('refreshBtn').addEventListener('click', loadAndRender);
document.getElementById('timeRange').addEventListener('change', loadAndRender);

// initial
fetch('/api/user').then(r=>r.json()).then(u=>{document.getElementById('staffName').textContent = u.name || u.role || 'Me';}).catch(()=>{});
loadAndRender();
