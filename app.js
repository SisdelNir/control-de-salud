// app.js

// Estado global de la aplicación
let medications = JSON.parse(localStorage.getItem('medications')) || [];

// Permisos para notificaciones del navegador
if ("Notification" in window) {
    Notification.requestPermission();
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    updateDateDisplay();
    renderTimeline();
    setupForm();
    startAlertChecker();
});

function updateDateDisplay() {
    const dateEl = document.getElementById('current-date');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = new Date().toLocaleDateString('es-ES', options);
}

function setupForm() {
    const form = document.getElementById('medication-form');

    // Asignar hora actual por defecto
    const now = new Date();
    document.getElementById('med-start').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('med-name').value;
        const dose = document.getElementById('med-dose').value;
        const freqHours = parseInt(document.getElementById('med-freq').value, 10);
        const startTime = document.getElementById('med-start').value;
        const durationDays = parseInt(document.getElementById('med-duration').value, 10);

        const newMed = {
            id: Date.now().toString(),
            name,
            dose,
            freqHours,
            startTime,
            durationDays,
            startDate: new Date().toISOString(),
            takenLog: [] // Guardar logs de tomas: [timestamp, timestamp]
        };

        medications.push(newMed);
        saveData();
        renderTimeline();
        form.reset();

        // Restaurar hora actual tras reset
        document.getElementById('med-start').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        alert(`¡${name} programado con éxito!`);
    });
}

function saveData() {
    localStorage.setItem('medications', JSON.stringify(medications));
}

// Genera los eventos del día actual basados en la configuración de la medicina
function getTodaySchedule() {
    const schedule = [];
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    medications.forEach(med => {
        const treatmentStart = new Date(med.startDate);
        const [startH, startM] = med.startTime.split(':').map(Number);

        let doseTime = new Date(treatmentStart);
        doseTime.setHours(startH, startM, 0, 0);

        const treatmentEnd = new Date(treatmentStart);
        treatmentEnd.setDate(treatmentStart.getDate() + med.durationDays);
        treatmentEnd.setHours(23, 59, 59, 999);

        if (now < startOfToday || now > treatmentEnd) return;

        // Avanzar hasta llegar a hoy para mantener el ritmo exacto
        while (doseTime < startOfToday) {
            doseTime.setHours(doseTime.getHours() + med.freqHours);
        }

        // Registrar solo las de las próximas 24 horas (hoy)
        while (doseTime <= endOfToday && doseTime <= treatmentEnd) {
            if (doseTime >= startOfToday) {
                const timeStr = `${String(doseTime.getHours()).padStart(2, '0')}:${String(doseTime.getMinutes()).padStart(2, '0')}`;
                const instanceId = `${med.id}-${doseTime.getTime()}`; // ID basado en timestamp exacto
                const isTaken = med.takenLog.includes(instanceId);

                schedule.push({
                    instanceId,
                    medId: med.id,
                    name: med.name,
                    dose: med.dose,
                    time: new Date(doseTime),
                    timeString: timeStr,
                    isTaken
                });
            }
            doseTime.setHours(doseTime.getHours() + med.freqHours);
        }
    });

    return schedule.sort((a, b) => a.time - b.time);
}

function renderTimeline() {
    const timelineEl = document.getElementById('timeline');
    const emptyStateEl = document.getElementById('empty-state');
    const schedule = getTodaySchedule();

    timelineEl.innerHTML = '';

    if (schedule.length === 0) {
        timelineEl.style.display = 'none';
        emptyStateEl.style.display = 'block';
        return;
    }

    timelineEl.style.display = 'flex';
    emptyStateEl.style.display = 'none';

    schedule.forEach(item => {
        const el = document.createElement('div');
        el.className = `timeline-item ${item.isTaken ? 'taken' : ''}`;

        el.innerHTML = `
            <div class="timeline-time">${item.timeString}</div>
            <div class="timeline-content">
                <div class="timeline-med">${item.name}</div>
                <div class="timeline-dose">${item.dose}</div>
            </div>
        `;

        // Permitir marcar como tomado desde el timeline
        el.addEventListener('click', () => {
            if (!item.isTaken) markAsTaken(item.medId, item.instanceId);
        });

        timelineEl.appendChild(el);
    });
}

