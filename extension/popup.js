// extension/popup.js
chrome.runtime.sendMessage({ type: 'status' }, (response) => {
  const dot   = document.getElementById('dot');
  const label = document.getElementById('label');
  const sub   = document.getElementById('sub');

  if (chrome.runtime.lastError || !response) {
    dot.className   = 'dot off';
    label.textContent = 'Error';
    sub.textContent   = chrome.runtime.lastError?.message || 'Could not reach background';
    return;
  }

  dot.className     = `dot ${response.connected ? 'on' : 'off'}`;
  label.textContent = response.connected ? 'Connected · ws://localhost:1232' : 'Disconnected';
  sub.textContent   = `${response.attachedCount} tab${response.attachedCount !== 1 ? 's' : ''} attached`;
});
