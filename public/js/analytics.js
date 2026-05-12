// Ensure the DOM is fully loaded before initializing the pie chart
document.addEventListener('DOMContentLoaded', () => {
    const ctx5 = document.getElementById('chart5').getContext('2d');
    const barCtx = document.getElementById('ticketBarChart').getContext('2d');
    const gaugeRespCtx = document.getElementById('gaugeResponse') ? document.getElementById('gaugeResponse').getContext('2d') : null;
    const gaugeResRateCtx = document.getElementById('gaugeResolution') ? document.getElementById('gaugeResolution').getContext('2d') : null;
    let gaugeRespChart = null;
    let gaugeResRateChart = null;
    // Controls and KPI elements
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const branchSelect = document.getElementById('branchSelect');
    const applyFiltersBtn = document.getElementById('applyFilters');
    const exportCsvBtn = document.getElementById('exportCsv');
    const kpiTotalTickets = document.getElementById('kpi-totalTickets');
    const kpiAvgResponse = document.getElementById('kpi-avgResponse');
    const kpiResolutionRate = document.getElementById('kpi-resolutionRate');
    const kpiActiveChats = document.getElementById('kpi-activeChats');
    const kpiAIFeedbackAvg = document.getElementById('kpi-aiFeedbackAvg');
    const kpiAIFeedbackCount = document.getElementById('kpi-aiFeedbackCount');

    // Keep last fetched datasets for export
    let lastAnalyticsData = null;
    let lastTicketsData = null;
    let lastMessagesData = null;

    // Function to create bar chart for tickets by period
    function createTicketBarChart(ctx, data) {
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Today', 'This Week', 'This Month'],
                datasets: [{
                    label: 'Total Tickets Created',
                    data: [data.daily, data.weekly, data.monthly],
                    backgroundColor: [
                        '#FF6384',
                        '#36A2EB',
                        '#FFCE56'
                    ],
                    borderColor: [
                        '#FF6384',
                        '#36A2EB',
                        '#FFCE56'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: 'Tickets Created This Period'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // Fetch data for bar chart
    function buildQueryParams() {
        const params = new URLSearchParams();
        if (startDateInput && startDateInput.value) params.set('start', startDateInput.value);
        if (endDateInput && endDateInput.value) params.set('end', endDateInput.value);
        const branch = branchSelect ? branchSelect.value : 'all';
        if (branch && branch !== 'all') params.set('branch', branch);
        return params.toString() ? `?${params.toString()}` : '';
    }

    function fetchTicketsByPeriod() {
        const qp = buildQueryParams();
        return fetch('/api/tickets-by-period' + qp, { credentials: 'same-origin' })
            .then(res => {
                if (!res.ok) return res.text().then(t => { throw new Error(t || 'tickets fetch failed'); });
                return res.json();
            });
    }

    // Fetch counts from server and render bar chart (fetchTicketsByPeriod already returns parsed JSON)
    fetchTicketsByPeriod()
        .then(data => {
            if (!data || typeof data.daily !== 'number') {
                throw new Error('tickets-by-period returned invalid data');
            }
            console.log('tickets-by-period data', data);
            createTicketBarChart(barCtx, {
                daily: data.daily || 0,
                weekly: data.weekly || 0,
                monthly: data.monthly || 0
            });
        })
        .catch(error => {
            console.error('tickets-by-period fetch error:', error);
            createTicketBarChart(barCtx, {
                daily: 0,
                weekly: 0,
                monthly: 0
            });
        });

    const socket = io();
    let analyticsChart = null;

    // Fetch live data and render the 3D pie chart
    function create3DPieChart(ctx, data) {
        const colors = [
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200),
            ctx.createRadialGradient(200, 200, 50, 200, 200, 200)
        ];
        colors[0].addColorStop(0, '#00bcd4'); colors[0].addColorStop(1, '#006064');
        colors[1].addColorStop(0, '#ffeb3b'); colors[1].addColorStop(1, '#f57c00');
        colors[2].addColorStop(0, '#2196f3'); colors[2].addColorStop(1, '#0d47a1');
        colors[3].addColorStop(0, '#f44336'); colors[3].addColorStop(1, '#b71c1c');
        colors[4].addColorStop(0, '#9c27b0'); colors[4].addColorStop(1, '#4a148c');
        colors[5].addColorStop(0, '#5ce460'); colors[5].addColorStop(1, '#1b5e20');
        colors[6].addColorStop(0, '#ff9800'); colors[6].addColorStop(1, '#e65100');

        return new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Chats', 'Escalated Chats', 'Tickets', 'Escalated Tickets', 'Receipts', 'Resolved Chats'],
                datasets: [{
                    label: 'Overview',
                    data: [
                        data.numChats,
                        data.numEscalatedChats,
                        data.numTickets,
                        data.numEscalatedTickets,
                        data.numReceipts,
                        data.numResolvedChats
                    ],
                    backgroundColor: colors,
                    borderColor: [
                        '#0097a7', '#ff9800', '#1976d2', '#d32f2f', '#7b1fa2', '#5CE460', '#ef6c00'
                    ],
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#2c2c2c',
                            font: {
                                size: 14,
                                weight: 'bold'
                            },
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw;
                                return `${label}: ${value}`;
                            }
                        }
                    }
                },
                animation: {
                    animateScale: true,
                    animateRotate: true
                }
            },
            plugins: [{
                id: 'shadow',
                beforeDraw: chart => {
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.4)';
                    ctx.shadowBlur = 24;
                    ctx.shadowOffsetX = 10;
                    ctx.shadowOffsetY = 10;
                },
                afterDraw: chart => {
                    chart.ctx.restore();
                }
            }]
        });
    }

    // Small Chart.js plugin to draw center text inside semi-circle gauges
    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: chart => {
            const txt = chart.config.options && chart.config.options.plugins && chart.config.options.plugins.centerText && chart.config.options.plugins.centerText.text;
            if (!txt) return;
            const ctx = chart.ctx;
            const width = chart.width;
            const height = chart.height;
            ctx.save();
            ctx.font = '600 18px Arial';
            ctx.fillStyle = '#222';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, width / 2, height * 0.62);
            ctx.restore();
        }
    };

    // Needle plugin draws a needle over the semi-circle doughnut
    const needlePlugin = {
        id: 'needle',
        afterDraw: chart => {
            try {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data || !meta.data[0]) return;
                const ctx = chart.ctx;
                const cfg = (chart.options && chart.options.plugins && chart.options.plugins.needle) || {};
                const centerX = chart.width / 2;
                const centerY = meta.data[0].y;
                const outerRadius = meta.data[0].outerRadius || Math.min(chart.width, chart.height) / 2;
                const dataset = chart.data.datasets[0];
                const value = Number(dataset.data[0] || 0);
                const max = Number((dataset.data[0] || 0) + (dataset.data[1] || 0)) || 1;
                const rotation = chart.options.rotation || -Math.PI;
                const circumference = chart.options.circumference || Math.PI;
                const angle = rotation + (value / Math.max(1, max)) * circumference;

                // needle length and drawing
                const len = outerRadius * 0.92;
                ctx.save();
                ctx.translate(centerX, centerY);
                ctx.rotate(angle);
                ctx.beginPath();
                ctx.moveTo(0, -6);
                ctx.lineTo(len, 0);
                ctx.lineTo(0, 6);
                ctx.closePath();
                ctx.fillStyle = cfg.color || '#222';
                ctx.fill();
                ctx.restore();

                // draw center cap
                ctx.beginPath();
                ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
                ctx.fillStyle = cfg.centerColor || (cfg.color || '#222');
                ctx.fill();
            } catch (e) {
                // fail silently
            }
        }
    };

    function createGaugeChart(ctx, initialValue, maxValue, color, labelText, needleOpts) {
        if (!ctx || typeof Chart === 'undefined') return null;
        try { Chart.register && Chart.register(centerTextPlugin); } catch (e) {}
        try { Chart.register && Chart.register(needlePlugin); } catch (e) {}
        const val = Math.max(0, Math.min(initialValue, maxValue));
        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [val, Math.max(0, maxValue - val)],
                    backgroundColor: [color, '#e9ecef'],
                    borderWidth: 0
                }]
            },
            options: {
                rotation: -Math.PI,
                circumference: Math.PI,
                cutout: '70%',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    centerText: { text: labelText },
                    needle: Object.assign({ color: '#222', centerColor: '#222' }, needleOpts || {})
                }
            },
            plugins: [centerTextPlugin, needlePlugin]
        });
    }

    function updateGauge(chart, value, maxValue, displayText) {
        if (!chart) return;
        const v = Math.max(0, Math.min(value, maxValue));
        chart.data.datasets[0].data[0] = v;
        chart.data.datasets[0].data[1] = Math.max(0, maxValue - v);
        if (!chart.options.plugins) chart.options.plugins = {};
        chart.options.plugins.centerText = { text: displayText };
        chart.update();
    }

    // Fetch metrics for the logged-in user and update gauges
    async function refreshMyMetrics() {
        try {
            const res = await fetch('/api/my-metrics', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();

            const maxResp = 600;
            if (!gaugeRespChart && gaugeRespCtx) {
                gaugeRespChart = createGaugeChart(gaugeRespCtx, 0, maxResp, '#1e88e5', '—s', { color: '#1e88e5', centerColor: '#1e88e5' });
            }
            const avg = (data && typeof data.avgResponseSeconds === 'number') ? data.avgResponseSeconds : 0;
            const display = avg ? `${Math.round(avg)}s` : '—s';
            updateGauge(gaugeRespChart, avg || 0, maxResp, display);

            if (!gaugeResRateChart && gaugeResRateCtx) {
                gaugeResRateChart = createGaugeChart(gaugeResRateCtx, 0, 1, '#4caf50', '—%', { color: '#4caf50', centerColor: '#4caf50' });
            }
            const rate = (data && typeof data.resolutionRate === 'number') ? data.resolutionRate : 0;
            const rateDisplay = isFinite(rate) && rate !== null ? `${Math.round(rate * 100)}%` : '—%';
            updateGauge(gaugeResRateChart, rate || 0, 1, rateDisplay);
        } catch (e) {
            // ignore
        }
    }

    function updateAnalyticsChart(chart, data) {
        if (!chart) return;
        chart.data.datasets[0].data = [
            data.numChats,
            data.numEscalatedChats,
            data.numTickets,
            data.numEscalatedTickets,
            data.numReceipts,
            data.numResolvedChats
        ];
        chart.update();
    }

    function refreshAnalyticsChart() {
        const qp = buildQueryParams();
        return fetch('/api/analytics' + qp, { credentials: 'same-origin' })
            .then(res => {
                if (!res.ok) return res.text().then(t => { throw new Error(t || 'analytics fetch failed'); });
                return res.json();
            })
            .then(data => {
                lastAnalyticsData = data;
                if (!analyticsChart) {
                    analyticsChart = create3DPieChart(ctx5, data);
                } else {
                    updateAnalyticsChart(analyticsChart, data);
                }
                loadKPIs();
            })
            .catch(() => {
                if (!analyticsChart) {
                    analyticsChart = create3DPieChart(ctx5, {
                        numChats: 10,
                        numEscalatedChats: 8,
                        numTickets: 12,
                        numEscalatedTickets: 3,
                        numReceipts: 20,
                        numResolvedChats: 15
                    });
                }
                loadKPIs();
            });
    }

    refreshAnalyticsChart();

    // Function to create bar chart for message traffic
    function createMessageBarChart(ctx, data) {
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Today', 'This Week', 'This Month'],
                datasets: [{
                    label: 'Messages Received',
                    data: [data.daily, data.weekly, data.monthly],
                    backgroundColor: [
                        '#4CAF50',
                        '#2196F3',
                        '#FF9800'
                    ],
                    borderColor: [
                        '#4CAF50',
                        '#2196F3',
                        '#FF9800'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: 'Message Traffic by Period'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    const messageCtx = document.getElementById('messageBarChart').getContext('2d');
    let messageChart = null;

    function updateMessageChart(chart, data) {
        if (!chart) return;
        chart.data.datasets[0].data = [data.daily, data.weekly, data.monthly];
        chart.update();
    }

    async function refreshMessageChart() {
        try {
            const res = await fetch('/api/messages-by-period' + buildQueryParams(), { credentials: 'same-origin' });
            if (!res.ok) {
                const body = await res.text();
                console.error('messages-by-period fetch failed', res.status, body);
                throw new Error('Fetch failed');
            }
            const data = await res.json();
            lastMessagesData = data;
            console.log('messages-by-period data', data);
            if (!messageChart) {
                messageChart = createMessageBarChart(messageCtx, data);
            } else {
                updateMessageChart(messageChart, data);
            }
        } catch (error) {
            console.error('refreshMessageChart error', error);
            if (!messageChart) {
                messageChart = createMessageBarChart(messageCtx, {
                    daily: 50,
                    weekly: 300,
                    monthly: 1200
                });
            }
        }
    }

    function msUntilNextMidnight() {
        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0);
        return nextMidnight - now;
    }

    function msUntilNextWeek() {
        const now = new Date();
        const nextWeek = new Date(now);
        const dayOfWeek = nextWeek.getDay();
        const daysUntilMonday = ((8 - dayOfWeek) % 7) || 7;
        nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
        nextWeek.setHours(0, 0, 0, 0);
        return nextWeek - now;
    }

    function msUntilNextMonth() {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        nextMonth.setHours(0, 0, 0, 0);
        return nextMonth - now;
    }

    function scheduleDailyMessageRefresh() {
        setTimeout(() => {
            refreshMessageChart();
            scheduleDailyMessageRefresh();
        }, msUntilNextMidnight());
    }

    function scheduleWeeklyMessageRefresh() {
        setTimeout(() => {
            refreshMessageChart();
            scheduleWeeklyMessageRefresh();
        }, msUntilNextWeek());
    }

    function scheduleMonthlyMessageRefresh() {
        setTimeout(() => {
            refreshMessageChart();
            scheduleMonthlyMessageRefresh();
        }, msUntilNextMonth());
    }

    /*refreshMessageChart();
    scheduleDailyMessageRefresh();
    scheduleWeeklyMessageRefresh();
    scheduleMonthlyMessageRefresh();
    setInterval(refreshMessageChart, 10000);*/

    // Initialize default date range (last 30 days)
    (function initDefaultDates() {
        try {
            const today = new Date();
            const prior = new Date();
            prior.setDate(today.getDate() - 30);
            if (startDateInput) startDateInput.value = prior.toISOString().slice(0,10);
            if (endDateInput) endDateInput.value = today.toISOString().slice(0,10);
        } catch (e) {}
    })();

    // Load KPI summary cards using last fetched datasets where possible
    function loadKPIs() {
        // total tickets
        let totalTickets = '—';
        if (lastAnalyticsData && typeof lastAnalyticsData.numTickets === 'number') {
            totalTickets = lastAnalyticsData.numTickets;
        } else if (lastTicketsData && typeof lastTicketsData.monthly === 'number') {
            totalTickets = lastTicketsData.monthly;
        }
        if (kpiTotalTickets) kpiTotalTickets.textContent = totalTickets;

        // avg response
        let avgResp = '—';
        if (lastAnalyticsData && typeof lastAnalyticsData.avgResponseSeconds === 'number') {
            avgResp = Math.round(lastAnalyticsData.avgResponseSeconds);
        }
        if (kpiAvgResponse) kpiAvgResponse.textContent = avgResp;

        // resolution rate
        let rr = '—';
        if (lastAnalyticsData && typeof lastAnalyticsData.resolutionRate === 'number') {
            rr = `${Math.round(lastAnalyticsData.resolutionRate * 100)}%`;
        } else if (lastAnalyticsData && lastAnalyticsData.numTickets && lastAnalyticsData.numResolvedChats) {
            const rate = (lastAnalyticsData.numResolvedChats / Math.max(1, lastAnalyticsData.numTickets));
            rr = `${Math.round(rate * 100)}%`;
        }
        if (kpiResolutionRate) kpiResolutionRate.textContent = rr;

        // active chats
        let active = '—';
        if (lastAnalyticsData && typeof lastAnalyticsData.activeChats === 'number') {
            active = lastAnalyticsData.activeChats;
        } else if (lastAnalyticsData && typeof lastAnalyticsData.numChats === 'number') {
            active = lastAnalyticsData.numChats;
        }
        if (kpiActiveChats) kpiActiveChats.textContent = active;
        // AI feedback KPIs
        if (kpiAIFeedbackAvg) {
            const avg = lastAnalyticsData && typeof lastAnalyticsData.aiFeedbackAvg === 'number' ? Number(lastAnalyticsData.aiFeedbackAvg).toFixed(2) : '—';
            kpiAIFeedbackAvg.textContent = avg;
        }
        if (kpiAIFeedbackCount) {
            const cnt = lastAnalyticsData && typeof lastAnalyticsData.aiFeedbackCount === 'number' ? lastAnalyticsData.aiFeedbackCount : '—';
            kpiAIFeedbackCount.textContent = cnt;
        }

        // Initialize gauges if needed and update them
        try {
            // Average response gauge (max in seconds)
            const maxResp = 600; // 10 minutes cap for visualization
            if (!gaugeRespChart && gaugeRespCtx) {
                gaugeRespChart = createGaugeChart(gaugeRespCtx, 0, maxResp, '#1e88e5', '—s');
            }
            let avgRespVal = 0;
            if (lastAnalyticsData && typeof lastAnalyticsData.avgResponseSeconds === 'number') avgRespVal = lastAnalyticsData.avgResponseSeconds;
            else if (lastTicketsData && typeof lastTicketsData.avgResponseSeconds === 'number') avgRespVal = lastTicketsData.avgResponseSeconds;
            const avgRespDisplay = avgRespVal ? `${Math.round(avgRespVal)}s` : '—s';
            updateGauge(gaugeRespChart, avgRespVal || 0, maxResp, avgRespDisplay);

            // Resolution rate gauge (0.0 - 1.0)
            if (!gaugeResRateChart && gaugeResRateCtx) {
                gaugeResRateChart = createGaugeChart(gaugeResRateCtx, 0, 1, '#4caf50', '—%');
            }
            let resRateVal = 0;
            if (lastAnalyticsData && typeof lastAnalyticsData.resolutionRate === 'number') {
                resRateVal = lastAnalyticsData.resolutionRate;
            } else if (lastAnalyticsData && lastAnalyticsData.numTickets && lastAnalyticsData.numResolvedChats) {
                resRateVal = (lastAnalyticsData.numResolvedChats / Math.max(1, lastAnalyticsData.numTickets));
            }
            const resRateDisplay = isFinite(resRateVal) ? `${Math.round(resRateVal * 100)}%` : '—%';
            updateGauge(gaugeResRateChart, resRateVal || 0, 1, resRateDisplay);
        } catch (e) {
            console.warn('Gauge update failed', e);
        }
    }

    // Wire up filter apply button
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', async () => {
            try {
                const [tix] = await Promise.all([fetchTicketsByPeriod()]);
                lastTicketsData = tix;
            } catch (e) {
                console.warn('tickets fetch for filters failed', e);
            }
            refreshAnalyticsChart();
            refreshMessageChart();
        });
    }

    // CSV export
    function exportCsv() {
        const rows = [];
        rows.push(['metric','value']);
        if (lastAnalyticsData) {
            Object.keys(lastAnalyticsData).forEach(k => rows.push([k, JSON.stringify(lastAnalyticsData[k])]));
        }
        if (lastTicketsData) {
            Object.keys(lastTicketsData).forEach(k => rows.push([`tickets_${k}`, lastTicketsData[k]]));
        }
        if (lastMessagesData) {
            Object.keys(lastMessagesData).forEach(k => rows.push([`messages_${k}`, lastMessagesData[k]]));
        }
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics-export-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCsv);

    // initial KPI load
    loadKPIs();

    // load user-specific metrics and refresh periodically
    refreshMyMetrics();
    setInterval(refreshMyMetrics, 15000);

    socket.on('newMessage', msg => {
        if (msg.sender === 'customer' || msg.sender === 'received') {
            refreshMessageChart();
        }
    });

    socket.on('ticketCreated', refreshAnalyticsChart);
    socket.on('ticketDeleted', refreshAnalyticsChart);
    socket.on('ticketEscalated', refreshAnalyticsChart);
    socket.on('receiptCreated', refreshAnalyticsChart);
    socket.on('receiptDeleted', refreshAnalyticsChart);
    socket.on('connect', () => {
        refreshAnalyticsChart();
        refreshMessageChart();
    });

});