function markAsTaken(medId, instanceId) {
    const med = medications.find(m => m.id === medId);
    if (med && !med.takenLog.includes(instanceId)) {
        med.takenLog.push(instanceId);
        saveData();
        renderTimeline();
        hideAlert(); // Por si venía de un alert
    }
}

// --- Sistema de Alertas ---
let alertCheckerInterval;
let currentAlertItem = null;
let snoozeUntil = {}; // Registro de cuándo volver a avisar: { instanceId: timestamp }

function startAlertChecker() {
    // Revisar inmediatamente y luego cada 15 segundos
    checkAlerts();
    alertCheckerInterval = setInterval(checkAlerts, 15000);
}

let lastCheckDate = new Date().toDateString();

function checkAlerts() {
    const now = new Date();
    const nowMs = now.getTime();

    // Si el día cambió, actualizar toda la UI
    if (now.toDateString() !== lastCheckDate) {
        lastCheckDate = now.toDateString();
        updateDateDisplay();
        renderTimeline();
    }

    const schedule = getTodaySchedule();

    // Buscar la toma más antigua que ya debió ocurrir y no ha sido tomada ni pospuesta
    const pendingItem = schedule.find(item => {
        const isSnoozed = snoozeUntil[item.instanceId] && nowMs < snoozeUntil[item.instanceId];
        return !item.isTaken && item.time <= now && !isSnoozed;
    });

    if (pendingItem) {
        // Si hay algo pendiente y no estamos mostrando ya ESA alerta, dispararla
        if (!currentAlertItem || currentAlertItem.instanceId !== pendingItem.instanceId) {
            triggerAlert(pendingItem);
        }
    } else {
        // Si no hay pendientes (o fueron pospuestos/tomados), ocultar el modal si estaba abierto
        // pero solo si lo que se estaba mostrando ya no es "pendiente" o fue pospuesto
        if (currentAlertItem) {
            const stillUnfinished = schedule.find(it => it.instanceId === currentAlertItem.instanceId && !it.isTaken);
            const nowIsSnoozed = snoozeUntil[currentAlertItem.instanceId] && nowMs < snoozeUntil[currentAlertItem.instanceId];

            if (!stillUnfinished || nowIsSnoozed) {
                hideAlert();
            }
        }
    }
}

let lastNotifiedId = null;

function triggerAlert(item) {
    currentAlertItem = item;

    // Mostrar modal in-app con animaciones
    const modalContent = document.querySelector('.modal-content');
    modalContent.classList.add('pulse-alert');

    // Ícono de campana sonando
    const iconContainer = document.getElementById('alert-icon-container');
    if (iconContainer) iconContainer.innerHTML = '<span class="bell-animation">🔔</span>';

    const medNameEl = document.getElementById('alert-med-name');
    medNameEl.textContent = item.name;
    medNameEl.classList.add('blink-text');

    const medDoseEl = document.getElementById('alert-med-dose');
    medDoseEl.textContent = item.dose;
    medDoseEl.classList.add('blink-text');

    document.getElementById('alert-modal').classList.remove('hidden');

    // Evitar ruidos/notificaciones repetitivas para el mismo ID seguidos
    if (lastNotifiedId !== item.instanceId) {
        playChime();

        if (Notification.permission === "granted") {
            new Notification("SaludTrack: Hora de tu medicina", {
                body: `Toma ahora: ${item.name} (${item.dose})`,
                tag: item.instanceId, // Evita duplicados en el centro de notificaciones
                requireInteraction: true, // En navegadores que lo soportan, mantiene la notif.
                icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💊</text></svg>'
            });
        }
        lastNotifiedId = item.instanceId;
    }
}

