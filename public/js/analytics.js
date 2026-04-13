// Ensure the DOM is fully loaded before initializing the pie chart
document.addEventListener('DOMContentLoaded', () => {
    const ctx5 = document.getElementById('chart5').getContext('2d');
    const barCtx = document.getElementById('ticketBarChart').getContext('2d');

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
    fetch('/api/tickets-by-period')
        .then(res => {
            if (!res.ok) {
                return res.text().then(text => {
                    throw new Error(`tickets-by-period failed (${res.status}): ${text}`);
                });
            }
            return res.json();
        })
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
        return fetch('/api/analytics')
            .then(res => res.json())
            .then(data => {
                if (!analyticsChart) {
                    analyticsChart = create3DPieChart(ctx5, data);
                } else {
                    updateAnalyticsChart(analyticsChart, data);
                }
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
            });
    }

    refreshAnalyticsChart();

    socket.on('ticketCreated', refreshAnalyticsChart);
    socket.on('ticketDeleted', refreshAnalyticsChart);
    socket.on('ticketEscalated', refreshAnalyticsChart);
    socket.on('receiptCreated', refreshAnalyticsChart);
    socket.on('receiptDeleted', refreshAnalyticsChart);
    socket.on('connect', () => {
        refreshAnalyticsChart();
    });

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
            const res = await fetch('/api/messages-by-period');
            if (!res.ok) {
                const body = await res.text();
                console.error('messages-by-period fetch failed', res.status, body);
                throw new Error('Fetch failed');
            }
            const data = await res.json();
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