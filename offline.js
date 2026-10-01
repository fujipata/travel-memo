(() => {
  const status = document.getElementById('offline-status');
  const connection = document.getElementById('connection-status');
  const updateButton = document.getElementById('apply-update');
  const checkButton = document.getElementById('check-update');
  const updateStatus = document.getElementById('update-status');
  let registration;
  let updateRequested = false;
  let checkId = 0;

  function showConnection() {
    connection.textContent = navigator.onLine
      ? '端末はオンラインです。旅行前に機内モードで起動も確認してください。'
      : '端末はオフラインです。iCloudへのバックアップは通信が戻ってから保存してください。';
  }

  function checkOffline() {
    const id = ++checkId;
    const worker = navigator.serviceWorker.controller;
    if (!worker) {
      status.textContent = 'オフライン利用の準備中です。通信がある状態でお待ちください。';
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      if (id === checkId) status.textContent = '準備状況を確認できませんでした。通信がある状態で開き直してください。';
    }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      if (id !== checkId) return;
      status.textContent = event.data.ready
        ? 'オフライン利用の準備ができました。'
        : 'オフライン用の保存が未完了です。通信がある状態で開き直してください。';
    };
    worker.postMessage({type: 'CHECK_OFFLINE'}, [channel.port2]);
  }

  function showUpdate() {
    updateButton.hidden = !registration?.waiting;
    if (registration?.waiting) updateStatus.textContent = '新しい版を用意できました。入力を記録してから更新してください。';
  }

  function watchInstalling() {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') showUpdate();
      if (worker.state === 'activated') checkOffline();
      if (worker.state === 'redundant') {
        updateStatus.textContent = '新しい版の準備に失敗しました。通信を確認し、更新を再確認してください。';
      }
    });
  }

  showConnection();
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'この開き方ではオフライン対応を利用できません。公開URLをSafariで開いてください。';
    checkButton.hidden = true;
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) { window.location.reload(); return; }
    checkOffline();
  });
  window.addEventListener('online', () => { showConnection(); checkOffline(); });
  window.addEventListener('offline', () => { showConnection(); checkOffline(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { showConnection(); checkOffline(); }
  });

  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    try {
      if (!registration) throw new Error('not registered');
      await registration.update();
      showUpdate();
      if (!registration.waiting) updateStatus.textContent = registration.installing
        ? '新しい版を準備しています。' : '更新を確認しました。';
      checkOffline();
    } catch (error) {
      updateStatus.textContent = '更新を確認できませんでした。通信がある状態で開き直してください。';
    } finally { checkButton.disabled = false; }
  });

  updateButton.addEventListener('click', () => {
    if (!registration?.waiting) return;
    if (document.getElementById('amount').value || document.getElementById('memo').value) {
      updateStatus.textContent = '入力中の金額・メモがあります。「記録する」を押すか、入力欄を空にしてから更新してください。';
      return;
    }
    if (!confirm('新しい版へ更新して画面を開き直します。保存済みの記録は残ります。よろしいですか？')) return;
    updateRequested = true;
    updateButton.disabled = true;
    registration.waiting.postMessage({type: 'ACTIVATE_UPDATE'});
  });

  navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
    .then(reg => {
      registration = reg;
      showUpdate();
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      checkOffline();
    }).catch(() => {
      status.textContent = 'オフライン利用の準備に失敗しました。通信がある状態で開き直してください。';
    });
})();
