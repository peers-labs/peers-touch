(() => {
  'use strict';

  let operatorToken = '';
  let currentInvites = [];
  let currentEnrollments = [];

  const credentialDialog = document.querySelector('#credential-dialog');
  const credentialForm = document.querySelector('#credential-form');
  const operatorTokenInput = document.querySelector('#operator-token');
  const createDialog = document.querySelector('#create-dialog');
  const createForm = document.querySelector('#create-form');
  const invitationDialog = document.querySelector('#invitation-dialog');
  const invitationOutput = document.querySelector('#invitation-output');
  const pageError = document.querySelector('#page-error');

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = fragment.get('token');
  if (fragmentToken) {
    operatorToken = fragmentToken.trim();
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function showError(message) {
    pageError.textContent = message;
    pageError.classList.remove('hidden');
  }

  function clearError() {
    pageError.textContent = '';
    pageError.classList.add('hidden');
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (operatorToken) headers.set('Authorization', `Bearer ${operatorToken}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { error: raw };
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        operatorToken = '';
        openCredentialDialog();
      }
      throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
    }
    return payload;
  }

  function openCredentialDialog() {
    operatorTokenInput.value = '';
    if (!credentialDialog.open) credentialDialog.showModal();
    window.setTimeout(() => operatorTokenInput.focus(), 0);
  }

  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function setStats(stats) {
    document.querySelector('#stat-nodes').textContent = stats.admitted_nodes ?? '-';
    document.querySelector('#stat-routes').textContent = stats.active_routes ?? '-';
    document.querySelector('#stat-permits').textContent = stats.active_permits ?? '-';
    document.querySelector('#stat-capacity').textContent = stats.max_stations ?? '-';
  }

  function appendCell(row, content) {
    const cell = document.createElement('td');
    if (content instanceof Node) cell.append(content);
    else cell.textContent = String(content ?? '');
    row.append(cell);
    return cell;
  }

  function renderInvites() {
    const body = document.querySelector('#invite-rows');
    const empty = document.querySelector('#invite-empty');
    body.replaceChildren();
    empty.classList.toggle('hidden', currentInvites.length !== 0);
    currentInvites.forEach((invite) => {
      const row = document.createElement('tr');
      appendCell(row, invite.label || 'Invitation');
      const station = element('code', invite.intended_station_peer_id || 'Any Station');
      station.title = invite.intended_station_peer_id || 'Any Station';
      appendCell(row, station);
      const status = element(
        'span',
        invite.status === 1 ? 'Active' : 'Consumed',
        `status ${invite.status === 1 ? 'active' : 'consumed'}`,
      );
      appendCell(row, status);
      appendCell(row, formatTime(invite.created_at));
      const actions = element('div', null, 'row-actions');
      if (invite.status === 1) {
        const deleteButton = element('button', 'Delete', 'button danger');
        deleteButton.type = 'button';
        deleteButton.addEventListener('click', () => deleteInvite(invite.id));
        actions.append(deleteButton);
      }
      appendCell(row, actions);
      body.append(row);
    });
  }

  function renderEnrollments() {
    const body = document.querySelector('#enrollment-rows');
    const empty = document.querySelector('#enrollment-empty');
    body.replaceChildren();
    empty.classList.toggle('hidden', currentEnrollments.length !== 0);
    currentEnrollments.forEach((enrollment) => {
      const row = document.createElement('tr');
      appendCell(row, enrollment.label || 'Station');
      const station = element('code', enrollment.station_peer_id);
      station.title = enrollment.station_peer_id;
      appendCell(row, station);
      const node = element('code', enrollment.node_peer_id);
      node.title = enrollment.node_peer_id;
      appendCell(row, node);
      appendCell(row, enrollment.generation);
      const actions = element('div', null, 'row-actions');
      const revokeButton = element('button', 'Revoke', 'button danger');
      revokeButton.type = 'button';
      revokeButton.addEventListener('click', () => revokeEnrollment(enrollment));
      actions.append(revokeButton);
      appendCell(row, actions);
      body.append(row);
    });
  }

  async function refresh() {
    if (!operatorToken) {
      openCredentialDialog();
      return;
    }
    clearError();
    try {
      const [health, stats, inviteResult, enrollmentResult] = await Promise.all([
        request('/healthz'),
        request('/api/v1/relay/stats'),
        request('/api/v1/relay/invites'),
        request('/api/v1/relay/enrollments'),
      ]);
      document.querySelector('#relay-identity').textContent = health.peer_id || 'Relay';
      setStats(stats);
      currentInvites = inviteResult.invites || [];
      currentEnrollments = enrollmentResult.enrollments || [];
      renderInvites();
      renderEnrollments();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to load Relay state');
    }
  }

  async function deleteInvite(inviteID) {
    if (!window.confirm('Delete this active invitation?')) return;
    try {
      await request('/api/v1/relay/invite', {
        method: 'DELETE',
        body: JSON.stringify({ invite_id: inviteID }),
      });
      await refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete invitation');
    }
  }

  async function revokeEnrollment(enrollment) {
    if (!window.confirm('Revoke this Station enrollment?')) return;
    try {
      await request('/api/v1/relay/enrollment', {
        method: 'DELETE',
        body: JSON.stringify({
          station_peer_id: enrollment.station_peer_id,
          node_peer_id: enrollment.node_peer_id,
        }),
      });
      await refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to revoke enrollment');
    }
  }

  credentialForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const nextToken = operatorTokenInput.value.trim();
    if (!nextToken) return;
    operatorToken = nextToken;
    credentialDialog.close();
    refresh();
  });

  document.querySelector('#change-token').addEventListener('click', openCredentialDialog);
  document.querySelector('#refresh').addEventListener('click', refresh);
  document.querySelector('#open-create').addEventListener('click', () => {
    document.querySelector('#create-error').classList.add('hidden');
    createDialog.showModal();
  });
  document.querySelector('#cancel-create').addEventListener('click', () => {
    createDialog.close();
  });
  document.querySelector('#close-invitation').addEventListener('click', () => {
    invitationDialog.close();
  });
  document.querySelector('#copy-invitation').addEventListener('click', async () => {
    await navigator.clipboard.writeText(invitationOutput.value);
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = document.querySelector('#create-error');
    errorBox.classList.add('hidden');
    try {
      const result = await request('/api/v1/relay/invite', {
        method: 'POST',
        body: JSON.stringify({
          station_peer_id: document.querySelector('#station-peer-id').value.trim(),
          label: document.querySelector('#invite-label').value.trim(),
          max_clients: Number(document.querySelector('#max-clients').value || 0),
          bandwidth_limit: Number(document.querySelector('#bandwidth-limit').value || 0),
        }),
      });
      invitationOutput.value = JSON.stringify(result.invitation, null, 2);
      createDialog.close();
      invitationDialog.showModal();
      createForm.reset();
      document.querySelector('#max-clients').value = '0';
      document.querySelector('#bandwidth-limit').value = '0';
      await refresh();
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : 'Failed to create invitation';
      errorBox.classList.remove('hidden');
    }
  });

  if (operatorToken) refresh();
  else openCredentialDialog();
})();
