import { LOGO } from '../core/icons.js';
import { reportURL, watchErrors, ISSUES_URL } from '../core/diagnostics.js';

watchErrors('help');
document.getElementById('logo').innerHTML = LOGO(30);
document.getElementById('version').textContent = `Retake ${chrome.runtime.getManifest().version}`;
document.getElementById('report').addEventListener('click', async () => {
  chrome.tabs.create({ url: await reportURL() });
});
document.getElementById('suggest').addEventListener('click', (e) => {
  e.preventDefault();
  const params = new URLSearchParams({ title: 'Retake idea: ', labels: 'retake,idea', body: '**What would you like Retake to do?**\n\n\n**Why would it help you?**\n' });
  chrome.tabs.create({ url: `${ISSUES_URL}?${params}` });
});
