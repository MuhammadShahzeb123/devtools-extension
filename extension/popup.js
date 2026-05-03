// extension/popup.js
const dot   = document.getElementById('dot');
const label = document.getElementById('label');
const sub   = document.getElementById('sub');
const btn   = document.getElementById('btn');

function render({ connected, attachedCount, paused }) {
  if (paused) {
    dot.className     = 'dot paused-dot';
    label.textContent = 'Paused';
    sub.textContent   = 'Bridge is stopped — port 1232 not in use';
  } else {
    dot.className     = `dot ${connected ? 'on' : 'off'}`;
    label.textContent = connected ? 'Connected · ws://localhost:1232' : 'Disconnected';
    sub.textContent   = `${attachedCount} tab${attachedCount !== 1 ? 's' : ''} attached`;
  }

  btn.style.display = '';
  if (paused) {
    btn.textContent = 'Resume bridge';
    btn.className   = 'btn resume';
  } else {
    btn.textContent = 'Pause bridge';
    btn.className   = 'btn pause';
  }

  btn.onclick = () => {
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'setPaused', value: !paused }, (res) => {
      if (res) render({ connected: false, attachedCount: 0, paused: res.paused });
    });
  };
}

chrome.runtime.sendMessage({ type: 'status' }, (response) => {
  if (chrome.runtime.lastError || !response) {
    dot.className     = 'dot off';
    label.textContent = 'Error';
    sub.textContent   = chrome.runtime.lastError?.message || 'Could not reach background';
    return;
  }
  render(response);
});
