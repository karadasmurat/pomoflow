let timerInterval = null;
let endTime = null;

self.onmessage = function(e) {
    if (e.data.action === 'start') {
        endTime = e.data.endTime;
        if (timerInterval) clearInterval(timerInterval);
        
        timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
            
            self.postMessage({ 
                action: 'tick', 
                remaining: remaining 
            });
            
            if (remaining <= 0) {
                clearInterval(timerInterval);
            }
        }, 500); // Check twice a second for accuracy
    } else if (e.data.action === 'stop') {
        if (timerInterval) clearInterval(timerInterval);
    }
};