function hideAlert() {
    document.getElementById('alert-modal').classList.add('hidden');
    document.querySelector('.modal-content').classList.remove('pulse-alert');
    document.getElementById('alert-med-name').classList.remove('blink-text');
    document.getElementById('alert-med-dose').classList.remove('blink-text');
    currentAlertItem = null;
}

// Botones del Modal
document.getElementById('btn-take-med').addEventListener('click', () => {
    if (currentAlertItem) {
        markAsTaken(currentAlertItem.medId, currentAlertItem.instanceId);
        playApplause(); // EFECTO VISUAL Y SONORO
    }
});

document.getElementById('btn-snooze').addEventListener('click', () => {
    if (currentAlertItem) {
        // Posponer 10 minutos desde ahora
        const snoozeTime = new Date().getTime() + (10 * 60 * 1000);
        snoozeUntil[currentAlertItem.instanceId] = snoozeTime;

        // Reset lastNotifiedId para que vuelva a sonar cuando pase el snooze
        if (lastNotifiedId === currentAlertItem.instanceId) {
            lastNotifiedId = null;
        }

        hideAlert();
        console.log(`Pospuesto hasta: ${new Date(snoozeTime).toLocaleTimeString()}`);
    }
});

function playChime() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);

        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 1);
    } catch (e) {
        console.log("Audio API no soportada o bloqueada");
    }
}

function playApplause() {
    // EFECO VISUAL: Lluvia de aplausos (emoji confeti)
    const container = document.body;
    for (let i = 0; i < 20; i++) {
        const emoji = document.createElement('div');
        emoji.className = 'applause-emoji';
        emoji.textContent = '👏';
        
        // Posición aleatoria horizontal
        emoji.style.left = Math.random() * 100 + 'vw';
        // Retraso aleatorio para el efecto de lluvia
        emoji.style.animationDelay = Math.random() * 0.5 + 's';
        
        container.appendChild(emoji);
        
        // Limpiar elemento después de la animación
        setTimeout(() => emoji.remove(), 2500);
    }

    // EFECTO SONORO: Palmadas sintéticas
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        for (let i = 0; i < 8; i++) {
            const bufferSize = audioCtx.sampleRate * 0.2;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let j = 0; j < bufferSize; j++) {
                data[j] = Math.random() * 2 - 1;
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1200 + (Math.random() * 500);
            filter.Q.value = 1;
            const gainNode = audioCtx.createGain();
            const startTime = audioCtx.currentTime + (i * 0.08);
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
            noise.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            noise.start(startTime);
            noise.stop(startTime + 0.2);
        }
    } catch (e) {
        console.log("Error al reproducir aplauso sonoro");
    }
}

// Botón de Borrar Historial con Clave
document.getElementById('btn-clear-history').addEventListener('click', () => {
    const password = prompt("Por favor, ingresa la clave para borrar el historial de tomas:");

    if (password === "N55211") {
        if (confirm("¿Estás seguro de que deseas borrar solo el HISTORIAL de tomas? Los medicamentos se mantendrán.")) {
            medications.forEach(med => {
                med.takenLog = [];
            });
            saveData();
            renderTimeline();
            alert("Historial borrado con éxito.");
        }
    } else if (password !== null) {
        alert("Clave incorrecta. No se han realizado cambios.");
    }
});

// Botón de Reinicio Total con Clave
document.getElementById('btn-reset-app').addEventListener('click', () => {
    const password = prompt("Por favor, ingresa la clave para borrar TODOS los datos:");

    if (password === "N55211") {
        if (confirm("¿Estás seguro de que deseas borrar TODA la configuración y medicamentos? Esta acción no se puede deshacer.")) {
            localStorage.clear();
            location.reload();
        }
    } else if (password !== null) {
        alert("Clave incorrecta. No se han realizado cambios.");
    }
});
