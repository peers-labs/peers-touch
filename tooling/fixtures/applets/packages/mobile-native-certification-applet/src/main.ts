import { sdk } from '@peers-touch/applet-sdk';

const appletDisplayName = "Mobile Native Certification Applet";

export async function runAppletReadinessFlow() {
  const context = await sdk.app.getContext();
  const launchOptions = await sdk.app.getLaunchOptions();
  let observedShow = false;
  const unsubscribeShow = sdk.lifecycle.onShow(() => {
    observedShow = true;
  });
  const unsubscribeHide = sdk.lifecycle.onHide(() => undefined);
  let observedCompletedTaskEvent = false;
  let expectedCompletedTaskId = '';
  const unsubscribeTaskEvent = sdk.events.on('task.event', (event: unknown) => {
    if (
      event &&
      typeof event === 'object' &&
      'state' in event &&
      event.state === 'completed' &&
      'taskId' in event &&
      event.taskId === expectedCompletedTaskId
    ) {
      observedCompletedTaskEvent = true;
    }
  });
  await sdk.events.subscribe('task.event');
  sdk.lifecycle.onPause(() => undefined);
  sdk.lifecycle.onResume(() => undefined);
  await sdk.lifecycle.reportReady();
  await sdk.ui.setNavigationBar({ title: appletDisplayName });
  await sdk.ui.showToast({ message: `${appletDisplayName} ready`, type: 'success' });
  const safeArea = await sdk.device.getSafeArea();
  const windowInfo = await sdk.device.getWindowInfo();
  await sdk.device.vibrate({ durationMs: 10 });
  await sdk.clipboard.setText({ text: 'readiness', userActivated: true });
  const clipboardText = await sdk.clipboard.getText();
  await sdk.file.write({ path: 'readiness/state.json', content: JSON.stringify({ safeArea, windowInfo }) });
  const fileState = await sdk.file.read({ path: 'readiness/state.json' });
  const fileEntries = await sdk.file.list({ path: 'readiness' });
  const fileInfo = await sdk.file.getInfo();
  await sdk.storage.set('lastContext', context);
  const storageKeys = await sdk.storage.keys('last');
  const storageInfo = await sdk.storage.getInfo();

  const station = await sdk.network.request({
    service: 'primary-api',
    path: '/api/v1/e2e',
    method: 'GET',
  });
  const upload = await sdk.network.upload({
    service: 'primary-api',
    path: '/api/v1/e2e/echo',
    body: { fileState },
  });
  const download = await sdk.network.download({
    service: 'primary-api',
    path: '/api/v1/e2e',
    filePath: 'downloads/e2e.json',
  });

  await sdk.skills.register({
    id: 'runtime-summary',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    streaming: true,
    executor: {
      type: 'network',
      request: {
        service: 'primary-api',
        path: '/api/v1/e2e/echo',
        method: 'POST',
      },
    },
  });
  const skills = await sdk.skills.list();
  const skillResult = await sdk.skills.invoke(
    'runtime-summary',
    { message: 'skill-network', storageInfo },
    { stream: true },
  );
  await sdk.skills.register({
    id: 'agent-summary',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    streaming: true,
    executor: { type: 'agent' },
  });
  const agentSkillResult = await sdk.skills.invoke(
    'agent-summary',
    { message: 'skill-agent', metadata: { storageKeys } },
    { stream: true },
  );
  const task = await sdk.tasks.start({
    taskType: 'network',
    input: {
      request: {
        service: 'primary-api',
        path: '/api/v1/e2e/echo',
        method: 'POST',
        body: { message: 'task-network', storageInfo },
      },
    },
  });
  const agentTask = await sdk.tasks.start({
    taskType: 'agent',
    input: {
      message: 'task-agent',
      metadata: { storageKeys },
    },
  });
  const backgroundTask = await sdk.tasks.start({
    taskType: 'readiness',
    input: { storageInfo, networkTaskId: task.taskId, agentTaskId: agentTask.taskId },
    completeAfterMs: 100,
  });
  expectedCompletedTaskId = backgroundTask.taskId;
  const taskEventDeadline = Date.now() + 2500;
  while (!observedCompletedTaskEvent && Date.now() < taskEventDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await sdk.events.unsubscribe('task.event');
  unsubscribeShow();
  unsubscribeHide();
  unsubscribeTaskEvent();
  if (!observedShow) {
    throw new Error('lifecycle.show was not delivered through the Host event bridge');
  }
  if (!observedCompletedTaskEvent) {
    throw new Error('completed task.event was not delivered through the Host event bridge');
  }
  const agent = await sdk.agent.stream({ message: 'Summarize readiness evidence.' }, () => undefined);
  const ai = await sdk.ai.chat({ messages: [{ role: 'user', content: 'Summarize readiness evidence.' }] });
  await sdk.telemetry.track({ name: 'applet.readiness.flow.completed', properties: { taskId: task.taskId, agentTaskId: agentTask.taskId } });

  return { context, launchOptions, safeArea, windowInfo, clipboardText, fileEntries, fileInfo, storageKeys, station, upload, download, skills, skillResult, agentSkillResult, task, backgroundTask, agent, ai };
}

