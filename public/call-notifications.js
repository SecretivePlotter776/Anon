(() => {
  const supported = 'Notification' in window;
  if (!supported) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = Notification.permission === 'granted' ? 'Call alerts on' : 'Enable call alerts';
  button.setAttribute('aria-label', 'Enable browser notifications for incoming voice calls');
  Object.assign(button.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '20',
    border: '1px solid #596041', borderRadius: '8px', padding: '9px 12px',
    color: '#c6f277', background: '#1b1c21', font: '12px sans-serif', cursor: 'pointer',
    display: 'none'
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(button);
    const refresh = () => {
      const app = document.querySelector('#appView');
      const signedIn = app && getComputedStyle(app).display !== 'none';
      button.style.display = signedIn && Notification.permission !== 'granted' ? 'block' : 'none';
      button.textContent = Notification.permission === 'granted' ? 'Call alerts on' : 'Enable call alerts';
    };
    refresh();
    setInterval(refresh, 1500);
    button.addEventListener('click', async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          button.style.display = 'none';
          window.dispatchEvent(new CustomEvent('anon-toast', { detail: 'Call notifications enabled.' }));
        } else {
          button.textContent = 'Allow alerts in browser settings';
        }
      } catch { button.textContent = 'Notifications unavailable'; }
    });
  });

  // Wrap Socket.IO so incoming-call events also create a system notification while the
  // app is open. The app's existing incoming-call dialog remains available as fallback.
  const originalIo = window.io;
  if (typeof originalIo !== 'function') return;
  const wrappedIo = function (...args) {
    const socket = originalIo.apply(this, args);
    const originalOn = socket.on.bind(socket);
    socket.on = function (event, listener) {
      if (event === 'incoming-call') {
        return originalOn(event, data => {
          if (Notification.permission === 'granted') {
            const notice = new Notification(`${data?.from || 'Someone'} is calling`, {
              body: 'Incoming voice call · Tap to return to Anon',
              tag: `anon-call-${data?.callId || 'incoming'}`,
              renotify: true
            });
            notice.onclick = () => { window.focus(); notice.close(); };
          }
          return listener.call(this, data);
        });
      }
      return originalOn(event, listener);
    };
    return socket;
  };
  Object.assign(wrappedIo, originalIo);
  window.io = wrappedIo;
  window.addEventListener('anon-toast', event => {
    const toast = document.querySelector('#toast');
    if (toast) { toast.textContent = event.detail; toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, 3000); }
  });
})();
