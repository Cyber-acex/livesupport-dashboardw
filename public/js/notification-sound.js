const notificationSocket = io();

function playNotificationSound(beepCount = 1, beepDuration = 0.25, gap = 0.15) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        for (let i = 0; i < beepCount; i++) {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 1200;
            oscillator.type = 'sine';

            const startTime = audioContext.currentTime + i * (beepDuration + gap);
            gainNode.gain.setValueAtTime(0.0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.6, startTime + 0.02);
            gainNode.gain.setValueAtTime(0.6, startTime + beepDuration - 0.03);
            gainNode.gain.linearRampToValueAtTime(0.0, startTime + beepDuration);

            oscillator.start(startTime);
            oscillator.stop(startTime + beepDuration);
        }
    } catch (error) {
        console.warn('Notification sound failed:', error);
    }
}

function notifyDesktop(message, title = 'LiveSupport') {
    if (localStorage.getItem('msgAlert') !== 'true') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, {
        body: message,
        icon: '/favicon.ico'
    });
}

notificationSocket.on('newMessage', msg => {
    if (localStorage.getItem('soundAlert') === 'true') {
        playNotificationSound();
    }

    if (msg && localStorage.getItem('msgAlert') === 'true' && !document.hasFocus()) {
        notifyDesktop(msg.message || 'You have a new customer message.', 'LiveSupport - New Message');
    }
});

notificationSocket.on('handoffAlert', () => {
    if (localStorage.getItem('soundAlert') === 'true') {
        playNotificationSound(4, 0.3, 0.2);
    }

    if (localStorage.getItem('msgAlert') === 'true' && !document.hasFocus()) {
        notifyDesktop('AI has handed off the chat to staff.', 'LiveSupport - Handoff Alert');
    }
});
