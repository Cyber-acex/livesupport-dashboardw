// Ensure the DOM is fully loaded before initializing the pie chart
document.addEventListener('DOMContentLoaded', () => {
    const ctx5 = document.getElementById('chart5').getContext('2d');

    // Fetch live data and render the 3D pie chart
    function create3DPieChart(ctx, data) {
        const colors = [
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

        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Chats', 'Escalated Chats', 'Tickets', 'Escalated Tickets', 'Resolved Chats'],
                datasets: [{
                    label: 'Overview',
                    data: [
                        data.numChats,
                        data.numEscalatedChats,
                        data.numTickets,
                        data.numEscalatedTickets,
                        data.numResolvedChats
                    ],
                    backgroundColor: colors,
                    borderColor: [
                        '#0097a7', '#ff9800', '#1976d2', '#d32f2f', '#7b1fa2'
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

    // Fetch data and render the chart
    fetch('/api/analytics')
        .then(res => res.json())
        .then(data => {
            create3DPieChart(ctx5, data);
        })
        .catch(() => {
            // fallback to placeholder data if fetch fails
            create3DPieChart(ctx5, {
                numChats: 10,
                numEscalatedChats: 8,
                numTickets: 20,
                numEscalatedTickets: 5,
                numResolvedChats: 15
            });
        });
});